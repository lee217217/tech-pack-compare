/**
 * Path: netlify/functions/run-workflow.js
 * Purpose: 完整 multi-agent workflow endpoint。
 *          直接呼 coordinatorAgent.runCoordinatorAgent()，回完整 workflowResult envelope。
 * Depends on:
 *   - netlify/functions/_lib/workflowService.js
 *   - src/agents/coordinatorAgent.js
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）— Sonar Pro lock
 */

import { handleRequest } from './_lib/workflowService.js';
import { runCoordinatorAgent, normalizeOutputMode } from '../../src/agents/coordinatorAgent.js';

export async function handler(event, context) {
  return handleRequest(
    { event, context, fnName: 'run-workflow' },
    { methods: ['POST'], requireAuth: true, rateLimit: true, parseBody: true },
    async ({ body, requestId, log, debugAllowed }) => {
      const outputMode = normalizeOutputMode(body.outputMode || body.output_mode || 'FULL');
      log.info('workflow.start', { outputMode, debugAllowed });

      const envelope = await runCoordinatorAgent({
        outputMode,
        input: {
          techPackA: body.techPackA || body.techpack_a || {},
          techPackB: body.techPackB || body.techpack_b || {},
          buyerComments: body.buyerComments || body.buyer_comments || ''
        },
        context: { debugAllowed },
        requestId
      });

      // coordinator 已產生完整 workflowResult envelope（含 success/data/error/meta）。
      // 加上 provider/model_used 提示（meta.provider 已有，這裡加 model_used）
      if (envelope?.meta) {
        envelope.meta.model_used = inferModelUsed(outputMode);
      }

      const statusCode = envelope.success ? 200 : 500;
      return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        body: JSON.stringify(envelope)
      };
    }
  );
}

function inferModelUsed(mode) {
  // measurement / bom 走 high tier (sonar-pro)；summarizer/comment/image 走 medium (sonar-pro)；
  // 結論：FULL/MEASUREMENT_ONLY/BOM_ONLY/DEBUG_ALL 主要靠 sonar-pro。
  return 'sonar-pro';
}
