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
  A: { name: null, pages: 0, text: '', pdf: null, preview: null, pageTextMap: [], pageScores: [], autoTextPages: [], autoImagePages: [], autoMeasurementPages: [] },
  B: { name: null, pages: 0, text: '', pdf: null, preview: null, pageTextMap: [], pageScores: [], autoTextPages: [], autoImagePages: [], autoMeasurementPages: [] },
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

function statusBadgeHtml(status = 'Changed') {
  const normalized = String(status || 'Changed');
  let cls = 'badge badge-medium';
  if (normalized === 'Changed') cls = 'badge badge-high';
  if (normalized === 'Same') cls = 'badge badge-low';
  if (normalized === 'Added in B') cls = 'badge badge-medium';
  if (normalized === 'Removed from B') cls = 'badge badge-medium';
  return `<span class="${cls}">${escapeHtml(normalized)}</span>`;
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
  if (!pages.length) return { scores: [], autoTextPages: [], autoImagePages: [], autoMeasurementPages: [] };

  const scores = pages.map(({ page, text, length }) => {
    const lower = text.toLowerCase();
    const hasMeasurement = /measurement|measure|spec|pom|size|neck|chest|waist|hip|sleeve|inseam|outseam|tolerance/.test(lower);
    const hasComment = /comment|remarks|revise|amend|change to|pls change|approved with comment|buyer comment/.test(lower);
    const hasArtwork = /sketch|artwork|graphic|photo|placement|print|embroidery|label position/.test(lower);
    const hasBom = /bom|fabric|trim|zipper|button|care label|hangtag|packaging|polybag/.test(lower);

    let pageType = 'general';
    let textScore = 0;
    let imageScore = 0;
    let measurementScore = 0;

    if (hasMeasurement) {
      pageType = 'measurement';
      textScore += 2;
      measurementScore += 4;
    }
    if (hasComment && length > 40) {
      pageType = pageType === 'measurement' ? 'measurement+comment' : 'text-comment';
      textScore += 3;
    }
    if (hasBom) textScore += 1;
    if (hasArtwork) imageScore += 2;
    if (length < 80) imageScore += 2;
    if (length < 30) imageScore += 1;

    return { page, length, pageType, textScore, imageScore, measurementScore };
  });

  let lastMeasurementPage = -1;
  scores.forEach(item => {
    if (String(item.pageType).includes('measurement')) {
      lastMeasurementPage = item.page;
    } else if (lastMeasurementPage > 0 && item.page > lastMeasurementPage && item.length < 120) {
      item.imageScore += 2;
    }
  });

  const autoTextPages = scores.filter(item => item.textScore > 0).sort((a, b) => b.textScore - a.textScore || a.page - b.page).slice(0, 3).map(item => item.page);
  const autoImagePages = scores.filter(item => item.imageScore > 0).sort((a, b) => b.imageScore - a.imageScore || a.page - b.page).slice(0, 3).map(item => item.page);
  const autoMeasurementPages = scores.filter(item => item.measurementScore > 0).sort((a, b) => b.measurementScore - a.measurementScore || a.page - b.page).slice(0, 2).map(item => item.page);

  return { scores, autoTextPages, autoImagePages, autoMeasurementPages };
}

function pickPagesForProfile(profile, entry) {
  const textPages = entry.autoTextPages || [];
  const imagePages = entry.autoImagePages || [];
  const measurementPages = entry.autoMeasurementPages || [];

  if (profile === 'text-first') return { textPages: textPages.length ? textPages : measurementPages, imagePages, measurementPages };
  if (profile === 'image-markup') return { textPages, imagePages: imagePages.length ? imagePages : textPages, measurementPages };
  return { textPages, imagePages, measurementPages };
}

function buildTextForCompare(entry, selectedPages) {
  const map = entry.pageTextMap || [];
  const safeFullText = String(entry?.text || '').trim();
  if (!selectedPages || !selectedPages.length) return safeFullText;
  const want = new Set((selectedPages || []).map(Number));
  const parts = map
    .filter(p => want.has(Number(p.page)))
    .map(p => `--- Page ${p.page} ---\n${String(p.text || '').trim()}`)
    .filter(Boolean)
    .filter(v => v.replace(/--- Page \d+ ---/g, '').trim().length > 0);
  const joined = parts.join('\n\n').trim();
  return joined || safeFullText;
}

function getPageText(entry, pageNum) {
  return (entry.pageTextMap || []).find(p => p.page === pageNum)?.text || '';
}

function normalizeMeasurementLine(line = '') {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

const COMMON_SIZE_HEADERS = ['XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL'];
const MEASUREMENT_HINTS = /(pom|point of measure|pts of measure|measurements|measurement spec|neck|chest|waist|hip|sleeve|length|opening|bottom|shoulder|inseam|outseam|tolerance|body length|across|armhole|sweep|bicep|cuff)/i;
const NON_MEASUREMENT_HINTS = /(bom|costing|fabric|trim|supplier|article|centric|detail|packaging|polybag|hangtag|label artwork|revision date)/i;

function looksLikeMeasurementLine(clean = '') {
  const numberCount = (clean.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || []).length;
  const sizeCount = (clean.match(/\b(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL)\b/gi) || []).length;
  const likelyMeasurementByStructure = numberCount >= 2 && (sizeCount >= 1 || /tol|tolerance|spec|measure/i.test(clean));
  return (MEASUREMENT_HINTS.test(clean) || likelyMeasurementByStructure) && !NON_MEASUREMENT_HINTS.test(clean);
}

function parseMeasurementLine(line = '') {
  const clean = normalizeMeasurementLine(line);
  if (!looksLikeMeasurementLine(clean)) return null;

  const tokens = clean.split(/\s+/).filter(Boolean);
  const sizeTokens = tokens.filter(token => COMMON_SIZE_HEADERS.includes(token.toUpperCase()));
  const numberTokens = clean.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || [];

  const pomMatch = clean.match(/^(POM\s*[A-Z0-9.-]+|POINT OF MEASURE\s*[A-Z0-9.-]*|PTS OF MEASURE\s*[A-Z0-9.-]*|[A-Z]\.|[A-Z][0-9])/i);
  const numberCount = (clean.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || []).length;
  const fallbackPom = numberCount >= 2 ? 'POM' : '';
  const pomName = normalizeMeasurementLine(pomMatch?.[1] || fallbackPom);
  const withoutPom = pomMatch ? clean.replace(pomMatch[1], '').trim() : clean;

  let description = withoutPom;
  const cutIdx = withoutPom.search(/\s(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|-?\d+(?:\.\d+)?(?:\/\d+)?)/i);
  if (cutIdx > 0) description = withoutPom.slice(0, cutIdx).trim();
  description = normalizeMeasurementLine(description || clean);
  if (!description || description === '-') description = normalizeMeasurementLine(withoutPom || clean);

  const sizeValueMap = {};
  if (sizeTokens.length && numberTokens.length) {
    sizeTokens.forEach((size, i) => {
      if (numberTokens[i] !== undefined) sizeValueMap[size.toUpperCase()] = numberTokens[i];
    });
  } else if (numberTokens.length && numberTokens.length <= 8) {
    numberTokens.forEach((value, i) => { sizeValueMap[`Value ${i+1}`] = value; });
  }

  const keyBase = normalizeMeasurementLine(`${pomName} ${description}` || clean).toLowerCase();
  const key = keyBase || normalizeMeasurementLine(clean).toLowerCase();
  if (!key) return null;
  return { pomName: pomName || 'POM', description, sizeValueMap, raw: clean, key };
}

function extractMeasurementLines(entry, pages) {
  const lines = [];
  (pages || []).forEach(pageNum => {
    const text = getPageText(entry, pageNum);
    String(text || '')
      .split(/(?=\b(?:POM|POINT OF MEASURE|NECK|CHEST|WAIST|HIP|SLEEVE|LENGTH|OPENING|BOTTOM|SHOULDER|INSEAM|OUTSEAM|TOLERANCE|BODY LENGTH|ACROSS|ARMHOLE|SWEEP|BICEP|CUFF)\b)/i)
      .map(normalizeMeasurementLine)
      .filter(Boolean)
      .forEach(line => {
        const parsed = parseMeasurementLine(line);
        if (parsed?.key) lines.push({ page: pageNum, line, ...parsed });
      });
  });
  return lines;
}


function extractRawMeasurementCandidates(entry, pages) {
  const out = [];
  (pages || []).forEach(pageNum => {
    const text = getPageText(entry, pageNum);
    String(text || '')
      .split(/(?=\b(?:POM|POINT OF MEASURE|PTS OF MEASURE|NECK|CHEST|WAIST|HIP|SLEEVE|LENGTH|OPENING|BOTTOM|SHOULDER|INSEAM|OUTSEAM|TOLERANCE|BODY LENGTH|ACROSS|ARMHOLE|SWEEP|BICEP|CUFF)\b)/i)
      .map(normalizeMeasurementLine)
      .filter(Boolean)
      .forEach(line => {
        const nums = line.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || [];
        if (nums.length >= 2 && !NON_MEASUREMENT_HINTS.test(line)) {
          out.push({ page: pageNum, raw: line, nums, key: line.toLowerCase().replace(/\d+(?:\.\d+)?(?:\/\d+)?/g, '#') });
        }
      });
  });
  return out;
}

function buildFallbackMeasurementRows(entryA, entryB, pagesA, pagesB) {
  const candA = extractRawMeasurementCandidates(entryA, pagesA);
  const candB = extractRawMeasurementCandidates(entryB, pagesB);
  const mapB = new Map(candB.map(item => [item.key, item]));
  const rows = [];

  candA.slice(0, 20).forEach(itemA => {
    const itemB = mapB.get(itemA.key);
    if (!itemB) return;
    const max = Math.max(itemA.nums.length, itemB.nums.length);
    for (let i = 0; i < max; i++) {
      const valueA = itemA.nums[i] || '-';
      const valueB = itemB.nums[i] || '-';
      if (valueA !== valueB) {
        rows.push({
          pomName: 'POM',
          description: itemA.raw.replace(/\s+/g, ' ').slice(0, 90),
          size: `Value ${i + 1}`,
          valueA,
          valueB,
          status: valueA === '-' ? 'Added in B' : valueB === '-' ? 'Removed from B' : 'Changed',
          pageA: itemA.page,
          pageB: itemB.page,
          impact: 'medium'
        });
      }
    }
  });

  return rows;
}

async function extractMeasurementTableViaOCR(side, pages) {
  const rows = [];
  for (const pageNum of (pages || []).slice(0, 2)) {
    const preview = await buildPreviewForSide(side, pageNum, false);
    if (!preview?.dataUrl) continue;
    const data = await callJson('/.netlify/functions/extract-measurement-table', { image: preview.dataUrl, side, page: pageNum });
    const pageRows = Array.isArray(data?.result?.rows) ? data.result.rows : [];
    pageRows.forEach(row => rows.push({ ...row, page: pageNum }));
  }
  return rows;
}

function compareExtractedMeasurementRows(rowsA, rowsB) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const mapA = new Map(
    (rowsA || []).map((r) => [norm(`${r.pom_name} ${r.description}`), r])
  );
  const mapB = new Map(
    (rowsB || []).map((r) => [norm(`${r.pom_name} ${r.description}`), r])
  );

  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const rows = [];

  keys.forEach((key) => {
    const a = mapA.get(key);
    const b = mapB.get(key);
    const sizeKeys = [
      ...new Set([
        ...Object.keys(a?.size_values || {}),
        ...Object.keys(b?.size_values || {})
      ])
    ];

    sizeKeys.forEach((size) => {
      const valueA =
        (a && a.size_values && a.size_values[size] !== undefined
          ? String(a.size_values[size]).trim()
          : '') || '';
      const valueB =
        (b && b.size_values && b.size_values[size] !== undefined
          ? String(b.size_values[size]).trim()
          : '') || '';

      if (!valueA && !valueB) return;

      const status =
        valueA === valueB
          ? 'Same'
          : !valueA
          ? 'Added in B'
          : !valueB
          ? 'Removed from B'
          : 'Changed';

      if (status === 'Same') return;

      rows.push({
        pomName: a?.pom_name || b?.pom_name || 'POM',
        description: a?.description || b?.description || '-',
        size,
        valueA: valueA || '-',
        valueB: valueB || '-',
        status,
        pageA: a?.page || '-',
        pageB: b?.page || '-',
        impact: /tolerance|neck|chest|waist|hip|sleeve|length|inseam|outseam|band|cup|wing/.test(
          `${a?.pom_name || ''} ${a?.description || b?.description || ''}`.toLowerCase()
        )
          ? 'high'
          : 'medium'
      });
    });
  });

  const changes = rows.map((row) => ({
    before: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueA}`,
    after: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueB} | ${row.status}`,
    impact: row.impact
  }));

  const summary = rows.length
    ? `${rows.length} measurement difference row(s) were identified by POM and size label.`
    : 'Measurement tables were processed but no numeric differences were found between A and B.';

  return { summary, changes, rows };
}

functionn bindDropzone(dropId, input, side) {
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

async function runMultiImageCompare(pickA, pickB) {
  const pairs = [];
  const max = Math.min(Math.max(pickA.imagePages.length, pickB.imagePages.length), 3);
  for (let i = 0; i < max; i++) {
    const pageA = pickA.imagePages[i] || pickA.imagePages[0];
    const pageB = pickB.imagePages[i] || pickB.imagePages[0];
    if (!pageA || !pageB) continue;
    const previewA = await buildPreviewForSide('A', pageA, i === 0);
    const previewB = await buildPreviewForSide('B', pageB, i === 0);
    const result = await callJson('/.netlify/functions/analyze-techpack-images', {
      imageA: previewA?.dataUrl || '',
      imageB: previewB?.dataUrl || '',
      pageA,
      pageB,
      comments: commentsInput.value || ''
    });
    pairs.push({ pageA, pageB, result });
  }

  const summaries = uniqueItems(pairs.map(item => item.result?.result?.summary || ''));
  const visible_comments = uniqueItems(pairs.flatMap(item => item.result?.result?.visible_comments || []));
  const visual_changes = pairs.flatMap(item => (item.result?.result?.visual_changes || []).map(change => ({ ...change, area: `${change.area || 'Visual area'} (A${item.pageA} vs B${item.pageB})` })));
  const action_items = uniqueItems(pairs.flatMap(item => item.result?.result?.action_items || []));

  return {
    ok: true,
    mode: 'merged_multi_page_image_review',
    result: {
      summary: summaries.join(' '),
      visible_comments,
      visual_changes,
      action_items
    }
  };
}

function buildPointFormSummary({ textData, imageData, measurementData, imageSkipped = false, imageError = '' }) {
  const textResult = textData?.result || {};
  const textSummary = textResult.summary || {};
  const textDiffs = Array.isArray(textResult.differences) ? textResult.differences : [];
  const buyerComments = Array.isArray(textResult.buyer_comments) ? textResult.buyer_comments : [];
  const textActions = Array.isArray(textResult.action_items) ? textResult.action_items : [];
  const imageResult = imageData?.result || {};
  const imageComments = Array.isArray(imageResult.visible_comments) ? imageResult.visible_comments : [];
  const imageChanges = Array.isArray(imageResult.visual_changes) ? imageResult.visual_changes : [];
  const imageActions = Array.isArray(imageResult.action_items) ? imageResult.action_items : [];
  const measurementSummary = measurementData?.summary || '';
  const measurementChanges = Array.isArray(measurementData?.changes) ? measurementData.changes : [];
  const measurementRows = Array.isArray(measurementData?.rows) ? measurementData.rows : [];

  const topSummary = uniqueItems([
    textSummary.overview || '',
    measurementSummary || '',
    imageResult.summary || '',
    imageSkipped ? 'Image review was skipped because preview pages were not ready.' : '',
    imageError ? `Image review failed: ${imageError}` : ''
  ]);

  const keyChangePoints = uniqueItems(textDiffs.slice(0, 8).map(item => `${item.section || 'General'}: ${item.before || '-'} → ${item.after || '-'}`));
  const measurementPoints = uniqueItems(measurementChanges.slice(0, 8).map(item => `${item.before || '-'} → ${item.after || '-'}`));
  const imagePoints = uniqueItems(imageChanges.slice(0, 10).map(item => `${item.area || 'Visual area'}: ${item.note || ''}`).concat(imageComments.slice(0, 6)));
  const actionPoints = uniqueItems([...textActions, ...imageActions]);
  const buyerPoints = uniqueItems(buyerComments.slice(0, 8));

  const plainText = [
    'Tech Pack Final Summary',
    '',
    'Overall Summary',
    ...(topSummary.length ? topSummary : ['No overall summary generated.']).map(v => `- ${v}`),
    '',
    'Measurement Changes',
    ...(measurementPoints.length ? measurementPoints : ['No clear measurement changes found.']).map(v => `- ${v}`),
    '',
    'Key Text Differences',
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

  return { plainText, sections: { topSummary, measurementPoints, keyChangePoints, imagePoints, buyerPoints, actionPoints } };
}

function renderFinalReport({ textData, imageData, measurementData, imageSkipped = false, imageError = '' }) {
  const textResult = textData?.result || {};
  const textDiffs = Array.isArray(textResult.differences) ? textResult.differences : [];
  const buyerComments = Array.isArray(textResult.buyer_comments) ? textResult.buyer_comments : [];
  const textActions = Array.isArray(textResult.action_items) ? textResult.action_items : [];
  const imageResult = imageData?.result || {};
  const imageComments = Array.isArray(imageResult.visible_comments) ? imageResult.visible_comments : [];
  const imageChanges = Array.isArray(imageResult.visual_changes) ? imageResult.visual_changes : [];
  const imageActions = Array.isArray(imageResult.action_items) ? imageResult.action_items : [];
  const measurementChanges = Array.isArray(measurementData?.changes) ? measurementData.changes : [];
  const measurementRows = Array.isArray(measurementData?.rows) ? measurementData.rows : [];

  const summaryPack = buildPointFormSummary({ textData, imageData, measurementData, imageSkipped, imageError });
  state.latestSummaryText = summaryPack.plainText;

  const html = `
    <article class="report-card">
      <header class="report-header">
        <div>
          <p class="eyebrow">Final report</p>
          <h2>Tech Pack Compare Summary</h2>
          <p class="report-subtitle">Focused on measurement changes, key text differences, image comments, and follow-up actions.</p>
        </div>
      </header>

      <section class="report-block">
        <h3>Overall Summary</h3>
        ${toBulletList(summaryPack.sections.topSummary, 'No overall summary generated.')}
      </section>

      <section class="report-block">
        <h3>Measurement Changes</h3>
        ${measurementRows.length ? `
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead>
                <tr>
                  <th>POM Name</th>
                  <th>Description</th>
                  <th>Size</th>
                  <th>Value A</th>
                  <th>Value B</th>
                  <th>Status</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                ${measurementRows.map(row => `
                  <tr>
                    <td>${escapeHtml(row.pomName || '-')}</td>
                    <td>${escapeHtml(row.description || '-')}</td>
                    <td>${escapeHtml(row.size || '-')}</td>
                    <td>${escapeHtml(row.valueA || '-')}</td>
                    <td>${escapeHtml(row.valueB || '-')}</td>
                    <td>${statusBadgeHtml(row.status || 'Changed')}</td>
                    <td>${badgeHtml(row.impact || 'medium')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p>No clear measurement changes found.</p>'}
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
    const imageData = await runMultiImageCompare(pickA, pickB);
    renderFinalReport({ textData: null, imageData, measurementData: null });
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
    setActionStatus('Preparing automatic comparison...');
    state.customerProfile = detectCustomerProfile(commentsInput.value);
    const pickA = pickPagesForProfile(state.customerProfile, state.A);
    const pickB = pickPagesForProfile(state.customerProfile, state.B);

    let textA = buildTextForCompare(state.A, uniqueItems([...pickA.textPages, ...pickA.measurementPages]));
    let textB = buildTextForCompare(state.B, uniqueItems([...pickB.textPages, ...pickB.measurementPages]));

    if (!String(textA || '').trim()) textA = String(state.A.text || '').trim();
    if (!String(textB || '').trim()) textB = String(state.B.text || '').trim();

    if (!String(textA || '').trim() || !String(textB || '').trim()) {
      throw new Error('Unable to extract usable text from one or both PDFs');
    }

    setActionStatus('Comparing text and measurement pages...');
    const textData = await callJson('/.netlify/functions/compare-techpacks', {
      textA,
      textB,
      comments: commentsInput.value || ''
    });

    setActionStatus('Extracting measurement tables...');
    const measurementRowsA = await extractMeasurementTableViaOCR('A', pickA.measurementPages.length ? pickA.measurementPages : pickA.textPages);
    const measurementRowsB = await extractMeasurementTableViaOCR('B', pickB.measurementPages.length ? pickB.measurementPages : pickB.textPages);
    const measurementData = compareExtractedMeasurementRows(measurementRowsA, measurementRowsB);

    let imageData = null;
    let imageSkipped = false;
    let imageError = '';

    try {
      setActionStatus('Comparing image pages...');
      imageData = await runMultiImageCompare(pickA, pickB);
    } catch (error) {
      console.error(error);
      imageSkipped = true;
      imageError = error.message || 'Image review failed';
    }

    renderFinalReport({ textData, imageData, measurementData, imageSkipped, imageError });
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
exportReportBtn?.addEventListener('click', () => window.print());
