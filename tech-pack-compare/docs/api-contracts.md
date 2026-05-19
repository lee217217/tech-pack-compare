# API Contracts — AI Tech Pack Comparator v2

> All endpoints live under `/.netlify/functions/*` and accept the `/api/*` rewrite (see `netlify.toml`).
> All responses are JSON. All errors include `ok: false` and a human-readable `error`.

---

## Common headers

| Header | Required | Notes |
|---|---|---|
| `Content-Type: application/json` | yes (for POST) | |
| `x-license-key` | yes | matches `ADMIN_LICENSE_KEY` or any in `LICENSE_KEYS` |
| `x-request-id` | optional | echoed back in response `meta.requestId` |

---

## Common response envelope

```json
{
  "ok": true,
  "data": { ... },
  "warning": null,
  "error": null,
  "agentStatus": {
    "extractor": "done",
    "measurement": "done",
    "comments": "done",
    "images": "skipped",
    "bom": "done",
    "summarizer": "done",
    "qaReview": "done"
  },
  "meta": {
    "durationMs": 4231,
    "provider": "perplexity",
    "outputMode": "full",
    "requestId": "..."
  }
}
```

---

## `GET /health`

Returns service status + which providers have API keys configured.

```json
{
  "ok": true,
  "service": "techpack-compare-v2",
  "version": "2.0.0",
  "timestamp": "2026-05-18T09:39:00Z",
  "providers": {
    "perplexity": "configured",
    "openai": "missing-key",
    "anthropic": "missing-key",
    "ollama": "configured",
    "mock": "always-on"
  }
}
```

---

## `POST /run-workflow` — main entry

Request:

```json
{
  "outputMode": "full",
  "techPackA": {
    "rawText": "...",
    "imagePages": [
      { "page": 7, "imageBase64": "data:image/png;base64,..." }
    ]
  },
  "techPackB": { "rawText": "...", "imagePages": [...] },
  "buyerComments": "free text comments from buyer\nline 2",
  "options": {
    "preferProvider": { "measurement": "openai" },
    "skipAgents": [],
    "language": "zh-HK"
  }
}
```

`outputMode`（全大寫，由 coordinatorAgent.normalizeOutputMode 強制 UPPERCASE）：

| Mode | 跑的 agent | 用途 |
|---|---|---|
| `FULL` | extractor → (measurement / comment / image / bom 並行) → summarizer → qaReview | **預設**，完整報告 |
| `SUMMARY` | extractor → summarizer → qaReview | 只要 bullet summary + email |
| `MEASUREMENT_ONLY` | extractor → measurement → summarizer → qaReview | 只關心尺寸表變更 |
| `BOM_ONLY` | extractor → bom → summarizer → qaReview | 只關心物料 / BOM 變更 |
| `DEBUG_ALL` | 等同 FULL，但 `meta.debug` 會回 agent raw meta / cache stats / provider health / workflow timings | **admin only**；若 `context.debugAllowed !== true` 會自動降級 FULL 並在 `meta.warnings` 記錄 |

Response (success): see common envelope. `data` shape (matches `workflowResult.schema.json`):

```json
{
  "workflow_id": "wf_xxx",
  "output_mode": "FULL",
  "artifacts": {
    "summary": { ... summaryArtifact ... },
    "measurement_changes": [ { ...measurementChange... } ],
    "comment_changes": [ { ...commentArtifact... } ],
    "image_changes": [ { ...imageArtifact... } ],
    "bom_changes": [
      {
        "bom_item_id": "bom_001",
        "material_code": "FAB-001",
        "material_type": "FABRIC",
        "description": "主布 100% Cotton Jersey 180gsm",
        "color": "Navy",
        "size_or_spec": "180gsm",
        "supplier": "Luen Thai Textiles",
        "old_qty": 1.4,
        "new_qty": 1.5,
        "diff_qty": 0.1,
        "unit": "YDS",
        "status": "CHANGED",
        "impact": "COST",
        "severity": "MAJOR",
        "related_pom": null,
        "source_page_old": 12,
        "source_page_new": 12,
        "confidence": 0.92,
        "notes": "主布耗量上升 7%"
      }
    ],
    "qa": { ... qaReview ... }
  }
}
```

---

## `POST /extract`, `/measurement`, `/comments`, `/images`, `/bom`, `/summarize`

Debug-friendly endpoints that invoke a single agent. Same envelope, same auth.

See `src/schemas/*.schema.json` for exact shapes per agent.
