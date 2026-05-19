/**
 * Path: src/agents/extractorAgent.js
 * Purpose: PDF / 原始 Tech Pack 內容正規化 agent。
 *          把 rawText + imagePages + buyerComments 統一成下游 agent 都能讀的 ExtractedPackage。
 *          注意：此 agent **不走 LLM strict schema**（見 KI-005），目前是純結構化 normalize +
 *          (可選) LLM-based metadata 推測。輸出形狀在程式內固定，由 JSDoc typedef 對齊。
 * Depends on:
 *   - src/services/llmClient.js (chat — 可選，只用於 metadata 推測)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js
 *   - src/utils/hash.js (shortHash)
 *
 * 變更日期 / 改動原因：
 *   2026-05-18  初版（Group D1）— BOM 升級後架構落地，extractor schema 延後至 Phase 6
 */

import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';
import { shortHash } from '../utils/hash.js';

/**
 * @typedef {Object} ExtractedPage
 * @property {number} page                  1-based
 * @property {string} text                  正文（純文字）
 * @property {string|null} imageBase64      若 caller 已提供整頁圖 OCR，base64 dataURL；否則 null
 *
 * @typedef {Object} ExtractedDoc
 * @property {string} doc_label             'A' | 'B'
 * @property {ExtractedPage[]} pages
 * @property {object} metadata              { brand, style, season, color, fabric, doc_hash }
 * @property {string|null} bom_table_raw    原始 BOM 區塊純文字（給 bomAgent）
 * @property {string|null} size_table_raw   原始尺寸表純文字（給 measurementAgent）
 *
 * @typedef {Object} ExtractedPackage
 * @property {ExtractedDoc} docA
 * @property {ExtractedDoc} docB
 * @property {string} buyer_comments        合併後純文字
 * @property {string[]} warnings
 */

/**
 * 把 raw input 整理成 ExtractedPackage。
 * 不會 throw — 任何錯誤都記在 warnings 內。
 * @param {object} param0
 * @param {object} param0.input  { techPackA, techPackB, buyerComments }
 * @param {object} [param0.context]
 * @param {string} [param0.requestId]
 * @returns {Promise<{ok:boolean, data:ExtractedPackage, warnings:string[], error:string|null}>}
 */
export async function runExtractorAgent({ input = {}, context = {}, requestId = null } = {}) {
  const log = logger.child({ agent: 'extractor', requestId });
  const warnings = [];

  try {
    const techPackA = input.techPackA || {};
    const techPackB = input.techPackB || {};
    const buyer = (input.buyerComments || '').toString();

    const docA = normalizeDoc('A', techPackA, warnings);
    const docB = normalizeDoc('B', techPackB, warnings);

    const pkg = {
      docA,
      docB,
      buyer_comments: buyer.trim(),
      warnings
    };

    log.info('extractor.done', {
      pages_a: docA.pages.length,
      pages_b: docB.pages.length,
      buyer_len: pkg.buyer_comments.length,
      warnings: warnings.length
    });

    return { ok: true, data: pkg, warnings, error: null };
  } catch (err) {
    log.error('extractor.fatal', { err: err?.message });
    return {
      ok: false,
      data: fallbackPackage(),
      warnings: [...warnings, t('error.extractor_failed') || '檔案解析失敗，已使用空白資料'],
      error: err?.message || 'extractor failed'
    };
  }
}

function normalizeDoc(label, tp, warnings) {
  // v2.1: 優先用前端 PDF.js 已分頁的 structured pages
  const structuredPages = Array.isArray(tp.pages) ? tp.pages : null;
  const imagePages = Array.isArray(tp.imagePages) ? tp.imagePages : [];
  const relevantImages = Array.isArray(tp.relevantImages) ? tp.relevantImages : [];
  const sizeTablePages = Array.isArray(tp.sizeTablePages) ? tp.sizeTablePages.filter((n) => Number.isInteger(n)) : [];
  const bomPages = Array.isArray(tp.bomPages) ? tp.bomPages.filter((n) => Number.isInteger(n)) : [];

  let pages = [];
  let rawText = '';

  if (structuredPages && structuredPages.length > 0) {
    // v2.1 路徑
    pages = structuredPages
      .filter((p) => p && Number.isInteger(p.page))
      .map((p) => ({
        page: p.page,
        text: (p.text || '').toString(),
        imageBase64: null,
        isSizeTable: !!p.isSizeTable,
        isBom: !!p.isBom,
        hasImage: !!p.hasImage
      }));
    rawText = pages.map((p) => p.text).join('\n\f\n');
  } else {
    // v2.0 legacy 路徑
    rawText = (tp.rawText || '').toString();
    pages = splitTextToPages(rawText);
  }

  // 合併 v2.0 imagePages（base64 全頁圖）
  for (const img of imagePages) {
    if (!img || typeof img.page !== 'number') continue;
    let p = pages.find((x) => x.page === img.page);
    if (!p) {
      p = { page: img.page, text: '', imageBase64: null, isSizeTable: false, isBom: false, hasImage: false };
      pages.push(p);
    }
    if (typeof img.imageBase64 === 'string' && img.imageBase64.length > 0) {
      p.imageBase64 = img.imageBase64;
      p.hasImage = true;
    }
  }

  // 合併 v2.1 relevantImages（前端 render 的縮圖 base64，最多 6 頁）
  for (const img of relevantImages) {
    if (!img || typeof img.page !== 'number') continue;
    let p = pages.find((x) => x.page === img.page);
    if (!p) {
      p = { page: img.page, text: '', imageBase64: null, isSizeTable: false, isBom: false, hasImage: false };
      pages.push(p);
    }
    if (typeof img.base64 === 'string' && img.base64.length > 0) {
      p.imageBase64 = img.base64;
      p.hasImage = true;
    }
  }

  pages = pages.sort((a, b) => a.page - b.page);

  if (pages.length === 0) {
    warnings.push(`Tech Pack ${label} 沒有任何可解析內容`);
    pages = [{ page: 1, text: '', imageBase64: null, isSizeTable: false, isBom: false, hasImage: false }];
  }

  // 優先用前端 hint 抽 size_table_raw / bom_table_raw
  let size_table_raw = null;
  let bom_table_raw = null;

  if (sizeTablePages.length > 0) {
    size_table_raw = pages
      .filter((p) => sizeTablePages.includes(p.page))
      .map((p) => p.text)
      .join('\n')
      .trim() || null;
  }
  if (bomPages.length > 0) {
    bom_table_raw = pages
      .filter((p) => bomPages.includes(p.page))
      .map((p) => p.text)
      .join('\n')
      .trim() || null;
  }
  // page-level isSizeTable / isBom hint (PDF.js 已標記)
  if (!size_table_raw) {
    const hinted = pages.filter((p) => p.isSizeTable).map((p) => p.text).join('\n').trim();
    if (hinted) size_table_raw = hinted;
  }
  if (!bom_table_raw) {
    const hinted = pages.filter((p) => p.isBom).map((p) => p.text).join('\n').trim();
    if (hinted) bom_table_raw = hinted;
  }
  // fallback sniffSection
  if (!bom_table_raw) {
    bom_table_raw = sniffSection(rawText, ['BOM', 'BILL OF MATERIAL', 'MATERIAL', '物料', '用料']);
  }
  if (!size_table_raw) {
    size_table_raw = sniffSection(rawText, ['SIZE', 'MEASUREMENT', 'SPEC', '尺寸', '規格']);
  }

  // metadata 優先用 tp.metadata (PDF.js info)
  const tpMeta = tp.metadata && typeof tp.metadata === 'object' ? tp.metadata : {};
  const metadata = {
    brand: sniffKv(rawText, ['Brand', 'BRAND', '品牌']) || tpMeta.brand || null,
    style: sniffKv(rawText, ['Style', 'STYLE', 'Style#', '款號']) || tpMeta.style || null,
    season: sniffKv(rawText, ['Season', 'SEASON', '季度']) || tpMeta.season || null,
    color: sniffKv(rawText, ['Color', 'COLOR', '顏色']) || null,
    fabric: sniffKv(rawText, ['Fabric', 'FABRIC', '布料']) || null,
    title: tpMeta.title || null,
    author: tpMeta.author || null,
    pageCount: Number.isInteger(tpMeta.pageCount) ? tpMeta.pageCount : pages.length,
    fileName: tp.fileName || null,
    fileSize: Number.isFinite(tp.fileSize) ? tp.fileSize : null,
    doc_hash: shortHash(rawText || `${label}-empty`)
  };

  return {
    doc_label: label,
    pages,
    metadata,
    bom_table_raw,
    size_table_raw
  };
}

function splitTextToPages(text) {
  if (!text) return [];
  // 優先 form-feed
  if (text.includes('\f')) {
    return text.split('\f').map((t, i) => ({ page: i + 1, text: t.trim(), imageBase64: null }));
  }
  // 退而求其次：用 "Page N" 標記
  const parts = text.split(/\n\s*Page\s+(\d+)\s*\n/i);
  if (parts.length > 1) {
    const out = [];
    // parts[0] = 第一頁前文；parts[1] = page number；parts[2] = 文字 ...
    if (parts[0].trim()) out.push({ page: 1, text: parts[0].trim(), imageBase64: null });
    for (let i = 1; i < parts.length; i += 2) {
      const p = parseInt(parts[i], 10) || out.length + 1;
      const txt = (parts[i + 1] || '').trim();
      out.push({ page: p, text: txt, imageBase64: null });
    }
    return out;
  }
  // 單頁
  return [{ page: 1, text: text.trim(), imageBase64: null }];
}

function sniffSection(text, keywords) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const idxs = [];
  for (let i = 0; i < lines.length; i++) {
    const up = lines[i].toUpperCase();
    if (keywords.some((kw) => up.includes(kw.toUpperCase()))) {
      idxs.push(i);
    }
  }
  if (idxs.length === 0) return null;
  // 抓第一個關鍵字 → 抓接下來 30 行
  const start = idxs[0];
  return lines.slice(start, Math.min(lines.length, start + 30)).join('\n').trim() || null;
}

function sniffKv(text, keys) {
  if (!text) return null;
  for (const k of keys) {
    const re = new RegExp(`${k}\\s*[:：]\\s*([^\\n\\r]+)`, 'i');
    const m = text.match(re);
    if (m && m[1]) return m[1].trim().slice(0, 200);
  }
  return null;
}

function fallbackPackage() {
  const emptyPage = { page: 1, text: '', imageBase64: null, isSizeTable: false, isBom: false, hasImage: false };
  return {
    docA: { doc_label: 'A', pages: [emptyPage], metadata: emptyMeta(), bom_table_raw: null, size_table_raw: null },
    docB: { doc_label: 'B', pages: [emptyPage], metadata: emptyMeta(), bom_table_raw: null, size_table_raw: null },
    buyer_comments: '',
    warnings: []
  };
}

function emptyMeta() {
  return {
    brand: null, style: null, season: null, color: null, fabric: null,
    title: null, author: null, pageCount: 0, fileName: null, fileSize: null,
    doc_hash: 'empty'
  };
}

export default { runExtractorAgent };
