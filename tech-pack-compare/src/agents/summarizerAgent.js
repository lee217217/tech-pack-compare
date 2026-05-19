/**
 * Path: src/agents/summarizerAgent.js
 * Purpose: 把 measurement / comment / image / bom 四個 agent 的 artifact[] 整合成
 *          一份對 Sales / Merchandiser 友好的 summaryArtifact（含 follow_up_email 草稿）。
 * Depends on:
 *   - src/services/llmClient.js (chat)
 *   - src/services/schemaValidator.js (validate)
 *   - src/schemas/index.js (SCHEMA_NAMES)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js
 *
 * 變更日期 / 改動原因：
 *   2026-05-18  初版（Group D1）
 */

import { chat } from '../services/llmClient.js';
import { validate } from '../services/schemaValidator.js';
import { SCHEMA_NAMES } from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';

const SYSTEM_PROMPT = `你是一個製衣業 Tech Pack 比對報告 summarizer。
任務：把以下四種變更陣列整合成一份 summaryArtifact JSON：
  1. measurement_changes (尺寸表變更)
  2. comment_changes (註解 / 買家 comment)
  3. image_changes (圖像差異)
  4. bom_changes (物料 BOM 變更)

輸出 schema 必須含：
- total_changes               = 4 個陣列總和
- total_measurement_changes
- total_comment_items
- total_image_changes
- total_bom_changes
- bullet_points               (3-8 條，重點摘要，繁中 HK)
- cost_risk_items             (最多 20 條，標出影響成本的項目；無則 [])
- production_risk_items       (最多 20 條，標出影響生產 / 品質 / 交期的項目；無則 [])
- decisions                   (需 Sales / Merchandiser 即時決定的事項)
- action_items                (具體 action：owner 通常為 Sales / Tech / PD / Merch)
- follow_up_email             (繁中 HK 專業簡潔，給買家或內部 Tech 的 follow-up email 草稿，
                               語氣要 polished、無 placeholder、開頭直接稱呼、結尾有專業署名)
- generated_at                (ISO timestamp)

action_items[].priority 為 LOW / MEDIUM / HIGH / URGENT (UPPERCASE)。
所有文字必須使用繁體中文（香港），follow_up_email 也是繁中 HK。
不要回傳解釋文字，只回 JSON。`;

/**
 * @param {object} param0
 * @param {object} param0.input  { measurement_changes:[], comment_changes:[], image_changes:[], bom_changes:[] }
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:object|null, warnings:string[], error:string|null}>}
 */
export async function runSummarizerAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'summarizer', requestId });
  const warnings = [];

  try {
    const measurement = Array.isArray(input.measurement_changes) ? input.measurement_changes : [];
    const comment = Array.isArray(input.comment_changes) ? input.comment_changes : [];
    const image = Array.isArray(input.image_changes) ? input.image_changes : [];
    const bom = Array.isArray(input.bom_changes) ? input.bom_changes : [];

    if (measurement.length + comment.length + image.length + bom.length === 0) {
      log.warn('summarizer.no_changes');
      const empty = makeEmptySummary();
      const v = validate(SCHEMA_NAMES.SUMMARY_ARTIFACT, empty);
      return {
        ok: true,
        data: v.valid ? v.value : empty,
        warnings: ['無任何差異，已產生空白 summary'],
        error: null
      };
    }

    const userPrompt = `請整合以下四組變更，產出 summaryArtifact JSON。

【measurement_changes（${measurement.length} 筆）】
${truncate(JSON.stringify(measurement, null, 2), 4000)}

【comment_changes（${comment.length} 筆）】
${truncate(JSON.stringify(comment, null, 2), 3000)}

【image_changes（${image.length} 筆）】
${truncate(JSON.stringify(image, null, 2), 3000)}

【bom_changes（${bom.length} 筆）】
${truncate(JSON.stringify(bom, null, 2), 4000)}

請只回傳一個 JSON 物件（summaryArtifact），不要包 wrapper。`;

    const resp = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      schema: SCHEMA_NAMES.SUMMARY_ARTIFACT,
      model_tier: 'medium',
      agent_name: 'summarizer',
      requestId
    });

    let summary = resp?.data && typeof resp.data === 'object' ? resp.data : null;
    if (!summary) summary = makeEmptySummary();

    summary = normalizeSummary(summary, { measurement, comment, image, bom });

    const v = validate(SCHEMA_NAMES.SUMMARY_ARTIFACT, summary);
    if (!v.valid) {
      warnings.push(`summary validate fail: ${v.errors?.[0]?.message || 'unknown'}`);
      // 退回基線版（counts 一定對）
      const baseline = normalizeSummary(makeEmptySummary(), { measurement, comment, image, bom });
      const v2 = validate(SCHEMA_NAMES.SUMMARY_ARTIFACT, baseline);
      return {
        ok: v2.valid,
        data: v2.valid ? v2.value : null,
        warnings,
        error: v2.valid ? null : (v.errors?.[0]?.message || 'summary invalid')
      };
    }

    log.info('summarizer.done', {
      provider: resp?.provider,
      cached: resp?.cached,
      total_changes: v.value.total_changes
    });

    return { ok: true, data: v.value, warnings, error: null };
  } catch (err) {
    log.error('summarizer.fatal', { err: err?.message });
    return {
      ok: false,
      data: null,
      warnings: [...warnings, t('error.summarizer_failed') || '報告整合失敗'],
      error: err?.message || 'summarizer failed'
    };
  }
}

function makeEmptySummary() {
  return {
    total_changes: 0,
    total_measurement_changes: 0,
    total_comment_items: 0,
    total_image_changes: 0,
    total_bom_changes: 0,
    bullet_points: ['本次比對未偵測到顯著差異。'],
    cost_risk_items: [],
    production_risk_items: [],
    decisions: [],
    action_items: [],
    follow_up_email:
      '你好，\n\n已完成兩份 Tech Pack 比對，未發現顯著差異。如有任何需要進一步確認的細節，請隨時告知。\n\n謝謝。',
    generated_at: new Date().toISOString()
  };
}

function normalizeSummary(s, counts) {
  const out = { ...s };
  const m = counts.measurement.length;
  const c = counts.comment.length;
  const i = counts.image.length;
  const b = counts.bom.length;

  out.total_measurement_changes = m;
  out.total_comment_items = c;
  out.total_image_changes = i;
  out.total_bom_changes = b;
  out.total_changes = m + c + i + b;

  if (!Array.isArray(out.bullet_points) || out.bullet_points.length === 0) {
    out.bullet_points = ['（系統提示）summarizer 未能產生 bullet_points，請查看明細頁。'];
  }
  out.bullet_points = out.bullet_points.slice(0, 12).map((x) => String(x).slice(0, 500));

  out.cost_risk_items = Array.isArray(out.cost_risk_items) ? out.cost_risk_items.slice(0, 20) : [];
  out.production_risk_items = Array.isArray(out.production_risk_items) ? out.production_risk_items.slice(0, 20) : [];

  out.decisions = Array.isArray(out.decisions) ? out.decisions.map(normalizeDecision).slice(0, 20) : [];
  out.action_items = Array.isArray(out.action_items) ? out.action_items.map(normalizeAction).slice(0, 20) : [];

  out.follow_up_email = String(out.follow_up_email || '').slice(0, 4000) ||
    '你好，\n\n附上最新 Tech Pack 比對結果，請查閱。如有任何問題請隨時告知。\n\n謝謝。';

  out.generated_at = out.generated_at || new Date().toISOString();
  return out;
}

function normalizeDecision(d) {
  return {
    title: String(d?.title || '待補決定').slice(0, 200),
    detail: String(d?.detail || '').slice(0, 2000),
    impacted_poms: Array.isArray(d?.impacted_poms) ? d.impacted_poms.slice(0, 50).map(String) : []
  };
}

function normalizeAction(a) {
  const PRIO = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  return {
    title: String(a?.title || '待補 action').slice(0, 200),
    owner: String(a?.owner || 'Sales').slice(0, 100),
    due_date: typeof a?.due_date === 'string' ? a.due_date : null,
    priority: PRIO.includes(a?.priority) ? a.priority : 'MEDIUM'
  };
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '\n...（已截斷）' : s;
}

export default { runSummarizerAgent };
