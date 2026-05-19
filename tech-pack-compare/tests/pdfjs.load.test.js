/*
  Path:     tests/pdfjs.load.test.js
  Purpose:  v2.1.1 — 驗證 PDF.js 載入策略結構(CDN list / version / .mjs / worker URL)
            注意:dynamic import 在 node test 環境無法真實 fetch,故只做結構性檢查。
            真實瀏覽器載入由 LOCAL_VERIFICATION_CHECKLIST 手動驗證。
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadSrc = readFileSync(resolve(__dirname, '../public/modules/upload.js'), 'utf8');

test('PDF.js — version pinned to 4.0.379', () => {
  assert.match(uploadSrc, /PDFJS_VERSION\s*=\s*['"]4\.0\.379['"]/);
});

test('PDF.js — both cdnjs and jsdelivr CDN listed', () => {
  assert.match(uploadSrc, /name:\s*['"]cdnjs['"]/);
  assert.match(uploadSrc, /name:\s*['"]jsdelivr['"]/);
});

test('PDF.js — module URLs are .mjs', () => {
  const matches = uploadSrc.match(/module:\s*`https:\/\/[^`]+`/g) || [];
  assert.ok(matches.length >= 2, 'expected at least 2 module CDN entries');
  for (const m of matches) assert.match(m, /\.mjs`$/, `module URL must end .mjs — ${m}`);
});

test('PDF.js — worker URLs are .mjs', () => {
  const matches = uploadSrc.match(/worker:\s*`https:\/\/[^`]+`/g) || [];
  assert.ok(matches.length >= 2, 'expected at least 2 worker CDN entries');
  for (const w of matches) assert.match(w, /\.mjs`$/, `worker URL must end .mjs — ${w}`);
});

test('PDF.js — cdnjs URL hits cdnjs.cloudflare.com', () => {
  assert.match(uploadSrc, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\//);
});

test('PDF.js — jsdelivr URL hits cdn.jsdelivr.net/npm/pdfjs-dist', () => {
  assert.match(uploadSrc, /cdn\.jsdelivr\.net\/npm\/pdfjs-dist@/);
});

test('PDF.js — loadPdfJs / prewarmPdfJs / getPdfJsInfo all exported', () => {
  assert.match(uploadSrc, /export\s+function\s+loadPdfJs\s*\(/);
  assert.match(uploadSrc, /export\s+function\s+prewarmPdfJs\s*\(/);
  assert.match(uploadSrc, /export\s+function\s+getPdfJsInfo\s*\(/);
});

test('PDF.js — retry + fallback logic present (loops over CDNs + attempt counter)', () => {
  assert.match(uploadSrc, /for\s*\(\s*const\s+cdn\s+of\s+PDFJS_CDNS\s*\)/);
  // 期待有 attempt loop 或 retry constant
  assert.ok(/attempt/i.test(uploadSrc), 'should reference attempt counter');
});

test('PDF.js — boot console.log diagnostic for version + CDN', () => {
  // 用戶明確要求 console.log 標記 PDF.js 載入版本(例外於 no-console-log 規則)
  assert.match(uploadSrc, /console\.log\([^)]*PDF\.js[^)]*\)/);
});

test('PDF.js — GlobalWorkerOptions.workerSrc assigned dynamically', () => {
  assert.match(uploadSrc, /GlobalWorkerOptions\.workerSrc\s*=/);
});

test('PDF.js — friendly Chinese error message present when load fails', () => {
  // 任何中文字 "載入" 或 "PDF.js" 的友善訊息均可
  assert.ok(/載入/.test(uploadSrc) || /無法載入/.test(uploadSrc), 'should contain Chinese friendly message');
});

test('netlify.toml — CSP includes cdnjs + jsdelivr + Google Fonts (script/style/font/worker)', () => {
  const toml = readFileSync(resolve(__dirname, '../netlify.toml'), 'utf8');
  // script-src
  assert.match(toml, /script-src[^;]*cdnjs\.cloudflare\.com/);
  assert.match(toml, /script-src[^;]*cdn\.jsdelivr\.net/);
  // worker-src
  assert.match(toml, /worker-src[^;]*cdnjs\.cloudflare\.com/);
  assert.match(toml, /worker-src[^;]*cdn\.jsdelivr\.net/);
  // style-src (Google Fonts + jsdelivr)
  assert.match(toml, /style-src[^;]*fonts\.googleapis\.com/);
  // font-src
  assert.match(toml, /font-src[^;]*fonts\.gstatic\.com/);
});
