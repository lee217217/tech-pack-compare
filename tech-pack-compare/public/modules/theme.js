/*
  Path:     public/modules/theme.js
  Purpose:  prefers-color-scheme + localStorage 主題切換 (light/dark)
  Depends:  Tailwind darkMode:'class'
*/

const STORAGE_KEY = 'tpc.theme';

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function getInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch (_) { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* ignore */ }
  return next;
}

export function initTheme() {
  applyTheme(getInitialTheme());
}

export default { applyTheme, getInitialTheme, toggleTheme, initTheme };
