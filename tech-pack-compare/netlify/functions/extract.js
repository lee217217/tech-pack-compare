/**
 * Path: netlify/functions/extract.js
 * Purpose: 單跑 extractorAgent（debug / 前端 step-by-step UI）。
 * Depends on:
 *   - netlify/functions/_lib/workflowService.js
 *   - src/agents/extractorAgent.js
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）
 */

import { handleRequest, okResponse, errorResponse } from './_lib/workflowService.js';
import { runExtractorAgent } from '../../src/agents/extractorAgent.js';

export async function handler(event, context) {
  return handleRequest(
    { event, context, fnName: 'extract' },
    { methods: ['POST'], requireAuth: true, rateLimit: true, parseBody: true },
    async ({ body, requestId, log }) => {
      const start = Date.now();
      const result = await runExtractorAgent({
        input: {
          techPackA: body.techPackA || body.techpack_a || {},
          techPackB: body.techPackB || body.techpack_b || {},
          buyerComments: body.buyerComments || body.buyer_comments || ''
        },
        requestId
      });
      if (!result.ok) {
        return errorResponse('EXTRACTOR_FAILED', result.error || '提取失敗', 500, null, {
          warnings: result.warnings
        });
      }
      log.info('extract.done', { warnings: result.warnings?.length });
      return okResponse(result.data, {
        duration_ms: Date.now() - start,
        warnings: result.warnings || [],
        model_used: 'none (deterministic)'
      });
    }
  );
}
