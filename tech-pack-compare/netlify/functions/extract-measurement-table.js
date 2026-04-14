export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const { image, side = 'A', page = 1 } = await request.json();
    if (!image) {
      return new Response(JSON.stringify({ error: 'Missing image' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing PERPLEXITY_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const schema = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pom_name: { type: 'string' },
              description: { type: 'string' },
              size_values: {
                type: 'object',
                additionalProperties: { type: 'string' }
              }
            },
            required: ['pom_name', 'description', 'size_values'],
            additionalProperties: false
          }
        }
      },
      required: ['rows'],
      additionalProperties: false
    };

    const prompt = `Extract the measurement chart from this tech pack page image and return JSON only. Do not return an empty rows array unless you truly cannot see any measurement row.

Rules:
- Read only the measurement table rows.
- Ignore page header, footer, page count, metadata, and text like Displaying x-y of z results.
- Preserve POM code exactly when visible, such as B21, F18, J14, D3.2.
- Preserve description text as closely as possible.
- Extract all size columns and values exactly as shown.
- The size columns may be standard apparel sizes OR bra sizes like 32B, 34B, 36B, 38B, 40B, 32C, 34C, 36C, 38C, 40C, 32D, 34D, 36D, 38D, 40D, 32DD, 34DD, 36DD, 38DD, 40DD.
- If the page contains multiple segments of the same measurement chart, merge all rows into one rows array.
- If the image is hard to read, still return partial rows rather than empty output.
- If you can identify even one row like B21, F18, J14, D3.2, return it.
- If nothing usable is visible, return {"rows":[]}.

Return format:
{
  "rows": [
    {
      "pom_name": "B21",
      "description": "Neck Along Edge- Strap to Strap",
      "size_values": {
        "32B": "12 5/8",
        "34B": "12 1/2"
      }
    }
  ]
}`;

    async function callPerplexity(model, extraPrompt = '') {
      const body = {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a precise OCR table extraction engine. Output valid JSON only. Do not use markdown fences.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `${prompt}\n\n${extraPrompt}`.trim() },
              { type: 'image_url', image_url: { url: image } }
            ]
          }
        ],
        temperature: 0,
        max_tokens: 4000
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000);
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `Perplexity request failed (${res.status})`);

      const raw = data?.choices?.[0]?.message?.content;
      let parsed = { rows: [] };
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        const match = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch {}
        }
      }
      return { parsed, raw, model };
    }

    let primary;
    try {
      primary = await callPerplexity('sonar-pro');
    } catch (error) {
      primary = { parsed: { rows: [] }, raw: null, model: 'sonar-pro', error: error.message };
    }

    let rows = Array.isArray(primary?.parsed?.rows) ? primary.parsed.rows : [];

    if (!rows.length) {
      try {
        const retry = await callPerplexity('sonar-pro', 'Important: this page may be a bra measurement chart. Treat bra size headers like 32B, 34B, 36C, 40DD as valid size columns. Return partial rows if needed. If you can see POM codes such as B21, F18, J14, F47, F26, F28, D3.1, F55, F52, D3.2, output them.');
        rows = Array.isArray(retry?.parsed?.rows) ? retry.parsed.rows : [];
        primary = retry;
      } catch {}
    }

    const cleaned = rows
      .filter(row => row && (row.pom_name || row.description) && row.size_values && Object.keys(row.size_values).length)
      .map(row => ({
        pom_name: String(row.pom_name || '').trim(),
        description: String(row.description || '').trim(),
        size_values: Object.fromEntries(
          Object.entries(row.size_values || {})
            .map(([k, v]) => [String(k).trim(), String(v).trim()])
            .filter(([k, v]) => k && v)
        )
      }))
      .filter(row => Object.keys(row.size_values).length > 0);

    return new Response(JSON.stringify({
      ok: true,
      side,
      page,
      model: primary?.model || 'sonar-pro',
      result: { rows: cleaned },
      debug: {
        raw_length: typeof primary?.raw === 'string' ? primary.raw.length : 0,
        row_count: cleaned.length,
        primary_error: primary?.error || null
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
