export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { image, side = 'A', page = 1 } = await request.json();
    if (!image) {
      return new Response(JSON.stringify({ error: 'Missing image' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing PERPLEXITY_API_KEY' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const prompt = `You are extracting a garment measurement chart from a tech pack page image. Return JSON only.

Goal:
- Read the measurement chart/table from the image.
- Extract each measurement row.
- Keep exact POM code and description when visible.
- Extract size columns and their values exactly as shown.
- This file may use apparel sizes (XS, S, M, L, XL) OR bra sizes (32B, 34B, 36B, 38B, 40B, 32C, 34C, 36C, 38C, 40C, 32D, 34D, 36D, 38D, 40D, 32DD, 34DD, 36DD, 38DD, 40DD).
- Ignore headers, footers, page numbers, 'Displaying x-y of z results', and non-table metadata.
- If multiple table sections exist, merge all measurement rows into one rows array.
- If nothing readable is present, return {"rows":[]}.

Output schema exactly:
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

    const body = {
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: 'You are a precise OCR-to-JSON extraction engine. Output valid JSON only and no markdown.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          schema: {
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
          }
        }
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || 'Perplexity API request failed', raw: data }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const raw = data?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      parsed = { rows: [] };
    }

    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    return new Response(JSON.stringify({ ok: true, side, page, result: { rows } }), {
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
