# AGENTS.md

> **This file is written for AI coding tools (Claude Code, Codex, Cursor, Continue, Aider, etc).**
> Keep it short, high-signal, copy-paste friendly. Update it when architecture changes.
> Following these conventions saves ~16.6% tokens vs ad-hoc exploration of the repo.

---

## 1. Project at a glance

- **Name**: AI Tech Pack Comparator v2
- **Domain**: Apparel / Garment manufacturing
- **Users**: Factory Sales & Merchandisers
- **What it does**: Compare 2 PDF Tech Packs (buyer revisions) → produce a localized 繁中（HK）report covering text diff, measurement diff (POM-level), buyer comments, and image-embedded markups.
- **Version**: v2.1.0。**Open Mode 預設啟用** — 無 `X-License-Key` 也能試用；`ADMIN_LICENSE_KEY` 帶頭仍可解 `DEBUG_ALL`。設 `REQUIRE_LICENSE=true` 重新啟用嚴格模式。
- **Stack**: Vanilla JS + Tailwind CDN (frontend) · Netlify Functions on Node 18+ (backend) · Multi-LLM provider router.
- **Hard constraints** (do NOT violate):
  - **No TypeScript.** Pure ES modules `.js`.
  - **No axios.** Use native `fetch`.
  - **No Next.js / React / Vue.** Vanilla HTML + JS.
  - **No bundler for frontend.** Tailwind via CDN.
  - **All LLM API keys live ONLY in `netlify/functions/` or `src/services/llmClient.js`** — never imported by anything under `public/`.
  - **All LLM responses must be parsed via `schemaValidator.js`** — never `JSON.parse` raw.
  - **All output strings shown to user are 繁體中文（香港）**. Use `src/utils/i18n.js` keys.

---

## 2. Architecture (Multi-Agent)

```
                    ┌──────────────────────────┐
   PDF A + PDF B    │   public/app.js          │   (browser)
   + buyer comments │   - PDF.js text extract  │
                    │   - render page → PNG    │
                    └────────────┬─────────────┘
                                 │  POST /run-workflow
                                 ▼
                ┌──────────────────────────────────┐
                │  netlify/functions/run-workflow  │
                │   → rateLimiter + license check  │
                │   → coordinatorAgent             │
                └────────────┬─────────────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │           coordinatorAgent.js              │
        │                                            │
        │   extractorAgent  ──► (in-memory package)   │
        │   measurementAgent ─► measurement_changes │
        │   commentAgent    ──► comments            │
        │   imageAgent      ──► images              │
        │   bomAgent        ──► bom_changes         │
        │   summarizerAgent ──► summary             │
        │   qaReviewAgent   ──► qa_review           │
        │                                            │
        │   outputMode (UPPERCASE):                  │
        │     FULL | SUMMARY | MEASUREMENT_ONLY |    │
        │     BOM_ONLY | DEBUG_ALL                   │
        └────────────────────────────────────────────┘
                             │
                             ▼
                JSON report (validated by AJV)
```

### Agent responsibility matrix

| Agent | model_tier | Input | Output schema | Notes |
|---|---|---|---|---|
| `extractorAgent`   | low    | raw PDF text/page text/image refs/metadata | normalized extracted package (in-memory, no schema yet — see KI-005) | perplexity sonar |
| `measurementAgent` | high   | extractor.measurement sections A vs B  | `measurementChange` (per POM×size row) | sonar-pro temp=0, tolerance rule abs(diff)>0.5cm / >0.25in |
| `commentAgent`     | medium | TEXT_FIELD + IMAGE_ANNOTATION + BUYER_COMMENT | `commentArtifact` | language detect zh-HK/zh-CN/en/unknown |
| `imageAgent`       | medium | image A/B base64 (near size table) | `imageArtifact` | vision; no input → empty array, not error |
| `bomAgent`         | high   | extractor.bom sections A vs B | `bomArtifact` | FABRIC/TRIM/LABEL/PACKAGING/THREAD/ACCESSORY/OTHER; impact/severity rules below |
| `summarizerAgent`  | medium | all above artifacts | `summaryArtifact` | merges 4 artifact types + cost_risk_items + production_risk_items |
| `qaReviewAgent`    | high   | all artifacts | `qaReview` | hallucination + completeness (incl. bom) |
| `coordinatorAgent` | —      | request body + outputMode | `workflowResult` envelope | pure code orchestrator, supports parallel |

### BOM agent classification rules

- **status**: ADDED / REMOVED / CHANGED / UNCHANGED (CHANGED = code/qty/color/supplier/spec any-of differ)
- **impact**: COST / LEAD_TIME / QUALITY / COMPLIANCE / NO_IMPACT / UNKNOWN
- **severity**: CRITICAL (composition/care label/compliance/主布大改) > MAJOR (主布/重要 trim/qty) > MINOR (packing/accessory) > INFO

---

## 3. Where to put new code

| Task | Place it in |
|---|---|
| New agent | `src/agents/<name>Agent.js` + `src/schemas/<name>.schema.json` + dummy in `src/services/mockProvider.js` |
| New LLM provider | extend `src/services/llmClient.js` (add a case in `callProvider`) |
| New limit / quota tweak | `src/config/limits.js` |
| New UI text | `src/utils/i18n.js` (keys), and reference from `public/app.js` |
| New endpoint | `netlify/functions/<verb>-<noun>.js` (kebab-case) |
| Shared utility | `src/utils/` |
| Frontend logic | `public/app.js` only — keep DOM glue here |

---

## 4. Coding conventions

- **ES modules** everywhere (`import` / `export`, `"type": "module"` in package.json).
- **No semicolons rule? → YES use semicolons.** Match existing files.
- **2-space indent.**
- Filenames: kebab-case for functions/utils, camelCase for agent class files (`extractorAgent.js`).
- Every file starts with a header comment:
  ```js
  /**
   * Path: src/agents/extractorAgent.js
   * Purpose: ...
   * Depends on: src/services/llmClient.js, src/services/schemaValidator.js
   */
  ```
- **All LLM calls** must:
  1. Be inside `try / catch`.
  2. Pass `response_format: { type: 'json_schema', json_schema: ... }` when provider supports it.
  3. Validate with `schemaValidator.validate(schemaName, parsed)`.
  4. Fall back gracefully (return a `mode: 'fallback'` shape) — never throw to the user.
- **Never log raw API keys**. Use `logger.js` which auto-redacts.
- **Hash inputs before sending to LLM** when content is likely to repeat (use `utils/hash.js`).

---

## 5. Token optimization rules

1. **JSON schema, not free text** — every agent uses `response_format: json_schema`.
2. **Dedupe by hash** — if input hash matches a recent successful response in `cacheService`, reuse it.
3. **Truncate aggressively** — text inputs are sliced to per-agent budgets (defined in `src/config/limits.js`).
4. **No "please" / "thank you" / role chitchat** in prompts. System prompts ≤ 80 tokens.
5. **Strip boilerplate** before sending — PDF page headers/footers, page numbers, "Displaying 1 - 5 of 15".
6. **Reuse extracted artifacts** across agents — never re-extract.

---

## 6. Error handling contract

Every Netlify function returns this shape:

```json
{
  "ok": true | false,
  "data": { ... } | null,
  "error": "string|null",
  "warning": "string|null",
  "agentStatus": {
    "extractor":   "done" | "running" | "pending" | "error" | "skipped",
    "measurement": "done" | "...",
    ...
  },
  "meta": { "durationMs": 1234, "provider": "perplexity", "outputMode": "full" }
}
```

Frontend reads `agentStatus` to update the progress bar.

---

## 7. Testing

- `npm test` runs `tests/sample-run.test.js`
- It uses `tests/fixtures/techpack-A.json` and `techpack-B.json` (pre-extracted Tech Pack JSON — no real PDF needed)
- The test exercises `coordinatorAgent` directly with `LLM_PROVIDER=mock` so it runs offline
- When you add a new agent, add a `mock` branch in `llmClient.js` so `npm test` keeps passing

---

## 8. Environment variables (reference)

| Var | Required | Default | Notes |
|---|---|---|---|
| `LLM_PROVIDER` | yes | `perplexity` | `perplexity` `openai` `anthropic` `ollama` `mock` |
| `PERPLEXITY_API_KEY` | if provider=perplexity | — | |
| `OPENAI_API_KEY` | if provider=openai | — | |
| `ANTHROPIC_API_KEY` | if provider=anthropic | — | |
| `OLLAMA_BASE_URL` | if provider=ollama | `http://localhost:11434` | |
| `ADMIN_LICENSE_KEY` | yes | — | hard-coded admin key for now |
| `RATE_LIMIT_PER_MIN` | no | `10` | per IP |
| `MAX_FILE_MB` | no | `20` | per PDF |
| `ALLOWED_ORIGINS` | no | `*` (dev only) | comma-separated for CORS |

---

## 9. Glossary (apparel-specific)

| Term | Meaning |
|---|---|
| POM | Point of Measure — single body landmark on a garment (e.g. F18 = chest width) |
| Tech Pack | Buyer-issued spec doc (PDF) covering style, BOM, measurements, construction |
| BOM | Bill of Materials |
| Spec / Measurement Table | Table of POM × Size → numeric value |
| Buyer Comment | Free-text or image-embedded markup from buyer for next revision |
| Tolerance | Allowed ± deviation per POM |

---

## 10. Things that look wrong but are intentional

- We **do not** use a real diff library (e.g. `diff` npm) — apparel diff is semantic, not line-based.
- We **do** keep `coordinatorAgent` as code, not LLM — orchestration must be deterministic.
- We **do** allow Tailwind via CDN (no PostCSS) — keeps the repo single-deploy and avoids supply-chain risk.
- `qaReviewAgent` runs **after** summarizer to catch hallucinations — its `pass:false` is informational, not blocking.
