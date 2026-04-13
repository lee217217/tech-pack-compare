import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}

function buildPrompt(sideLabel, pageNum) {
  return `You are extracting garment measurement/spec table data from a tech pack page image.\nReturn ONLY valid JSON with this exact schema:\n{\n  "side": "${sideLabel}",\n  "page": ${pageNum},\n  "rows": [\n    {\n      "pom_name": "",\n      "description": "",\n      "size_values": {"XS":"", "S":"", "M":"", "L":"", "XL":""}\n    }\n  ]\n}\nRules:\n- Extract only measurement/spec rows, not BOM, costing, artwork, revision history, or notes.\n- pom_name should be the POM code/name if visible, otherwise use a short stable identifier like "POM".\n- description should contain the point of measure description.\n- Keep each size exactly as seen on the page.\n- If no measurement table is visible, return rows as an empty array.\n- Do not include markdown fences or explanations.`;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({ ok: true });

  try {
    const { image, side, page } = JSON.parse(event.body || '{}');
    if (!image) return json({ error: 'image is required' }, 400);

    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: buildPrompt(side || 'A', Number(page || 1)) },
            { type: 'input_image', image_url: image }
          ]
        }
      ]
    });

    const text = response.output_text?.trim() || '{}';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}$/);
      parsed = match ? JSON.parse(match[0]) : { side, page, rows: [] };
    }

    return json({ ok: true, result: parsed });
  } catch (error) {
    return json({ error: error.message || 'measurement extraction failed' }, 500);
  }
};
