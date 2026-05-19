# DEPLOY.md — AI Tech Pack Comparator v2

從 0 到上線 Netlify 嘅 step-by-step。預估時間: **15 分鐘**(假設 Netlify / Perplexity API key 已備妥)。

---

## 0. 前置條件

- Node.js **≥ 20.10** (用到 `node --test` + `import ... with { type: 'json' }`)
- Netlify CLI: `npm i -g netlify-cli` (建議 ≥ 17)
- Perplexity API key (`pplx-xxxxxxxxxxxxxxxxxxxxxxxxx`) — 從 [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) 拎
- Git repo (GitHub / GitLab / Bitbucket 都得)

---

## 1. 本機跑 mock 驗證 (3 分鐘)

```bash
cd v2
npm install
LLM_PROVIDER=mock \
ADMIN_LICENSE_KEY='ADMIN-TEST-2026' \
LICENSE_KEYS='ADMIN-TEST-2026,USER-DEMO-001' \
node --test tests/
```

**預期**: `# pass 39 / # fail 0`。

開本機 server:

```bash
LLM_PROVIDER=mock \
ADMIN_LICENSE_KEY='ADMIN-TEST-2026' \
LICENSE_KEYS='ADMIN-TEST-2026,USER-DEMO-001' \
netlify dev
```

打開 [http://localhost:8888](http://localhost:8888),vlf License Key `USER-DEMO-001`,貼樣本文字試「開始比對」。

---

## 2. 真實 Sonar Pro 驗證 (2 分鐘)

```bash
LLM_PROVIDER=perplexity \
PERPLEXITY_API_KEY='pplx-你的key' \
ADMIN_LICENSE_KEY='ADMIN-TEST-2026' \
LICENSE_KEYS='ADMIN-TEST-2026' \
netlify dev
```

跑一次 `FULL` outputMode,確認:
- `meta.provider` = `perplexity`
- `meta.total_tokens > 0` (**KI-006 驗證點**)
- `workflow_log[].tokens_used` 各有數字

---

## 3. Netlify Site 建立 (5 分鐘)

```bash
# 3.1 連到 Netlify
netlify login
netlify init    # 跟提示選 "Create & configure a new site"
```

**Build settings**(`netlify init` 會問,或之後在 UI 改):
- Build command: *(留空)*
- Publish directory: `public`
- Functions directory: `netlify/functions`

(這些已寫在 `netlify.toml`,正常情況 Netlify 會自動讀。)

---

## 4. 設環境變數 (3 分鐘)

於 Netlify Dashboard → **Site settings → Environment variables**,新增:

| Key | Value | 備註 |
|---|---|---|
| `LLM_PROVIDER` | `perplexity` | production 鎖 Sonar Pro |
| `PERPLEXITY_API_KEY` | `pplx-xxx...` | 真實 key,**不要 commit** |
| `ADMIN_LICENSE_KEY` | `ADMIN-PROD-{隨機字串}` | 唯一 admin key,可開 DEBUG_ALL |
| `LICENSE_KEYS` | `ADMIN-PROD-xxx,USER-001,USER-002` | 逗號分隔 |
| `RATE_LIMIT_RPM` | `30` | 每 license 每分鐘上限 (預設 30) |
| `CACHE_TTL_SECONDS` | `300` | 5 分鐘 cache |
| `LOG_LEVEL` | `info` | `info` / `warn` / `error` |

CLI 一次過設(替代 UI):

```bash
netlify env:set LLM_PROVIDER perplexity
netlify env:set PERPLEXITY_API_KEY pplx-xxx
netlify env:set ADMIN_LICENSE_KEY ADMIN-PROD-2026-001
netlify env:set LICENSE_KEYS 'ADMIN-PROD-2026-001,USER-001'
netlify env:set RATE_LIMIT_RPM 30
netlify env:set CACHE_TTL_SECONDS 300
netlify env:set LOG_LEVEL info
```

---

## 5. 部署 (2 分鐘)

```bash
# Draft preview
netlify deploy
# 確認 OK 後正式 publish
netlify deploy --prod
```

或 push 去 Git,Netlify 會自動 build(`netlify.toml` 已 wire 好)。

---

## 6. 線上驗收 (5 分鐘)

```bash
SITE_URL="https://你的-site-name.netlify.app"

# 6.1 health (無需 license)
curl -s "$SITE_URL/api/health" | jq

# 6.2 run-workflow FULL
curl -s -X POST "$SITE_URL/api/run-workflow" \
  -H 'Content-Type: application/json' \
  -H 'X-License-Key: USER-001' \
  -d '{"output_mode":"FULL","techPackA":{"rawText":"SIZE TABLE\nChest M: 50cm"},"techPackB":{"rawText":"SIZE TABLE\nChest M: 51.5cm"}}' \
  | jq '{success, mode: .data.output_mode, status: .data.agentStatus, tokens: .meta.total_tokens}'
```

**預期**:
- `success: true`
- `mode: "FULL"`
- `tokens > 0` (KI-006 確認)
- 7 個 agent 全部 `DONE`

打開 `$SITE_URL`,完整跑一次 UI flow + Excel 匯出。

---

## 7. 監控 & 故障排查

- Netlify Dashboard → **Functions** tab 看 invocation log
- 401 `UNAUTHORIZED` → `LICENSE_KEYS` 沒包該 key
- 429 `RATE_LIMITED` → 調 `RATE_LIMIT_RPM`
- 413 `PAYLOAD_TOO_LARGE` → Netlify body limit 6MB,當前 spec 20MB 是前端 client-side guard
- 500 + `meta.warnings` 含 "mock fallback" → `PERPLEXITY_API_KEY` 失效或超量,llmClient 自動 fallback 到 mock provider

---

## 8. 回滾

```bash
netlify deploy:list
netlify deploy:lock --id <previous-deploy-id>
```

或 Dashboard → **Deploys** → 找到上個 deploy → **Publish deploy**。

---

> 📌 安全提示:
> - `PERPLEXITY_API_KEY` **只**放在 Netlify env vars,**不要** commit `.env` 入 Git。
> - `.gitignore` 已包 `.env` + `.netlify/`。
> - License key 是 access control,**不**等同 API key 安全等級;production 建議搭配 IP allowlist。
