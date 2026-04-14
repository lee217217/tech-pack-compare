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

    const prompt = `You are reading one measurement chart page from a garment tech pack. Return plain text only.

Your task:
1. Read the measurement chart table from the image.
2. Ignore page headers, page footers, metadata, page number, and text like 'Displaying 1 - 5 of 15 results'.
3. Keep only table-related text.
4. Keep row content in reading order.
5. Preserve POM codes when visible, such as B21, F18, J14, F47, F26, F28, D3.1, F55, F52, D3.2.
6. Preserve size headers when visible, including bra sizes such as 32B, 34B, 36B, 38B, 40B, 32C, 34C, 36C, 38C, 40C, 32D, 34D, 36D, 38D, 40D, 32DD, 34DD, 36DD, 38DD, 40DD.
7. Do not explain anything.
8. Output raw table text only.`;

    const body = {
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: 'You are a precise OCR reader. Output plain raw text only. No markdown, no JSON, no explanation.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
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
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || 'Perplexity API request failed', raw: data }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawText = String(data?.choices?.[0]?.message?.content || '').replace(/```[\s\S]*?```/g, '').trim();

    const knownSizes = ['32B','34B','36B','38B','40B','32C','34C','36C','38C','40C','32D','34D','36D','38D','40D','32DD','34DD','36DD','38DD','40DD','XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL'];
    const rowRegex = /\b([BDFJ]\d+(?:\.\d+)?)\b/g;
    const positions = [...rawText.matchAll(rowRegex)].map(m => ({ idx: m.index, pom: m[1] }));

    const chunks = [];
    if (positions.length) {
      for (let i = 0; i < positions.length; i++) {
        const start = positions[i].idx;
        const end = i + 1 < positions.length ? positions[i + 1].idx : rawText.length;
        const part = rawText.slice(start, end).replace(/\s+/g, ' ').trim();
        if (part) chunks.push(part);
      }
    }

    function parseChunk(chunk) {
      const pom = (chunk.match(/^([BDFJ]\d+(?:\.\d+)?)/i) || [])[1];
      if (!pom) return null;

      const sizeMatches = [...chunk.matchAll(/\b(32B|34B|36B|38B|40B|32C|34C|36C|38C|40C|32D|34D|36D|38D|40D|32DD|34DD|36DD|38DD|40DD|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL)\b/gi)].map(m => m[1].toUpperCase());
      const numMatches = [...chunk.matchAll(/-?\d+(?:\.\d+)?(?:\/\d+)?/g)].map(m => m[0]);

      let description = chunk.replace(pom, '').trim();
      const firstSizeIdx = description.search(/\b(32B|34B|36B|38B|40B|32C|34C|36C|38C|40C|32D|34D|36D|38D|40D|32DD|34DD|36DD|38DD|40DD|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL)\b/i);
      if (firstSizeIdx > 0) description = description.slice(0, firstSizeIdx).trim();
      else {
        const firstNumIdx = description.search(/-?\d+(?:\.\d+)?(?:\/\d+)?/);
        if (firstNumIdx > 0) description = description.slice(0, firstNumIdx).trim();
      }

      const filteredNums = numMatches.filter(v => v.toUpperCase() !== pom.toUpperCase());
      const size_values = {};
      if (sizeMatches.length) {
        sizeMatches.forEach((size, i) => {
          if (filteredNums[i] !== undefined) size_values[size] = filteredNums[i];
        });
      }

      if (!Object.keys(size_values).length) return null;
      return {
        pom_name: pom.toUpperCase(),
        description: description || pom.toUpperCase(),
        size_values
      };
    }

    const rows = chunks.map(parseChunk).filter(Boolean);

    return new Response(JSON.stringify({
      ok: true,
      side,
      page,
      result: { rows },
      debug: {
        raw_text: rawText,
        raw_length: rawText.length,
        chunk_count: chunks.length,
        row_count: rows.length
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
