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
  A: { name: null, pages: 0, text: '', pdf: null, preview: null, pageTextMap: [], pageScores: [], autoTextPages: [], autoImagePages: [] },
  B: { name: null, pages: 0, text: '', pdf: null, preview: null, pageTextMap: [], pageScores: [], autoTextPages: [], autoImagePages: [] },
  customerProfile: 'hybrid',
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

function detectCustomerProfile(comments = '') {
  const t = String(comments || '').toLowerCase();
  if (/attached image|see image|markup|mark up|arrow|circled|circle|photo|sketch|artwork/.test(t)) return 'image-markup';
  if (/comment column|remarks|revise|amend|pls change|approved with comment/.test(t)) return 'text-first';
  return 'hybrid';
}

function classifyPages(entry) {
  const pages = entry.pageTextMap || [];
  if (!pages.length) return { scores: [], autoTextPages: [], autoImagePages: [] };

  const scores = pages.map(({ page, text, length }) => {
    const lower = text.toLowerCase();
    const hasMeasurement = /measurement|measure|spec|pom|size|neck|chest|waist|hip|sleeve|inseam|outseam/.test(lower);
    const hasComment = /comment|remarks|revise|amend|change to|pls change|approved with comment|buyer comment/.test(lower);
    const hasArtwork = /sketch|artwork|graphic|photo|placement|print|embroidery|label position/.test(lower);
    const hasBom = /bom|fabric|trim|zipper|button|care label|hangtag|packaging|polybag/.test(lower);

    let pageType = 'general';
    let textScore = 0;
    let imageScore = 0;
    const reasons = [];

    if (hasMeasurement) {
      pageType = 'measurement';
      textScore += 2;
      reasons.push('measurement keywords');
    }
    if (hasComment && length > 40) {
      pageType = pageType === 'measurement' ? 'measurement+comment' : 'text-comment';
      textScore += 3;
      reasons.push('comment keywords');
    }
    if (hasBom) {
      textScore += 1;
      reasons.push('BOM / trim keywords');
    }
    if (hasArtwork) {
      imageScore += 2;
      reasons.push('artwork / sketch keywords');
    }
    if (length < 80) {
      imageScore += 2;
      reasons.push('low text density');
    }
    if (length < 30) {
      imageScore += 1;
    }

    return { page, length, pageType, textScore, imageScore, reasons };
  });

  let lastMeasurementPage = -1;
  scores.forEach(item => {
    if (String(item.pageType).includes('measurement')) {
      lastMeasurementPage = item.page;
    } else if (lastMeasurementPage > 0 && item.page > lastMeasurementPage && item.length < 120) {
      item.imageScore += 2;
      item.reasons.push('after measurement page with low text');
    }
  });

  const autoTextPages = scores
    .filter(item => item.textScore > 0)
    .sort((a, b) => b.textScore - a.textScore || a.page - b.page)
    .slice(0, 3)
    .map(item => item.page);

  const autoImagePages = scores
    .filter(item => item.imageScore > 0)
    .sort((a, b) => b.imageScore - a.imageScore || a.page - b.page)
    .slice(0, 2)
    .map(item => item.page);

  return { scores, autoTextPages, autoImagePages };
}

function pickPagesForProfile(profile, entry) {
  const textPages = entry.autoTextPages || [];
  const imagePages = entry.autoImagePages || [];

  if (profile === 'text-first') {
    return { textPages: textPages.length ? textPages : imagePages, imagePages };
  }
  if (profile === 'image-markup') {
    return { textPages, imagePages: imagePages.length ? imagePages : textPages };
  }
  return { textPages, imagePages };
}

function buildTextForCompare(entry, selectedPages) {
  const map = entry.pageTextMap || [];
  if (!selectedPages || !selectedPages.length) return entry.text || '';
  const want = new Set(selectedPages);
  const parts = map.filter(p => want.has(p.page)).map(p => `--- Page ${p.page} ---\n${p.text}`);
  return parts.join('\n\n');
}

function selectionDisplay(pages) {
  return pages && pages.length ? pages.join(', ') : '-';
}

function buildSelectionMetaHtml(profile, pickA, pickB) {
  return `
    <section class="report-block">
      <h3>System Page Selection</h3>
      <ul>
        <li>Customer profile: ${escapeHtml(profile)}</li>
        <li>Text pages A: ${escapeHtml(selectionDisplay(pickA.textPages))}</li>
        <li>Text pages B: ${escapeHtml(selectionDisplay(pickB.textPages))}</li>
        <li>Image pages A: ${escapeHtml(selectionDisplay(pickA.imagePages))}</li>
        <li>Image pages B: ${escapeHtml(selectionDisplay(pickB.imagePages))}</li>
      </ul>
    </section>
  `;
}

function buildDebugPageHtml(side) {
  const items = state[side].pageScores || [];
  if (!items.length) return '';
  return `
    <section class="report-block">
      <h3>Page Classification ${escapeHtml(side)}</h3>
      <div class="compact-table-wrap">
        <table class="compact-table">
          <thead>
            <tr>
              <th>Page</th>
              <th>Type</th>
              <th>Chars</th>
              <th>Text Score</th>
              <th>Image Score</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td>${item.page}</td>
                <td>${escapeHtml(item.pageType)}</td>
                <td>${item.length}</td>
                <td>${item.textScore}</td>
                <td>${item.imageScore}</td>
                <td>${escapeHtml(item.reasons.join(', ') || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function buildPointFormSummary({ textData, imageData, imageSkipped = false, imageError = '', profile = 'hybrid', pickA = { textPages: [], imagePages: [] }, pickB = { textPages: [], imagePages: [] } }) {
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
    `Customer profile: ${profile}`,
    `Text pages A: ${selectionDisplay(pickA.textPages)} | B: ${selectionDisplay(pickB.textPages)}`,
    `Image pages A: ${selectionDisplay(pickA.imagePages)} | B: ${selectionDisplay(pickB.imagePages)}`,
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
    ...(topSummary.length ? topSummary : ['No overall summary generated.']).map(v => `- ${v}`),
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

async function buildPreviewForSide(side, pageNum, setVisible = false) {
  const entry = state[side];
  if (!entry.pdf || !pageNum) return null;
  const page = await entry.pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.4 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  const preview = { page: pageNum, dataUrl, width: canvas.width, height: canvas.height };

  if (setVisible) {
    entry.preview = preview;
    const img = side === 'A' ? previewImgA : previewImgB;
    const meta = side === 'A' ? previewMetaA : previewMetaB;
    img.src = dataUrl;
    meta.textContent = `Page ${pageNum} · ${canvas.width} × ${canvas.height}`;
    updateStats();
  }

  return preview;
}

async function renderPagePreview(side, pageNum) {
  await buildPreviewForSide(side, pageNum, true);
}

async function extractPdfText(file, side) {
  if (!file) return;
  const meta = side === 'A' ? fileAMeta : fileBMeta;
  const nameEl = side === 'A' ? fileAName : fileBName;
  const pageSelect = side === 'A' ? textASelect : textBSelect;

  try {
    setActionStatus(`Reading PDF ${side}...`);
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pageTexts = [];
    const pageTextMap = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const line = content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
      pageTexts.push(`--- Page ${pageNum} ---\n${line}`);
      pageTextMap.push({ page: pageNum, text: line, length: line.length });
    }

    const fullText = pageTexts.join('\n\n');
    const nextEntry = {
      name: file.name,
      pages: pdf.numPages,
      text: fullText,
      pdf,
      preview: null,
      pageTextMap,
      pageScores: [],
      autoTextPages: [],
      autoImagePages: []
    };

    const classified = classifyPages(nextEntry);
    nextEntry.pageScores = classified.scores;
    nextEntry.autoTextPages = classified.autoTextPages;
    nextEntry.autoImagePages = classified.autoImagePages;
    state[side] = nextEntry;

    nameEl.textContent = file.name;
    meta.textContent = `Pages: ${pdf.numPages} · Characters: ${fullText.length.toLocaleString()} · Auto text pages: ${selectionDisplay(nextEntry.autoTextPages)} · Auto image pages: ${selectionDisplay(nextEntry.autoImagePages)}`;
    fillPageSelect(pageSelect, pdf.numPages);

    const firstPreviewPage = nextEntry.autoImagePages[0] || 1;
    pageSelect.value = String(firstPreviewPage);
    await renderPagePreview(side, firstPreviewPage);
    setActionStatus(`PDF ${side} ready`);
  } catch (error) {
    meta.textContent = 'Pages: - · Characters: -';
    console.error(error);
    setActionStatus(`Failed to read PDF ${side}`);
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

function renderFinalReport({ textData, imageData, imageSkipped = false, imageError = '', profile = 'hybrid', pickA = { textPages: [], imagePages: [] }, pickB = { textPages: [], imagePages: [] } }) {
  const textResult = textData?.result || {};
  const textSummary = textResult.summary || {};
  const textDiffs = Array.isArray(textResult.differences) ? textResult.differences : [];
  const buyerComments = Array.isArray(textResult.buyer_comments) ? textResult.buyer_comments : [];
  const textActions = Array.isArray(textResult.action_items) ? textResult.action_items : [];
  const imageResult = imageData?.result || {};
  const imageComments = Array.isArray(imageResult.visible_comments) ? imageResult.visible_comments : [];
  const imageChanges = Array.isArray(imageResult.visual_changes) ? imageResult.visual_changes : [];
  const imageActions = Array.isArray(imageResult.action_items) ? imageResult.action_items : [];

  const summaryPack = buildPointFormSummary({ textData, imageData, imageSkipped, imageError, profile, pickA, pickB });
  state.latestSummaryText = summaryPack.plainText;

  const html = `
    <article class="report-card">
      <header class="report-header">
        <div>
          <p class="eyebrow">Tech Pack Compare Report</p>
          <h2>Final Summary</h2>
          <p class="report-subtitle">AI-assisted text + image review for apparel Sales / Merchandisers</p>
        </div>
      </header>

      ${buildSelectionMetaHtml(profile, pickA, pickB)}

      <section class="report-block">
        <h3>Overall Summary</h3>
        ${toBulletList(summaryPack.sections.topSummary, 'No overall summary generated.')}
      </section>

      <section class="report-block">
        <h3>Key Text Differences</h3>
        ${textDiffs.length ? `
          <div class="diff-list">
            ${textDiffs.map(item => `
              <div class="diff-card">
                <div class="diff-top">
                  <strong>${escapeHtml(item.section || 'General')}</strong>
                  ${badgeHtml(item.impact || 'low')}
                </div>
                <div class="diff-grid">
                  <div>
                    <div class="muted-label">Before</div>
                    <p>${escapeHtml(item.before || '-')}</p>
                  </div>
                  <div>
                    <div class="muted-label">After</div>
                    <p>${escapeHtml(item.after || '-')}</p>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p>No key text differences found.</p>'}
      </section>

      <section class="report-block">
        <h3>Image Comments / Visual Changes</h3>
        ${imageChanges.length ? `
          <div class="diff-list">
            ${imageChanges.map(item => `
              <div class="diff-card">
                <div class="diff-top">
                  <strong>${escapeHtml(item.area || 'Visual area')}</strong>
                  ${badgeHtml(item.impact || 'low')}
                </div>
                <p>${escapeHtml(item.note || '-')}</p>
              </div>
            `).join('')}
          </div>
        ` : '<p>No image findings found.</p>'}
        <div class="inline-columns">
          <div>
            <div class="muted-label">Visible / Extracted Image Comments</div>
            ${toBulletList(imageComments, 'No visible image comments extracted.')}
          </div>
          <div>
            <div class="muted-label">Buyer Comments</div>
            ${toBulletList(buyerComments, 'No buyer comments extracted.')}
          </div>
        </div>
      </section>

      <section class="report-block">
        <h3>Merged Follow-up Actions</h3>
        ${toBulletList(uniqueItems([...textActions, ...imageActions]), 'No follow-up actions returned.')}
      </section>

      ${buildDebugPageHtml('A')}
      ${buildDebugPageHtml('B')}
    </article>
  `;

  state.latestReportHtml = html;
  finalReportOut.innerHTML = html;
}

async function runImageOnly() {
  if (!state.A.pdf || !state.B.pdf) {
    setActionStatus('Please upload both PDFs first');
    return;
  }

  try {
    setActionStatus('Running image review...');
    state.customerProfile = detectCustomerProfile(commentsInput.value);
    const pickA = pickPagesForProfile(state.customerProfile, state.A);
    const pickB = pickPagesForProfile(state.customerProfile, state.B);
    const pageA = pickA.imagePages[0] || Number(textASelect.value || 1);
    const pageB = pickB.imagePages[0] || Number(textBSelect.value || 1);

    const previewA = await buildPreviewForSide('A', pageA, true);
    const previewB = await buildPreviewForSide('B', pageB, true);

    const data = await callJson('/.netlify/functions/analyze-techpack-images', {
      imageA: previewA?.dataUrl || '',
      imageB: previewB?.dataUrl || '',
      pageA,
      pageB,
      comments: commentsInput.value || ''
    });

    renderFinalReport({ textData: null, imageData: data, profile: state.customerProfile, pickA, pickB });
    setActionStatus('Image review ready');
  } catch (error) {
    console.error(error);
    setActionStatus(`Image review failed: ${error.message}`);
  }
}

async function runFullCompare() {
  if (!state.A.pdf || !state.B.pdf) {
    setActionStatus('Please upload both PDFs first');
    return;
  }

  try {
    setActionStatus('Preparing automatic page selection...');
    state.customerProfile = detectCustomerProfile(commentsInput.value);
    const pickA = pickPagesForProfile(state.customerProfile, state.A);
    const pickB = pickPagesForProfile(state.customerProfile, state.B);

    const textA = buildTextForCompare(state.A, pickA.textPages);
    const textB = buildTextForCompare(state.B, pickB.textPages);

    setActionStatus('Comparing selected text pages...');
    const textData = await callJson('/.netlify/functions/compare-techpacks', {
      textA,
      textB,
      comments: commentsInput.value || ''
    });

    let imageData = null;
    let imageSkipped = false;
    let imageError = '';

    try {
      const pageA = pickA.imagePages[0] || Number(textASelect.value || 1);
      const pageB = pickB.imagePages[0] || Number(textBSelect.value || 1);
      setActionStatus('Reviewing selected image pages...');
      const previewA = await buildPreviewForSide('A', pageA, true);
      const previewB = await buildPreviewForSide('B', pageB, true);
      imageData = await callJson('/.netlify/functions/analyze-techpack-images', {
        imageA: previewA?.dataUrl || '',
        imageB: previewB?.dataUrl || '',
        pageA,
        pageB,
        comments: commentsInput.value || ''
      });
    } catch (error) {
      console.error(error);
      imageSkipped = true;
      imageError = error.message || 'Image review failed';
    }

    renderFinalReport({ textData, imageData, imageSkipped, imageError, profile: state.customerProfile, pickA, pickB });
    setActionStatus('Final report ready');
  } catch (error) {
    console.error(error);
    setActionStatus(`Report failed: ${error.message}`);
  }
}

fileAInput?.addEventListener('change', e => extractPdfText(e.target.files?.[0], 'A'));
fileBInput?.addEventListener('change', e => extractPdfText(e.target.files?.[0], 'B'));
textASelect?.addEventListener('change', e => renderPagePreview('A', Number(e.target.value)));
textBSelect?.addEventListener('change', e => renderPagePreview('B', Number(e.target.value)));
bindDropzone('dropA', fileAInput, 'A');
bindDropzone('dropB', fileBInput, 'B');
compareBtn?.addEventListener('click', runFullCompare);
compareBtn2?.addEventListener('click', runFullCompare);
visionBtn?.addEventListener('click', runImageOnly);
copySummaryBtn?.addEventListener('click', async () => {
  if (!state.latestSummaryText) {
    setActionStatus('No summary available to copy');
    return;
  }
  try {
    await navigator.clipboard.writeText(state.latestSummaryText);
    setActionStatus('Summary copied');
  } catch (error) {
    console.error(error);
    setActionStatus('Copy failed');
  }
});
exportReportBtn?.addEventListener('click', () => {
  window.print();
});
