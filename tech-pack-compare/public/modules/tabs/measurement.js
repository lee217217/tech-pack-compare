/*
  Path:     public/modules/tabs/measurement.js
  Purpose:  Measurement tab — POM 表
*/

import { escapeHtml, emptyState, sevClassForMeasurement } from '../ui.js';
import { I18N } from '../i18n.js';

export function renderMeasurementTab(panel, rows = []) {
  if (!panel) return;
  if (!rows.length) { panel.innerHTML = emptyState(I18N.msg.noData); return; }
  const body = rows.map((r) => `
    <tr>
      <td class="mono small">${escapeHtml(r.pom_code || '')}</td>
      <td>${escapeHtml(r.pom_name)}</td>
      <td>${escapeHtml(r.size_label)}</td>
      <td class="mono">${r.old_value ?? '—'}</td>
      <td class="mono">${r.new_value ?? '—'}</td>
      <td class="mono">${r.diff_value > 0 ? '+' : ''}${r.diff_value ?? '—'}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td><span class="badge ${sevClassForMeasurement(r.status, r.tolerance_exceeded)}">${escapeHtml(I18N.severity[r.status] || r.status)}${r.tolerance_exceeded ? ' · 超容差' : ''}</span></td>
      <td class="mono small">${(r.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');
  panel.innerHTML = `
    <div class="table-wrap">
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

export default { renderMeasurementTab };
