/**
 * Path: netlify/functions/measurement.js
 * Purpose: 單跑 measurementAgent（model_tier: high → sonar-pro temp 0）。
 *          body 接受兩種：
 *            (a) { extracted: ExtractedPackage }  — 已 extract 過
 *            (b) { techPackA, techPackB, buyerComments } — 自動先跑 extractor
 * Depends on:
 *   - netlify/functions/_lib/workflowService.js
 *   - src/agents/extractorAgent.js
 *   - src/agents/measurementAgent.js
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）
 */

import { handleRequest, okResponse, errorResponse } from './_lib/workflowService.js';
import { runExtractorAgent } from '../../src/agents/extractorAgent.js';
import { runMeasurementAgent } from '../../src/agents/measurementAgent.js';

export async function handler(event, context) {
  return handleRequest(
    { event, context, fnName: 'measurement' },
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
        if (!exRes.ok) {
          return errorResponse('EXTRACTOR_FAILED', exRes.error || '提取失敗', 500);
        }
        extracted = exRes.data;
        warnings.push(...(exRes.warnings || []));
      }

      const result = await runMeasurementAgent({ input: extracted, requestId });
      warnings.push(...(result.warnings || []));
      if (!result.ok) {
        return errorResponse('MEASUREMENT_FAILED', result.error || '尺寸比對失敗', 500, null, { warnings });
      }

      log.info('measurement.done', { count: result.data.length });
      return okResponse(
        { items: result.data, count: result.data.length },
        { duration_ms: Date.now() - start, warnings, model_used: 'sonar-pro' }
      );
    }
  );
}
