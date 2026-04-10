import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs';

const healthBtn = document.getElementById('healthBtn');
const compareBtn = document.getElementById('compareBtn');
const compareBtn2 = document.getElementById('compareBtn2');
const fillDemoBtn = document.getElementById('fillDemoBtn');
const fileAInput = document.getElementById('fileA');
const fileBInput = document.getElementById('fileB');
const fileAName = document.getElementById('fileAName');
const fileBName = document.getElementById('fileBName');
const fileAMeta = document.getElementById('fileAMeta');
const fileBMeta = document.getElementById('fileBMeta');
const commentsInput = document.getElementById('commentsInput');
const healthOut = document.getElementById('healthOut');
const compareOut = document.getElementById('compareOut');
const textAOut = document.getElementById('textAOut');
const textBOut = document.getElementById('textBOut');
const statFiles = document.getElementById('statFiles');
const statPages = document.getElementById('statPages');
const statCharsA = document.getElementById('statCharsA');
const statCharsB = document.getElementById('statCharsB');

const state = {
  A: { name: null, pages: 0, text: '' },
  B: { name: null, pages: 0, text: '' }
};

function updateStats() {
  statFiles.textContent = [state.A.name, state.B.name].filter(Boolean).length;
  statPages.textContent = state.A.pages + state.B.pages;
  statCharsA.textContent = (state.A.text || '').length.toLocaleString();
  statCharsB.textContent = (state.B.text || '').length.toLocaleString();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}

async function extractPdfText(file, side) {
  if (!file) return;
  const target = side === 'A' ? textAOut : textBOut;
  const meta = side === 'A' ? fileAMeta : fileBMeta;
  const nameEl = side === 'A' ? fileAName : fileBName;

  target.textContent = `Reading ${file.name} ...`;
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
    state[side] = { name: file.name, pages: pdf.numPages, text: fullText };
    nameEl.textContent = file.name;
    meta.textContent = `Pages: ${pdf.numPages} · Characters: ${fullText.length.toLocaleString()}`;
    target.textContent = fullText || 'No extractable text found.';
  } catch (error) {
    target.textContent = 'Failed to extract text. This file may be scanned-only or protected.';
    meta.textContent = 'Pages: - · Characters: -';
    console.error(error);
  } finally {
    updateStats();
  }
}

function bindDropzone(dropId, input, side) {
  const zone = document.getElementById(dropId);
  ['dragenter', 'dragover'].forEach(name => {
    zone.addEventListener(name, e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(name => {
    zone.addEventListener(name, e => {
      e.preventDefault();
      zone.classList.remove('dragover');
    });
  });
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

async function checkHealth() {
  healthOut.textContent = 'Checking...';
  try {
    const res = await fetch('/.netlify/functions/health');
    const data = await res.json();
    healthOut.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    healthOut.textContent = error.message;
  }
}

function renderCompareResult(data) {
  const warning = data.warning ? `<div style="margin-bottom:12px;padding:10px 12px;border-radius:14px;background:rgba(157,91,20,.12);color:#9d5b14;font-size:13px;font-weight:600;">Fallback mode: ${escapeHtml(data.warning)}</div>` : '';
  const result = data.result || {};
  const summary = result.summary || {};
  const differences = Array.isArray(result.differences) ? result.differences : [];
  const buyerComments = Array.isArray(result.buyer_comments) ? result.buyer_comments : [];
  const actionItems = Array.isArray(result.action_items) ? result.action_items : [];

  const impactBadge = (impact = 'low') => {
    const map = {
      high: 'background:rgba(157,53,82,.12);color:#9d3552;',
      medium: 'background:rgba(157,91,20,.12);color:#9d5b14;',
      low: 'background:rgba(47,125,69,.12);color:#2f7d45;'
    };
    return `<span style="display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800;${map[impact] || map.low}">${impact.toUpperCase()}</span>`;
  };

  compareOut.innerHTML = `
    ${warning}
    <div style="display:grid;gap:14px;">
      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;">
          <strong>Overview</strong>
          ${impactBadge(summary.risk_level || 'low')}
        </div>
        <div style="margin-top:8px;color:var(--muted);line-height:1.6;">${escapeHtml(summary.overview || 'No summary returned.')}</div>
      </div>

      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <strong>Key Differences (${differences.length})</strong>
        <div style="display:grid;gap:10px;margin-top:12px;">
          ${differences.length ? differences.map(item => `
            <div style="border:1px solid var(--border);border-radius:16px;padding:12px;background:var(--surface);display:grid;gap:8px;">
              <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;">
                <span style="font-weight:800;">${escapeHtml(item.section || 'General')}</span>
                ${impactBadge(item.impact || 'low')}
              </div>
              <div>
                <div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:4px;">Before</div>
                <div style="color:var(--muted);line-height:1.6;">${escapeHtml(item.before || '-')}</div>
              </div>
              <div>
                <div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:4px;">After</div>
                <div style="color:var(--muted);line-height:1.6;">${escapeHtml(item.after || '-')}</div>
              </div>
            </div>`).join('') : `<div style="color:var(--muted);">No differences returned.</div>`}
        </div>
      </div>

      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <strong>Buyer Comments (${buyerComments.length})</strong>
        <ul style="margin:12px 0 0 18px;padding:0;color:var(--muted);line-height:1.8;">
          ${buyerComments.length ? buyerComments.map(item => `<li>${escapeHtml(item)}</li>`).join('') : `<li>No buyer comments extracted.</li>`}
        </ul>
      </div>

      <div style="padding:14px 16px;border:1px solid var(--border);border-radius:18px;background:var(--surface-2);">
        <strong>Follow-up Actions (${actionItems.length})</strong>
        <ol style="margin:12px 0 0 18px;padding:0;color:var(--muted);line-height:1.8;">
          ${actionItems.length ? actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join('') : `<li>No action items returned.</li>`}
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
    if (fileAInput.files[0] && !state.A.text) await extractPdfText(fileAInput.files[0], 'A');
    if (fileBInput.files[0] && !state.B.text) await extractPdfText(fileBInput.files[0], 'B');

    const data = await callJson('/.netlify/functions/compare-techpacks', {
      textA: state.A.text,
      textB: state.B.text,
      comments: commentsInput.value
    });
    renderCompareResult(data);
  } catch (error) {
    compareOut.textContent = error.message;
  }
}

fileAInput.addEventListener('change', e => extractPdfText(e.target.files[0], 'A'));
fileBInput.addEventListener('change', e => extractPdfText(e.target.files[0], 'B'));
healthBtn.addEventListener('click', checkHealth);
compareBtn.addEventListener('click', runCompare);
compareBtn2.addEventListener('click', runCompare);
fillDemoBtn.addEventListener('click', () => {
  commentsInput.value = 'Please revise neck drop to 7.5 cm.\nUpdate care label wording before PPS approval.\nConfirm collar edge topstitch.\nCheck if main label placement changed.';
});

bindDropzone('dropA', fileAInput, 'A');
bindDropzone('dropB', fileBInput, 'B');
updateStats();
