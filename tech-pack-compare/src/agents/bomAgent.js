/**
 * Path: src/agents/bomAgent.js
 * Purpose: BOM (Bill of Material) / 物料表比對 agent → 對應 bomArtifact schema。
 *          抽取主布、副布、配件、輔料、包裝、車線等變更，並標 impact / severity。
 * Depends on:
 *   - src/services/llmClient.js (chat)
 *   - src/services/schemaValidator.js (validate)
 *   - src/schemas/index.js (SCHEMA_NAMES)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js
 *
 * Severity 規則（必須遵守）：
 *   CRITICAL = composition / care / compliance / 主布大改（成份變、>20% 用量變、供應商換）
 *   MAJOR    = 主布小改、重要 trim 變更、qty 變動 5-20%
 *   MINOR    = 包裝 / accessory 微調
 *   INFO     = 純記事
 *
 * 變更日期 / 改動原因：
 *   2026-05-18  初版（Group D1）— BOM 升級
 */

import { chat } from '../services/llmClient.js';
import { validate } from '../services/schemaValidator.js';
import { SCHEMA_NAMES } from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';

const SYSTEM_PROMPT = `你是一個製衣業 BOM (Bill of Material) 物料表結構化比對專家。
任務：比較 Tech Pack A（舊版）vs B（新版）的物料表 / BOM，逐項輸出結構化 JSON。

物料分類（material_type，必須 UPPERCASE）：
- FABRIC     = 主布 / 副布 / 裡布 / 配色布
- TRIM       = 鈕扣、拉鏈、Velcro、抽繩、彈性帶、織帶
- LABEL      = 主嘜、洗水嘜、size label、care label、price tag
- PACKAGING  = polybag、carton、hangtag、tissue paper
- THREAD     = 車線、繡花線
- ACCESSORY  = 其他配件（鞋帶、扣具、扣件）
- OTHER      = 以上皆非

影響類型（impact，必須 UPPERCASE）：
- COST       = 影響物料成本（單價、用量）
- LEAD_TIME  = 影響交期（換供應商、特殊物料、MOQ）
- QUALITY    = 影響品質（gsm、composition）
- COMPLIANCE = 影響合規（OEKO-TEX、CPSIA、AZO、care label）
- NO_IMPACT  = 無實質影響
- UNKNOWN    = 無法判斷

嚴重程度規則：
- CRITICAL : 成份變、care label 變、compliance 物料變、主布大改（>20% 用量 / 不同供應商 / gsm 大改）
- MAJOR    : 主布小改、重要 trim（拉鏈、主鈕）、qty ±5~20%
- MINOR    : 包裝 / 一般 accessory 微調
- INFO     : 純記事

status 規則：
- ADDED   = 新版才有
- REMOVED = 舊版才有
- CHANGED = 兩版都有但任一欄位（用量、供應商、規格、顏色）不同
- UNCHANGED = 完全一致（一般略過）

diff_qty = new_qty - old_qty；若任一為 null，diff_qty 也是 null。
unit 強制 UPPERCASE（YD / YDS / M / KG / PCS / SET / ROLL / DZ / GR 等）。
confidence 0~1。

所有最終輸出必須使用繁體中文（香港）— description / notes 用繁中描述。
不要回傳解釋文字，只回 JSON。`;

/**
 * @param {object} param0
 * @param {object} param0.input  ExtractedPackage
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:Array, warnings:string[], error:string|null}>}
 */
export async function runBomAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'bom', requestId });
  const warnings = [];

  try {
    const bomA = input?.docA?.bom_table_raw || '';
    const bomB = input?.docB?.bom_table_raw || '';

    if (!bomA && !bomB) {
      log.warn('bom.no_bom_table');
      return { ok: true, data: [], warnings: ['未偵測到 BOM / 物料表，已略過 BOM 比對'], error: null };
    }

    const userPrompt = `以下是兩份 Tech Pack 的 BOM / 物料表原文。請逐項輸出結構化差異 JSON。

【Tech Pack A — 舊版 BOM】
${bomA || '（無）'}

【Tech Pack B — 新版 BOM】
${bomB || '（無）'}

請回傳：
{ "items": [ <bomArtifact>, ... ] }
只輸出 status ≠ UNCHANGED 的項目以節省 token。`;

    const resp = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      schema: SCHEMA_NAMES.BOM_ARTIFACT,
      model_tier: 'high',
      agent_name: 'bom',
      requestId
    });

    const items = pickItems(resp?.data);
    const validated = [];
    let idCounter = 1;
    for (const it of items) {
      const normalized = normalizeItem(it, idCounter++);
      const v = validate(SCHEMA_NAMES.BOM_ARTIFACT, normalized);
      if (v.valid) {
        validated.push(v.value);
      } else {
        warnings.push(`bomArtifact validate fail: ${v.errors?.[0]?.message || 'unknown'}`);
      }
    }

    log.info('bom.done', {
      provider: resp?.provider,
      cached: resp?.cached,
      raw_count: items.length,
      valid_count: validated.length
    });

    return { ok: true, data: validated, warnings, error: null };
  } catch (err) {
    log.error('bom.fatal', { err: err?.message });
    return {
      ok: false,
      data: [],
      warnings: [...warnings, t('error.bom_failed') || 'BOM 比對失敗'],
      error: err?.message || 'bom failed'
    };
  }
}

function pickItems(data) {
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    if (data.bom_item_id || data.material_type) return [data];
  }
  return [];
}

const MATERIAL_OK = ['FABRIC', 'TRIM', 'LABEL', 'PACKAGING', 'THREAD', 'ACCESSORY', 'OTHER'];
const IMPACT_OK = ['COST', 'LEAD_TIME', 'QUALITY', 'COMPLIANCE', 'NO_IMPACT', 'UNKNOWN'];
const SEVERITY_OK = ['INFO', 'MINOR', 'MAJOR', 'CRITICAL'];
const STATUS_OK = ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'];

function normalizeItem(it, fallbackIdx) {
  const out = { ...it };
  out.bom_item_id = out.bom_item_id || `bom_${String(fallbackIdx).padStart(3, '0')}`;
  out.material_code = (typeof out.material_code === 'string' && out.material_code) ? out.material_code : null;
  out.material_type = MATERIAL_OK.includes(out.material_type) ? out.material_type : 'OTHER';
  out.description = String(out.description || '').slice(0, 1000);
  out.color = (typeof out.color === 'string' && out.color) ? out.color : null;
  out.size_or_spec = (typeof out.size_or_spec === 'string' && out.size_or_spec) ? out.size_or_spec : null;
  out.supplier = (typeof out.supplier === 'string' && out.supplier) ? out.supplier : null;

  const oldQ = typeof out.old_qty === 'number' ? out.old_qty : null;
  const newQ = typeof out.new_qty === 'number' ? out.new_qty : null;
  out.old_qty = oldQ;
  out.new_qty = newQ;
  out.diff_qty = (oldQ != null && newQ != null) ? Number((newQ - oldQ).toFixed(4)) : null;

  out.unit = (typeof out.unit === 'string' && out.unit) ? out.unit.toUpperCase() : null;

  if (!STATUS_OK.includes(out.status)) {
    if (oldQ == null && newQ != null) out.status = 'ADDED';
    else if (oldQ != null && newQ == null) out.status = 'REMOVED';
    else if (out.diff_qty != null && Math.abs(out.diff_qty) > 0) out.status = 'CHANGED';
    else out.status = 'CHANGED'; // 雖未必 qty 改，但其他欄位（顏色、供應商、規格）可能改
  }

  if (!IMPACT_OK.includes(out.impact)) out.impact = inferImpact(out);
  if (!SEVERITY_OK.includes(out.severity)) out.severity = inferSeverity(out);

  out.related_pom = out.related_pom || null;
  out.source_page_old = typeof out.source_page_old === 'number' ? out.source_page_old : null;
  out.source_page_new = typeof out.source_page_new === 'number' ? out.source_page_new : null;

  if (typeof out.confidence !== 'number' || out.confidence < 0 || out.confidence > 1) {
    out.confidence = 0.75;
  }
  out.notes = out.notes ? String(out.notes).slice(0, 1000) : null;
  return out;
}

function inferImpact(it) {
  const desc = `${it.description || ''} ${it.notes || ''}`.toLowerCase();
  if (/(composition|成份|gsm|care\s*label|coo|oeko|cpsia|azo|合規)/i.test(desc)) return 'COMPLIANCE';
  if (it.diff_qty != null && Math.abs(it.diff_qty) > 0) return 'COST';
  if (/(supplier|供應商|moq|lead|交期|出貨)/i.test(desc)) return 'LEAD_TIME';
  if (/(quality|品質|gsm|density|cwt)/i.test(desc)) return 'QUALITY';
  return 'UNKNOWN';
}

function inferSeverity(it) {
  const desc = `${it.description || ''} ${it.notes || ''}`.toLowerCase();
  // CRITICAL
  if (/(composition|成份|care\s*label|compliance|合規|coo|oeko|cpsia|azo)/i.test(desc)) return 'CRITICAL';
  if (it.material_type === 'FABRIC') {
    if (it.diff_qty != null && it.old_qty && Math.abs(it.diff_qty / it.old_qty) > 0.2) return 'CRITICAL';
    return 'MAJOR';
  }
  // qty 5-20% → MAJOR
  if (it.diff_qty != null && it.old_qty && Math.abs(it.diff_qty / it.old_qty) >= 0.05) return 'MAJOR';
  if (['LABEL', 'TRIM'].includes(it.material_type)) return 'MAJOR';
  if (['PACKAGING', 'ACCESSORY', 'THREAD'].includes(it.material_type)) return 'MINOR';
  return 'INFO';
}

export default { runBomAgent };
