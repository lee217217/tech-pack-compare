function normalizeLine(line) {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

function toLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map(normalizeLine)
    .filter(line => line.length >= 3);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function inferSection(text = '') {
  const t = text.toLowerCase();
  if (/neck|chest|waist|hip|sleeve|length|width|measure|pom|spec/.test(t)) return 'Measurement Specs';
  if (/fabric|lining|trim|button|zipper|label|hangtag|packaging|polybag|bom/.test(t)) return 'BOM / Labels / Packing';
  if (/stitch|seam|construction|topstitch|reinforcement|finish/.test(t)) return 'Construction Notes';
  if (/sketch|artwork|print|graphic|colorway/.test(t)) return 'Artwork / Style Info';
  return 'General';
}

function inferImpact(text = '') {
  const t = text.toLowerCase();
  if (/neck|chest|waist|hip|sleeve|length|width|measure|pom|spec|fabric|label|care|wash/.test(t)) return 'high';
  if (/stitch|construction|trim|pack|polybag|finish|note/.test(t)) return 'medium';
  return 'low';
}

function buildFallbackDiff(textA, textB, comments = '') {
  const linesA = toLines(textA);
  const linesB = toLines(textB);
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const removed = linesA.filter(line => !setB.has(line)).slice(0, 8);
  const added = linesB.filter(line => !setA.has(line)).slice(0, 8);
  const differences = [];
  const max = Math.max(removed.length, added.length);

  for (let i = 0; i < max; i++) {
    const before = removed[i] || '';
    const after = added[i] || '';
    const combined = `${before} ${after}`.trim();
    differences.push({
      section: inferSection(combined),
      before,
      after,
      impact: inferImpact(combined)
    });
  }

  const buyerComments = String(comments || '')
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, 8);

  const actionItems = buyerComments.length
    ? buyerComments.map(line => `Follow up: ${line}`)
    : differences.slice(0, 5).map(item => `Review ${item.section}: compare updated requirement with previous version.`);

  const highCount = differences.filter(d => d.impact === 'high').length;

  return {
    mode: 'fallback_basic_diff',
    result: {
      summary: {
        overview: `${differences.length} basic difference item(s) found between Tech Pack A and B.`,
        risk_level: highCount >= 2 ? 'high' : highCount === 1 ? 'medium' : 'low'
      },
      differences,
      buyer_comments: buyerComments,
      action_items: actionItems
    }
  };
}

async function callPerplexity({ textA, textB, comments }) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('Missing PERPLEXITY_API_KEY');

  const prompt = `You are a professional garment merchandising and tech pack comparison assistant.
Your audience is apparel factory Sales and Merchandisers.
Focus on production-relevant and follow-up-relevant differences only.

A good fashion tech pack commonly includes BOM, measurement specs, labels, packaging, construction notes, sketches, and style details, so compare with those areas in mind. Also, merchandisers rely on strong follow-up to control deadlines, sample progress, approvals, and buyer communication. [web:126][web:127][web:128][web:129][web:134]

Task:
1. Compare Tech Pack A and Tech Pack B.
2. Identify the most important differences only.
3. Classify each difference into a practical section for apparel teams.
4. Review buyer comments if provided.
5. Return follow-up actions that Sales / Merchandisers should do next.

Return strict JSON only, with this exact shape:
{
  "summary": {
    "overview": "string",
    "risk_level": "high|medium|low"
  },
  "differences": [
    {
      "section": "Style Info|Measurement Specs|BOM / Labels / Packing|Construction Notes|Artwork / Colorway|General",
      "before": "string",
      "after": "string",
      "impact": "high|medium|low"
    }
  ],
  "buyer_comments": ["string"],
  "action_items": ["string"]
}

Rules:
- Be concise and practical.
- Prefer differences that affect sample development, fit, labeling, packing, costing, or buyer approval.
- Ignore noise and repeated boilerplate where possible.
- Use empty arrays if nothing is found.

Tech Pack A:
${textA.slice(0, 18000)}

Tech Pack B:
${textB.slice(0, 18000)}

Buyer Comments:
${(comments || '').slice(0, 6000)}`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You compare apparel tech pack revisions and return JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || 'Perplexity API request failed');

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response from Perplexity');

  const parsed = safeJsonParse(content);
  if (!parsed) {
    throw new Error('Perplexity response was not valid JSON');
  }

  return {
    mode: 'perplexity_api',
    model: data.model,
    usage: data.usage || null,
    result: parsed,
    raw: content
  };
}

export default async (request) => {
  try {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json();
    const textA = String(body.textA || '');
    const textB = String(body.textB || '');
    const comments = String(body.comments || '');

    if (!textA || !textB) {
      return Response.json({ error: 'textA and textB are required' }, { status: 400 });
    }

    try {
      const aiResult = await callPerplexity({ textA, textB, comments });
      return Response.json({ ok: true, ...aiResult });
    } catch (apiError) {
      const fallback = buildFallbackDiff(textA, textB, comments);
      return Response.json({ ok: true, warning: apiError.message, ...fallback });
    }
  } catch (error) {
    return Response.json({ error: error.message || 'Compare failed' }, { status: 500 });
  }
};
