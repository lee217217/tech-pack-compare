# Tech Pack Compare Skeleton

This version upgrades the Netlify skeleton to:

- wire frontend PDF upload to the `compare-techpacks` function
- keep API keys server-side in Netlify Functions
- call the Perplexity API from the function, similar to the user's AI Meeting project pattern

## Structure

- `public/index.html` — UI
- `public/app.js` — PDF upload, PDF.js text extraction, function calls
- `netlify/functions/health/index.js` — health check
- `netlify/functions/compare-techpacks/index.js` — Perplexity-backed compare endpoint
- `netlify/functions/extract-comments/index.js` — starter comment extraction endpoint
- `package.json`
- `netlify.toml`

## Required environment variable

Set this in Netlify site settings, with Functions scope enabled:

```bash
PERPLEXITY_API_KEY=your_api_key_here
```

Netlify environment variables must be configured in the Netlify UI, CLI, or API for function runtime use; values declared in `netlify.toml` are not available to functions at runtime.

## Local dev

```bash
npm install
npm run dev
```

## Request flow

1. User uploads PDF A and PDF B in the browser
2. Browser extracts text with PDF.js
3. Frontend sends `textA`, `textB`, and `comments` to `/.netlify/functions/compare-techpacks`
4. Netlify Function calls Perplexity API
5. Function returns JSON to frontend

## Current behavior

- If `PERPLEXITY_API_KEY` exists and the API returns valid content, the function returns AI compare output.
- If the key is missing or API parsing fails, the function falls back to basic line diff output so demo testing can continue.
