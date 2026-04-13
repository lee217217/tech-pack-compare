export default async () => {
  return Response.json({
    ok: true,
    service: 'techpack-compare-functions',
    timestamp: new Date().toISOString(),
    endpoints: [
      'compare-techpacks',
      'analyze-techpack-images',
      'extract-comments',
      'health'
    ]
  });
};
