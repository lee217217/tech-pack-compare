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
import { mountDropzone, stripForUpload, prewarmPdfJs, getPdfJsInfo } from './modules/upload.js';
import { exportEnvelopeToXlsx } from './modules/excel.js';
import { renderSummaryTab } from './modules/tabs/summary.js';
import { renderMeasurementTab } from './modules/tabs/measurement.js';
import { renderCommentsTab } from './modules/tabs/comments.js';
import { renderBomTab } from './modules/tabs/bom.js';
import { renderQaTab } from './modules/tabs/qa.js';
import { renderDebugTab } from './modules/tabs/debug.js';

const $ = (id) => document.getElementById(id);

// ─── Activity timeline (in-memory, latest 5) ─────────────
const _activity = [];
function pushActivity(text, kind = 'info') {
  _activity.unshift({ text, kind, at: new Date() });
  if (_activity.length > 5) _activity.length = 5;
  renderInspector();
}

// ─── Breadcrumb labels per step ──────────────────────────
const BC_LABELS = {
  1: 'Step 1 · 上傳 PDF',
  2: 'Step 2 · 比對設定',
  3: 'Step 3 · 檢視 & 執行',
  4: 'Step 4 · 結果 & 匯出'
};

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
  const bc = $('bc-step');
  if (bc) bc.textContent = BC_LABELS[step] || '';
  if (step === 3) renderReviewSummary();
}

// ─── Tab indicator slide ─────────────────────────────────
function moveTabIndicator(name) {
  const ind = document.querySelector('.tab-indicator');
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (!ind || !btn || btn.classList.contains('hidden')) return;
  const nav = btn.parentElement;
  const nb = nav.getBoundingClientRect();
  const bb = btn.getBoundingClientRect();
  ind.style.transform = `translateX(${bb.left - nb.left}px)`;
  ind.style.width = `${bb.width}px`;
}

// ─── Confetti ────────────────────────────────────────────
function fireConfetti() {
  const root = $('confetti-root');
  if (!root) return;
  root.innerHTML = '';
  const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    p.style.left = (5 + Math.random() * 90) + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.3) + 's';
    p.style.animationDuration = (1.2 + Math.random() * 0.8) + 's';
    root.appendChild(p);
  }
  setTimeout(() => { root.innerHTML = ''; }, 2200);
}

// ─── Rotating tips (Step 1) ──────────────────────────────
const TIPS = [
  '💡 提示:上傳後會自動偵測尺寸表 / BOM 表頁碼。',
  '⚡ 提示:Mock 模式可離線跑完整 7-agent workflow。',
  '🧠 提示:Provider 鎖定 Perplexity Sonar Pro,JSON 結構穩定。',
  '🔑 提示:Admin License (ADMIN-*) 可解鎖 DEBUG_ALL 模式。',
  '🖼 提示:系統會挑前 6 張關鍵頁渲為圖像供 LLM 參考。'
];
let _tipIdx = 0;
let _tipTimer = null;
function startTipsRotator() {
  const el = document.querySelector('.helper-text');
  if (!el) return;
  if (_tipTimer) clearInterval(_tipTimer);
  _tipTimer = setInterval(() => {
    _tipIdx = (_tipIdx + 1) % TIPS.length;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = TIPS[_tipIdx]; el.style.opacity = '1'; }, 200);
  }, 5000);
}

// ─── Review summary (Step 3) ─────────────────────────────
function renderReviewSummary() {
  const el = $('review-summary');
  if (!el) return;
  const s = getState();
  el.innerHTML = `
    <div class="rev-grid">
      <div class="rev-row"><span class="rev-k">款式</span><span class="rev-v mono">${escapeHtml(s.styleNumber || '—')}</span></div>
      <div class="rev-row"><span class="rev-k">品牌</span><span class="rev-v">${escapeHtml(s.brandName || '—')}</span></div>
      <div class="rev-row"><span class="rev-k">季度</span><span class="rev-v">${escapeHtml(s.season || '—')}</span></div>
      <div class="rev-row"><span class="rev-k">輸出模式</span><span class="rev-v mono">${escapeHtml(s.outputMode)}</span></div>
      <div class="rev-row"><span class="rev-k">A (舊版)</span><span class="rev-v">${s.techPackA ? escapeHtml(s.techPackA.fileName) + ` · ${s.techPackA.pageCount}p` : '<em>未上傳</em>'}</span></div>
      <div class="rev-row"><span class="rev-k">B (新版)</span><span class="rev-v">${s.techPackB ? escapeHtml(s.techPackB.fileName) + ` · ${s.techPackB.pageCount}p` : '<em>未上傳</em>'}</span></div>
    </div>
  `;
}

// ─── Inspector v2 (5 collapse cards) ────────────────────
const EMPTY_SVG = `<svg class="ins-empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="10" y="14" width="36" height="40" rx="3"/><path d="M18 24h20M18 32h20M18 40h14"/><circle cx="50" cy="50" r="8"/><path d="M50 46v8M46 50h8"/></svg>`;

function fileCardBlock(label, tp) {
  if (!tp) {
    return `<div class="ins-file-card ins-file-empty">
      <span class="ins-file-pill">${escapeHtml(label)}</span>
      <span class="muted small">尚未上傳</span>
    </div>`;
  }
  return `<div class="ins-file-card">
    <div class="ins-file-card-head">
      <span class="ins-file-pill">${escapeHtml(label)}</span>
      <span class="ins-file-name" title="${escapeHtml(tp.fileName)}">${escapeHtml(tp.fileName)}</span>
    </div>
    <div class="ins-file-meta">${tp.pageCount} 頁 · ${(tp.fileSize/1024).toFixed(1)} KB</div>
    <div class="ins-tags">
      ${tp.sizeTablePages?.length ? `<span class="chip chip-primary">📐 尺寸 ${tp.sizeTablePages.join(',')}</span>` : ''}
      ${tp.bomPages?.length ? `<span class="chip chip-success">🧵 BOM ${tp.bomPages.join(',')}</span>` : ''}
    </div>
  </div>`;
}

function renderInspector() {
  const s = getState();
  const el = $('inspector-body');
  if (!el) return;
  const meta = s.lastEnvelope?.meta || {};
  const arts = s.lastEnvelope?.data?.artifacts || {};
  const sum = arts.summary || {};
  const pdfInfo = getPdfJsInfo();
  const hasAnyFile = !!(s.techPackA || s.techPackB);
  const hasResult = !!s.lastEnvelope;

  if (!hasAnyFile && !hasResult) {
    el.innerHTML = `<div class="ins-empty">${EMPTY_SVG}
      <div class="ins-empty-title">尚未開始</div>
      <div class="ins-empty-sub">上傳 PDF 後即可看到摘要</div>
    </div>`;
    return;
  }

  const activityList = _activity.length ? _activity.map(a => `
    <li class="ins-tl-item ins-tl-${a.kind}">
      <span class="ins-tl-dot"></span>
      <span class="ins-tl-time mono">${a.at.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span class="ins-tl-text">${escapeHtml(a.text)}</span>
    </li>`).join('') : '<li class="muted small">尚無動作</li>';

  el.innerHTML = `
    <details class="ins-card" open>
      <summary class="ins-card-head"><span class="ins-card-icon">📄</span><span class="ins-card-title">上傳的檔案</span></summary>
      <div class="ins-card-body">
        ${fileCardBlock('A · 舊版', s.techPackA)}
        ${fileCardBlock('B · 新版', s.techPackB)}
      </div>
    </details>
    <details class="ins-card" open>
      <summary class="ins-card-head"><span class="ins-card-icon">⚙️</span><span class="ins-card-title">執行配置</span></summary>
      <div class="ins-card-body">
        <div class="ins-kv"><span>Provider</span><span class="mono">${escapeHtml(s.health?.provider || meta.provider || '—')}</span></div>
        <div class="ins-kv"><span>Mode</span><span class="mono">${escapeHtml(s.outputMode)}</span></div>
        <div class="ins-kv"><span>License</span><span class="mono">${s.licenseKey ? (s.isAdmin ? 'ADMIN' : '已設定') : 'OPEN'}</span></div>
        ${meta.duration_ms != null ? `<div class="ins-kv"><span>耗時</span><span class="mono">${meta.duration_ms} ms</span></div>` : ''}
        ${meta.total_tokens != null ? `<div class="ins-kv"><span>Tokens</span><span class="mono">${meta.total_tokens}</span></div>` : ''}
      </div>
    </details>
    ${hasResult ? `
    <details class="ins-card" open>
      <summary class="ins-card-head"><span class="ins-card-icon">📊</span><span class="ins-card-title">結果統計</span></summary>
      <div class="ins-card-body">
        <div class="ins-stat-grid">
          <div class="ins-stat"><div class="ins-stat-num">${sum.total_changes ?? 0}</div><div class="ins-stat-lbl">總變更</div></div>
          <div class="ins-stat"><div class="ins-stat-num">${sum.total_measurement_changes ?? 0}</div><div class="ins-stat-lbl">尺寸</div></div>
          <div class="ins-stat"><div class="ins-stat-num">${sum.total_comment_items ?? 0}</div><div class="ins-stat-lbl">註解</div></div>
          <div class="ins-stat"><div class="ins-stat-num">${sum.total_bom_changes ?? 0}</div><div class="ins-stat-lbl">BOM</div></div>
        </div>
      </div>
    </details>` : ''}
    <details class="ins-card">
      <summary class="ins-card-head"><span class="ins-card-icon">📜</span><span class="ins-card-title">最近動作</span></summary>
      <div class="ins-card-body">
        <ul class="ins-tl">${activityList}</ul>
      </div>
    </details>
    <details class="ins-card">
      <summary class="ins-card-head"><span class="ins-card-icon">🔧</span><span class="ins-card-title">引擎資訊</span></summary>
      <div class="ins-card-body">
        <div class="ins-kv"><span>PDF.js</span><span class="mono">${pdfInfo.loaded ? `v${escapeHtml(pdfInfo.version)} (${escapeHtml(pdfInfo.cdn)})` : '未載入'}</span></div>
        <div class="ins-kv"><span>UI</span><span class="mono">v2.1.1</span></div>
        <div class="ins-kv"><span>Output</span><span class="mono">${escapeHtml(s.outputMode)}</span></div>
      </div>
    </details>
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
  requestAnimationFrame(() => moveTabIndicator(name));
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
  const durVal = $('duration-val');
  if (durVal) durVal.textContent = `${meta.duration_ms || 0} ms${meta.cached ? ' · cached' : ''}`;
  $('duration-pill').classList.remove('hidden');
  const tokVal = $('tokens-val');
  if (tokVal) tokVal.textContent = `${meta.total_tokens || 0}`;
  $('tokens-pill').classList.remove('hidden');
  $('provider-name').textContent = meta.provider || '—';

  renderInspector();
  goToStep(4);
  fireConfetti();
  pushActivity(`Workflow 完成 · ${meta.duration_ms || 0}ms · ${meta.total_tokens || 0} tokens`, 'success');
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
  mountDropzone($('dropzone-a'), { label: 'A', onParsed: (tp) => {
    setState({ techPackA: tp });
    pushActivity(`上傳 A · ${tp.fileName} (${tp.pageCount}p)`, 'info');
    renderInspector();
  } });
  mountDropzone($('dropzone-b'), { label: 'B', onParsed: (tp) => {
    setState({ techPackB: tp });
    pushActivity(`上傳 B · ${tp.fileName} (${tp.pageCount}p)`, 'info');
    renderInspector();
  } });

  // pre-warm PDF.js (idle callback)
  try { prewarmPdfJs(); } catch (e) { /* non-fatal */ }
  startTipsRotator();

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
  requestAnimationFrame(() => moveTabIndicator('summary'));
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tab-btn.tab-btn-active');
    if (active) moveTabIndicator(active.dataset.tab);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
