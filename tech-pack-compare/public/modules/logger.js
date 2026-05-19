/*
  Path:     public/modules/logger.js
  Purpose:  Browser-side logger — 統一接口,可開關 debug;絕對不可在其他地方 console.log
  Depends:  無
*/

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const current = (() => {
  try {
    return localStorage.getItem('tpc.logLevel') || 'info';
  } catch { return 'info'; }
})();

function shouldLog(level) {
  return (LEVELS[level] ?? 3) <= (LEVELS[current] ?? 3);
}

function fmt(level, msg, ctx) {
  const ts = new Date().toISOString().slice(11, 23);
  return [`[${ts}] [${level.toUpperCase()}] ${msg}`, ctx ?? ''];
}

export const logger = {
  debug(msg, ctx) { if (shouldLog('debug')) console.debug(...fmt('debug', msg, ctx)); },
  info(msg, ctx)  { if (shouldLog('info'))  console.info(...fmt('info', msg, ctx)); },
  warn(msg, ctx)  { if (shouldLog('warn'))  console.warn(...fmt('warn', msg, ctx)); },
  error(msg, ctx) { if (shouldLog('error')) console.error(...fmt('error', msg, ctx)); },
  child(_meta) { return logger; }
};

export default logger;
