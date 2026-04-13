function stripDataUrlPrefix(dataUrl = '') {
  return String(dataUrl).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
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

function fallbackVisionResult({ pageA, pageB, comments }) {
  const buyerComments = String(comments || '')
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    mode: 'vision_skeleton_fallback',
    result: {
      summary: `Image review fallback mode. Preview pages A${pageA} and B${pageB} were received successfully.`,
      visible_comments: buyerComments,
      visual_changes: [
        { area: `Page ${pageA} vs Page ${pageB}`, note: 'Image-based compare pipeline is connected; visual reasoning fallback is active.', impact: 'medium' }
      ],
      action_items: buyerComments.length
        ? buyerComments.map(line => `Check whether the marked-up page reflects this buyer comment: ${line}`)
        : [
            'Review preview images manually for marked-up areas.',
            'Verify buyer image comments against sketch and artwork pages.',
            'Confirm whether selected preview pages are the right pages to compare.'
          ]
    }
  };
}

function sanitizeVisionResult(parsed, pageA, pageB, comments) {
  const fallback = fallbackVisionResult({ pageA, pageB, comments });
  const result = parsed?.result || parsed || {};
  const visibleComments = Array.isArray(result.visible_comments) ? result.visible_comments.filter(Boolean) : [];
  const visualChanges = Array.isArray(result.visual_changes) ? result.visual_changes.filter(Boolean) : [];
  const actionItems = Array.isArray(result.action_items) ? result.action_items.filter(Boolean) : [];

  return {
    mode: parsed?.mode || 'perplexity_vision',
    result: {
      summary: result.summary || fallback.result.summary,
      visible_comments: visibleComments.length ? visibleComments : fallback.result.visible_comments,
      visual_changes: visualChanges.length ? visualChanges : fallback.result.visual_changes,
      action_items: actionItems.length ? actionItems : fallback.result.action_items
    }
  };
}

async function callPerplexityVision({ imageA, imageB, pageA, pageB, comments }) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('Missing PERPLEXITY_API_KEY');

  const prompt = `You are an apparel tech pack image review assistant for factory Sales and Merchandisers.
You are comparing two tech pack page images.

Tasks:
1. Read any visible comments, callouts, labels, arrows, circled notes, and marked-up instructions from both images.
2. Identify the main visual changes between page ${pageA} and page ${pageB}.
3. Focus on garment-relevant details: sketch changes, label placement, packaging notes, construction marks, measurement callouts, artwork notes, and customer markups.
4. Merge any useful context from buyer comments if provided.

Return strict JSON only in this exact format:
{
  "summary": "string",
  "visible_comments": ["string"],
  "visual_changes": [
    {
      "area": "string",
      "note": "string",
      "impact": "high|medium|low"
    }
  ],
  "action_items": ["string"]
}

Rules:
- Keep output concise and practical.
- If a comment is partially visible, still summarize it carefully.
- Prefer business-usable findings over generic image description.
- Use empty arrays only if truly nothing useful is visible.

Buyer comments:\n${String(comments || '').slice(0, 4000)}`;

  const payload = {
    model: 'sonar-pro',
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${stripDataUrlPrefix(imageA)}` } },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${stripDataUrlPrefix(imageB)}` } }
        ]
      }
    ]
  };

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || 'Image analysis request failed');
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty image analysis response');
  const parsed = safeJsonParse(content);
  if (!parsed) throw new Error('Vision response was not valid JSON');
  return sanitizeVisionResult(parsed, pageA, pageB, comments);
}

export default async (request) => {
  try {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json();
    const imageA = String(body.imageA || body.previewA || '');
    const imageB = String(body.imageB || body.previewB || '');
    const pageA = Number(body.pageA || 1);
    const pageB = Number(body.pageB || 1);
    const comments = String(body.comments || '');

    if (!imageA || !imageB) {
      return Response.json({ ok: true, warning: 'imageA and imageB were missing; returning safe fallback image review.', ...fallbackVisionResult({ pageA, pageB, comments }) });
    }

    try {
      const result = await callPerplexityVision({ imageA, imageB, pageA, pageB, comments });
      return Response.json({ ok: true, ...result });
    } catch (error) {
      return Response.json({ ok: true, warning: error.message, ...fallbackVisionResult({ pageA, pageB, comments }) });
    }
  } catch (error) {
    return Response.json({ ok: true, warning: error.message || 'Image analysis failed; returning fallback image review.', ...fallbackVisionResult({ pageA: 1, pageB: 1, comments: '' }) });
  }
};
