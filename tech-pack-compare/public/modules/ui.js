/*
  Path:     public/modules/ui.js
  Purpose:  簡易 UI primitives — Button / Card / Badge / Tabs / Modal / Progress / StatCard / Skeleton
            純函式回傳 HTML 字串 (給其他 module 拼接)
  Depends:  ./i18n.js
*/

import { I18N } from './i18n.js';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export function Button({ id = '', label = '', variant = 'primary', icon = '', disabled = false, attrs = '' } = {}) {
  const v = variant === 'primary' ? 'btn-primary'
          : variant === 'ghost'   ? 'btn-ghost'
          : variant === 'danger'  ? 'btn-danger'
          : 'btn-secondary';
  return `<button ${id ? `id="${id}"` : ''} class="btn ${v}" ${disabled ? 'disabled' : ''} ${attrs}>${icon ? `<span class="btn-icon">${icon}</span>` : ''}<span>${escapeHtml(label)}</span></button>`;
}

export function Card({ title = '', body = '', footer = '', className = '' } = {}) {
  return `
    <section class="card ${className}">
      ${title ? `<header class="card-header"><h3 class="card-title">${escapeHtml(title)}</h3></header>` : ''}
      <div class="card-body">${body}</div>
      ${footer ? `<footer class="card-footer">${footer}</footer>` : ''}
    </section>
  `;
}

export function Badge({ label = '', tone = 'neutral' } = {}) {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

export function StatCard({ label = '', value = 0, hint = '' } = {}) {
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value))}</div>
      ${hint ? `<div class="stat-hint">${escapeHtml(hint)}</div>` : ''}
    </div>
  `;
}

export function Skeleton({ lines = 3 } = {}) {
  return `<div class="skeleton">${Array.from({ length: lines }).map(() => '<span class="skeleton-line"></span>').join('')}</div>`;
}

export function emptyState(msg) {
  return `<div class="empty-state">${escapeHtml(msg ?? I18N.msg.noData)}</div>`;
}

// === Severity helpers (used by tabs + Excel) ===
export function sevClassForBomLike(severity) {
  if (severity === 'CRITICAL' || severity === 'MAJOR') return 'sev-RED';
  if (severity === 'MINOR') return 'sev-YELLOW';
  return 'sev-GREY';
}
export function sevClassForMeasurement(status, toleranceExceeded) {
  if (toleranceExceeded || status === 'ADDED' || status === 'REMOVED') return 'sev-RED';
  if (status === 'CHANGED') return 'sev-YELLOW';
  return 'sev-GREY';
}
export function sevClassForQa(status) {
  if (status === 'FAIL') return 'sev-RED';
  if (status === 'WARN') return 'sev-YELLOW';
  return 'sev-GREY';
}

export default {
  Button, Card, Badge, StatCard, Skeleton, emptyState, escapeHtml,
  sevClassForBomLike, sevClassForMeasurement, sevClassForQa
};
