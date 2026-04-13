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
      `{"side":"${side || 'A'}","page":${Number(page || 1)},"rows":[{"pom_name":"","description":"","size_values":{"XS":"","S":"","M":"","L":"","XL":""}}]}\n` +
      'Rules:\n' +
      '- Extract only measurement/spec rows, not BOM, costing, artwork, revision history, or notes.\n' +
      '- pom_name should be the POM code/name if visible, otherwise use a short stable identifier like "POM".\n' +
      '- description should contain the point of measure description.\n' +
      '- size_values should contain key-value pairs where key is the size label exactly as shown (e.g. XS, S, M, L, XL, 2XL) and value is the numeric spec.\n' +
      '- If no measurement table is visible, use an empty array for rows.\n' +
      '- Do not include any explanation text; answer must be raw JSON only.';

    // Perplexity Chat Completions / Sonar endpoint（與 OpenAI chat 格式兼容）
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
                  // 這裡可以直接用 dataURL（data:image/png;base64,...）
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
      return json(
        { error: `Perplexity API error: ${resp.status} ${errText}` },
        500
      );
    }

    const data = await resp.json();
    // Perplexity chat-completions 風格：從 choices[0].message.content 拿文字
    const text =
      data?.choices?.[0]?.message?.content?.[0]?.text ||
      data?.choices?.[0]?.message?.content ||
      '';

    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      const match = String(text).match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { side, page, rows: [] };
    }

    return json({ ok: true, result: parsed });
  } catch (error) {
    return json(
      { error: error.message || 'measurement extraction failed' },
      500
    );
  }
};