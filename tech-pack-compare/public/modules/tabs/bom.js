/*
  Path:     public/modules/tabs/bom.js
  Purpose:  BOM tab
*/

import { escapeHtml, emptyState, sevClassForBomLike } from '../ui.js';
import { I18N } from '../i18n.js';

export function renderBomTab(panel, rows = []) {
  if (!panel) return;
  if (!rows.length) { panel.innerHTML = emptyState(I18N.msg.noData); return; }
  const body = rows.map((r) => `
    <tr>
      <td class="mono small">${escapeHtml(r.material_code || '')}</td>
      <td>${escapeHtml(r.material_type)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.supplier || '')}</td>
      <td class="mono">${r.old_qty ?? '—'}</td>
      <td class="mono">${r.new_qty ?? '—'}</td>
      <td class="mono">${r.diff_qty > 0 ? '+' : ''}${r.diff_qty ?? '—'}</td>
      <td>${escapeHtml(r.unit || '')}</td>
      <td>${escapeHtml(r.impact)}</td>
      <td><span class="badge ${sevClassForBomLike(r.severity)}">${escapeHtml(I18N.severity[r.severity] || r.severity)}</span></td>
      <td class="mono small">${(r.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');
  panel.innerHTML = `
    <div class="table-wrap">
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

export default { renderBomTab };
