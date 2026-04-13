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
  if (/fabric|lining|trim|button|zipper|label|hangtag|packaging|polybag|bom|care|wash/.test(t)) return 'BOM / Labels / Packing';
  if (/stitch|seam|construction|topstitch|reinforcement|finish/.test(t)) return 'Construction Notes';
  if (/sketch|artwork|print|graphic|colorway|style/.test(t)) return 'Artwork / Colorway';
  return 'General';
}

function inferImpact(text = '') {
  const t = text.toLowerCase();
  if (/neck|chest|waist|hip|sleeve|length|width|measure|pom|spec|fabric|label|care|wash/.test(t)) return 'high';
  if (/stitch|construction|trim|pack|polybag|finish|note|graphic|artwork/.test(t)) return 'medium';
  return 'low';
}

function splitCommentLines(comments = '') {
  return String(comments || '')
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildFallbackDiff(textA, textB, comments = '') {
  const linesA = toLines(textA);
  const linesB = toLines(textB);
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const removed = linesA.filter(line => !setB.has(line)).slice(0, 10);
  const added = linesB.filter(line => !setA.has(line)).slice(0, 10);
  const differences = [];
  const max = Math.max(removed.length, added.length);

  for (let i = 0; i < max; i++) {
    const before = removed[i] || '';
    const after = added[i] || '';
    const combined = `${before} ${after}`.trim();
    differences.push({
      section: inferSection(combined),
      before: before || '(not found in A after normalization)',
      after: after || '(not found in B after normalization)',
      impact: inferImpact(combined)
    });
  }

  const buyerComments = splitCommentLines(comments);
  const actionItems = buyerComments.length
    ? buyerComments.map(line => `Follow up buyer comment: ${line}`)
    : differences.slice(0, 5).map(item => `Review ${item.section}: confirm whether the latest version should replace the previous requirement.`);

  const highCount = differences.filter(d => d.impact === 'high').length;

  return {
    mode: 'fallback_basic_diff',
    result: {
      summary: {
        overview: differences.length
          ? `${differences.length} difference item(s) were found from the extracted PDF text between Tech Pack A and B.`
          : 'No clear line-level difference was found from extracted text. Please review image pages and buyer comments as a secondary check.',
        risk_level: highCount >= 2 ? 'high' : highCount === 1 ? 'medium' : 'low'
      },
      differences,
      buyer_comments: buyerComments,
      action_items: actionItems
    }
  };
}

function sanitizeCompareResult(parsed, textA, textB, comments) {
  const fallback = buildFallbackDiff(textA, textB, comments);
  const result = parsed?.result || parsed || {};
  const summary = result.summary || {};
  const differences = Array.isArray(result.differences) ? result.differences.filter(Boolean) : [];
  const buyerComments = Array.isArray(result.buyer_comments) ? result.buyer_comments.filter(Boolean) : splitCommentLines(comments);
  const actionItems = Array.isArray(result.action_items) ? result.action_items.filter(Boolean) : [];

  return {
    mode: parsed?.mode || 'perplexity_text_compare',
    result: {
      summary: {
        overview: summary.overview || fallback.result.summary.overview,
        risk_level: summary.risk_level || fallback.result.summary.risk_level
      },
      differences: differences.length ? differences : fallback.result.differences,
      buyer_comments: buyerComments.length ? buyerComments : fallback.result.buyer_comments,
      action_items: actionItems.length ? actionItems : fallback.result.action_items
    }
  };
}

async function callPerplexity({ textA, textB, comments }) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('Missing PERPLEXITY_API_KEY');

  const systemPrompt = 'You compare apparel tech pack revisions and return JSON only.';
  const userPrompt = `You are a professional garment merchandising and tech pack comparison assistant.
Your audience is apparel factory Sales and Merchandisers.
Focus on production-relevant and follow-up-relevant differences only.

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
- Use empty arrays only if truly nothing useful is found.

Tech Pack A:
${String(textA || '').slice(0, 18000)}

Tech Pack B:
${String(textB || '').slice(0, 18000)}

Buyer Comments:
${String(comments || '').slice(0, 6000)}`;

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
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || 'Text compare request failed');
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty compare response');
  const parsed = safeJsonParse(content);
  if (!parsed) throw new Error('Compare response was not valid JSON');
  return sanitizeCompareResult(parsed, textA, textB, comments);
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
      const result = await callPerplexity({ textA, textB, comments });
      return Response.json({ ok: true, ...result });
    } catch (error) {
      return Response.json({ ok: true, warning: error.message, ...buildFallbackDiff(textA, textB, comments) });
    }
  } catch (error) {
    return Response.json({ error: error.message || 'Compare failed' }, { status: 500 });
  }
};
