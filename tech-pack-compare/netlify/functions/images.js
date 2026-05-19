/**
 * Path: netlify/functions/images.js
 * Purpose: 單跑 imageAgent（model_tier: medium → sonar-pro，prompt 描述版，見 KI-007）。
 * Depends on:
 *   - netlify/functions/_lib/workflowService.js
 *   - src/agents/extractorAgent.js
 *   - src/agents/imageAgent.js
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）— Sonar Pro 不支援 vision，使用 prompt 描述版
 */

import { handleRequest, okResponse, errorResponse } from './_lib/workflowService.js';
import { runExtractorAgent } from '../../src/agents/extractorAgent.js';
import { runImageAgent } from '../../src/agents/imageAgent.js';

export async function handler(event, context) {
  return handleRequest(
    { event, context, fnName: 'images' },
    { methods: ['POST'], requireAuth: true, rateLimit: true, parseBody: true },
    async ({ body, requestId, log }) => {
      const start = Date.now();
      let extracted = body.extracted;
      const warnings = [];

      if (!extracted) {
        const exRes = await runExtractorAgent({
          input: {
            techPackA: body.techPackA || body.techpack_a || {},
            techPackB: body.techPackB || body.techpack_b || {},
            buyerComments: body.buyerComments || body.buyer_comments || ''
          },
          requestId
        });
        if (!exRes.ok) return errorResponse('EXTRACTOR_FAILED', exRes.error || '提取失敗', 500);
        extracted = exRes.data;
        warnings.push(...(exRes.warnings || []));
      }

      const result = await runImageAgent({ input: extracted, requestId });
      warnings.push(...(result.warnings || []));
      if (!result.ok) {
        return errorResponse('IMAGE_FAILED', result.error || '圖像差異分析失敗', 500, null, { warnings });
      }
      log.info('images.done', { count: result.data.length });
      return okResponse(
        { items: result.data, count: result.data.length },
        { duration_ms: Date.now() - start, warnings, model_used: 'sonar-pro (prompt-only)' }
      );
    }
  );
}
