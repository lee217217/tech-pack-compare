/**
 * Path: src/agents/coordinatorAgent.js
 * Purpose: 編排 extractor + 4 specialist agents + summarizer + qaReview，
 *          最後組裝 workflowResult envelope（符合 workflowResult.schema.json）。
 *          支援 5 種 outputMode：FULL / SUMMARY / MEASUREMENT_ONLY / BOM_ONLY / DEBUG_ALL。
 * Depends on:
 *   - src/agents/extractorAgent.js / measurementAgent.js / commentAgent.js / imageAgent.js / bomAgent.js / summarizerAgent.js / qaReviewAgent.js
 *   - src/services/llmClient.js (health)
 *   - src/services/cacheService.js (stats)
 *   - src/services/schemaValidator.js (validate)
 *   - src/schemas/index.js
 *   - src/utils/hash.js (makeRequestId)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js
 *   - src/config/limits.js (FEATURES)
 *
 * 變更日期 / 改動原因：
 *   2026-05-18  初版（Group D2）— 新增 BOM_ONLY / DEBUG_ALL，並回填 agentStatus + warnings
 */

import { runExtractorAgent } from './extractorAgent.js';
import { runMeasurementAgent } from './measurementAgent.js';
import { runCommentAgent } from './commentAgent.js';
import { runImageAgent } from './imageAgent.js';
import { runBomAgent } from './bomAgent.js';
import { runSummarizerAgent } from './summarizerAgent.js';
import { runQaReviewAgent } from './qaReviewAgent.js';
import { health as llmHealth } from '../services/llmClient.js';
import { stats as cacheStats } from '../services/cacheService.js';
import { validate } from '../services/schemaValidator.js';
import { SCHEMA_NAMES } from '../schemas/index.js';
import { makeRequestId } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';
import { FEATURES } from '../config/limits.js';

export const SUPPORTED_OUTPUT_MODES = ['FULL', 'SUMMARY', 'MEASUREMENT_ONLY', 'BOM_ONLY', 'DEBUG_ALL'];
const VERSION = 'v2.0.0';

const AGENT_KEYS = ['extractor', 'measurement', 'comment', 'image', 'bom', 'summarizer', 'qaReview'];

/**
 * 強制 outputMode 落在白名單內，否則退回 FULL。
 * @param {string} mode
 * @returns {string}
 */
export function normalizeOutputMode(mode) {
  const m = typeof mode === 'string' ? mode.toUpperCase() : '';
  return SUPPORTED_OUTPUT_MODES.includes(m) ? m : 'FULL';
}

/**
 * 編排整個 workflow。永遠回傳合法的 workflowResult envelope；
 * 只有 auth / rate limit / 整體 crash 才 success=false。
 * @param {object} param0
 * @param {object} param0.input
 * @param {string} [param0.outputMode]
 * @param {object} [param0.context]    { debugAllowed?, outputMode?, license? }
 * @param {string} [param0.requestId]
 * @returns {Promise<object>} workflowResult envelope
 */
export async function runCoordinatorAgent({
  input = {},
  outputMode = 'FULL',
  context = {},
  requestId = null
} = {}) {
  const startTime = Date.now();
  const reqId = requestId || makeRequestId();
  const log = logger.child({ agent: 'coordinator', requestId: reqId });

  let mode = normalizeOutputMode(outputMode);
  const warnings = [];

  // ---------- DEBUG_ALL guard ----------
  if (mode === 'DEBUG_ALL' && context.debugAllowed !== true) {
    warnings.push('DEBUG_ALL 未授權，已自動降級為 FULL');
    log.warn('coordinator.debug_downgrade');
    mode = 'FULL';
  }

  // ---------- workflow_log + agentStatus 初始化 ----------
  const workflowLog = AGENT_KEYS.map((agent) => ({
    agent,
    status: 'PENDING',
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_ms: null,
    tokens_used: 0,
    error_message: null
  }));
  const agentStatus = AGENT_KEYS.reduce((acc, k) => ({ ...acc, [k]: 'PENDING' }), {});

  // 5 種 mode 共用：先決定哪些 specialist 要跑
  const plan = planForMode(mode);
  for (const a of AGENT_KEYS) {
    if (!plan.run.has(a)) {
      setLog(workflowLog, agentStatus, a, 'SKIPPED');
    }
  }

  // ---------- helpers in closure ----------
  const agentMeta = {}; // for DEBUG_ALL: agent => { warnings, error }
  let totalTokens = 0;

  async function runOne(agentKey, fn) {
    const entry = workflowLog.find((x) => x.agent === agentKey);
    entry.status = 'RUNNING';
    agentStatus[agentKey] = 'RUNNING';
    const t0 = Date.now();
    entry.started_at = new Date(t0).toISOString();
    try {
      const result = await fn();
      const t1 = Date.now();
      entry.ended_at = new Date(t1).toISOString();
      entry.duration_ms = t1 - t0;
      // KI-006 fix: agent 可能回傳單一 tokensUsed（其中一個 llmClient.chat）或在 result.meta.tokensUsed；
      // 同時允許多次調用累加。agent 回傳克同 result.tokensUsed、result.meta?.tokensUsed 或 result.tokens_used。
      const at = pickAgentTokens(result);
      entry.tokens_used = at;
      totalTokens += at;
      entry.status = 'DONE';
      agentStatus[agentKey] = 'DONE';
      if (result?.warnings?.length) warnings.push(...result.warnings.map((w) => `[${agentKey}] ${w}`));
      if (result?.error) {
        // ok=true 但內含 error → 視為 partial fallback (DONE + warning)
        warnings.push(`[${agentKey}] partial fallback: ${result.error}`);
      }
      agentMeta[agentKey] = {
        warnings: result?.warnings || [],
        error: result?.error || null
      };
      return result;
    } catch (err) {
      const t1 = Date.now();
      entry.ended_at = new Date(t1).toISOString();
      entry.duration_ms = t1 - t0;
      entry.status = 'ERROR';
      entry.error_message = (err?.message || String(err)).slice(0, 1000);
      agentStatus[agentKey] = 'ERROR';
      warnings.push(`[${agentKey}] crashed: ${entry.error_message}`);
      agentMeta[agentKey] = { warnings: [], error: entry.error_message };
      log.error('coordinator.agent_crashed', { agent: agentKey, err: entry.error_message });
      return null;
    }
  }

  try {
    // ---------- Step 1: extractor (always) ----------
    const extractorRes = await runOne('extractor', () =>
      runExtractorAgent({ input, context, requestId: reqId })
    );
    const extracted = extractorRes?.data || fallbackExtracted();

    // ---------- Step 2: specialist agents (parallel where requested) ----------
    let measurement = [];
    let comments = [];
    let images = [];
    let bom = [];

    const tasks = [];
    if (plan.run.has('measurement')) {
      tasks.push(
        runOne('measurement', () => runMeasurementAgent({ input: extracted, context, requestId: reqId }))
          .then((r) => { measurement = Array.isArray(r?.data) ? r.data : []; })
      );
    }
    if (plan.run.has('comment')) {
      tasks.push(
        runOne('comment', () => runCommentAgent({ input: extracted, context, requestId: reqId }))
          .then((r) => { comments = Array.isArray(r?.data) ? r.data : []; })
      );
    }
    if (plan.run.has('image')) {
      tasks.push(
        runOne('image', () => runImageAgent({ input: extracted, context, requestId: reqId }))
          .then((r) => { images = Array.isArray(r?.data) ? r.data : []; })
      );
    }
    if (plan.run.has('bom')) {
      tasks.push(
        runOne('bom', () => runBomAgent({ input: extracted, context, requestId: reqId }))
          .then((r) => { bom = Array.isArray(r?.data) ? r.data : []; })
      );
    }

    // Promise.allSettled 確保單一 agent fail 不會拖垮其他
    await Promise.allSettled(tasks);

    // ---------- Step 3: summarizer ----------
    let summary = null;
    if (plan.run.has('summarizer')) {
      const sRes = await runOne('summarizer', () =>
        runSummarizerAgent({
          input: {
            measurement_changes: measurement,
            comment_changes: comments,
            image_changes: images,
            bom_changes: bom
          },
          context,
          requestId: reqId
        })
      );
      summary = sRes?.data || null;

      // SUMMARY mode: 若沒 specialist artifact，加 note
      if (mode === 'SUMMARY' && summary && (measurement.length + comments.length + images.length + bom.length === 0)) {
        summary.bullet_points = ['（SUMMARY mode）未執行詳細差異分析，僅根據原文摘要產生報告。', ...(summary.bullet_points || [])].slice(0, 12);
      }
    }

    // ---------- Step 4: qaReview ----------
    let qaReview = null;
    if (FEATURES.enableQaReview && plan.run.has('qaReview')) {
      const qRes = await runOne('qaReview', () =>
        runQaReviewAgent({
          input: {
            measurement_changes: measurement,
            comments,
            images,
            bom_changes: bom,
            summary,
            workflow_log: workflowLog
          },
          context: { ...context, outputMode: mode },
          requestId: reqId
        })
      );
      qaReview = qRes?.data || null;
    } else {
      setLog(workflowLog, agentStatus, 'qaReview', 'SKIPPED');
    }

    // ---------- Step 5: assemble envelope ----------
    const provider = pickProvider();
    const duration_ms = Date.now() - startTime;

    const data = {
      request_id: reqId,
      output_mode: outputMode === 'DEBUG_ALL' && mode === 'FULL' ? 'FULL' : mode,
      artifacts: {
        measurement_changes: measurement,
        comments,
        images,
        bom_changes: bom,
        summary,
        qa_review: qaReview
      },
      agentStatus,
      workflow_log: workflowLog
    };

    const meta = {
      version: VERSION,
      duration_ms,
      total_tokens: totalTokens,
      provider,
      cached: false,
      warnings: warnings.slice(0, 100)
    };

    if (mode === 'DEBUG_ALL') {
      meta.debug = buildDebugMeta({ agentMeta, workflowLog, startTime });
    } else {
      meta.debug = null;
    }

    const envelope = {
      success: true,
      data,
      error: null,
      meta
    };

    const v = validate(SCHEMA_NAMES.WORKFLOW_RESULT, envelope);
    if (!v.valid) {
      log.error('coordinator.envelope_invalid', { errors: v.errors });
      // 退回 fail envelope（但 partial data 嘗試保留）
      return failEnvelope({
        reqId,
        mode,
        code: 'WORKFLOW_RESULT_INVALID',
        message: `workflowResult schema validate fail: ${v.errors?.[0]?.message || 'unknown'}`,
        duration_ms,
        warnings
      });
    }

    log.info('coordinator.done', {
      mode,
      qa: qaReview?.status,
      m: measurement.length,
      c: comments.length,
      i: images.length,
      b: bom.length,
      warnings: warnings.length,
      duration_ms
    });

    return v.value;
  } catch (err) {
    log.error('coordinator.crashed', { err: err?.message, stack: err?.stack?.slice(0, 500) });
    return failEnvelope({
      reqId,
      mode,
      code: 'WORKFLOW_CRASHED',
      message: t('error.workflow_crashed') || `Workflow 整體失敗：${err?.message || '未知錯誤'}`,
      duration_ms: Date.now() - startTime,
      warnings
    });
  }
}

// ---------- helpers ----------

/**
 * 从 agent result 抽 token 計數。Agent 可能在 result.tokensUsed / result.meta.tokensUsed /
 * result.tokens_used 以太人都看不懂的方式回，都接住。預設 0 不會損部 envelope。
 */
function pickAgentTokens(result) {
  if (!result || typeof result !== 'object') return 0;
  if (typeof result.tokensUsed === 'number') return result.tokensUsed;
  if (typeof result.tokens_used === 'number') return result.tokens_used;
  if (typeof result?.meta?.tokensUsed === 'number') return result.meta.tokensUsed;
  if (typeof result?.meta?.total_tokens === 'number') return result.meta.total_tokens;
  return 0;
}

function planForMode(mode) {
  // run: 此次要跑的 agent keys
  const all = new Set(['extractor', 'measurement', 'comment', 'image', 'bom', 'summarizer', 'qaReview']);
  switch (mode) {
    case 'SUMMARY':
      return { run: new Set(['extractor', 'summarizer', 'qaReview']) };
    case 'MEASUREMENT_ONLY':
      return { run: new Set(['extractor', 'measurement', 'summarizer', 'qaReview']) };
    case 'BOM_ONLY':
      return { run: new Set(['extractor', 'bom', 'summarizer', 'qaReview']) };
    case 'FULL':
    case 'DEBUG_ALL':
    default:
      return { run: all };
  }
}

function setLog(workflowLog, agentStatus, agentKey, status) {
  const entry = workflowLog.find((x) => x.agent === agentKey);
  if (entry) {
    entry.status = status;
    entry.ended_at = new Date().toISOString();
    entry.duration_ms = 0;
  }
  agentStatus[agentKey] = status;
}

function pickProvider() {
  try {
    const h = llmHealth?.() || {};
    return h.provider || process.env.LLM_PROVIDER || 'mock';
  } catch {
    return process.env.LLM_PROVIDER || 'mock';
  }
}

function buildDebugMeta({ agentMeta, workflowLog, startTime }) {
  let provHealth = null;
  let cache = null;
  try { provHealth = llmHealth(); } catch (e) { provHealth = { error: e?.message }; }
  try { cache = cacheStats(); } catch (e) { cache = { error: e?.message }; }
  return {
    agent_meta: agentMeta,
    provider_health: provHealth,
    cache_stats: cache,
    workflow_timings: workflowLog.map((l) => ({
      agent: l.agent,
      status: l.status,
      duration_ms: l.duration_ms
    })),
    started_at: new Date(startTime).toISOString(),
    note: 'DEBUG_ALL output — 只應用於 admin license 或 LLM_PROVIDER=mock 開發環境'
  };
}

function fallbackExtracted() {
  return {
    docA: { doc_label: 'A', pages: [{ page: 1, text: '', imageBase64: null }], metadata: { brand: null, style: null, season: null, color: null, fabric: null, doc_hash: 'empty' }, bom_table_raw: null, size_table_raw: null },
    docB: { doc_label: 'B', pages: [{ page: 1, text: '', imageBase64: null }], metadata: { brand: null, style: null, season: null, color: null, fabric: null, doc_hash: 'empty' }, bom_table_raw: null, size_table_raw: null },
    buyer_comments: '',
    warnings: []
  };
}

function failEnvelope({ reqId, mode, code, message, duration_ms, warnings }) {
  return {
    success: false,
    data: null,
    error: { code, message, detail: null },
    meta: {
      version: VERSION,
      duration_ms: typeof duration_ms === 'number' ? duration_ms : 0,
      total_tokens: 0,
      provider: pickProvider(),
      cached: false,
      warnings: (warnings || []).slice(0, 100),
      debug: null
    }
  };
}

export default { runCoordinatorAgent, SUPPORTED_OUTPUT_MODES, normalizeOutputMode };
