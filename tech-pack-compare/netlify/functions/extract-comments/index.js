export default async (request) => {
  try {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json();
    const comments = String(body.comments || '');
    const items = comments
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        id: index + 1,
        type: /confirm|check|verify/i.test(line) ? 'to_confirm' : 'change_request',
        text: line
      }));

    return Response.json({
      ok: true,
      count: items.length,
      items
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Comment extraction failed' }, { status: 500 });
  }
};
