/*
  Path:     public/modules/tabs/comments.js
  Purpose:  Comments & Images tab
*/

import { escapeHtml, emptyState, sevClassForBomLike } from '../ui.js';
import { I18N } from '../i18n.js';

export function renderCommentsTab(panel, comments = [], images = []) {
  if (!panel) return;
  if (!comments.length && !images.length) { panel.innerHTML = emptyState(I18N.msg.noData); return; }
  const cBody = comments.map((c) => `
    <tr>
      <td class="mono small">${escapeHtml(c.comment_id || '')}</td>
      <td>${escapeHtml(c.source)}</td>
      <td>${escapeHtml(c.comment_text)}</td>
      <td>${escapeHtml(c.related_pom || '')}</td>
      <td><span class="badge ${sevClassForBomLike(c.severity)}">${escapeHtml(I18N.severity[c.severity] || c.severity)}</span></td>
      <td class="mono small">${(c.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');
  const iBody = images.map((i) => `
    <tr>
      <td class="mono small">${escapeHtml(i.image_id || '')}</td>
      <td>${escapeHtml(i.change_type)}</td>
      <td>${escapeHtml(i.before_desc || '')}</td>
      <td>${escapeHtml(i.after_desc || '')}</td>
      <td>${escapeHtml(i.diff_summary || '')}</td>
      <td class="mono small">${(i.confidence ?? 0).toFixed(2)}</td>
    </tr>
  `).join('');

  panel.innerHTML = `
    <h3 class="section-h">註解 (${comments.length})</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>ID</th><th>來源</th><th>內容</th><th>關聯 POM</th><th>嚴重度</th><th>信心</th></tr></thead>
        <tbody>${cBody || `<tr><td colspan="6" class="muted">無</td></tr>`}</tbody>
      </table>
    </div>
    <h3 class="section-h">圖像變更 (${images.length})</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>ID</th><th>類型</th><th>舊版描述</th><th>新版描述</th><th>差異</th><th>信心</th></tr></thead>
        <tbody>${iBody || `<tr><td colspan="6" class="muted">無</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

export default { renderCommentsTab };
