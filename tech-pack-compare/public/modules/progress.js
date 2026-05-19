/*
  Path:     public/modules/progress.js
  Purpose:  7-step agent progress bar
  Depends:  ./i18n.js
*/

import { I18N } from './i18n.js';
import { escapeHtml } from './ui.js';

export const STEP_KEYS = ['extractor', 'measurement', 'comment', 'image', 'bom', 'summarizer', 'qaReview'];

export function renderProgress(container, agentStatus = {}) {
  if (!container) return;
  container.innerHTML = STEP_KEYS.map((k) => {
    const st = String(agentStatus[k] || 'PENDING').toUpperCase();
    const cls =
      st === 'DONE'    ? 'step-done'    :
      st === 'RUNNING' ? 'step-running' :
      st === 'SKIPPED' ? 'step-skipped' :
      st === 'FAILED'  ? 'step-failed'  : 'step-pending';
    const label = I18N.agentNumLabels[k] || k;
    const stLab = I18N.agentStatus[st] || st;
    return `<li class="step-chip ${cls}" title="${escapeHtml(k)}: ${escapeHtml(st)}">
      <span class="step-label">${escapeHtml(label)}</span>
      <span class="step-status">${escapeHtml(stLab)}</span>
    </li>`;
  }).join('');
}

export function resetProgress(container) {
  const init = {};
  STEP_KEYS.forEach((k) => { init[k] = 'PENDING'; });
  renderProgress(container, init);
}

export function setAllRunning(container) {
  const r = {};
  STEP_KEYS.forEach((k) => { r[k] = 'RUNNING'; });
  renderProgress(container, r);
}

export function setAllFailed(container) {
  const r = {};
  STEP_KEYS.forEach((k) => { r[k] = 'FAILED'; });
  renderProgress(container, r);
}

export default { STEP_KEYS, renderProgress, resetProgress, setAllRunning, setAllFailed };
