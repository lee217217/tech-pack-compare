/**
 * Path: src/agents/commentAgent.js
 * Purpose: 客人 buyer comments + Tech Pack 內 TEXT_FIELD / IMAGE_ANNOTATION 註解
 *          結構化抽取 agent → 對應 commentArtifact schema。
 *          自動偵測語言（zh-HK / zh-CN / en / unknown）+ 套用嚴重程度規則。
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

const SYSTEM_PROMPT = `你是一個製衣業 Tech Pack 註解 / 買家 comment 結構化抽取專家。
任務：把 Tech Pack 內的文字註解、圖像 annotation、買家 comment，逐條轉成結構化 JSON。

嚴重程度規則（必須遵守）：
- CRITICAL: 涉及尺寸/交期/合規(compliance)/安全（safety）/法規（label, care label, COO）
- MAJOR   : 外觀變更、主要物料變更、品質要求
- MINOR   : 字眼修正、措辭、非關鍵裝飾
- INFO    : 純記事 / 一般 note

source 分類：
- TEXT_FIELD       = Tech Pack 表格內的文字註解
- IMAGE_ANNOTATION = 圖上的箭頭/手寫註解
- BUYER_COMMENT    = 買家獨立提供的 comment 文字

language_detected:
- 'zh-HK' / 'zh-CN' / 'en' / 'unknown' （用 ISO 風格小寫）
- 有繁體字（粵語用詞如「嘅」「咗」「喺」）→ 'zh-HK'
- 全簡體 → 'zh-CN'
- 全英文 → 'en'

requires_human_review = true 的情境：
- severity 為 CRITICAL
- 內文含「confirm / 確認 / 再決定 / TBC / pending」等不確定字眼

所有最終輸出必須使用繁體中文（香港）— 即 comment_text 若原文是英文，請保留原文；但 related_pom 等描述用繁中。
不要回傳解釋文字，只回 JSON。`;

/**
 * @param {object} param0
 * @param {object} param0.input  ExtractedPackage
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:Array, warnings:string[], error:string|null}>}
 */
export async function runCommentAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'comment', requestId });
  const warnings = [];

  try {
    const buyer = input.buyer_comments || '';
    const textA = collectText(input.docA);
    const textB = collectText(input.docB);

    if (!buyer && !textA && !textB) {
      log.warn('comment.no_input');
      return { ok: true, data: [], warnings: [], error: null };
    }

    const userPrompt = `請從下列內容中抽取所有 comment / 註解，逐條轉為 JSON。

【Buyer Comments】
${buyer || '（無）'}

【Tech Pack A — 舊版 內文摘要】
${textA || '（無）'}

【Tech Pack B — 新版 內文摘要】
${textB || '（無）'}

請回傳：
{ "items": [ <commentArtifact>, ... ] }`;

    const resp = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      schema: SCHEMA_NAMES.COMMENT_ARTIFACT,
      model_tier: 'medium',
      agent_name: 'comment',
      requestId
    });

    const items = pickItems(resp?.data);
    const validated = [];
    let idCounter = 1;
    for (const it of items) {
      const normalized = normalizeItem(it, idCounter++);
      const v = validate(SCHEMA_NAMES.COMMENT_ARTIFACT, normalized);
      if (v.valid) {
        validated.push(v.value);
      } else {
        warnings.push(`commentArtifact validate fail: ${v.errors?.[0]?.message || 'unknown'}`);
      }
    }

    log.info('comment.done', {
      provider: resp?.provider,
      cached: resp?.cached,
      raw_count: items.length,
      valid_count: validated.length
    });

    return { ok: true, data: validated, warnings, error: null };
  } catch (err) {
    log.error('comment.fatal', { err: err?.message });
    return {
      ok: false,
      data: [],
      warnings: [...warnings, t('error.comment_failed') || '註解抽取失敗'],
      error: err?.message || 'comment failed'
    };
  }
}

function pickItems(data) {
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    if (data.comment_id || data.comment_text) return [data];
  }
  return [];
}

const SEVERITY_OK = ['INFO', 'MINOR', 'MAJOR', 'CRITICAL'];
const SOURCE_OK = ['TEXT_FIELD', 'IMAGE_ANNOTATION', 'BUYER_COMMENT'];
const LANG_OK = ['zh-HK', 'zh-CN', 'en', 'unknown'];

function normalizeItem(it, fallbackIdx) {
  const out = { ...it };
  out.comment_id = out.comment_id || `c_${String(fallbackIdx).padStart(3, '0')}`;
  if (!SOURCE_OK.includes(out.source)) out.source = 'BUYER_COMMENT';
  out.page_old = (typeof out.page_old === 'number') ? out.page_old : null;
  out.page_new = (typeof out.page_new === 'number') ? out.page_new : null;
  out.comment_text = String(out.comment_text || '').slice(0, 4000);
  out.related_pom = out.related_pom || null;

  // severity auto-elevate by keywords
  const txt = (out.comment_text || '').toLowerCase();
  let sev = SEVERITY_OK.includes(out.severity) ? out.severity : 'INFO';
  if (!SEVERITY_OK.includes(out.severity)) {
    if (/(size|尺寸|delivery|交期|compliance|合規|safety|安全|法規|coo|care\s*label)/i.test(txt)) sev = 'CRITICAL';
    else if (/(fabric|主布|物料|外觀|appearance|quality|品質)/i.test(txt)) sev = 'MAJOR';
    else if (/(typo|wording|字眼|措辭)/i.test(txt)) sev = 'MINOR';
  }
  out.severity = sev;

  // language detect fallback
  if (!LANG_OK.includes(out.language_detected)) {
    out.language_detected = detectLanguage(out.comment_text);
  }

  // requires_human_review
  if (typeof out.requires_human_review !== 'boolean') {
    out.requires_human_review =
      out.severity === 'CRITICAL' ||
      /(confirm|確認|再決定|tbc|pending)/i.test(out.comment_text || '');
  }

  if (typeof out.confidence !== 'number' || out.confidence < 0 || out.confidence > 1) {
    out.confidence = 0.7;
  }
  return out;
}

function detectLanguage(text) {
  if (!text) return 'unknown';
  const hasHk = /[嘅咗喺嗰冇噉啲咁]|繁體|粵語/.test(text);
  const hasTrad = /[繁體中文點樣這個]/.test(text);
  const hasSimp = /[简体这个为]/.test(text);
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  const hasEn = /[A-Za-z]/.test(text);
  if (hasHk) return 'zh-HK';
  if (hasChinese && hasTrad && !hasSimp) return 'zh-HK';
  if (hasChinese && hasSimp && !hasTrad) return 'zh-CN';
  if (hasChinese) return 'zh-HK'; // 繁中 HK 預設
  if (hasEn) return 'en';
  return 'unknown';
}

function collectText(doc) {
  if (!doc || !Array.isArray(doc.pages)) return '';
  return doc.pages.map((p) => p.text || '').join('\n').slice(0, 6000);
}

export default { runCommentAgent };
