import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs';

const compareBtn = document.getElementById('compareBtn');
const compareBtn2 = document.getElementById('compareBtn2');
const visionBtn = document.getElementById('visionBtn');
const fileAInput = document.getElementById('fileA');
const fileBInput = document.getElementById('fileB');
const fileAName = document.getElementById('fileAName');
const fileBName = document.getElementById('fileBName');
const fileAMeta = document.getElementById('fileAMeta');
const fileBMeta = document.getElementById('fileBMeta');
const commentsInput = document.getElementById('commentsInput');
const compareOut = document.getElementById('compareOut');
const visionOut = document.getElementById('visionOut');
const statFiles = document.getElementById('statFiles');
const statPages = document.getElementById('statPages');
const statPreviewA = document.getElementById('statPreviewA');
const statPreviewB = document.getElementById('statPreviewB');
const previewImgA = document.getElementById('previewImgA');
const previewImgB = document.getElementById('previewImgB');
const previewMetaA = document.getElementById('previewMetaA');
const previewMetaB = document.getElementById('previewMetaB');
const textASelect = document.getElementById('visionPageA');
const textBSelect = document.getElementById('visionPageB');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeText = document.getElementById('themeText');

const state = {
  A: { name: null, pages: 0, text: '', pdf: null, preview: null },
  B: { name: null, pages: 0, text: '', pdf: null, preview: null }
};

(function initTheme() {
  const root = document.documentElement;
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const applyTheme = (mode) => {
    theme = mode;
    root.setAttribute('data-theme', mode);
    const isDark = mode === 'dark';
    themeIcon.textContent = isDark ? '☀️' : '🌙';
    themeText.textContent = isDark ? 'Light' : 'Dark';
    themeToggle.setAttribute('aria-label', isDark ? '切換淺色模式' : '切換深色模式');
  };
  applyTheme(theme);
  themeToggle.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
})();

function updateStats() {
  statFiles.textContent = [state.A.name, state.B.name].filter(Boolean).length;
  statPages.textContent = state.A.pages + state.B.pages;
  statPreviewA.textContent = state.A.preview?.page || '-';
  statPreviewB.textContent = state.B.preview?.page || '-';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}

function fillPageSelect(select, numPages) {
  select.innerHTML = '';
  for (let i = 1; i <= numPages; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Page ${i}`;
    select.appendChild(option);
  }
}

async function renderPagePreview(side, pageNum) {
  const entry = state[side];
  if (!entry.pdf) return;
  const page = await entry.pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.4 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  entry.preview = { page: pageNum, dataUrl, width: canvas.width, height: canvas.height };

  const img = side === 'A' ? previewImgA : previewImgB;
  const meta = side === 'A' ? previewMetaA : previewMetaB;
  img.src = dataUrl;
  meta.textContent = `Page ${pageNum} · ${canvas.width} × ${canvas.height}`;
  updateStats();
}

async function extractPdfText(file, side) {
  if (!file) return;
  const meta = side === 'A' ? fileAMeta : fileBMeta;
  const nameEl = side === 'A' ? fileAName : fileBName;
  const pageSelect = side === 'A' ? textASelect : textBSelect;

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pageTexts = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const line = content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
      pageTexts.push(`--- Page ${pageNum} ---\n${line}`);
    }
    const fullText = pageTexts.join('\n\n');
    state[side] = { name: file.name, pages: pdf.numPages, text: fullText, pdf, preview: null };
    nameEl.textContent = file.name;
    meta.textContent = `Pages: ${pdf.numPages} · Characters: ${fullText.length.toLocaleString()}`;
    fillPageSelect(pageSelect, pdf.numPages);
    await renderPagePreview(side, 1);
  } catch (error) {
    meta.textContent = 'Pages: - · Characters: -';
    console.error(error);
  } finally {
    updateStats();
  }
}

function bindDropzone(dropId, input, side) {
  const zone = document.getElementById(dropId);
  ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, e => { e.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', e => {
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      extractPdfText(file, side);
    }
  });
}

async function callJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderSimpleBox(el, title, data) {
  el.innerHTML = `<div style="font-weight:800;margin-bottom:10px;">${title}</div><pre style="margin:0;">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

function renderVisionResult(data) {
  const result = data.result || {};
  const comments = Array.isArray(result.visible_comments) ? result.visible_comments : [];
  const visualChanges = Array.isArray(result.visual_changes) ? result.visual_changes : [];
  const actionItems = Array.isArray(result.action_items) ? result.action_items : [];
  const warning = data.warning ? `<div style="margin-bottom:12px;padding:10px 12px;border-radius:14px;background:rgba(156,97,27,.12);color:#9c611b;font-size:13px;font-weight:600;">Fallback mode: ${escapeHtml(data.warning)}</div>` : '';

  const impactBadge = (impact = 'low') => {
    const map = {
      high: 'background:rgba(156,53,82,.12);color:#9c3552;',
      medium: 'background:rgba(156,97,27,.12);color:#9c611b;',
      low: 'background:rgba(47,125,69,.12);color:#2f7d45;'
    };
    return `<span style="display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800;${map[impact] || map.low}">${impact.toUpperCase()}</span>`;
  };

  visionOut.innerHTML = `
    ${warning}
    <div style="display:grid;gap:14px;">
      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <div style="font-weight:800;margin-bottom:8px;">Image Comment Summary</div>
        <div style="color:var(--muted);line-height:1.7;">${escapeHtml(result.summary || 'No summary returned.')}</div>
      </div>
      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <div style="font-weight:800;margin-bottom:10px;">Visible Comments (${comments.length})</div>
        <ul style="margin:0 0 0 18px;padding:0;color:var(--muted);line-height:1.8;">
          ${comments.length ? comments.map(item => `<li>${escapeHtml(item)}</li>`).join('') : '<li>No clear image comments detected.</li>'}
        </ul>
      </div>
      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <div style="font-weight:800;margin-bottom:10px;">Visual Changes (${visualChanges.length})</div>
        <div style="display:grid;gap:10px;">
          ${visualChanges.length ? visualChanges.map(item => `
            <div style="border:1px solid var(--border);border-radius:16px;padding:12px;background:var(--surface);display:grid;gap:8px;">
              <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;">
                <span style="font-weight:800;">${escapeHtml(item.area || 'Visual area')}</span>
                ${impactBadge(item.impact || 'low')}
              </div>
              <div style="color:var(--muted);line-height:1.7;">${escapeHtml(item.note || '')}</div>
            </div>`).join('') : '<div style="color:var(--muted);">No visual changes returned.</div>'}
        </div>
      </div>
      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <div style="font-weight:800;margin-bottom:10px;">Action Items (${actionItems.length})</div>
        <ol style="margin:0 0 0 18px;padding:0;color:var(--muted);line-height:1.8;">
          ${actionItems.length ? actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join('') : '<li>No action items returned.</li>'}
        </ol>
      </div>
      <details style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <summary style="cursor:pointer;font-weight:800;">Raw JSON</summary>
        <pre style="margin-top:12px;">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>`;
}

async function runCompare() {
  compareOut.textContent = 'Running compare...';
  try {
    const data = await callJson('/.netlify/functions/compare-techpacks', {
      textA: state.A.text,
      textB: state.B.text,
      comments: commentsInput.value
    });
    renderSimpleBox(compareOut, 'Text Compare Result', data);
  } catch (error) {
    compareOut.textContent = error.message;
  }
}

async function runVisionReview() {
  visionOut.textContent = 'Running image review...';
  try {
    if (!state.A.preview || !state.B.preview) throw new Error('Please upload both PDFs first.');
    const data = await callJson('/.netlify/functions/analyze-techpack-images', {
      imageA: state.A.preview.dataUrl,
      imageB: state.B.preview.dataUrl,
      pageA: state.A.preview.page,
      pageB: state.B.preview.page,
      comments: commentsInput.value
    });
    renderVisionResult(data);
  } catch (error) {
    visionOut.textContent = error.message;
  }
}

fileAInput.addEventListener('change', e => extractPdfText(e.target.files[0], 'A'));
fileBInput.addEventListener('change', e => extractPdfText(e.target.files[0], 'B'));
textASelect.addEventListener('change', e => renderPagePreview('A', Number(e.target.value)));
textBSelect.addEventListener('change', e => renderPagePreview('B', Number(e.target.value)));
compareBtn.addEventListener('click', runCompare);
compareBtn2.addEventListener('click', runCompare);
visionBtn.addEventListener('click', runVisionReview);
bindDropzone('dropA', fileAInput, 'A');
bindDropzone('dropB', fileBInput, 'B');
updateStats();
