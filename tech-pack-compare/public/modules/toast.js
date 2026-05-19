/*
  Path:     public/modules/toast.js
  Purpose:  右下角通知 (info / success / warn / error)
  Depends:  document body
*/

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

export function toast(kind, message, { timeout = 3500 } = {}) {
  ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `
    <span class="toast-icon">${iconFor(kind)}</span>
    <span class="toast-msg"></span>
    <button class="toast-close" aria-label="關閉">×</button>
  `;
  el.querySelector('.toast-msg').textContent = String(message ?? '');
  el.querySelector('.toast-close').addEventListener('click', () => el.remove());
  container.appendChild(el);
  if (timeout > 0) setTimeout(() => el.remove(), timeout);
  return el;
}

function iconFor(kind) {
  return ({ info: 'ⓘ', success: '✓', warn: '⚠', error: '✕' })[kind] || 'ⓘ';
}

export const Toast = {
  info:    (m, o) => toast('info', m, o),
  success: (m, o) => toast('success', m, o),
  warn:    (m, o) => toast('warn', m, o),
  error:   (m, o) => toast('error', m, o)
};

export default Toast;
