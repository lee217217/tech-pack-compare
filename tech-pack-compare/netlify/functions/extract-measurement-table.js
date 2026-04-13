export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ ok: true })
    };
  }

  const json = (body, statusCode = 200) => ({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  });

  try {
    const { image, side, page } = JSON.parse(event.body || '{}');
    if (!image) return json({ error: 'image is required' }, 400);

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return json({ error: 'PERPLEXITY_API_KEY is missing' }, 500);

    const prompt =
      'You are extracting garment measurement/spec table data from a tech pack page image.\n' +
      'Return ONLY valid JSON with this exact schema and nothing else (no markdown, no comments):\n' +
      `{"side":"${side || 'A'}","page":${Number(page || 1)},"rows":[{"pom_name":"","description":"","size_values":{"<SIZE_LABEL>":""}}]}\n` +
      'Where:\n' +
      '- pom_name: the POM code/name from the first column (e.g. "B21.1", "F28").\n' +
      '- description: the point of measure description from the second column.\n' +
      '- size_values: an object whose KEYS are ALL size headers as printed in the table (for example 32B, 34B, 36B, 38B, 40B, 32C, 34C, 36C, 38C, 40C, 32D, 34D, 36D, 38D, 40D, 32DD, 34DD, 36DD, 38DD, 40DD) and whose VALUES are the numeric spec values for that POM and size.\n' +
      'Rules:\n' +
      '- Extract only measurement/spec rows, not BOM, costing, artwork, revision history, or notes.\n' +
      '- If a POM has a sub-row with an arrow (↳) description, treat it as the same POM and include its values in the same row when possible.\n' +
      '- If a size cell is blank for a given POM, omit that key from size_values or set it to an empty string.\n' +
      '- Do NOT normalise or change the size labels; keep them exactly as shown in the header.\n' +
      '- If no measurement table is visible, use an empty array for rows.\n' +
      '- Do not include any explanation text; answer must be raw JSON only.';

    const resp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'sonar-reasoning-pro',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: image
                }
              }
            ]
          }
        ],
        temperature: 0
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      return json({ error: `Perplexity API error: ${resp.status} ${errText}` }, 500);
    }

    const data = await resp.json();
    const text =
      data?.choices?.[0]?.message?.content?.[0]?.text ||
      data?.choices?.[0]?.message?.content ||
      '';

    let parsed;
    try {
      parsed = JSON.parse(String(text).trim());
    } catch {
      const match = String(text).match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { side, page, rows: [] };
    }

    return json({ ok: true, result: parsed });
  } catch (error) {
    return json({ error: error.message || 'measurement extraction failed' }, 500);
  }
};
