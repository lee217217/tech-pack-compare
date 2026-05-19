/*
  Path:     public/modules/tabs/qa.js
  Purpose:  QA Review tab — qa shape: { status, overall_risk, recommendation, issues OR findings }
*/

import { escapeHtml, emptyState, sevClassForQa } from '../ui.js';
import { I18N } from '../i18n.js';

export function renderQaTab(panel, qa) {
  if (!panel) return;
  if (!qa) { panel.innerHTML = emptyState(I18N.msg.noData); return; }
  const list = qa.issues || qa.findings || [];
  const items = list.map((f) => `
    <li class="qa-item">
      <span class="badge ${
        f.severity === 'ERROR' ? 'sev-RED' :
        f.severity === 'WARN'  ? 'sev-YELLOW' : 'sev-GREY'
      }">${escapeHtml(f.severity)}</span>
      <span class="qa-text"><span class="qa-agent">[${escapeHtml(f.agent || '')}]</span> ${escapeHtml(f.message)}</span>
    </li>
  `).join('');
  panel.innerHTML = `
    <div class="qa-status-row">
      <span class="badge ${sevClassForQa(qa.status)} qa-status-badge">${escapeHtml(I18N.severity[qa.status] || qa.status)}</span>
      <span class="muted small">總體風險: ${escapeHtml(I18N.severity[qa.overall_risk] || qa.overall_risk || '—')}</span>
    </div>
    <h3 class="section-h">QA 發現 (${list.length})</h3>
    <ul class="qa-list">${items || emptyState('無')}</ul>
    ${qa.recommendation ? `<div class="qa-rec"><span class="qa-rec-label">建議:</span> ${escapeHtml(qa.recommendation)}</div>` : ''}
  `;
}

export default { renderQaTab };
