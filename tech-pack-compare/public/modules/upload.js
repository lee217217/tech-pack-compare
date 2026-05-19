/*
  Path:     public/modules/upload.js
  Purpose:  v2.1.1 — PDF.js .mjs lazy load + retry + fallback CDN
            dropzone (idle/hover/drag-over/parsing/done) + thumbnail + sizeTable/BOM regex
            + relevantImages (≤6 頁,480px JPEG q=0.7)
  Depends:  ./logger.js, ./i18n.js, ./toast.js, ./ui.js
  Notes:    PDF.js 用 ES module 動態 import (cdnjs 4.0.379)。
            失敗 retry 1 次後 fallback 到 jsdelivr。
            版本 + CDN 透過 logger.info 印出方便排查。
*/

import { logger } from './logger.js';
import { I18N } from './i18n.js';
import { Toast } from './toast.js';
import { escapeHtml } from './ui.js';

// ── CDN endpoints ──────────────────────────────────────────────
const PDFJS_VERSION = '4.0.379';
const PDFJS_CDNS = [
  {
    name: 'cdnjs',
    module: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`,
    worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`
  },
  {
    name: 'jsdelivr',
    module: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`,
    worker: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`
  }
];

const SIZE_KEYWORDS = [
  /\bSIZE\s*(CHART|TABLE|SPEC|SPECIFICATION)\b/i,
  /\bMEASUREMENT(S)?\b/i,
  /\bGRADING\b/i,
  /\bPOM\b/i,
  /\bPOINT\s+OF\s+MEASURE\b/i,
  /尺寸|規格/
];
const BOM_KEYWORDS = [
  /\bBOM\b/i,
  /\bBILL\s+OF\s+MATERIAL/i,
  /\bMATERIAL(S)?\s+(LIST|DETAIL|BOM)?/i,
  /\bTRIM(S)?\b/i,
  /物料|用料|主料|副料|輔料|配料/
];

const MAX_RELEVANT_IMAGES = 6;
const THUMB_MAX_WIDTH = 220;
const RELEVANT_IMG_WIDTH = 480;

// ── PDF.js lazy loader ────────────────────────────────────────
/** @type {Promise<any> | null} */
let pdfJsPromise = null;
/** @type {{ name: string, version: string } | null} */
let loadedFrom = null;

/**
 * Lazy-load PDF.js as ES module。retry 1 次後 fallback。
 * 同時掛 GlobalWorkerOptions.workerSrc。
 */
export function loadPdfJs() {
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = (async () => {
    let lastErr = null;
    for (const cdn of PDFJS_CDNS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          logger.info('pdfjs.loading', { cdn: cdn.name, attempt, version: PDFJS_VERSION });
          // dynamic import — bypassed by Vite/bundler if any
          const mod = await import(/* @vite-ignore */ cdn.module);
          // cdnjs / jsdelivr 4.x 都 export 命名空間;pdfjs 也提供 default
          const lib = mod?.pdfjsLib || mod;
          if (!lib || typeof lib.getDocument !== 'function') {
            throw new Error('module 不含 getDocument');
          }
          lib.GlobalWorkerOptions = lib.GlobalWorkerOptions || {};
          lib.GlobalWorkerOptions.workerSrc = cdn.worker;
          // 暴露給 window 方便 debug + 跨 module 引用
          if (typeof window !== 'undefined') window.pdfjsLib = lib;
          loadedFrom = { name: cdn.name, version: PDFJS_VERSION };
          logger.info('pdfjs.loaded', loadedFrom);
          // 為 dev 排查:用 console.log 印出版本(允許,屬於 boot diagnostic)
          // eslint-disable-next-line no-console
          console.log(`[Tech Pack Comparator] PDF.js ${PDFJS_VERSION} loaded from ${cdn.name}`);
          return lib;
        } catch (err) {
          lastErr = err;
          logger.warn('pdfjs.load.fail', { cdn: cdn.name, attempt, err: String(err?.message || err) });
        }
      }
    }
    throw new Error(`PDF.js 載入失敗:${lastErr?.message || '所有 CDN 皆失敗'}`);
  })();
  return pdfJsPromise;
}

/** 預熱 — 在 idle 時呼叫一次,後續上傳就無需等 */
export function prewarmPdfJs() {
  // 避免阻塞首屏渲染;在 requestIdleCallback / setTimeout
  if (typeof window === 'undefined') return;
  const kick = () => loadPdfJs().catch(() => { /* 容錯,handleFile 會再試 */ });
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(kick, { timeout: 2500 });
  } else {
    setTimeout(kick, 600);
  }
}

export function getPdfJsInfo() {
  return loadedFrom ? { ...loadedFrom } : null;
}

/**
 * 解析 PDF File 為 v2.1 techPack payload
 * @param {File} file
 * @param {(stage: string, pct: number) => void} [onProgress]
 */
export async function parsePdfFile(file, onProgress = () => {}) {
  if (!file || file.type !== 'application/pdf') {
    throw new Error('請選擇 PDF 檔案');
  }
  onProgress('載入 PDF.js', 2);
  const pdfjsLib = await loadPdfJs();
  onProgress('讀檔中', 8);
  const buffer = await file.arrayBuffer();
  onProgress('開啟 PDF', 14);
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = pdf.numPages;

  let title = null, author = null;
  try {
    const meta = await pdf.getMetadata();
    title = meta?.info?.Title || null;
    author = meta?.info?.Author || null;
  } catch (_) { /* ignore */ }

  const pages = [];
  const sizeTablePages = [];
  const bomPages = [];
  const candidateImagePages = [];

  for (let i = 1; i <= pageCount; i++) {
    onProgress(`解析第 ${i}/${pageCount} 頁`, Math.round(15 + (i / pageCount) * 70));
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = (tc.items || []).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();

    const isSizeTable = SIZE_KEYWORDS.some((re) => re.test(text));
    const isBom = BOM_KEYWORDS.some((re) => re.test(text));
    const hasImage = text.length < 100;

    pages.push({ page: i, text, isSizeTable, isBom, hasImage });
    if (isSizeTable) sizeTablePages.push(i);
    if (isBom) bomPages.push(i);

    const score = (isSizeTable ? 3 : 0) + (isBom ? 3 : 0) + (hasImage ? 1 : 0);
    if (score > 0) candidateImagePages.push({ page: i, score });
  }

  candidateImagePages.sort((a, b) => b.score - a.score || a.page - b.page);
  const targets = candidateImagePages.slice(0, MAX_RELEVANT_IMAGES);
  onProgress('擷取圖像', 88);

  const relevantImages = [];
  for (const { page } of targets) {
    try {
      const b64 = await renderPageToBase64(pdf, page, RELEVANT_IMG_WIDTH);
      relevantImages.push({ page, base64: b64, region: 'full-page' });
    } catch (err) {
      logger.warn('upload.renderRelevant', { page, err: err.message });
    }
  }

  let thumbnail = null;
  try {
    thumbnail = await renderPageToBase64(pdf, 1, THUMB_MAX_WIDTH);
  } catch (_) { /* ignore */ }

  const rawText = pages.map((p) => p.text).join('\n\f\n');
  onProgress('完成', 100);

  return {
    fileName: file.name,
    fileSize: file.size,
    pageCount,
    metadata: { title, author, pageCount },
    pages,
    rawText,
    sizeTablePages,
    bomPages,
    relevantImages,
    thumbnail
  };
}

async function renderPageToBase64(pdf, pageNum, maxWidth) {
  const page = await pdf.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / baseViewport.width, 1.5);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.7);
}

/**
 * Mount dropzone — clickable + drag/drop
 * v2.1.1: hover / drag-over 三態 + 上傳完成卡 + 移除/重新上傳
 */
export function mountDropzone(root, { onParsed, label = 'A' } = {}) {
  if (!root) return () => {};
  root.innerHTML = `
    <div class="dropzone" data-state="idle" data-label="${escapeHtml(label)}">
      <div class="dz-empty">
        <div class="dz-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 4h16l8 8v28a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
            <path d="M30 4v8h8"/>
            <path d="M24 22v12m0-12l-4 4m4-4l4 4"/>
          </svg>
        </div>
        <div class="dz-title">${escapeHtml(I18N.buttons.dropHere)}</div>
        <div class="dz-sub">把 PDF 拖到這裡,或點擊選擇檔案</div>
        <button type="button" class="btn btn-secondary dz-pick-btn">${escapeHtml(I18N.buttons.upload)}</button>
        <div class="dz-hint">支援 .pdf · 最大 20MB · 解析在 PDF.js worker 進行</div>
      </div>
      <div class="dz-progress hidden">
        <div class="dz-progress-label">準備中…</div>
        <div class="dz-progress-bar"><div class="dz-progress-fill" style="width:0%"></div></div>
        <div class="dz-progress-pct mono">0%</div>
      </div>
      <div class="dz-done hidden">
        <button type="button" class="dz-remove-x" title="移除" aria-label="移除">✕</button>
        <img class="dz-thumb" alt="" />
        <div class="dz-info">
          <div class="dz-filename"></div>
          <div class="dz-meta mono"></div>
          <div class="dz-detect"></div>
          <div class="dz-tags"></div>
          <div class="dz-actions">
            <button type="button" class="btn btn-ghost btn-sm dz-replace">↻ 重新上傳</button>
          </div>
        </div>
      </div>
      <input type="file" accept="application/pdf" class="dz-input hidden" />
    </div>
  `;
  const dz = root.querySelector('.dropzone');
  const input = root.querySelector('.dz-input');
  const pickBtn = root.querySelector('.dz-pick-btn');
  const removeX = root.querySelector('.dz-remove-x');
  const replaceBtn = root.querySelector('.dz-replace');

  function openPicker() { input.click(); }
  pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
  dz.addEventListener('click', (e) => {
    if (dz.dataset.state !== 'idle') return;
    if (e.target.closest('.dz-done') || e.target.closest('.dz-pick-btn')) return;
    openPicker();
  });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    if (dz.dataset.state === 'parsing') return;
    dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) await handleFile(f);
  });
  input.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) await handleFile(f);
    input.value = '';
  });
  function clearFile() {
    dz.dataset.state = 'idle';
    dz.querySelector('.dz-empty').classList.remove('hidden');
    dz.querySelector('.dz-done').classList.add('hidden');
    dz.querySelector('.dz-progress').classList.add('hidden');
    onParsed && onParsed(null);
  }
  removeX.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });
  replaceBtn.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); openPicker(); });

  async function handleFile(file) {
    if (file.type !== 'application/pdf') {
      Toast.error('請選擇 PDF 檔案');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      Toast.error(`${file.name} 超過 20MB 上限`);
      return;
    }
    dz.dataset.state = 'parsing';
    dz.classList.remove('drag-over');
    dz.querySelector('.dz-empty').classList.add('hidden');
    dz.querySelector('.dz-progress').classList.remove('hidden');
    const fill = dz.querySelector('.dz-progress-fill');
    const lab = dz.querySelector('.dz-progress-label');
    const pct = dz.querySelector('.dz-progress-pct');
    try {
      // 友善訊息:若 PDF.js 還沒載好,顯示等待提示
      if (!loadedFrom) {
        lab.textContent = '首次解析需要載入 PDF.js…';
        Toast.info('首次解析需要載入 PDF.js,請稍候');
      }
      const tp = await parsePdfFile(file, (stage, p) => {
        lab.textContent = `${I18N.msg.parsingPdf} ${stage}`;
        fill.style.width = p + '%';
        pct.textContent = p + '%';
      });
      dz.dataset.state = 'done';
      dz.querySelector('.dz-progress').classList.add('hidden');
      const doneEl = dz.querySelector('.dz-done');
      doneEl.classList.remove('hidden');
      doneEl.querySelector('.dz-thumb').src = tp.thumbnail || '';
      doneEl.querySelector('.dz-filename').textContent = tp.fileName;
      const sz = (tp.fileSize / 1024).toFixed(1);
      doneEl.querySelector('.dz-meta').textContent =
        `${tp.pageCount} 頁 · ${sz} KB · ${tp.relevantImages.length} 圖`;
      const detectParts = [];
      if (tp.sizeTablePages.length) detectParts.push(`✓ 偵測到 ${tp.sizeTablePages.length} 個尺寸表`);
      if (tp.bomPages.length) detectParts.push(`✓ 偵測到 ${tp.bomPages.length} 個 BOM 表`);
      if (!detectParts.length) detectParts.push('未自動偵測到尺寸/BOM 表 (LLM 仍會嘗試)');
      doneEl.querySelector('.dz-detect').textContent = detectParts.join(' · ');
      doneEl.querySelector('.dz-tags').innerHTML = [
        tp.sizeTablePages.length ? `<span class="dz-tag tag-size">尺寸頁 ${tp.sizeTablePages.join(',')}</span>` : '',
        tp.bomPages.length ? `<span class="dz-tag tag-bom">BOM 頁 ${tp.bomPages.join(',')}</span>` : ''
      ].join('');
      Toast.success(`${I18N.msg.parseOk} (${label})`);
      onParsed && onParsed(tp);
    } catch (err) {
      logger.error('upload.parse', { err: err.message });
      Toast.error(`${I18N.msg.parseFail}: ${err.message}`);
      dz.dataset.state = 'idle';
      dz.querySelector('.dz-empty').classList.remove('hidden');
      dz.querySelector('.dz-progress').classList.add('hidden');
    }
  }

  return () => {
    pickBtn.removeEventListener('click', openPicker);
  };
}

/** 為了 Netlify 6MB payload 上限,送出前 strip thumbnail (前端不送回 backend) */
export function stripForUpload(tp) {
  if (!tp) return null;
  const { thumbnail, ...rest } = tp;
  return rest;
}

export default { parsePdfFile, mountDropzone, stripForUpload, loadPdfJs, prewarmPdfJs, getPdfJsInfo };
