/*
  Path:     public/modules/api.js
  Purpose:  fetch wrapper — X-License-Key optional (Open Mode);envelope-aware
  Depends:  ./logger.js, ./state.js
*/

import { logger } from './logger.js';
import { getState } from './state.js';

async function call(path, { method = 'POST', body = null } = {}) {
  const license = (getState().licenseKey || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (license) headers['X-License-Key'] = license;   // Open Mode: optional

  const opts = { method, headers };
  if (body != null) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

  let httpStatus = 0;
  let envelope = null;
  try {
    const res = await fetch(path, opts);
    httpStatus = res.status;
    envelope = await res.json().catch(() => null);
  } catch (err) {
    logger.error('api.network', { path, err: err.message });
    return {
      httpStatus: 0,
      envelope: {
        success: false,
        data: null,
        error: { code: 'NETWORK_ERROR', message: String(err) },
        meta: {}
      }
    };
  }
  return { httpStatus, envelope };
}

export async function runWorkflow(payload)   { return call('/api/run-workflow', { body: payload }); }
export async function getHealth()             { return call('/api/health',     { method: 'GET' }); }
export async function runExtract(payload)     { return call('/api/extract',    { body: payload }); }
export async function runMeasurement(payload) { return call('/api/measurement', { body: payload }); }
export async function runComments(payload)    { return call('/api/comments',    { body: payload }); }
export async function runImages(payload)      { return call('/api/images',      { body: payload }); }
export async function runBom(payload)         { return call('/api/bom',         { body: payload }); }
export async function runSummarize(payload)   { return call('/api/summarize',   { body: payload }); }

export const Api = {
  call,
  runWorkflow, getHealth,
  runExtract, runMeasurement, runComments, runImages, runBom, runSummarize
};

export default Api;
