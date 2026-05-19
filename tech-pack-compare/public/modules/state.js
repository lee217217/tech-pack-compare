/*
  Path:     public/modules/state.js
  Purpose:  簡易 store + localStorage 持久化 (preference / last envelope)
  Depends:  ./logger.js
*/

import { logger } from './logger.js';

const LS_PREFIX = 'tpc.';

const subscribers = new Set();

const initialState = {
  step: 1,                  // 1..4
  licenseKey: '',
  isAdmin: false,
  styleNumber: 'STYLE-DEMO-001',
  brandName: '',
  season: '',
  buyerComments: '',
  outputMode: 'FULL',
  techPackA: null,          // { fileName, fileSize, pageCount, metadata, pages, rawText, sizeTablePages, bomPages, relevantImages }
  techPackB: null,
  lastEnvelope: null,
  runningAgents: {},        // { extractor: 'RUNNING', ... }
  isRunning: false,
  error: null,
  health: null              // /api/health 結果
};

let state = { ...initialState };

export const STATE = state;

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  // 不要把 last envelope / pages 寫 localStorage (太大)
  persistPrefs();
  for (const fn of subscribers) {
    try { fn(state); } catch (err) { logger.error('state.subscriber', { err: err.message }); }
  }
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ── localStorage prefs ─────────────────────────────
const PREF_KEYS = ['licenseKey', 'styleNumber', 'brandName', 'season', 'outputMode'];

export function loadPrefs() {
  const patch = {};
  for (const k of PREF_KEYS) {
    try {
      const v = localStorage.getItem(LS_PREFIX + k);
      if (v != null) patch[k] = v;
    } catch (_) { /* ignore */ }
  }
  state = { ...state, ...patch };
}

function persistPrefs() {
  for (const k of PREF_KEYS) {
    try { localStorage.setItem(LS_PREFIX + k, state[k] ?? ''); } catch (_) { /* ignore */ }
  }
}

export default { getState, setState, subscribe, loadPrefs, STATE };
