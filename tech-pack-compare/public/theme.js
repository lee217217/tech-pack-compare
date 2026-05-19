/*
  Path:     public/theme.js
  Purpose:  prefers-color-scheme + localStorage 主題切換 (light/dark)
  Depends:  index.html #theme-toggle, Tailwind darkMode:'class'
*/

const STORAGE_KEY = 'tpc.theme';

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.classList.add('dark');
  else                 root.classList.remove('dark');
}

function getInitialTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const initial = getInitialTheme();
applyTheme(initial);

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  });
});
