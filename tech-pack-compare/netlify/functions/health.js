/**
 * Path: netlify/functions/health.js
 * Purpose: 公開 health endpoint。不需 license，不打 Perplexity API。
 *          只回 provider config / schema 名單 / feature flags / uptime。
 * Depends on:
 *   - netlify/functions/_lib/workflowService.js
 *   - src/services/llmClient.js (health)
 *   - src/services/schemaValidator.js (schemaList)
 *   - src/services/cacheService.js (stats)
 *   - src/config/limits.js (FEATURES)
 *   - src/schemas/index.js (SCHEMA_NAMES)
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）— Sonar Pro lock
 */

import { handleRequest, okResponse } from './_lib/workflowService.js';
import { health as llmHealth } from '../../src/services/llmClient.js';
import { stats as cacheStats } from '../../src/services/cacheService.js';
import { FEATURES } from '../../src/config/limits.js';
import { SCHEMA_NAMES } from '../../src/schemas/index.js';

const VERSION = 'v2.0.0';
const PROCESS_START = Date.now();

export async function handler(event, context) {
  return handleRequest(
    { event, context, fnName: 'health' },
    { methods: ['GET'], requireAuth: false, rateLimit: false, parseBody: false },
    async ({ log }) => {
      const llm = safe(() => llmHealth());
      const cache = safe(() => cacheStats());
      const activeProvider = (process.env.LLM_PROVIDER || 'perplexity').toLowerCase();
      const apiKeyConfigured = !!process.env.PERPLEXITY_API_KEY;

      // 不打 Perplexity API。status 純依 config 推論：
      //   mock        → healthy
      //   perplexity + key 存在 → healthy
      //   perplexity 但無 key   → degraded（會 fallback to mock）
      let providerStatus = 'down';
      if (activeProvider === 'mock') providerStatus = 'healthy';
      else if (activeProvider === 'perplexity' && apiKeyConfigured) providerStatus = 'healthy';
      else if (activeProvider === 'perplexity' && !apiKeyConfigured) providerStatus = 'degraded';

      const data = {
        ok: providerStatus !== 'down',
        version: VERSION,
        provider: {
          active: activeProvider,
          status: providerStatus,
          model_low: 'sonar',
          model_medium: 'sonar-pro',
          model_high: 'sonar-pro',
          api_key_configured: apiKeyConfigured
        },
        providers_inactive: [
          { name: 'openai', status: 'disabled', note: 'Reserved for v3 — see KI-008' },
          { name: 'anthropic', status: 'disabled', note: 'Reserved for v3 — see KI-008' },
          { name: 'ollama', status: 'disabled', note: 'Reserved for v3 — see KI-008' }
        ],
        schemas: Object.values(SCHEMA_NAMES),
        features: {
          enableQaReview: FEATURES.enableQaReview,
          enableAiQaReview: FEATURES.enableAiQaReview,
          enablePromptCache: FEATURES.enablePromptCache,
          enableParallelAgents: FEATURES.enableParallelAgents
        },
        cache: cache?.value || null,
        llm_client: llm?.value || null,
        uptime_ms: Date.now() - PROCESS_START
      };

      log.info('health.ok', { provider: activeProvider, status: providerStatus });
      return okResponse(data, { provider: activeProvider });
    }
  );
}

function safe(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, value: null, error: err?.message };
  }
}
