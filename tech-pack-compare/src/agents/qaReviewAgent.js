/**
 * Path: src/agents/qaReviewAgent.js
 * Purpose: 對全套 artifact 做完整性檢查 + 幻覺風險評估 + 低 confidence 檢查 + schema consistency 檢查。
 *          優先 deterministic rule-based；只有 FEATURES.enableAiQaReview=true 時才呼 LLM 加 AI review。
 * Depends on:
 *   - src/services/llmClient.js (chat — 可選)
 *   - src/services/schemaValidator.js (validate)
 *   - src/schemas/index.js (SCHEMA_NAMES)
 *   - src/config/limits.js (FEATURES.enableAiQaReview)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js
 *
 * Status / hallucination_risk / issues 規則詳見 SYSTEM_PROMPT 與下方 commentary。
 *
 * 變更日期 / 改動原因：
 *   2026-05-18  初版（Group D2）
 */

import { chat } from '../services/llmClient.js';
import { validate } from '../services/schemaValidator.js';
import { SCHEMA_NAMES } from '../schemas/index.js';
import { FEATURES } from '../config/limits.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';

const SYSTEM_PROMPT = `你是 Tech Pack 比對系統的 QA reviewer。
任務：審閱所有 artifact，找出幻覺、矛盾、低 confidence、引用不存在 POM/BOM 等問題。
請只回 JSON，符合 qaReview schema。
所有 message / suggestion 用繁體中文（香港）。`;

/**
 * @param {object} param0
 * @param {object} param0.input  { measurement_changes, comments, images, bom_changes, summary, workflow_log }
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:object, warnings:string[], error:string|null}>}
 */
export async function runQaReviewAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'qaReview', requestId });
  const warnings = [];

  try {
    const measurement = Array.isArray(input.measurement_changes) ? input.measurement_changes : [];
    const comments = Array.isArray(input.comments) ? input.comments : [];
    const images = Array.isArray(input.images) ? input.images : [];
    const bom = Array.isArray(input.bom_changes) ? input.bom_changes : [];
    const summary = input.summary && typeof input.summary === 'object' ? input.summary : null;
    const workflowLog = Array.isArray(input.workflow_log) ? input.workflow_log : [];

    // ---------- Deterministic rule-based ----------
    const issues = [];
    const completeness = computeCompleteness(workflowLog, { measurement, comments, images, bom, summary });
    const confStats = computeConfidenceStats({ measurement, comments, images, bom });
    const fallbackAgents = workflowLog.filter((l) => l.status === 'ERROR').map((l) => l.agent);

    // Rule 1: summary counts 對齊
    if (summary && typeof summary.total_measurement_changes === 'number' && summary.total_measurement_changes !== measurement.length) {
      issues.push({
        severity: 'WARN',
        agent: 'summarizerAgent',
        field: 'total_measurement_changes',
        message: `summary 標示 ${summary.total_measurement_changes} 筆尺寸變更，實際為 ${measurement.length} 筆`,
        suggestion: '請人手對照 measurement 明細表，或重跑 summarizerAgent'
      });
    }
    if (summary && typeof summary.total_bom_changes === 'number' && summary.total_bom_changes !== bom.length) {
      issues.push({
        severity: 'WARN',
        agent: 'summarizerAgent',
        field: 'total_bom_changes',
        message: `summary 標示 ${summary.total_bom_changes} 筆 BOM 變更，實際為 ${bom.length} 筆`,
        suggestion: '請人手對照 BOM 明細表'
      });
    }
    if (summary && typeof summary.total_comment_items === 'number' && summary.total_comment_items !== comments.length) {
      issues.push({
        severity: 'WARN',
        agent: 'summarizerAgent',
        field: 'total_comment_items',
        message: `summary 標示 ${summary.total_comment_items} 條 comment，實際為 ${comments.length} 條`,
        suggestion: '請重跑 summarizerAgent'
      });
    }
    if (summary && typeof summary.total_image_changes === 'number' && summary.total_image_changes !== images.length) {
      issues.push({
        severity: 'WARN',
        agent: 'summarizerAgent',
        field: 'total_image_changes',
        message: `summary 標示 ${summary.total_image_changes} 條 image 差異，實際為 ${images.length} 條`,
        suggestion: '請重跑 summarizerAgent'
      });
    }

    // Rule 2: workflow_log ERROR
    for (const entry of workflowLog) {
      if (entry.status === 'ERROR') {
        issues.push({
          severity: 'ERROR',
          agent: entry.agent || 'unknown',
          field: null,
          message: `${entry.agent} 執行失敗：${entry.error_message || '未提供錯誤訊息'}`,
          suggestion: '請查看 server log，或重跑該 agent'
        });
      }
    }

    // Rule 3: summary 引用不存在的 POM / BOM
    if (summary) {
      const existingPoms = new Set(measurement.map((m) => m.pom_name).filter(Boolean));
      const existingBomDesc = new Set(bom.map((b) => b.description).filter(Boolean));
      const flatStrings = collectStrings(summary);
      // 抓潛在 POM 引用（粗略：summary 內字串若大寫又像 POM code，但在 measurement 內找不到）
      for (const decision of Array.isArray(summary.decisions) ? summary.decisions : []) {
        for (const ip of Array.isArray(decision.impacted_poms) ? decision.impacted_poms : []) {
          if (ip && existingPoms.size > 0 && !existingPoms.has(ip)) {
            issues.push({
              severity: 'ERROR',
              agent: 'summarizerAgent',
              field: `decisions.impacted_poms`,
              message: `summary 引用 POM「${ip}」，但 measurement_changes 不存在此 POM`,
              suggestion: '可能是 LLM 幻覺，請重跑 summarizerAgent'
            });
          }
        }
      }
    }

    // Rule 4: 低 confidence
    if (confStats.total > 0 && confStats.lowRatio > 0.2 && confStats.lowRatio <= 0.4) {
      issues.push({
        severity: 'WARN',
        agent: 'multiple',
        field: 'confidence',
        message: `低 confidence (<0.6) 項目佔 ${(confStats.lowRatio * 100).toFixed(0)}%`,
        suggestion: '建議由 merchandiser 人手覆核所有低 confidence 項'
      });
    } else if (confStats.total > 0 && confStats.lowRatio > 0.4) {
      issues.push({
        severity: 'ERROR',
        agent: 'multiple',
        field: 'confidence',
        message: `低 confidence (<0.6) 項目超過 40% (${(confStats.lowRatio * 100).toFixed(0)}%)`,
        suggestion: '強烈建議重跑整個 workflow 或更換 provider'
      });
    }

    // Rule 5: completeness false 但對應 outputMode 又應該執行的，補 issue
    const outputMode = context.outputMode || 'FULL';
    const expectedAgents = expectedAgentsForMode(outputMode);
    for (const k of Object.keys(completeness)) {
      if (!completeness[k] && expectedAgents.has(k)) {
        issues.push({
          severity: 'WARN',
          agent: `${k}Agent`,
          field: 'completeness',
          message: `${k} agent 未成功產出，但 outputMode=${outputMode} 期望它執行`,
          suggestion: '請檢查 workflow_log 對應 agent 的錯誤訊息'
        });
      }
    }

    // ---------- Hallucination risk ----------
    const hallRisk = determineHallucinationRisk({ confStats, fallbackAgents, issues });

    // ---------- AI review（可選） ----------
    if (FEATURES.enableAiQaReview) {
      try {
        const aiResult = await runAiReview({ measurement, comments, images, bom, summary, requestId });
        if (Array.isArray(aiResult?.issues)) {
          for (const it of aiResult.issues.slice(0, 10)) {
            issues.push(normalizeIssue(it));
          }
        }
      } catch (e) {
        log.warn('qa.ai_review_failed', { err: e?.message });
        warnings.push('AI QA review 失敗，已退回 rule-based');
      }
    }

    // ---------- Determine status ----------
    const status = determineStatus(issues, hallRisk);

    const artifact = {
      status,
      hallucination_risk: hallRisk,
      issues: issues.slice(0, 30),
      artifact_completeness: completeness,
      reviewed_at: new Date().toISOString()
    };

    const v = validate(SCHEMA_NAMES.QA_REVIEW, artifact);
    if (!v.valid) {
      warnings.push(`qaReview validate fail: ${v.errors?.[0]?.message || 'unknown'}`);
      // 退回最小合法 artifact
      const fb = fallbackArtifact(completeness);
      log.warn('qa.validate_fail_using_fallback');
      return { ok: true, data: fb, warnings, error: null };
    }

    log.info('qa.done', { status, hall: hallRisk, issues: issues.length });
    return { ok: true, data: v.value, warnings, error: null };
  } catch (err) {
    log.error('qa.fatal', { err: err?.message });
    return {
      ok: true, // 不讓 qa fail block workflow
      data: fallbackArtifact({ measurement: false, comment: false, image: false, bom: false, summary: false }),
      warnings: [...warnings, t('error.qa_failed') || 'QA 檢查失敗，已使用 fallback artifact'],
      error: err?.message || 'qa failed'
    };
  }
}

// ---------- helpers ----------

function computeCompleteness(workflowLog, artifacts) {
  // 預設：有 artifact 即算完整；workflow_log 有 ERROR 才標 false
  const errorAgents = new Set(
    workflowLog.filter((l) => l.status === 'ERROR').map((l) => agentKey(l.agent))
  );
  return {
    measurement: !errorAgents.has('measurement') && Array.isArray(artifacts.measurement),
    comment: !errorAgents.has('comment') && Array.isArray(artifacts.comments),
    image: !errorAgents.has('image') && Array.isArray(artifacts.images),
    bom: !errorAgents.has('bom') && Array.isArray(artifacts.bom),
    summary: !errorAgents.has('summarizer') && !!artifacts.summary
  };
}

function agentKey(name) {
  if (!name) return '';
  return name.replace(/Agent$/, '').toLowerCase();
}

function computeConfidenceStats({ measurement, comments, images, bom }) {
  const arr = [...measurement, ...comments, ...images, ...bom];
  const total = arr.length;
  if (total === 0) return { total: 0, lowCount: 0, lowRatio: 0, avgConf: 1 };
  let lowCount = 0;
  let sum = 0;
  for (const it of arr) {
    const c = typeof it?.confidence === 'number' ? it.confidence : 1;
    sum += c;
    if (c < 0.6) lowCount++;
  }
  return { total, lowCount, lowRatio: lowCount / total, avgConf: sum / total };
}

function determineHallucinationRisk({ confStats, fallbackAgents, issues }) {
  // 已偵測到 POM 不存在等 ERROR-level → HIGH
  if (issues.some((i) => i.severity === 'ERROR' && /幻覺|不存在/.test(i.message))) return 'HIGH';

  if (confStats.total === 0) return 'NONE';
  if (confStats.lowRatio > 0.4) return 'HIGH';
  if (confStats.lowRatio >= 0.2 || fallbackAgents.length > 0) return 'MEDIUM';
  if (confStats.lowRatio > 0) return 'LOW';
  if (confStats.avgConf >= 0.85) return 'NONE';
  return 'LOW';
}

function determineStatus(issues, hallRisk) {
  const hasError = issues.some((i) => i.severity === 'ERROR');
  const hasWarn = issues.some((i) => i.severity === 'WARN');
  if (hasError || hallRisk === 'HIGH') return 'FAIL';
  if (hasWarn || hallRisk === 'MEDIUM') return 'WARN';
  return 'PASS';
}

function expectedAgentsForMode(mode) {
  switch (mode) {
    case 'SUMMARY':
      return new Set(['summary']);
    case 'MEASUREMENT_ONLY':
      return new Set(['measurement']);
    case 'BOM_ONLY':
      return new Set(['bom']);
    case 'FULL':
    case 'DEBUG_ALL':
    default:
      return new Set(['measurement', 'comment', 'image', 'bom', 'summary']);
  }
}

function collectStrings(obj, out = []) {
  if (typeof obj === 'string') out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((x) => collectStrings(x, out));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((x) => collectStrings(x, out));
  return out;
}

function normalizeIssue(it) {
  const SEV_OK = ['INFO', 'WARN', 'ERROR'];
  return {
    severity: SEV_OK.includes(it?.severity) ? it.severity : 'INFO',
    agent: String(it?.agent || 'unknown').slice(0, 50),
    field: it?.field ? String(it.field).slice(0, 100) : null,
    message: String(it?.message || '（無訊息）').slice(0, 500),
    suggestion: it?.suggestion ? String(it.suggestion).slice(0, 500) : null
  };
}

function fallbackArtifact(completeness) {
  return {
    status: 'WARN',
    hallucination_risk: 'LOW',
    issues: [
      {
        severity: 'WARN',
        agent: 'qaReviewAgent',
        field: null,
        message: 'QA 檢查 fallback：可能是部分 agent 未產出',
        suggestion: '查看 workflow_log 確認個別 agent 狀態'
      }
    ],
    artifact_completeness: completeness || {
      measurement: false, comment: false, image: false, bom: false, summary: false
    },
    reviewed_at: new Date().toISOString()
  };
}

async function runAiReview({ measurement, comments, images, bom, summary, requestId }) {
  const userPrompt = `請審閱以下 artifact，找出幻覺風險、低 confidence、矛盾。
請回 { "issues": [ { "severity", "agent", "field", "message", "suggestion" } ] }。

【measurement (${measurement.length})】
${truncate(JSON.stringify(measurement), 2000)}

【comments (${comments.length})】
${truncate(JSON.stringify(comments), 1500)}

【images (${images.length})】
${truncate(JSON.stringify(images), 1000)}

【bom (${bom.length})】
${truncate(JSON.stringify(bom), 2000)}

【summary】
${truncate(JSON.stringify(summary), 1500)}`;

  const resp = await chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    schema: SCHEMA_NAMES.QA_REVIEW,
    model_tier: 'medium',
    agent_name: 'qaReview',
    requestId
  });

  return resp?.data || null;
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

export default { runQaReviewAgent };
