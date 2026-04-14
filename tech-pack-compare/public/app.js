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
  if (!themeToggle || !themeIcon || !themeText) return;
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
  if (actionStatus) actionStatus.textContent = text;
}

function updateStats() {
  if (statFiles) statFiles.textContent = [state.A.name, state.B.name].filter(Boolean).length;
  if (statPages) statPages.textContent = state.A.pages + state.B.pages;
  if (statPreviewA) statPreviewA.textContent = state.A.preview?.page || '-';
  if (statPreviewB) statPreviewB.textContent = state.B.preview?.page || '-';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fillPageSelect(select, numPages) {
  if (!select) return;
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
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  return safe.length
    ? `<ul>${safe.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : `<ul><li>${escapeHtml(emptyText)}</li></ul>`;
}

function uniqueItems(items) {
  return [...new Set((items || []).map(v => String(v).trim()).filter(Boolean))];
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
    const lower = String(text || '').toLowerCase();
    const hasMeasurement = /measurement|measure|spec|pom|size chart|size range|selected sizes|neck|chest|waist|hip|sleeve|inseam|outseam|tolerance|cup height|bottom band|armhole|strap|wing length/.test(lower);
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
  const autoMeasurementPages = scores.filter(item => item.measurementScore > 0).sort((a, b) => b.measurementScore - a.measurementScore || a.page - b.page).slice(0, 3).map(item => item.page);

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

const COMMON_SIZE_HEADERS = ['XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL','32B','34B','36B','38B','40B','32C','34C','36C','38C','40C','32D','34D','36D','38D','40D','32DD','34DD','36DD','38DD','40DD'];
const MEASUREMENT_HINTS = /(pom|point of measure|pts of measure|measurements|measurement spec|neck|chest|waist|hip|sleeve|length|opening|bottom|shoulder|inseam|outseam|tolerance|body length|across|armhole|sweep|bicep|cuff)/i;
const NON_MEASUREMENT_HINTS = /(bom|costing|fabric|trim|supplier|article|centric|detail|packaging|polybag|hangtag|label artwork|revision date)/i;

function looksLikeMeasurementLine(clean = '') {
  const numberCount = (clean.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || []).length;
  const sizeCount = (clean.match(/\b(?:XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL)\b/gi) || []).length;
  const likelyMeasurementByStructure = numberCount >= 2 && (sizeCount >= 1 || /tol|tolerance|spec|measure|cup|band|armhole|strap|wing/i.test(clean));
  return (MEASUREMENT_HINTS.test(clean) || likelyMeasurementByStructure) && !NON_MEASUREMENT_HINTS.test(clean);
}

function parseMeasurementLine(line = '') {
  const clean = normalizeMeasurementLine(line);
  if (!looksLikeMeasurementLine(clean)) return null;

  const tokens = clean.split(/\s+/).filter(Boolean);
  const sizeTokens = tokens.filter(token => COMMON_SIZE_HEADERS.includes(token.toUpperCase()));
  const numberTokens = clean.match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g) || [];

  const pomMatch = clean.match(/^(POM\s*[A-Z0-9.-]+|POINT OF MEASURE\s*[A-Z0-9.-]*|PTS OF MEASURE\s*[A-Z0-9.-]*|[A-Z]\.|[A-Z][0-9])/i);
  const numberCount = numberTokens.length;
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
  } else if (numberTokens.length && numberTokens.length <= 12) {
    numberTokens.forEach((value, i) => { sizeValueMap[`Value ${i + 1}`] = value; });
  }

  const keyBase = normalizeMeasurementLine(`${pomName} ${description}` || clean).toLowerCase();
  const key = keyBase || normalizeMeasurementLine(clean).toLowerCase();
  if (!key) return null;
  return { pomName: pomName || 'POM', description, sizeValueMap, raw: clean, key };
}

function extractMeasurementLines(entry, pages) {
  const lines = [];
  (pages || []).forEach(pageNum => {
    const pageText = String(getPageText(entry, pageNum) || '');
    const chunks = pageText
      .replace(/\b(Displaying\s+\d+\s*-\s*\d+\s+of\s+\d+\s+results)\b/gi, '\n$1\n')
      .replace(/\b(POM Name|Description|Tolerance Message|Measurement Chart|Size Chart|Selected Sizes)\b/gi, '\n$1\n')
      .replace(/\b(B\d+(?:\.\d+)?|D\d+(?:\.\d+)?|F\d+(?:\.\d+)?|J\d+(?:\.\d+)?)\b/g, '\n$1')
      .split(/\n+/)
      .map(normalizeMeasurementLine)
      .filter(Boolean);

    chunks.forEach(line => {
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
      .split(/(?=\b(?:POM|POINT OF MEASURE|PTS OF MEASURE|NECK|CHEST|WAIST|HIP|SLEEVE|LENGTH|OPENING|BOTTOM|SHOULDER|INSEAM|OUTSEAM|TOLERANCE|BODY LENGTH|ACROSS|ARMHOLE|SWEEP|BICEP|CUFF|CUP HEIGHT|CUP LENGTH|BOTTOM BAND|WING LENGTH|STRAP LENGTH|CENTER FRONT|SIDESEAM)\b)/i)
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


function normalizeSizeLabel(size = '') {
  const s = String(size || '').trim().toUpperCase().replace(/\s+/g, '');
  const map = {
    '2XS': 'XXS',
    'XS': 'XS',
    'S': 'S',
    'M': 'M',
    'L': 'L',
    'XL': 'XL',
    '1X': 'XL',
    'XXL': 'XXL',
    '2XL': 'XXL',
    '3XL': '3XL',
    '4XL': '4XL',
    '5XL': '5XL'
  };
  return map[s] || s || 'VALUE';
}

function normalizeMeasurementKey(pom = '', desc = '') {
  return `${pom} ${desc}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/(point of measure|pts of measure|measurement|measurements|spec|tol|tolerance)/g, ' ')
    .replace(/(body|garment)/g, ' ')
    .replace(/(hps|cf|cb)/g, ' ')
    .replace(/1 below armhole/g, ' chest ')
    .replace(/pit to pit/g, ' chest ')
    .replace(/across chest/g, ' chest ')
    .replace(/across shoulder/g, ' shoulder ')
    .replace(/sleeve length from shoulder/g, ' sleeve length ')
    .replace(/body length from hps/g, ' body length ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareParsedMeasurementRowsFuzzy(linesA, linesB) {
  const normalizeLine = (item) => ({
    ...item,
    normKey: normalizeMeasurementKey(item?.pomName || '', item?.description || ''),
    normSizes: Object.fromEntries(Object.entries(item?.sizeValueMap || {}).map(([k,v]) => [normalizeSizeLabel(k), v]))
  });

  const aList = (linesA || []).map(normalizeLine).filter(item => item.normKey);
  const bList = (linesB || []).map(normalizeLine).filter(item => item.normKey);
  const usedB = new Set();
  const rows = [];

  for (const a of aList) {
    let best = null;
    let bestIndex = -1;
    for (let i = 0; i < bList.length; i++) {
      if (usedB.has(i)) continue;
      const b = bList[i];
      if (a.normKey === b.normKey || a.normKey.includes(b.normKey) || b.normKey.includes(a.normKey)) {
        best = b;
        bestIndex = i;
        break;
      }
    }
    if (!best) continue;
    usedB.add(bestIndex);

    const sizeKeys = [...new Set([...Object.keys(a.normSizes || {}), ...Object.keys(best.normSizes || {})])];
    sizeKeys.forEach(size => {
      const valueA = a.normSizes?.[size] ?? '-';
      const valueB = best.normSizes?.[size] ?? '-';
      const status = valueA === valueB ? 'Same' : valueA === '-' ? 'Added in B' : valueB === '-' ? 'Removed from B' : 'Changed';
      if (status !== 'Same') {
        rows.push({
          pomName: a.pomName || best.pomName || 'POM',
          description: a.description || best.description || '-',
          size,
          valueA,
          valueB,
          status,
          pageA: a.page || '-',
          pageB: best.page || '-',
          impact: /tolerance|neck|chest|waist|hip|sleeve|length|inseam|outseam|band|cup|wing|shoulder/.test(`${a.pomName || ''} ${a.description || best.description || ''}`.toLowerCase()) ? 'high' : 'medium'
        });
      }
    });
  }

  return rows;
}


function buildFallbackMeasurementRows(entryA, entryB, pagesA, pagesB) {
  const candA = extractRawMeasurementCandidates(entryA, pagesA);
  const candB = extractRawMeasurementCandidates(entryB, pagesB);
  const mapB = new Map(candB.map(item => [item.key, item]));
  const rows = [];

  candA.slice(0, 40).forEach(itemA => {
    const itemB = mapB.get(itemA.key);
    if (!itemB) return;
    const max = Math.max(itemA.nums.length, itemB.nums.length);
    for (let i = 0; i < max; i++) {
      const valueA = itemA.nums[i] || '-';
      const valueB = itemB.nums[i] || '-';
      if (valueA !== valueB) {
        rows.push({
          pomName: 'POM',
          description: itemA.raw.replace(/\s+/g, ' ').slice(0, 120),
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

async function buildPreviewForSide(side, pageNum, setVisible = false) {
  const entry = state[side];
  if (!entry?.pdf || !pageNum) return null;
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
    state[side].preview = preview;
    const img = side === 'A' ? previewImgA : previewImgB;
    const meta = side === 'A' ? previewMetaA : previewMetaB;
    if (img) img.src = dataUrl;
    if (meta) meta.textContent = `Page ${pageNum} · ${canvas.width} × ${canvas.height}`;
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
      const line = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
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
      autoImagePages: [],
      autoMeasurementPages: []
    };

    const classified = classifyPages(nextEntry);
    nextEntry.pageScores = classified.scores;
    nextEntry.autoTextPages = classified.autoTextPages;
    nextEntry.autoImagePages = classified.autoImagePages;
    nextEntry.autoMeasurementPages = classified.autoMeasurementPages;
    state[side] = nextEntry;

    if (nameEl) nameEl.textContent = file.name;
    if (meta) meta.textContent = `Pages: ${pdf.numPages} · Characters: ${fullText.length.toLocaleString()} · Auto compare ready`;
    fillPageSelect(pageSelect, pdf.numPages);
    const firstPreviewPage = nextEntry.autoImagePages[0] || nextEntry.autoMeasurementPages[0] || 1;
    if (pageSelect) pageSelect.value = String(firstPreviewPage);
    await renderPagePreview(side, firstPreviewPage);
    setActionStatus(`PDF ${side} ready`);
  } catch (error) {
    if (meta) meta.textContent = 'Pages: - · Characters: -';
    console.error(error);
    setActionStatus(`Failed to read PDF ${side}: ${error.message}`);
  } finally {
    updateStats();
  }
}

function bindDropzone(dropId, input, side) {
  const zone = document.getElementById(dropId);
  if (!zone || !input) return;
  ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, e => {
    e.preventDefault();
    zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, e => {
    e.preventDefault();
    zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', e => {
    const file = e.dataTransfer?.files?.[0];
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

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

async function extractMeasurementTableViaOCR(side, pages) {
  const rows = [];
  const targetPages = (pages || []).slice(0, 3);
  if (!targetPages.length) return rows;

  for (const pageNum of targetPages) {
    try {
      setActionStatus(`Extracting measurement tables... ${side} page ${pageNum}`);
      const preview = await buildPreviewForSide(side, pageNum, false);
      if (!preview?.dataUrl) continue;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch('/.netlify/functions/extract-measurement-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: preview.dataUrl, side, page: pageNum }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || `Measurement OCR failed on ${side} page ${pageNum}`);

      const pageRows = Array.isArray(data?.result?.rows) ? data.result.rows : [];
      pageRows.forEach(row => rows.push({ ...row, page: pageNum }));
    } catch (error) {
      console.warn(`Measurement OCR skipped for ${side} page ${pageNum}:`, error);
    }
  }

  return rows;
}

function compareExtractedMeasurementRows(rowsA, rowsB) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const mapA = new Map((rowsA || []).map(r => [norm(`${r.pom_name} ${r.description}`), r]));
  const mapB = new Map((rowsB || []).map(r => [norm(`${r.pom_name} ${r.description}`), r]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const rows = [];

  keys.forEach(key => {
    const a = mapA.get(key);
    const b = mapB.get(key);
    const sizeKeys = [...new Set([...Object.keys(a?.size_values || {}), ...Object.keys(b?.size_values || {})])];

    sizeKeys.forEach(size => {
      const rawA = a?.size_values?.[size];
      const rawB = b?.size_values?.[size];
      const valueA = rawA === undefined || rawA === null || String(rawA).trim() === '' ? '-' : String(rawA).trim();
      const valueB = rawB === undefined || rawB === null || String(rawB).trim() === '' ? '-' : String(rawB).trim();
      const status = valueA === valueB ? 'Same' : valueA === '-' ? 'Added in B' : valueB === '-' ? 'Removed from B' : 'Changed';

      if (status !== 'Same') {
        rows.push({
          pomName: a?.pom_name || b?.pom_name || 'POM',
          description: a?.description || b?.description || '-',
          size,
          valueA,
          valueB,
          status,
          pageA: a?.page || '-',
          pageB: b?.page || '-',
          impact: /tolerance|neck|chest|waist|hip|sleeve|length|inseam|outseam|band|cup|wing/.test(`${a?.pom_name || ''} ${a?.description || b?.description || ''}`.toLowerCase()) ? 'high' : 'medium'
        });
      }
    });
  });

  const changes = rows.map(row => ({
    before: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueA}`,
    after: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueB} | ${row.status}`,
    impact: row.impact
  }));

  const summary = rows.length
    ? `${rows.length} measurement difference row(s) were identified by OCR table extraction.`
    : 'No clear measurement changes found.';

  return { summary, changes, rows };
}

async function runMultiImageCompare(pickA, pickB) {
  const pairs = [];
  const pagesA = pickA?.imagePages?.length ? pickA.imagePages : pickA?.textPages || [];
  const pagesB = pickB?.imagePages?.length ? pickB.imagePages : pickB?.textPages || [];
  const max = Math.min(Math.max(pagesA.length, pagesB.length), 3);

  for (let i = 0; i < max; i++) {
    const pageA = pagesA[i] || pagesA[0];
    const pageB = pagesB[i] || pagesB[0];
    if (!pageA || !pageB) continue;

    const previewA = await buildPreviewForSide('A', pageA, i === 0);
    const previewB = await buildPreviewForSide('B', pageB, i === 0);
    const result = await callJson('/.netlify/functions/analyze-techpack-images', {
      imageA: previewA?.dataUrl || '',
      imageB: previewB?.dataUrl || '',
      pageA,
      pageB,
      comments: commentsInput?.value || ''
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
  if (finalReportOut) finalReportOut.innerHTML = html;
}

async function runImageOnly() {
  if (!state.A.pdf || !state.B.pdf) {
    setActionStatus('Please upload both PDFs first');
    return;
  }

  try {
    setActionStatus('Running image review...');
    state.customerProfile = detectCustomerProfile(commentsInput?.value);
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
    state.customerProfile = detectCustomerProfile(commentsInput?.value);
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
      comments: commentsInput?.value || ''
    });

    setActionStatus('Extracting measurement tables...');
    const targetPagesA = pickA.measurementPages.length ? pickA.measurementPages : (state.A.pageScores || []).filter(p => p.measurementScore > 0 || /measurement chart|size chart|selected sizes/i.test(getPageText(state.A, p.page))).map(p => p.page).slice(0, 4);
    const targetPagesB = pickB.measurementPages.length ? pickB.measurementPages : (state.B.pageScores || []).filter(p => p.measurementScore > 0 || /measurement chart|size chart|selected sizes/i.test(getPageText(state.B, p.page))).map(p => p.page).slice(0, 4);

    let measurementRowsA = [];
    let measurementRowsB = [];

    try {
      measurementRowsA = await extractMeasurementTableViaOCR('A', targetPagesA);
      measurementRowsB = await extractMeasurementTableViaOCR('B', targetPagesB);
    } catch (ocrError) {
      console.warn('OCR extraction failed, fallback to raw text parsing', ocrError);
    }

    let measurementData = compareExtractedMeasurementRows(measurementRowsA, measurementRowsB);

    if (!measurementData.rows.length) {
      const parsedA = extractMeasurementLines(state.A, targetPagesA);
      const parsedB = extractMeasurementLines(state.B, targetPagesB);
      const parsedRows = compareParsedMeasurementRowsFuzzy(parsedA, parsedB);

      if (parsedRows.length) {
        measurementData = {
          summary: `${parsedRows.length} measurement difference row(s) were identified by text measurement parsing.`,
          changes: parsedRows.map(row => ({
            before: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueA}`,
            after: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueB} | ${row.status}`,
            impact: row.impact
          })),
          rows: parsedRows
        };
      }
    }

    if (!measurementData.rows.length) {
      const fallbackRows = buildFallbackMeasurementRows(state.A, state.B, targetPagesA, targetPagesB);
      if (fallbackRows.length) {
        measurementData = {
          summary: `${fallbackRows.length} measurement difference row(s) were identified by fallback text parsing.`,
          changes: fallbackRows.map(row => ({
            before: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueA}`,
            after: `${row.pomName} | ${row.description} | ${row.size} | ${row.valueB} | ${row.status}`,
            impact: row.impact
          })),
          rows: fallbackRows
        };
      }
    }

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

setActionStatus('app.js version 2026-04-14-1643 raw-text-first');
