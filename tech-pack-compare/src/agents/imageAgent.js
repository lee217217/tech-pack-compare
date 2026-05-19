/**
 * Path: src/agents/imageAgent.js
 * Purpose: Tech Pack 圖像差異 vision diff agent → 對應 imageArtifact schema。
 *          重點：只處理「靠近 size table」的相關圖像（near_size_table = true 場景），
 *          純文字 / 無 imagePages 的情況直接回空陣列（不報錯）。
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

const SYSTEM_PROMPT = `你是一個製衣業 Tech Pack 圖像差異視覺比對專家。
任務：比較 Tech Pack A vs B 的款式圖、structure drawing、placement 圖之間的變更。

判斷規則：
1. change_type 分類（必須是以下其中一個 UPPERCASE）：
   - STYLE        = 整體款式 / 剪裁 / 領口 / 袖口
   - CONSTRUCTION = 縫合 / 拼接 / 內構
   - TRIM         = 鈕扣 / 拉鏈 / 織帶
   - PRINT        = 印花 / logo
   - EMBROIDERY   = 刺繡
   - OTHER        = 以上皆非
2. region 是相對座標（0~1）：{ x, y, w, h }，描述變更在頁面中的位置
3. near_size_table = true 表示這個變更位於尺寸表附近，下游 measurementAgent 應特別關注
4. before_desc / after_desc 用繁體中文（香港），具體描述視覺差異
5. diff_summary 為一句總結（≤ 60 字）
6. confidence 0~1

無圖或視覺無差異 → 回 { "items": [] }，不要硬編出差異。

所有最終輸出必須使用繁體中文（香港）。
不要回傳解釋文字，只回 JSON。`;

/**
 * @param {object} param0
 * @param {object} param0.input  ExtractedPackage
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:Array, warnings:string[], error:string|null}>}
 */
export async function runImageAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'image', requestId });
  const warnings = [];

  try {
    const imagesA = collectImages(input.docA);
    const imagesB = collectImages(input.docB);

    if (imagesA.length === 0 && imagesB.length === 0) {
      log.info('image.no_images');
      return { ok: true, data: [], warnings: [], error: null };
    }

    const userPrompt = `請比對 Tech Pack A vs B 的圖像差異。

【Tech Pack A 圖像頁清單】
${describeImages(imagesA)}

【Tech Pack B 圖像頁清單】
${describeImages(imagesB)}

請回傳：
{ "items": [ <imageArtifact>, ... ] }
若無顯著差異，回 { "items": [] }`;

    // 注意：真實 vision 比對需要把 imageBase64 嵌入 multipart content。
    // 此處為 prompt 描述版（mock-friendly）；Phase 5 真實 provider 時會擴 messages 為 vision parts。
    const resp = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      schema: SCHEMA_NAMES.IMAGE_ARTIFACT,
      model_tier: 'medium',
      agent_name: 'image',
      requestId
    });

    const items = pickItems(resp?.data);
    const validated = [];
    let idCounter = 1;
    for (const it of items) {
      const normalized = normalizeItem(it, idCounter++);
      const v = validate(SCHEMA_NAMES.IMAGE_ARTIFACT, normalized);
      if (v.valid) {
        validated.push(v.value);
      } else {
        warnings.push(`imageArtifact validate fail: ${v.errors?.[0]?.message || 'unknown'}`);
      }
    }

    log.info('image.done', {
      provider: resp?.provider,
      cached: resp?.cached,
      raw_count: items.length,
      valid_count: validated.length
    });

    return { ok: true, data: validated, warnings, error: null };
  } catch (err) {
    log.error('image.fatal', { err: err?.message });
    return {
      ok: false,
      data: [],
      warnings: [...warnings, t('error.image_failed') || '圖像差異分析失敗'],
      error: err?.message || 'image failed'
    };
  }
}

function pickItems(data) {
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    if (data.image_id || data.diff_summary) return [data];
  }
  return [];
}

const CHANGE_TYPE_OK = ['STYLE', 'CONSTRUCTION', 'TRIM', 'PRINT', 'EMBROIDERY', 'OTHER'];

function normalizeItem(it, fallbackIdx) {
  const out = { ...it };
  out.image_id = out.image_id || `img_${String(fallbackIdx).padStart(3, '0')}`;
  out.page_old = typeof out.page_old === 'number' ? out.page_old : null;
  out.page_new = typeof out.page_new === 'number' ? out.page_new : null;

  // region 預設整頁
  const r = out.region && typeof out.region === 'object' ? out.region : {};
  out.region = {
    x: clamp01(r.x, 0),
    y: clamp01(r.y, 0),
    w: clamp01(r.w, 1),
    h: clamp01(r.h, 1)
  };

  if (!CHANGE_TYPE_OK.includes(out.change_type)) out.change_type = 'OTHER';
  out.before_desc = String(out.before_desc || '').slice(0, 2000);
  out.after_desc = String(out.after_desc || '').slice(0, 2000);
  out.diff_summary = String(out.diff_summary || '').slice(0, 500);

  if (typeof out.confidence !== 'number' || out.confidence < 0 || out.confidence > 1) {
    out.confidence = 0.6;
  }
  if (typeof out.near_size_table !== 'boolean') out.near_size_table = false;
  return out;
}

function clamp01(v, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function collectImages(doc) {
  if (!doc || !Array.isArray(doc.pages)) return [];
  return doc.pages.filter((p) => !!p.imageBase64);
}

function describeImages(arr) {
  if (arr.length === 0) return '（無）';
  return arr.map((p) => `Page ${p.page}: 有圖（base64 長度 ${p.imageBase64.length}）`).join('\n');
}

export default { runImageAgent };
