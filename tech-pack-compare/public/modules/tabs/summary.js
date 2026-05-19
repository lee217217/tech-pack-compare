/*
  Path:     public/modules/tabs/summary.js
  Purpose:  Summary tab — bullet points + cost/production risks + decisions
*/

import { escapeHtml, StatCard, emptyState } from '../ui.js';
import { I18N } from '../i18n.js';

export function renderSummaryTab(panel, summary) {
  if (!panel) return;
  if (!summary) { panel.innerHTML = emptyState(I18N.msg.noData); return; }
  const bullets = (summary.bullet_points || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const costs   = (summary.cost_risk_items || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const prods   = (summary.production_risk_items || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const decisions = (summary.decisions || []).map((d) => `
    <div class="decision-card">
      <div class="decision-title">${escapeHtml(d.title)}</div>
      <div class="decision-detail">${escapeHtml(d.detail)}</div>
      ${d.impacted_poms?.length ? `<div class="decision-poms">影響 POM: <span class="font-mono">${d.impacted_poms.map(escapeHtml).join(', ')}</span></div>` : ''}
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="stat-grid">
      ${StatCard({ label: I18N.stats.totalChanges, value: summary.total_changes ?? 0 })}
      ${StatCard({ label: I18N.stats.measurement, value: summary.total_measurement_changes ?? 0 })}
      ${StatCard({ label: I18N.stats.comments, value: summary.total_comment_items ?? 0 })}
      ${StatCard({ label: I18N.stats.bom, value: summary.total_bom_changes ?? 0 })}
    </div>
    <h3 class="section-h">重點摘要</h3>
    <ul class="bullets">${bullets || `<li class="muted">無</li>`}</ul>
    <div class="risk-grid">
      <div>
        <h3 class="section-h">成本風險</h3>
        <ul class="bullets">${costs || `<li class="muted">無</li>`}</ul>
      </div>
      <div>
        <h3 class="section-h">生產風險</h3>
        <ul class="bullets">${prods || `<li class="muted">無</li>`}</ul>
      </div>
    </div>
    <h3 class="section-h">決策建議</h3>
    <div class="decision-list">${decisions || emptyState('無')}</div>
  `;
}

export default { renderSummaryTab };
