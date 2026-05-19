/*
  Path:     public/modules/upload.js
  Purpose:  PDF.js dropzone + thumbnail render + sizeTable/BOM regex detection + relevantImages (≤6 頁)
  Depends:  PDF.js (CDN, exposed as window.pdfjsLib), ./logger.js, ./i18n.js, ./toast.js, ./ui.js
  Notes:    所有 parse 都在 PDF.js worker;不會 block UI。
*/

import { logger } from './logger.js';
import { I18N } from './i18n.js';
import { Toast } from './toast.js';
import { escapeHtml } from './ui.js';

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

let pdfReady = false;

function ensurePdfJs() {
  if (pdfReady) return true;
  if (typeof window === 'undefined' || !window.pdfjsLib) return false;
  // worker
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    window.pdfjsLib.GlobalWorkerOptions.workerSrc ||
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
  pdfReady = true;
  return true;
}

/**
 * 解析 PDF File 為 v2.1 techPack payload
 * @param {File} file
 * @param {(stage: string, pct: number) => void} [onProgress]
 * @returns {Promise<{ fileName, fileSize, pageCount, metadata, pages, rawText, sizeTablePages, bomPages, relevantImages }>}
 */
export async function parsePdfFile(file, onProgress = () => {}) {
  if (!ensurePdfJs()) {
    throw new Error('PDF.js 尚未載入');
  }
  if (!file || file.type !== 'application/pdf') {
    throw new Error('請選擇 PDF 檔案');
  }
  onProgress('讀檔中', 5);
  const buffer = await file.arrayBuffer();
  onProgress('開啟 PDF', 12);
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = pdf.numPages;

  // metadata
  let title = null, author = null;
  try {
    const meta = await pdf.getMetadata();
    title = meta?.info?.Title || null;
    author = meta?.info?.Author || null;
  } catch (_) { /* ignore */ }

  const pages = [];
  const sizeTablePages = [];
  const bomPages = [];
  const candidateImagePages = []; // [{page, score}]

  for (let i = 1; i <= pageCount; i++) {
    onProgress(`解析第 ${i}/${pageCount} 頁`, Math.round(15 + (i / pageCount) * 70));
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = (tc.items || []).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();

    const isSizeTable = SIZE_KEYWORDS.some((re) => re.test(text));
    const isBom = BOM_KEYWORDS.some((re) => re.test(text));
    // operators 數量大致代表 vector graphics 量（簡易 image 偵測:沒 text 也視為 image-heavy)
    const hasImage = text.length < 100; // 啟發式:文字少 = 圖多

    pages.push({ page: i, text, isSizeTable, isBom, hasImage });
    if (isSizeTable) sizeTablePages.push(i);
    if (isBom) bomPages.push(i);

    // score for relevantImages
    const score = (isSizeTable ? 3 : 0) + (isBom ? 3 : 0) + (hasImage ? 1 : 0);
    if (score > 0) candidateImagePages.push({ page: i, score });
  }

  // Render relevantImages (top-N by score, ≤ MAX_RELEVANT_IMAGES)
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

  // Thumbnail (first page)
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
  return canvas.toDataURL('image/jpeg', 0.7); // jpeg 較小
}

/**
 * Mount dropzone — clickable + drag/drop
 * @param {HTMLElement} root
 * @param {object} opts { onParsed: (techPack) => void }
 */
export function mountDropzone(root, { onParsed, label = 'A' } = {}) {
  if (!root) return () => {};
  root.innerHTML = `
    <div class="dropzone" data-state="idle">
      <div class="dz-empty">
        <div class="dz-icon">📄</div>
        <div class="dz-label">${escapeHtml(I18N.buttons.dropHere)}</div>
        <button type="button" class="btn btn-secondary dz-pick-btn">${escapeHtml(I18N.buttons.upload)}</button>
        <div class="dz-hint">支援 .pdf · 最大 20MB · 解析在 PDF.js worker 進行</div>
      </div>
      <div class="dz-progress hidden">
        <div class="dz-progress-label">準備中…</div>
        <div class="dz-progress-bar"><div class="dz-progress-fill" style="width:0%"></div></div>
      </div>
      <div class="dz-done hidden">
        <img class="dz-thumb" alt="" />
        <div class="dz-info">
          <div class="dz-filename"></div>
          <div class="dz-meta"></div>
          <div class="dz-tags"></div>
        </div>
        <button type="button" class="btn btn-ghost dz-remove">${escapeHtml(I18N.buttons.removeFile)}</button>
      </div>
      <input type="file" accept="application/pdf" class="dz-input hidden" />
    </div>
  `;
  const dz = root.querySelector('.dropzone');
  const input = root.querySelector('.dz-input');
  const pickBtn = root.querySelector('.dz-pick-btn');
  const removeBtn = root.querySelector('.dz-remove');

  function openPicker() { input.click(); }
  pickBtn.addEventListener('click', openPicker);
  dz.addEventListener('click', (e) => {
    if (e.target === pickBtn || dz.dataset.state !== 'idle') return;
    if (e.target.closest('.dz-done')) return;
    openPicker();
  });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('drag-over');
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
  removeBtn.addEventListener('click', () => {
    dz.dataset.state = 'idle';
    dz.querySelector('.dz-empty').classList.remove('hidden');
    dz.querySelector('.dz-done').classList.add('hidden');
    dz.querySelector('.dz-progress').classList.add('hidden');
    onParsed && onParsed(null);
  });

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
    dz.querySelector('.dz-empty').classList.add('hidden');
    dz.querySelector('.dz-progress').classList.remove('hidden');
    const fill = dz.querySelector('.dz-progress-fill');
    const lab = dz.querySelector('.dz-progress-label');
    try {
      const tp = await parsePdfFile(file, (stage, pct) => {
        lab.textContent = `${I18N.msg.parsingPdf} ${stage}`;
        fill.style.width = pct + '%';
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
      doneEl.querySelector('.dz-tags').innerHTML = [
        tp.sizeTablePages.length ? `<span class="dz-tag tag-size">尺寸頁: ${tp.sizeTablePages.join(',')}</span>` : '',
        tp.bomPages.length ? `<span class="dz-tag tag-bom">BOM 頁: ${tp.bomPages.join(',')}</span>` : ''
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

/**
 * 為了 Netlify 6MB payload 上限,送出前 strip thumbnail (前端不送回 backend)
 */
export function stripForUpload(tp) {
  if (!tp) return null;
  const { thumbnail, ...rest } = tp;
  return rest;
}

export default { parsePdfFile, mountDropzone, stripForUpload };
