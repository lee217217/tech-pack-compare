import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs';

const compareBtn = document.getElementById('compareBtn');
const compareBtn2 = document.getElementById('compareBtn2');
const visionBtn = document.getElementById('visionBtn');
const copySummaryBtn = document.getElementById('copySummaryBtn');
const exportReportBtn = document.getElementById('exportReportBtn');
const actionStatus = document.getElementById('actionStatus');
const fileAInput = document.getElementById('fileA');
const fileBInput = document.getElementById('fileB');
const fileAName = document.getElementById('fileAName');
const fileBName = document.getElementById('fileBName');
const fileAMeta = document.getElementById('fileAMeta');
const fileBMeta = document.getElementById('fileBMeta');
const commentsInput = document.getElementById('commentsInput');
const finalReportOut = document.getElementById('finalReportOut');
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
  B: { name: null, pages: 0, text: '', pdf: null, preview: null },
  latestSummaryText: '',
  latestReportHtml: ''
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

function setActionStatus(text) {
  actionStatus.textContent = text;
}

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

function badgeHtml(impact = 'low') {
  const cls = impact === 'high' ? 'badge badge-high' : impact === 'medium' ? 'badge badge-medium' : 'badge badge-low';
  return `<span class="${cls}">${escapeHtml(String(impact).toUpperCase())}</span>`;
}

function toBulletList(items, emptyText) {
  return items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<ul><li>${escapeHtml(emptyText)}</li></ul>`;
}

function uniqueItems(items) {
  return [...new Set(items.map(v => String(v).trim()).filter(Boolean))];
}

function buildPointFormSummary({ textData, imageData, imageSkipped = false, imageError = '' }) {
  const textResult = textData?.result || {};
  const textSummary = textResult.summary || {};
  const textDiffs = Array.isArray(textResult.differences) ? textResult.differences : [];
  const buyerComments = Array.isArray(textResult.buyer_comments) ? textResult.buyer_comments : [];
  const textActions = Array.isArray(textResult.action_items) ? textResult.action_items : [];
  const imageResult = imageData?.result || {};
  const imageComments = Array.isArray(imageResult.visible_comments) ? imageResult.visible_comments : [];
  const imageChanges = Array.isArray(imageResult.visual_changes) ? imageResult.visual_changes : [];
  const imageActions = Array.isArray(imageResult.action_items) ? imageResult.action_items : [];

  const topSummary = uniqueItems([
    textSummary.overview || '',
    imageResult.summary || '',
    imageSkipped ? 'Image review was skipped because preview pages were not ready.' : '',
    imageError ? `Image review failed: ${imageError}` : ''
  ]);

  const keyChangePoints = uniqueItems(textDiffs.slice(0, 8).map(item => {
    const section = item.section || 'General';
    const before = item.before || '-';
    const after = item.after || '-';
    return `${section}: ${before} → ${after}`;
  }));

  const imagePoints = uniqueItems(imageChanges.slice(0, 8).map(item => {
    const area = item.area || 'Visual area';
    return `${area}: ${item.note || ''}`;
  }).concat(imageComments.slice(0, 6)));

  const actionPoints = uniqueItems([...textActions, ...imageActions]);
  const buyerPoints = uniqueItems(buyerComments.slice(0, 8));

  const plainText = [
    'Tech Pack Final Summary',
    '',
    'Overall Summary',
    ...topSummary.map(v => `- ${v}`),
    '',
    'Key Changes',
    ...(keyChangePoints.length ? keyChangePoints : ['No key text changes found.']).map(v => `- ${v}`),
    '',
    'Image Comments / Visual Changes',
    ...(imagePoints.length ? imagePoints : ['No image findings found.']).map(v => `- ${v}`),
    '',
    'Buyer Comments',
    ...(buyerPoints.length ? buyerPoints : ['No buyer comments extracted.']).map(v => `- ${v}`),
    '',
    'Follow-up Actions',
    ...(actionPoints.length ? actionPoints : ['No follow-up actions returned.']).map(v => `- ${v}`)
  ].join('\n');

  return {
    plainText,
    sections: { topSummary, keyChangePoints, imagePoints, buyerPoints, actionPoints }
  };
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

function renderFinalReport({ textData, imageData, imageSkipped = false, imageError = '' }) {
  const textResult = textData?.result || {};
  const textSummary = textResult.summary || {};
  const textDiffs = Array.isArray(textResult.differences) ? textResult.differences : [];
  const buyerComments = Array.isArray(textResult.buyer_comments) ? textResult.buyer_comments : [];
  const textActions = Array.isArray(textResult.action_items) ? textResult.action_items : [];
  const imageResult = imageData?.result || {};
  const imageComments = Array.isArray(imageResult.visible_comments) ? imageResult.visible_comments : [];
  const imageChanges = Array.isArray(imageResult.visual_changes) ? imageResult.visual_changes : [];
  const imageActions = Array.isArray(imageResult.action_items) ? imageResult.action_items : [];
  const mergedActions = uniqueItems([...textActions, ...imageActions]);
  const notices = uniqueItems([
    textData?.warning ? `Text compare notice: ${textData.warning}` : '',
    imageData?.warning ? `Image review notice: ${imageData.warning}` : '',
    imageSkipped ? 'Image review skipped because preview pages were not ready.' : '',
    imageError ? `Image review failed: ${imageError}` : ''
  ]);

  const pointSummary = buildPointFormSummary({ textData, imageData, imageSkipped, imageError });
  state.latestSummaryText = pointSummary.plainText;

  finalReportOut.innerHTML = `
    <div class="report-grid" id="reportContent">
      <div class="report-card">
        <div class="report-item-head">
          <h4 style="margin:0;">Point-form summary</h4>
          ${badgeHtml(textSummary.risk_level || 'low')}
        </div>
        <div class="summary-grid">
          <div class="summary-panel">
            <h5>Overall summary</h5>
            ${toBulletList(pointSummary.sections.topSummary, 'No overall summary returned.')}
          </div>
          <div class="summary-panel">
            <h5>Key changes</h5>
            ${toBulletList(pointSummary.sections.keyChangePoints, 'No key text changes found.')}
          </div>
          <div class="summary-panel">
            <h5>Image comments / visual changes</h5>
            ${toBulletList(pointSummary.sections.imagePoints, 'No image findings found.')}
          </div>
          <div class="summary-panel">
            <h5>Buyer comments</h5>
            ${toBulletList(pointSummary.sections.buyerPoints, 'No buyer comments extracted.')}
          </div>
          <div class="summary-panel">
            <h5>Follow-up actions</h5>
            ${toBulletList(pointSummary.sections.actionPoints, 'No follow-up actions returned.')}
          </div>
        </div>
      </div>

      ${notices.length ? `
        <div class="report-card">
          <h4>System notices</h4>
          <ul class="report-list">${notices.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>` : ''}

      <div class="report-card">
        <h4>Detailed text differences (${textDiffs.length})</h4>
        <div class="report-items">
          ${textDiffs.length ? textDiffs.map(item => `
            <div class="report-item">
              <div class="report-item-head">
                <strong>${escapeHtml(item.section || 'General')}</strong>
                ${badgeHtml(item.impact || 'low')}
              </div>
              <div class="report-columns">
                <div>
                  <div class="label">Before</div>
                  <div class="muted">${escapeHtml(item.before || '-')}</div>
                </div>
                <div>
                  <div class="label">After</div>
                  <div class="muted">${escapeHtml(item.after || '-')}</div>
                </div>
              </div>
            </div>`).join('') : '<p>No text differences returned.</p>'}
        </div>
      </div>

      <div class="report-card">
        <h4>Detailed visual changes (${imageChanges.length})</h4>
        <div class="report-items">
          ${imageChanges.length ? imageChanges.map(item => `
            <div class="report-item">
              <div class="report-item-head">
                <strong>${escapeHtml(item.area || 'Visual area')}</strong>
                ${badgeHtml(item.impact || 'low')}
              </div>
              <div class="muted">${escapeHtml(item.note || '')}</div>
            </div>`).join('') : '<p>No visual changes returned.</p>'}
        </div>
      </div>

      <details class="report-card">
        <summary style="cursor:pointer;font-weight:800;">Raw JSON</summary>
        <div class="raw-box" style="margin-top:12px;">${escapeHtml(JSON.stringify({ textData, imageData }, null, 2))}</div>
      </details>
    </div>`;

  state.latestReportHtml = finalReportOut.innerHTML;
}

async function runImageOnly() {
  finalReportOut.textContent = 'Running image review...';
  setActionStatus('Running image review');
  try {
    if (!state.A.preview || !state.B.preview) throw new Error('Please upload both PDFs and keep preview pages selected.');
    const imageData = await callJson('/.netlify/functions/analyze-techpack-images', {
      imageA: state.A.preview.dataUrl,
      imageB: state.B.preview.dataUrl,
      pageA: state.A.preview.page,
      pageB: state.B.preview.page,
      comments: commentsInput.value
    });
    renderFinalReport({ textData: { result: { summary: { overview: 'Image-only run. Full text compare not executed.', risk_level: 'low' }, differences: [], buyer_comments: [], action_items: [] } }, imageData });
    setActionStatus('Image review ready');
  } catch (error) {
    finalReportOut.textContent = error.message;
    setActionStatus('Image review failed');
  }
}

async function runFinalReport() {
  finalReportOut.textContent = 'Generating final report...';
  setActionStatus('Generating report');
  try {
    if (!state.A.text || !state.B.text) throw new Error('Please upload both PDFs first.');

    const textData = await callJson('/.netlify/functions/compare-techpacks', {
      textA: state.A.text,
      textB: state.B.text,
      comments: commentsInput.value
    });

    let imageData = null;
    let imageSkipped = false;
    let imageError = '';

    if (state.A.preview && state.B.preview) {
      try {
        imageData = await callJson('/.netlify/functions/analyze-techpack-images', {
          imageA: state.A.preview.dataUrl,
          imageB: state.B.preview.dataUrl,
          pageA: state.A.preview.page,
          pageB: state.B.preview.page,
          comments: commentsInput.value
        });
      } catch (error) {
        imageError = error.message;
      }
    } else {
      imageSkipped = true;
    }

    renderFinalReport({ textData, imageData, imageSkipped, imageError });
    setActionStatus('Report ready');
  } catch (error) {
    finalReportOut.textContent = error.message;
    setActionStatus('Report failed');
  }
}

async function copySummary() {
  try {
    if (!state.latestSummaryText) throw new Error('Please generate a report first.');
    await navigator.clipboard.writeText(state.latestSummaryText);
    setActionStatus('Summary copied');
  } catch (error) {
    setActionStatus('Copy failed');
    alert(error.message || 'Copy failed');
  }
}

function exportReport() {
  if (!state.latestReportHtml) {
    setActionStatus('Nothing to export');
    alert('Please generate a report first.');
    return;
  }
  setActionStatus('Opening print view');
  window.print();
}

fileAInput.addEventListener('change', e => extractPdfText(e.target.files[0], 'A'));
fileBInput.addEventListener('change', e => extractPdfText(e.target.files[0], 'B'));
textASelect.addEventListener('change', e => renderPagePreview('A', Number(e.target.value)));
textBSelect.addEventListener('change', e => renderPagePreview('B', Number(e.target.value)));
compareBtn.addEventListener('click', runFinalReport);
compareBtn2.addEventListener('click', runFinalReport);
visionBtn.addEventListener('click', runImageOnly);
copySummaryBtn.addEventListener('click', copySummary);
exportReportBtn.addEventListener('click', exportReport);
bindDropzone('dropA', fileAInput, 'A');
bindDropzone('dropB', fileBInput, 'B');
updateStats();
setActionStatus('No report yet');
