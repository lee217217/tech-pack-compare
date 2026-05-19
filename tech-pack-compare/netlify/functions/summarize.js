/**
 * Path: netlify/functions/summarize.js
 * Purpose: 單跑 summarizerAgent。Body 需提供 measurement_changes / comment_changes /
 *          image_changes / bom_changes 四個 array（缺者視為空）。
 * Depends on:
 *   - netlify/functions/_lib/workflowService.js
 *   - src/agents/summarizerAgent.js
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）
 */

import { handleRequest, okResponse, errorResponse } from './_lib/workflowService.js';
import { runSummarizerAgent } from '../../src/agents/summarizerAgent.js';

export async function handler(event, context) {
  return handleRequest(
    { event, context, fnName: 'summarize' },
    { methods: ['POST'], requireAuth: true, rateLimit: true, parseBody: true },
    async ({ body, requestId, log }) => {
      const start = Date.now();
      const input = {
        measurement_changes: Array.isArray(body.measurement_changes) ? body.measurement_changes : [],
        comment_changes: Array.isArray(body.comment_changes) ? body.comment_changes : [],
        image_changes: Array.isArray(body.image_changes) ? body.image_changes : [],
        bom_changes: Array.isArray(body.bom_changes) ? body.bom_changes : []
      };
      const result = await runSummarizerAgent({ input, requestId });
      if (!result.ok) {
        return errorResponse('SUMMARIZER_FAILED', result.error || '報告整合失敗', 500, null, {
          warnings: result.warnings
        });
      }
      log.info('summarize.done', { total: result.data?.total_changes });
      return okResponse(result.data, {
        duration_ms: Date.now() - start,
        warnings: result.warnings || [],
        model_used: 'sonar-pro'
      });
    }
  );
}
