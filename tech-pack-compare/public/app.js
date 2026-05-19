/*
  Path:     public/app.js
  Purpose:  前端主邏輯 — 4 tab + 7-step 進度條 + License header + Excel export
  Depends:  public/index.html, public/theme.js, public/style.css, SheetJS (CDN)
  Notes:    所有文字繁中(HK)；License Key 用 localStorage 記住；
            PDF.js Phase 6 上線，現用 textarea 貼純文字
            envelope shape:
              { success, data: { request_id, output_mode, artifacts: { measurement_changes,
                comments, images, bom_changes, summary, qa_review }, agentStatus, workflow_log },
                error, meta: { version, duration_ms, total_tokens, provider, cached, warnings, debug }}
*/

// ── i18n: 簡化版字典（browser-side） ─────────────────────────
const I18N = {
  outputModes: {
    FULL:             '完整 (FULL)',
    SUMMARY:          '只看總結 (SUMMARY)',
    MEASUREMENT_ONLY: '只看尺寸 (MEASUREMENT_ONLY)',
    BOM_ONLY:         '只看 BOM (BOM_ONLY)',
    DEBUG_ALL:        'Debug 模式 (DEBUG_ALL · admin)'
  },
  agentLabels: {
    extractor:   '1. 解析',
    measurement: '2. 尺寸',
    comment:     '3. 註解',
    image:       '4. 圖像',
    bom:         '5. BOM',
    summarizer:  '6. 總結',
    qaReview:    '7. QA'
  },
  agentStatus: {
    PENDING: '等待中',
    RUNNING: '處理中',
    DONE:    '完成',
    SKIPPED: '略過',
    FAILED:  '失敗'
  },
  severity: {
    CRITICAL: '嚴重', MAJOR: '重要', MINOR: '輕微', INFO: '資訊',
    HIGH: '高', MEDIUM: '中', LOW: '低',
    ADDED: '新增', REMOVED: '移除', CHANGED: '變更', UNCHANGED: '不變',
    PASS: '通過', WARN: '警告', FAIL: '不通過'
  },
  msg: {
    licenseRequired: '請先輸入 License Key。',
    missingText:     '請貼上舊版與新版 Tech Pack 文字內容。',
    running:         '正在處理…',
    done:            '完成',
    failed:          '執行失敗',
    noData:          '此模式下無資料。',
    cached:          '(由快取回應)'
  }
};

// ── DOM refs ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  licenseKey:   $('license-key'),
  styleNumber:  $('style-number'),
  oldText:      $('old-text'),
  newText:      $('new-text'),
  outputGroup:  $('output-mode-group'),
  runBtn:       $('run-btn'),
  exportBtn:    $('export-btn'),
  statusMsg:    $('status-msg'),
  durationPill: $('duration-pill'),
  tokensPill:   $('tokens-pill'),
  providerName: $('provider-name'),
  progressSec:  $('progress-section'),
  progressList: $('progress-list'),
  resultSec:    $('result-section'),
  errorSec:     $('error-section'),
  errorBody:    $('error-body'),
  tabDebug:     $('tab-debug')
};

const STATE = {
  lastEnvelope: null,  // 最近一次 /run-workflow 成功 envelope
  styleNumber:  'STYLE-DEMO-001',
  outputMode:   'FULL',
  isAdmin:      false
};

// ── License + style number persistence ───────────────────
const LS_LICENSE = 'tpc.license';
const LS_STYLE   = 'tpc.style';
const LS_MODE    = 'tpc.outputMode';

function loadPrefs() {
  const lic   = localStorage.getItem(LS_LICENSE) || '';
  const style = localStorage.getItem(LS_STYLE)   || 'STYLE-DEMO-001';
  const mode  = localStorage.getItem(LS_MODE)    || 'FULL';
  els.licenseKey.value  = lic;
  els.styleNumber.value = style;
  STATE.styleNumber = style;
  STATE.outputMode  = mode;
}

function savePrefs() {
  localStorage.setItem(LS_LICENSE, els.licenseKey.value.trim());
  localStorage.setItem(LS_STYLE,   els.styleNumber.value.trim());
  localStorage.setItem(LS_MODE,    STATE.outputMode);
}

// ── Output mode radios ───────────────────────────────────
function renderOutputModes() {
  const modes = ['FULL','SUMMARY','MEASUREMENT_ONLY','BOM_ONLY','DEBUG_ALL'];
  els.outputGroup.innerHTML = modes.map((m) => `
    <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800">
      <input type="radio" name="output-mode" value="${m}" ${m === STATE.outputMode ? 'checked' : ''}>
      <span>${I18N.outputModes[m]}</span>
    </label>
  `).join('');
  els.outputGroup.querySelectorAll('input[name="output-mode"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      STATE.outputMode = e.target.value;
      savePrefs();
    });
  });
}

// ── Progress bar (7-step) ────────────────────────────────
const STEP_KEYS = ['extractor','measurement','comment','image','bom','summarizer','qaReview'];

function renderProgress(agentStatus = {}) {
  els.progressList.innerHTML = STEP_KEYS.map((k) => {
    const st = (agentStatus[k] || 'PENDING').toUpperCase();
    const cls =
      st === 'DONE'    ? 'step-done'    :
      st === 'RUNNING' ? 'step-running' :
      st === 'SKIPPED' ? 'step-skipped' :
      st === 'FAILED'  ? 'step-failed'  : 'step-pending';
    const label = I18N.agentLabels[k] || k;
    const stLab = I18N.agentStatus[st] || st;
    return `<li class="step-chip ${cls}" title="${k}: ${st}">${label} · ${stLab}</li>`;
  }).join('');
}

function resetProgress() {
  const init = {};
  STEP_KEYS.forEach((k) => init[k] = 'PENDING');
  renderProgress(init);
}

// ── Tabs ─────────────────────────────────────────────────
function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('tab-btn-active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('hidden', p.id !== `tab-panel-${name}`);
  });
}

document.querySelectorAll('.tab-btn').forEach((b) => {
  b.addEventListener('click', () => activateTab(b.dataset.tab));
});

// ── Severity helpers ─────────────────────────────────────
function sevClassForBomLike(severity) {
  if (severity === 'CRITICAL' || severity === 'MAJOR') return 'sev-RED';
  if (severity === 'MINOR')                            return 'sev-YELLOW';
  return 'sev-GREY';
}
function sevClassForMeasurement(status, toleranceExceeded) {
  if (toleranceExceeded || status === 'ADDED' || status === 'REMOVED') return 'sev-RED';
  if (status === 'CHANGED') return 'sev-YELLOW';
  return 'sev-GREY';
}
function sevClassForQa(status) {
  if (status === 'FAIL') return 'sev-RED';
  if (status === 'WARN') return 'sev-YELLOW';
  return 'sev-GREY';
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

// ── Render tabs from envelope ────────────────────────────
function renderResult(envelope) {
  STATE.lastEnvelope = envelope;
  const data    = envelope.data || {};
  const arts    = data.artifacts || {};
  const debugOn = !!(envelope.meta && envelope.meta.debug);

  els.resultSec.classList.remove('hidden');
  els.errorSec.classList.add('hidden');
  els.exportBtn.disabled = false;
  els.tabDebug.classList.toggle('hidden', !debugOn);

  renderSummaryTab(arts.summary);
  renderMeasurementTab(arts.measurement_changes || []);
  renderCommentsTab(arts.comments || [], arts.images || []);
  renderBomTab(arts.bom_changes || []);
  renderQaTab(arts.qa_review);
  if (debugOn) renderDebugTab(envelope);

  // 預設切到 summary
  activateTab('summary');

  // meta pills
  const meta = envelope.meta || {};
  els.durationPill.textContent = `${meta.duration_ms || 0} ms${meta.cached ? ' ' + I18N.msg.cached : ''}`;
  els.durationPill.classList.remove('hidden');
  els.tokensPill.textContent = `${meta.total_tokens || 0} tokens`;
  els.tokensPill.classList.remove('hidden');
  els.providerName.textContent = meta.provider || '—';
}

function emptyState(msg) {
  return `<div class="text-sm text-slate-500 dark:text-slate-400 italic">${escapeHtml(msg)}</div>`;
}

function renderSummaryTab(summary) {
  const p = $('tab-panel-summary');
  if (!summary) { p.innerHTML = emptyState(I18N.msg.noData); return; }
  const bullets = (summary.bullet_points || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const costs   = (summary.cost_risk_items || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const prods   = (summary.production_risk_items || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const decisions = (summary.decisions || []).map((d) => `
    <div class="rounded-md border border-slate-200 dark:border-slate-700 p-3">
      <div class="font-medium text-sm">${escapeHtml(d.title)}</div>
      <div class="text-xs text-slate-600 dark:text-slate-400 mt-1">${escapeHtml(d.detail)}</div>
      ${d.impacted_poms?.length ? `<div class="text-xs mt-1">影響 POM: <span class="font-mono">${d.impacted_poms.map(escapeHtml).join(', ')}</span></div>` : ''}
    </div>
  `).join('');

  p.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      ${statCard('總變更', summary.total_changes)}
      ${statCard('尺寸變更', summary.total_measurement_changes)}
      ${statCard('註解項', summary.total_comment_items)}
      ${statCard('BOM 變更', summary.total_bom_changes)}
    </div>
    <h3 class="text-sm font-semibold mb-2">重點摘要</h3>
    <ul class="list-disc pl-5 space-y-1 text-sm mb-5">${bullets || `<li class="italic text-slate-500">無</li>`}</ul>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
      <div>
        <h3 class="text-sm font-semibold mb-2">成本風險</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm">${costs || `<li class="italic text-slate-500">無</li>`}</ul>
      </div>
      <div>
        <h3 class="text-sm font-semibold mb-2">生產風險</h3>
        <ul class="list-disc pl-5 space-y-1 text-sm">${prods || `<li class="italic text-slate-500">無</li>`}</ul>
      </div>
    </div>

    <h3 class="text-sm font-semibold mb-2">決策建議</h3>
    <div class="space-y-2">${decisions || emptyState('無')}</div>
  `;
}
function statCard(label, value) {
  return `
    <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <div class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(label)}</div>
      <div class="text-2xl font-semibold mt-1 font-mono">${value ?? 0}</div>
    </div>
  `;
}

function renderMeasurementTab(rows) {
  const p = $('tab-panel-measurement');
  if (!rows.length) { p.innerHTML = emptyState(I18N.msg.noData); return; }
  const body = rows.map((r) => `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(r.pom_code || '')}</td>
      <td>${escapeHtml(r.pom_name)}</td>
      <td>${escapeHtml(r.size_label)}</td>
      <td class="font-mono">${r.old_value ?? '—'}</td>
      <td class="font-mono">${r.new_value ?? '—'}</td>
      <td class="font-mono">${r.diff_value > 0 ? '+' : ''}${r.diff_value ?? '—'}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td><span class="px-2 py-0.5 rounded text-xs ${sevClassForMeasurement(r.status, r.tolerance_exceeded)}">${I18N.severity[r.status] || r.status}${r.tolerance_exceeded ? ' · 超容差' : ''}</span></td>
      <td class="font-mono text-xs">${(r.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');
  p.innerHTML = `
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead><tr>
          <th>POM 代碼</th><th>POM 名稱</th><th>尺碼</th>
          <th>舊值</th><th>新值</th><th>差異</th><th>單位</th>
          <th>狀態</th><th>信心</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderCommentsTab(comments, images) {
  const p = $('tab-panel-comments');
  if (!comments.length && !images.length) { p.innerHTML = emptyState(I18N.msg.noData); return; }
  const cBody = comments.map((c) => `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(c.comment_id || '')}</td>
      <td>${escapeHtml(c.source)}</td>
      <td>${escapeHtml(c.comment_text)}</td>
      <td>${escapeHtml(c.related_pom || '')}</td>
      <td><span class="px-2 py-0.5 rounded text-xs ${sevClassForBomLike(c.severity)}">${I18N.severity[c.severity] || c.severity}</span></td>
      <td class="font-mono text-xs">${(c.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');
  const iBody = images.map((i) => `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(i.image_id || '')}</td>
      <td>${escapeHtml(i.change_type)}</td>
      <td>${escapeHtml(i.before_desc || '')}</td>
      <td>${escapeHtml(i.after_desc || '')}</td>
      <td>${escapeHtml(i.diff_summary || '')}</td>
      <td class="font-mono text-xs">${(i.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');

  p.innerHTML = `
    <h3 class="text-sm font-semibold mb-2">註解 (${comments.length})</h3>
    <div class="overflow-x-auto mb-6">
      <table class="data-table">
        <thead><tr><th>ID</th><th>來源</th><th>內容</th><th>關聯 POM</th><th>嚴重度</th><th>信心</th></tr></thead>
        <tbody>${cBody || `<tr><td colspan="6" class="italic text-slate-500">無</td></tr>`}</tbody>
      </table>
    </div>
    <h3 class="text-sm font-semibold mb-2">圖像變更 (${images.length})</h3>
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead><tr><th>ID</th><th>類型</th><th>舊版描述</th><th>新版描述</th><th>差異</th><th>信心</th></tr></thead>
        <tbody>${iBody || `<tr><td colspan="6" class="italic text-slate-500">無</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderBomTab(rows) {
  const p = $('tab-panel-bom');
  if (!rows.length) { p.innerHTML = emptyState(I18N.msg.noData); return; }
  const body = rows.map((r) => `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(r.material_code || '')}</td>
      <td>${escapeHtml(r.material_type)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.supplier || '')}</td>
      <td class="font-mono">${r.old_qty ?? '—'}</td>
      <td class="font-mono">${r.new_qty ?? '—'}</td>
      <td class="font-mono">${r.diff_qty > 0 ? '+' : ''}${r.diff_qty ?? '—'}</td>
      <td>${escapeHtml(r.unit || '')}</td>
      <td>${escapeHtml(r.impact)}</td>
      <td><span class="px-2 py-0.5 rounded text-xs ${sevClassForBomLike(r.severity)}">${I18N.severity[r.severity] || r.severity}</span></td>
      <td class="font-mono text-xs">${(r.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');
  p.innerHTML = `
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead><tr>
          <th>料號</th><th>類型</th><th>描述</th><th>供應商</th>
          <th>舊用量</th><th>新用量</th><th>差異</th><th>單位</th>
          <th>影響</th><th>嚴重度</th><th>信心</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderQaTab(qa) {
  const p = $('tab-panel-qa');
  if (!qa) { p.innerHTML = emptyState(I18N.msg.noData); return; }
  const items = (qa.findings || []).map((f) => `
    <li class="flex items-start gap-2">
      <span class="px-2 py-0.5 rounded text-xs ${
        f.severity === 'ERROR' ? 'sev-RED' :
        f.severity === 'WARN'  ? 'sev-YELLOW' : 'sev-GREY'
      }">${escapeHtml(f.severity)}</span>
      <span><span class="font-mono text-xs text-slate-500">[${escapeHtml(f.agent)}]</span> ${escapeHtml(f.message)}</span>
    </li>
  `).join('');
  p.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <span class="px-3 py-1 rounded-md text-sm font-medium ${sevClassForQa(qa.status)}">${I18N.severity[qa.status] || qa.status}</span>
      <span class="text-xs text-slate-500">總體風險: ${I18N.severity[qa.overall_risk] || qa.overall_risk || '—'}</span>
    </div>
    <h3 class="text-sm font-semibold mb-2">QA 發現 (${(qa.findings || []).length})</h3>
    <ul class="space-y-2 text-sm">${items || emptyState('無')}</ul>
    ${qa.recommendation ? `<div class="mt-4 text-sm"><span class="font-semibold">建議:</span> ${escapeHtml(qa.recommendation)}</div>` : ''}
  `;
}

function renderDebugTab(envelope) {
  const p = $('tab-panel-debug');
  p.innerHTML = `
    <pre class="text-xs font-mono whitespace-pre-wrap bg-slate-100 dark:bg-slate-950 p-3 rounded overflow-auto max-h-[60vh]">${escapeHtml(JSON.stringify(envelope, null, 2))}</pre>
  `;
}

// ── API call ─────────────────────────────────────────────
async function callApi(path, payload) {
  const license = els.licenseKey.value.trim();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-License-Key': license
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, envelope: json };
}

async function runWorkflow() {
  if (!els.licenseKey.value.trim()) {
    setStatus(I18N.msg.licenseRequired, 'error');
    return;
  }
  if (!els.oldText.value.trim() || !els.newText.value.trim()) {
    setStatus(I18N.msg.missingText, 'error');
    return;
  }

  STATE.styleNumber = els.styleNumber.value.trim() || 'STYLE-DEMO-001';
  savePrefs();

  setStatus(I18N.msg.running, 'info');
  els.runBtn.disabled = true;
  els.exportBtn.disabled = true;
  els.progressSec.classList.remove('hidden');
  els.errorSec.classList.add('hidden');
  els.resultSec.classList.add('hidden');

  // RUNNING 動畫 — 不會 SSE,先全部標 RUNNING
  const runningStatus = {};
  STEP_KEYS.forEach((k) => runningStatus[k] = 'RUNNING');
  renderProgress(runningStatus);

  const payload = {
    style_number: STATE.styleNumber,
    output_mode:  STATE.outputMode,
    // backend 期望 techPackA / techPackB / buyerComments (見 run-workflow.js body 對應)
    techPackA:    { rawText: els.oldText.value },
    techPackB:    { rawText: els.newText.value },
    buyerComments: ''
  };

  try {
    const { httpStatus, envelope } = await callApi('/api/run-workflow', payload);
    if (!envelope?.success) {
      showError(envelope, httpStatus);
      // 失敗時把所有 RUNNING 標 FAILED
      const failed = {};
      STEP_KEYS.forEach((k) => failed[k] = 'FAILED');
      renderProgress(failed);
      return;
    }
    renderProgress(envelope.data?.agentStatus || {});
    renderResult(envelope);
    setStatus(I18N.msg.done, 'success');
  } catch (err) {
    showError({ error: { code: 'NETWORK_ERROR', message: String(err) } }, 0);
  } finally {
    els.runBtn.disabled = false;
  }
}

function setStatus(text, kind = 'info') {
  els.statusMsg.textContent = text;
  els.statusMsg.className = 'text-xs ' + (
    kind === 'error'   ? 'text-red-600 dark:text-red-400 font-medium' :
    kind === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-medium' :
                         'text-slate-500 dark:text-slate-400'
  );
}

function showError(envelope, httpStatus) {
  els.errorSec.classList.remove('hidden');
  els.resultSec.classList.add('hidden');
  const err = envelope?.error || { code: 'UNKNOWN', message: 'Unexpected error' };
  els.errorBody.textContent = `[HTTP ${httpStatus}] [${err.code}] ${err.message}\n\nrequest_id: ${envelope?.meta?.request_id || envelope?.data?.request_id || '—'}`;
  setStatus(I18N.msg.failed, 'error');
}

// ── Excel export (SheetJS) ───────────────────────────────
function exportExcel() {
  if (!STATE.lastEnvelope) return;
  const env = STATE.lastEnvelope;
  const arts = env.data?.artifacts || {};
  const meta = env.meta || {};

  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const sum = arts.summary || {};
  const sumRows = [
    ['款式編號', STATE.styleNumber],
    ['輸出模式', STATE.outputMode],
    ['Request ID', env.data?.request_id || ''],
    ['Provider', meta.provider || ''],
    ['處理時間 (ms)', meta.duration_ms || 0],
    ['Token 用量', meta.total_tokens || 0],
    ['版本', meta.version || ''],
    ['匯出時間', new Date().toISOString()],
    [],
    ['── 統計 ──'],
    ['總變更', sum.total_changes ?? 0],
    ['尺寸變更', sum.total_measurement_changes ?? 0],
    ['註解項', sum.total_comment_items ?? 0],
    ['圖像變更', sum.total_image_changes ?? 0],
    ['BOM 變更', sum.total_bom_changes ?? 0],
    [],
    ['── 重點摘要 ──'],
    ...(sum.bullet_points || []).map((b) => [b]),
    [],
    ['── 成本風險 ──'],
    ...(sum.cost_risk_items || []).map((b) => [b]),
    [],
    ['── 生產風險 ──'],
    ...(sum.production_risk_items || []).map((b) => [b]),
    [],
    ['── 決策建議 ──'],
    ['標題', '詳述', '影響 POM'],
    ...(sum.decisions || []).map((d) => [d.title, d.detail, (d.impacted_poms || []).join(', ')])
  ];
  const sumSheet = XLSX.utils.aoa_to_sheet(sumRows);
  sumSheet['!cols'] = [{ wch: 22 }, { wch: 60 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, sumSheet, '總結');

  // Sheet 2: Measurement
  const mHeader = ['POM 代碼','POM 名稱','尺碼','舊值','新值','差異','單位','狀態','超容差','信心','舊頁','新頁'];
  const mData = (arts.measurement_changes || []).map((r) => [
    r.pom_code || '', r.pom_name, r.size_label, r.old_value, r.new_value, r.diff_value,
    r.unit, r.status, r.tolerance_exceeded ? '是' : '否', r.confidence,
    r.source_page_old, r.source_page_new
  ]);
  const mSheet = XLSX.utils.aoa_to_sheet([mHeader, ...mData]);
  mSheet['!cols'] = mHeader.map((h) => ({ wch: Math.max(h.length + 2, 10) }));
  colorRows(mSheet, mData.length, mHeader.length, (i) => {
    const r = arts.measurement_changes[i];
    return sevColorHex(sevClassForMeasurement(r.status, r.tolerance_exceeded));
  });
  XLSX.utils.book_append_sheet(wb, mSheet, '尺寸變更');

  // Sheet 3: Comments & Images (合成一張表,前段 comments,後段 images)
  const cHeader = ['類型','ID','來源/變更類型','內容/描述','關聯 POM','嚴重度','信心'];
  const cData = [
    ...((arts.comments || []).map((c) => [
      '註解', c.comment_id || '', c.source, c.comment_text, c.related_pom || '', c.severity, c.confidence
    ])),
    ...((arts.images || []).map((i) => [
      '圖像', i.image_id || '', i.change_type, `舊: ${i.before_desc || ''}\n新: ${i.after_desc || ''}\n差異: ${i.diff_summary || ''}`, '', '', i.confidence
    ]))
  ];
  const cSheet = XLSX.utils.aoa_to_sheet([cHeader, ...cData]);
  cSheet['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 60 }, { wch: 18 }, { wch: 12 }, { wch: 8 }];
  colorRows(cSheet, cData.length, cHeader.length, (i) => {
    const all = [...(arts.comments || []), ...(arts.images || [])];
    const item = all[i];
    return sevColorHex(sevClassForBomLike(item?.severity));
  });
  XLSX.utils.book_append_sheet(wb, cSheet, '註解與圖像');

  // Sheet 4: BOM
  const bHeader = ['料號','類型','描述','顏色','規格','供應商','舊用量','新用量','差異','單位','狀態','影響','嚴重度','關聯 POM','信心','備註'];
  const bData = (arts.bom_changes || []).map((r) => [
    r.material_code || '', r.material_type, r.description, r.color || '', r.size_or_spec || '',
    r.supplier || '', r.old_qty, r.new_qty, r.diff_qty, r.unit || '', r.status, r.impact,
    r.severity, r.related_pom || '', r.confidence, r.notes || ''
  ]);
  const bSheet = XLSX.utils.aoa_to_sheet([bHeader, ...bData]);
  bSheet['!cols'] = bHeader.map((h) => ({ wch: Math.max(h.length + 2, 10) }));
  colorRows(bSheet, bData.length, bHeader.length, (i) => sevColorHex(sevClassForBomLike(arts.bom_changes[i].severity)));
  XLSX.utils.book_append_sheet(wb, bSheet, '物料清單');

  // Sheet 5: QA Review
  const qa = arts.qa_review || {};
  const qHeader = ['嚴重度','Agent','訊息'];
  const qData = (qa.findings || []).map((f) => [f.severity, f.agent, f.message]);
  const qRows = [
    ['QA 狀態', I18N.severity[qa.status] || qa.status || ''],
    ['整體風險', I18N.severity[qa.overall_risk] || qa.overall_risk || ''],
    ['建議', qa.recommendation || ''],
    [],
    qHeader,
    ...qData
  ];
  const qSheet = XLSX.utils.aoa_to_sheet(qRows);
  qSheet['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, qSheet, 'QA Review');

  const dateStr = new Date().toISOString().slice(0, 10);
  const fname = `TechPack_Comparison_${STATE.styleNumber}_${dateStr}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// === SheetJS conditional row coloring helpers ===
// 注意:SheetJS Community 不支援寫入豐富 cell style;這裡用 cell.s 配合
// xlsx-js-style 才會生效,Community 版本會被忽略,不影響資料完整性。
function colorRows(sheet, dataRowCount, colCount, getColorFn) {
  for (let i = 0; i < dataRowCount; i++) {
    const color = getColorFn(i);
    if (!color) continue;
    for (let c = 0; c < colCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c });
      const cell = sheet[addr];
      if (!cell) continue;
      cell.s = cell.s || {};
      cell.s.fill = { fgColor: { rgb: color }, patternType: 'solid' };
    }
  }
}
function sevColorHex(cls) {
  if (cls === 'sev-RED')    return 'FEE2E2';
  if (cls === 'sev-YELLOW') return 'FEF3C7';
  if (cls === 'sev-GREY')   return 'E5E7EB';
  return null;
}

// ── Init ─────────────────────────────────────────────────
async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    if (json?.data?.provider) els.providerName.textContent = json.data.provider;
  } catch (_) { /* ignore */ }
}

function init() {
  loadPrefs();
  renderOutputModes();
  resetProgress();
  els.runBtn.addEventListener('click', runWorkflow);
  els.exportBtn.addEventListener('click', exportExcel);
  els.licenseKey.addEventListener('change', savePrefs);
  els.styleNumber.addEventListener('change', savePrefs);
  fetchHealth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
