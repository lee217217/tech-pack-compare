/**
 * Path: src/config/models.js
 * Purpose: 每個 LLM provider 的 model 對應表（low / medium / high tier）
 *          所有 agent 透過 `model_tier` 索取 model，不直接寫 model name
 *          這樣切換 provider 時，agent 不用改一行 code
 * Depends on: 無（純 config）
 *
 * Decision (本專案 default): provider = perplexity，全部 tier 都用 sonar-pro
 *   - sonar-pro 支援 vision + json_schema，是目前 Perplexity API 中最適合多模態 + 結構化輸出的模型
 *   - low tier 用 sonar 省成本（純文字 extractor）
 *   - high tier 用 sonar-pro 但降 temperature 到 0，給 measurement / qa 用
 */

/**
 * @typedef {Object} ModelSpec
 * @property {string} name           實際 API 用的 model id
 * @property {number} temperature
 * @property {number} max_tokens
 * @property {boolean} supportsJsonSchema   是否支援 response_format json_schema
 * @property {boolean} supportsVision       是否支援 image_url 輸入
 */

/**
 * @typedef {Object} ProviderSpec
 * @property {string} endpoint
 * @property {string} envKey          讀哪個環境變數作 API key
 * @property {{ low: ModelSpec, medium: ModelSpec, high: ModelSpec }} tiers
 */

/** @type {Record<string, ProviderSpec>} */
export const PROVIDERS = {
  perplexity: {
    endpoint: 'https://api.perplexity.ai/chat/completions',
    envKey: 'PERPLEXITY_API_KEY',
    tiers: {
      low: {
        name: 'sonar',
        temperature: 0.1,
        max_tokens: 2000,
        supportsJsonSchema: true,
        supportsVision: false
      },
      medium: {
        name: 'sonar-pro',
        temperature: 0.2,
        max_tokens: 4000,
        supportsJsonSchema: true,
        supportsVision: true
      },
      high: {
        name: 'sonar-pro',
        temperature: 0,
        max_tokens: 6000,
        supportsJsonSchema: true,
        supportsVision: true
      }
    }
  },

  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    tiers: {
      low: {
        name: 'gpt-5.5-mini',
        temperature: 0.2,
        max_tokens: 2000,
        supportsJsonSchema: true,
        supportsVision: true
      },
      medium: {
        name: 'gpt-5.5',
        temperature: 0.2,
        max_tokens: 4000,
        supportsJsonSchema: true,
        supportsVision: true
      },
      high: {
        name: 'gpt-5.5',
        temperature: 0,
        max_tokens: 6000,
        supportsJsonSchema: true,
        supportsVision: true
      }
    }
  },

  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    tiers: {
      low: {
        name: 'claude-haiku-4-5',
        temperature: 0.2,
        max_tokens: 2000,
        supportsJsonSchema: false,    // Claude 用 tool_use 模擬，llmClient 內部處理
        supportsVision: true
      },
      medium: {
        name: 'claude-sonnet-4-5',
        temperature: 0.2,
        max_tokens: 4000,
        supportsJsonSchema: false,
        supportsVision: true
      },
      high: {
        name: 'claude-sonnet-4-7',
        temperature: 0,
        max_tokens: 6000,
        supportsJsonSchema: false,
        supportsVision: true
      }
    }
  },

  ollama: {
    endpoint: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/api/chat',
    envKey: null,                     // local，不需 API key
    tiers: {
      low: {
        name: process.env.OLLAMA_MODEL_LOW || 'llama3.2:3b',
        temperature: 0.2,
        max_tokens: 2000,
        supportsJsonSchema: true,
        supportsVision: false
      },
      medium: {
        name: process.env.OLLAMA_MODEL || 'gemma3:27b',
        temperature: 0.2,
        max_tokens: 4000,
        supportsJsonSchema: true,
        supportsVision: false
      },
      high: {
        name: process.env.OLLAMA_MODEL_HIGH || 'gemma3:27b',
        temperature: 0,
        max_tokens: 6000,
        supportsJsonSchema: true,
        supportsVision: false
      }
    }
  },

  mock: {
    endpoint: 'mock://local',
    envKey: null,
    tiers: {
      low:    { name: 'mock-low',    temperature: 0, max_tokens: 1000, supportsJsonSchema: true, supportsVision: true },
      medium: { name: 'mock-medium', temperature: 0, max_tokens: 1000, supportsJsonSchema: true, supportsVision: true },
      high:   { name: 'mock-high',   temperature: 0, max_tokens: 1000, supportsJsonSchema: true, supportsVision: true }
    }
  }
};

/**
 * 取得當前 provider 名稱（從 .env 讀，預設 perplexity）
 * @returns {string}
 */
export function getActiveProvider() {
  const p = (process.env.LLM_PROVIDER || 'perplexity').toLowerCase();
  return PROVIDERS[p] ? p : 'perplexity';
}

/**
 * 取得指定 provider + tier 的 model spec
 * @param {'low'|'medium'|'high'} tier
 * @param {string} [provider]
 * @returns {{ provider: string, endpoint: string, envKey: string|null, spec: ModelSpec }}
 */
export function resolveModel(tier = 'medium', provider) {
  const p = provider || getActiveProvider();
  const def = PROVIDERS[p] || PROVIDERS.perplexity;
  const spec = def.tiers[tier] || def.tiers.medium;
  return {
    provider: p,
    endpoint: def.endpoint,
    envKey: def.envKey,
    spec
  };
}

/**
 * 回報哪些 provider 的 API key 有設置（給 /health 用）
 * @returns {Record<string, 'configured'|'missing-key'|'always-on'>}
 */
export function providerStatus() {
  const out = {};
  for (const [name, def] of Object.entries(PROVIDERS)) {
    if (!def.envKey) {
      out[name] = name === 'mock' ? 'always-on' : 'configured';
    } else {
      out[name] = process.env[def.envKey] ? 'configured' : 'missing-key';
    }
  }
  return out;
}

export default { PROVIDERS, getActiveProvider, resolveModel, providerStatus };
