/**
 * Path: src/agents/measurementAgent.js
 * Purpose: 尺寸表 (POM × Size) 比對 agent — 對應 measurementChange schema。
 *          產生整份 measurementChange[] 陣列；每筆獨立 schema-validate。
 *          tolerance_exceeded 規則：|diff| > 0.5 CM（或 0.25 INCH）
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

const SYSTEM_PROMPT = `你是一個製衣業 Tech Pack 尺寸表結構化比對專家。
任務：比較 Tech Pack A（舊版）與 Tech Pack B（新版）之間的 POM (Point of Measurement) × Size 表，產出 **每一個** 差異的結構化 JSON。

判斷規則：
1. status:
   - ADDED   = 新版才有的 POM/Size
   - REMOVED = 舊版才有的 POM/Size
   - CHANGED = 兩版都有但 old_value ≠ new_value
   - UNCHANGED = 兩版相同（除非要 audit，否則可略過）
2. tolerance_exceeded:
   - 單位 CM → |diff| > 0.5 即 true
   - 單位 INCH → |diff| > 0.25 即 true
3. size_label 必須是字串（即使是 32B 或 3XL）
4. diff_value 算法：new_value - old_value；若 old 或 new 是 null，diff_value 也是 null
5. unit 強制 UPPERCASE：'CM' 或 'INCH'
6. confidence 介於 0~1，估計你對該筆判斷的把握程度

所有最終輸出必須使用繁體中文（香港），描述欄 description 用繁中。
不要回傳解釋文字，只回 JSON。`;

/**
 * @param {object} param0
 * @param {object} param0.input  ExtractedPackage（來自 extractorAgent.data）
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:Array, warnings:string[], error:string|null}>}
 */
export async function runMeasurementAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'measurement', requestId });
  const warnings = [];

  try {
    const sizeA = input?.docA?.size_table_raw || extractAllText(input?.docA);
    const sizeB = input?.docB?.size_table_raw || extractAllText(input?.docB);

    if (!sizeA && !sizeB) {
      log.warn('measurement.no_size_table');
      return { ok: true, data: [], warnings: ['未偵測到尺寸表，已略過 measurement 比對'], error: null };
    }

    const userPrompt = `以下是兩份 Tech Pack 的尺寸表原文，請逐筆 POM × Size 比對，輸出 JSON。

【Tech Pack A — 舊版 尺寸表】
${sizeA || '（無）'}

【Tech Pack B — 新版 尺寸表】
${sizeB || '（無）'}

請回傳 JSON 物件，格式為：
{ "items": [ <measurementChange>, ... ] }

每個 <measurementChange> 必須符合 schema，僅在 status ≠ UNCHANGED 時輸出（UNCHANGED 略過以節省 token）。`;

    const resp = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      schema: SCHEMA_NAMES.MEASUREMENT_CHANGE, // 注意：LLM 會回 wrapper { items: [...] }，由我們自己分拆 validate
      model_tier: 'high',
      agent_name: 'measurement',
      requestId
    });

    const items = pickItems(resp?.data, resp?.rawText);
    const validated = [];
    for (const it of items) {
      const normalized = normalizeItem(it);
      const v = validate(SCHEMA_NAMES.MEASUREMENT_CHANGE, normalized);
      if (v.valid) {
        validated.push(v.value);
      } else {
        warnings.push(`measurementChange validate fail: ${v.errors?.[0]?.message || 'unknown'}`);
      }
    }

    log.info('measurement.done', {
      provider: resp?.provider,
      cached: resp?.cached,
      raw_count: items.length,
      valid_count: validated.length
    });

    return { ok: true, data: validated, warnings, error: null };
  } catch (err) {
    log.error('measurement.fatal', { err: err?.message });
    return {
      ok: false,
      data: [],
      warnings: [...warnings, t('error.measurement_failed') || '尺寸比對失敗'],
      error: err?.message || 'measurement failed'
    };
  }
}

function pickItems(data, rawText) {
  // mock provider 回單筆 dummy（不是 array）→ 包成 array
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    if (data.pom_name) return [data];
  }
  return [];
}

function normalizeItem(it) {
  const out = { ...it };
  // unit upper
  if (typeof out.unit === 'string') out.unit = out.unit.toUpperCase();
  if (out.unit !== 'CM' && out.unit !== 'INCH') out.unit = 'CM';
  // size_label 強制字串
  if (out.size_label != null && typeof out.size_label !== 'string') {
    out.size_label = String(out.size_label);
  }
  // diff_value 重算
  const oldV = typeof out.old_value === 'number' ? out.old_value : null;
  const newV = typeof out.new_value === 'number' ? out.new_value : null;
  out.old_value = oldV;
  out.new_value = newV;
  out.diff_value = (oldV != null && newV != null) ? Number((newV - oldV).toFixed(3)) : null;
  // tolerance
  const tol = out.unit === 'INCH' ? 0.25 : 0.5;
  out.tolerance_exceeded = out.diff_value != null && Math.abs(out.diff_value) > tol;
  // status sanity
  const allowed = ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'];
  if (!allowed.includes(out.status)) {
    if (oldV == null && newV != null) out.status = 'ADDED';
    else if (oldV != null && newV == null) out.status = 'REMOVED';
    else if (out.diff_value && Math.abs(out.diff_value) > 0) out.status = 'CHANGED';
    else out.status = 'UNCHANGED';
  }
  // confidence
  if (typeof out.confidence !== 'number' || out.confidence < 0 || out.confidence > 1) {
    out.confidence = 0.7;
  }
  // 必填欄位 fallback
  out.pom_name = out.pom_name || 'UNKNOWN_POM';
  out.pom_code = out.pom_code || null;
  out.description = out.description || '';
  out.size_label = out.size_label || 'M';
  out.source_page_old = (typeof out.source_page_old === 'number') ? out.source_page_old : null;
  out.source_page_new = (typeof out.source_page_new === 'number') ? out.source_page_new : null;
  return out;
}

function extractAllText(doc) {
  if (!doc || !Array.isArray(doc.pages)) return '';
  return doc.pages.map((p) => p.text || '').join('\n').slice(0, 8000);
}

export default { runMeasurementAgent };
