/*
  Path:     public/app.js
  Purpose:  v2.1 主入口 — 3-pane SaaS layout + 4-step wizard + 4 tab + Debug
            負責 wizard 切換 / wiring / 呼 modules/*
  Depends:  public/modules/* (ES modules), Tailwind CDN, PDF.js CDN, SheetJS CDN
*/

import { I18N, t } from './modules/i18n.js';
import { logger } from './modules/logger.js';
import { getState, setState, subscribe, loadPrefs } from './modules/state.js';
import { initTheme, toggleTheme } from './modules/theme.js';
import { Toast } from './modules/toast.js';
import { Api } from './modules/api.js';
import { escapeHtml, StatCard } from './modules/ui.js';
import { renderProgress, resetProgress, setAllRunning, setAllFailed, STEP_KEYS } from './modules/progress.js';
import { mountDropzone, stripForUpload } from './modules/upload.js';
import { exportEnvelopeToXlsx } from './modules/excel.js';
import { renderSummaryTab } from './modules/tabs/summary.js';
import { renderMeasurementTab } from './modules/tabs/measurement.js';
import { renderCommentsTab } from './modules/tabs/comments.js';
import { renderBomTab } from './modules/tabs/bom.js';
import { renderQaTab } from './modules/tabs/qa.js';
import { renderDebugTab } from './modules/tabs/debug.js';

const $ = (id) => document.getElementById(id);

// ─── Wizard step switch ──────────────────────────────────
function goToStep(step) {
  setState({ step });
  document.querySelectorAll('.wizard-step').forEach((el) => {
    const n = parseInt(el.dataset.step, 10);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  document.querySelectorAll('.step-panel').forEach((el) => {
    el.classList.toggle('hidden', parseInt(el.dataset.step, 10) !== step);
  });
}

// ─── Inspector (right pane) ─────────────────────────────
function renderInspector() {
  const s = getState();
  const el = $('inspector-body');
  if (!el) return;
  const fileBlock = (label, tp) => tp ? `
    <div class="ins-file">
      <div class="ins-file-label">${escapeHtml(label)}</div>
      <div class="ins-file-name">${escapeHtml(tp.fileName)}</div>
      <div class="ins-file-meta">${tp.pageCount} 頁 · ${(tp.fileSize/1024).toFixed(1)} KB</div>
      ${tp.sizeTablePages.length ? `<div class="ins-tag tag-size">尺寸頁 ${tp.sizeTablePages.join(',')}</div>` : ''}
      ${tp.bomPages.length ? `<div class="ins-tag tag-bom">BOM 頁 ${tp.bomPages.join(',')}</div>` : ''}
    </div>` : `<div class="ins-file empty">尚未上傳 ${escapeHtml(label)}</div>`;

  const meta = s.lastEnvelope?.meta || {};
  const arts = s.lastEnvelope?.data?.artifacts || {};
  const sum = arts.summary || {};

  el.innerHTML = `
    <div class="ins-section">
      <div class="ins-section-title">${escapeHtml(I18N.inspector.fileTitle)}</div>
      ${fileBlock('A · 舊版', s.techPackA)}
      ${fileBlock('B · 新版', s.techPackB)}
    </div>
    <div class="ins-section">
      <div class="ins-section-title">${escapeHtml(I18N.inspector.metaTitle)}</div>
      <div class="ins-kv"><span>Provider</span><span class="mono">${escapeHtml(s.health?.provider || meta.provider || '—')}</span></div>
      <div class="ins-kv"><span>Mode</span><span class="mono">${escapeHtml(s.outputMode)}</span></div>
      <div class="ins-kv"><span>License</span><span class="mono">${s.licenseKey ? '已設定' : 'OPEN'}</span></div>
      ${meta.duration_ms != null ? `<div class="ins-kv"><span>耗時</span><span class="mono">${meta.duration_ms} ms</span></div>` : ''}
      ${meta.total_tokens != null ? `<div class="ins-kv"><span>Tokens</span><span class="mono">${meta.total_tokens}</span></div>` : ''}
    </div>
    ${s.lastEnvelope ? `
      <div class="ins-section">
        <div class="ins-section-title">${escapeHtml(I18N.inspector.statTitle)}</div>
        <div class="ins-kv"><span>總變更</span><span class="mono">${sum.total_changes ?? 0}</span></div>
        <div class="ins-kv"><span>尺寸</span><span class="mono">${sum.total_measurement_changes ?? 0}</span></div>
        <div class="ins-kv"><span>註解</span><span class="mono">${sum.total_comment_items ?? 0}</span></div>
        <div class="ins-kv"><span>BOM</span><span class="mono">${sum.total_bom_changes ?? 0}</span></div>
      </div>` : ''}
  `;
}

// ─── Output mode group ───────────────────────────────────
function renderOutputModes() {
  const wrap = $('output-mode-group');
  if (!wrap) return;
  const s = getState();
  const modes = ['FULL', 'SUMMARY', 'MEASUREMENT_ONLY', 'BOM_ONLY', 'DEBUG_ALL'];
  wrap.innerHTML = modes.map((m) => {
    const isDebug = m === 'DEBUG_ALL';
    const disabled = isDebug && !s.isAdmin;
    return `
      <label class="om-radio ${disabled ? 'disabled' : ''} ${s.outputMode === m ? 'active' : ''}"
             title="${escapeHtml(I18N.outputModeDesc[m])}${disabled ? ' · ' + I18N.msg.debugLockedHint : ''}">
        <input type="radio" name="output-mode" value="${m}"
               ${s.outputMode === m ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="om-label">${escapeHtml(I18N.outputModes[m])}</span>
        <span class="om-desc">${escapeHtml(I18N.outputModeDesc[m])}</span>
      </label>
    `;
  }).join('');
  wrap.querySelectorAll('input[name="output-mode"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      setState({ outputMode: e.target.value });
      renderInspector();
    });
  });
}

// ─── Tabs ───────────────────────────────────────────────
function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('tab-btn-active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-panel-${name}`));
}

// ─── Render envelope to all tabs ─────────────────────────
function renderResult(env) {
  setState({ lastEnvelope: env });
  const arts = env?.data?.artifacts || {};
  const debugOn = !!(env?.meta?.debug);
  const isAdmin = !!getState().isAdmin;

  $('result-section').classList.remove('hidden');
  $('error-section').classList.add('hidden');
  $('export-btn').disabled = false;
  $('tab-debug-btn').classList.toggle('hidden', !(debugOn || isAdmin));

  renderSummaryTab($('tab-panel-summary'), arts.summary);
  renderMeasurementTab($('tab-panel-measurement'), arts.measurement_changes || []);
  renderCommentsTab($('tab-panel-comments'), arts.comments || [], arts.images || []);
  renderBomTab($('tab-panel-bom'), arts.bom_changes || []);
  renderQaTab($('tab-panel-qa'), arts.qa_review);
  if (debugOn || isAdmin) renderDebugTab($('tab-panel-debug'), env);

  activateTab('summary');

  const meta = env.meta || {};
  $('duration-pill').textContent = `${meta.duration_ms || 0} ms${meta.cached ? ' ' + I18N.msg.cached : ''}`;
  $('duration-pill').classList.remove('hidden');
  $('tokens-pill').textContent = `${meta.total_tokens || 0} tokens`;
  $('tokens-pill').classList.remove('hidden');
  $('provider-name').textContent = meta.provider || '—';

  renderInspector();
  goToStep(4);
}

function showError(env, http) {
  $('error-section').classList.remove('hidden');
  $('result-section').classList.add('hidden');
  const err = env?.error || { code: 'UNKNOWN', message: 'Unexpected error' };
  $('error-body').textContent = `[HTTP ${http}] [${err.code}] ${err.message}\n\nrequest_id: ${env?.meta?.request_id || env?.data?.request_id || '—'}`;
  setStatus(I18N.msg.failed, 'error');
}

function setStatus(text, kind = 'info') {
  const el = $('status-msg');
  el.textContent = text;
  el.className = 'status-msg status-' + kind;
}

// ─── Run workflow ────────────────────────────────────────
async function runWorkflow() {
  const s = getState();
  if (!s.techPackA || !s.techPackB) {
    Toast.warn(I18N.msg.missingPdf);
    return;
  }
  setState({ isRunning: true, error: null });
  setStatus(I18N.msg.running, 'info');
  $('run-btn').disabled = true;
  $('export-btn').disabled = true;
  $('progress-section').classList.remove('hidden');
  $('error-section').classList.add('hidden');
  $('result-section').classList.add('hidden');
  setAllRunning($('progress-list'));

  const payload = {
    styleNumber: s.styleNumber,
    brandName: s.brandName,
    season: s.season,
    style_number: s.styleNumber,   // legacy alias
    outputMode: s.outputMode,
    output_mode: s.outputMode,     // legacy alias
    techPackA: stripForUpload(s.techPackA),
    techPackB: stripForUpload(s.techPackB),
    buyerComments: s.buyerComments || ''
  };

  try {
    const { httpStatus, envelope } = await Api.runWorkflow(payload);
    if (!envelope?.success) {
      setAllFailed($('progress-list'));
      showError(envelope, httpStatus);
      return;
    }
    renderProgress($('progress-list'), envelope.data?.agentStatus || {});
    renderResult(envelope);
    setStatus(I18N.msg.done, 'success');
    Toast.success(I18N.msg.done);
  } catch (err) {
    logger.error('app.runWorkflow', { err: err.message });
    showError({ error: { code: 'NETWORK_ERROR', message: String(err) } }, 0);
  } finally {
    setState({ isRunning: false });
    $('run-btn').disabled = false;
  }
}

// ─── Health ──────────────────────────────────────────────
async function fetchHealth() {
  const { envelope } = await Api.getHealth();
  if (envelope?.success && envelope.data) {
    setState({ health: { provider: envelope.data?.provider?.active || envelope.data?.provider || '—' }});
    $('provider-name').textContent = getState().health.provider;
    renderInspector();
  }
}

// ─── License inspect (probe admin) ───────────────────────
async function probeLicense() {
  const s = getState();
  if (!s.licenseKey) {
    setState({ isAdmin: false });
    renderOutputModes();
    renderInspector();
    return;
  }
  // 用 DEBUG_ALL mode 試跑一個極小的 extract call;若 envelope.meta.debug != null 表示 admin
  // 但這太貴;改用 license probe pattern:呼 /api/health 帶 license,
  // 後端 health 不返 isAdmin;我們暫用 localStorage hint - admin license 都以 ADMIN- 開頭
  const isAdmin = /^ADMIN-/i.test(s.licenseKey);
  setState({ isAdmin });
  renderOutputModes();
  renderInspector();
}

// ─── Init ────────────────────────────────────────────────
function init() {
  loadPrefs();
  initTheme();
  const s = getState();

  // form values from state
  $('license-key').value = s.licenseKey || '';
  $('style-number').value = s.styleNumber || 'STYLE-DEMO-001';
  $('brand-name').value = s.brandName || '';
  $('season-name').value = s.season || '';
  $('buyer-comments').value = s.buyerComments || '';

  renderOutputModes();
  resetProgress($('progress-list'));
  renderInspector();

  // dropzones
  mountDropzone($('dropzone-a'), { label: 'A', onParsed: (tp) => { setState({ techPackA: tp }); renderInspector(); } });
  mountDropzone($('dropzone-b'), { label: 'B', onParsed: (tp) => { setState({ techPackB: tp }); renderInspector(); } });

  // wizard nav
  document.querySelectorAll('[data-goto-step]').forEach((b) => {
    b.addEventListener('click', () => goToStep(parseInt(b.dataset.gotoStep, 10)));
  });
  document.querySelectorAll('.wizard-step').forEach((s) => {
    s.addEventListener('click', () => goToStep(parseInt(s.dataset.step, 10)));
  });

  // run + export
  $('run-btn').addEventListener('click', runWorkflow);
  $('export-btn').addEventListener('click', () => {
    const env = getState().lastEnvelope;
    if (!env) { Toast.warn('尚未有結果'); return; }
    const s2 = getState();
    const fname = exportEnvelopeToXlsx(env, {
      styleNumber: s2.styleNumber, brandName: s2.brandName, season: s2.season, outputMode: s2.outputMode
    });
    if (fname) Toast.success(`已匯出 ${fname}`);
  });

  // form -> state
  $('license-key').addEventListener('input', (e) => { setState({ licenseKey: e.target.value.trim() }); probeLicense(); });
  $('style-number').addEventListener('input', (e) => { setState({ styleNumber: e.target.value.trim() }); });
  $('brand-name').addEventListener('input', (e) => { setState({ brandName: e.target.value.trim() }); });
  $('season-name').addEventListener('input', (e) => { setState({ season: e.target.value.trim() }); });
  $('buyer-comments').addEventListener('input', (e) => { setState({ buyerComments: e.target.value }); });

  // tabs
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));

  // theme
  $('theme-toggle').addEventListener('click', () => toggleTheme());

  // advanced collapse
  const advBtn = $('advanced-toggle');
  if (advBtn) advBtn.addEventListener('click', () => {
    $('advanced-panel').classList.toggle('hidden');
    advBtn.setAttribute('aria-expanded', String(!$('advanced-panel').classList.contains('hidden')));
  });

  // mode chip in sidebar
  subscribe((st) => {
    $('side-mode-chip').textContent = st.outputMode;
    $('side-license-chip').textContent = st.licenseKey ? (st.isAdmin ? 'admin' : 'set') : 'OPEN';
  });

  probeLicense();
  fetchHealth();
  goToStep(1);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
