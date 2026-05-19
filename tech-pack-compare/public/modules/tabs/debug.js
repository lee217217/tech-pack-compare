/*
  Path:     public/modules/tabs/debug.js
  Purpose:  Debug tab — raw envelope JSON + agentStatus + workflow log
*/

import { escapeHtml } from '../ui.js';

export function renderDebugTab(panel, envelope) {
  if (!panel) return;
  const log = envelope?.data?.workflow_log || [];
  const logRows = log.map((row, idx) => `
    <tr>
      <td class="mono small">${idx + 1}</td>
      <td class="mono small">${escapeHtml(row.agent || row.name || '')}</td>
      <td class="mono small">${escapeHtml(row.status || '')}</td>
      <td class="mono small">${escapeHtml(String(row.duration_ms ?? ''))}</td>
      <td class="mono small">${escapeHtml(String(row.tokens ?? row.total_tokens ?? ''))}</td>
    </tr>
  `).join('');

  panel.innerHTML = `
    <h3 class="section-h">Workflow Log</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>#</th><th>Agent</th><th>狀態</th><th>耗時(ms)</th><th>Tokens</th></tr></thead>
        <tbody>${logRows || `<tr><td colspan="5" class="muted">無</td></tr>`}</tbody>
      </table>
    </div>
    <h3 class="section-h">Raw Envelope JSON</h3>
    <pre class="raw-json">${escapeHtml(JSON.stringify(envelope, null, 2))}</pre>
  `;
}

export default { renderDebugTab };
