/**
 * Path: src/services/mockProvider.js
 * Purpose: 集中所有 schema 對應的合法 dummy artifact。
 *          給 LLM_PROVIDER=mock 跑 npm test、CI、離線 demo 用；
 *          也是 llmClient 在真實 provider 全部 retry 失敗後的最後 fallback。
 * Depends on:
 *   - src/schemas/index.js (SCHEMA_NAMES) — 維持 schema name 常數同步
 *   - src/utils/logger.js
 *
 * 新增規則：
 *   - 新增一個 schema → 必須同步在這裡補一份 dummy
 *   - dummy 必須通過 schemaValidator.validate(name, dummy) — 在 sample-run.test.js 強制驗
 *   - 文字內容必須繁中（HK）+ 製衣業專業詞，避免 demo 時顯得空洞
 */

import { SCHEMA_NAMES } from '../schemas/index.js';
import { logger } from '../utils/logger.js';

/**
 * 建立指定 schema 的合法 dummy。未知 schema 回 generic stub。
 * @param {string} schemaName
 * @param {Array} [messages]  原 messages（給 generic stub echo 用）
 * @returns {object | null}
 */
export function buildMockArtifact(schemaName, messages = []) {
  const now = new Date().toISOString();

  switch (schemaName) {
    case SCHEMA_NAMES.MEASUREMENT_CHANGE:
      return {
        pom_name: 'Chest Width',
        pom_code: 'F18',
        description: 'Measure across chest 1 inch below armhole',
        size_label: 'M',
        old_value: 50,
        new_value: 51.5,
        diff_value: 1.5,
        unit: 'CM',
        status: 'CHANGED',
        tolerance_exceeded: true,
        confidence: 0.9,
        source_page_old: 5,
        source_page_new: 5
      };

    case SCHEMA_NAMES.COMMENT_ARTIFACT:
      return {
        comment_id: 'c_mock_001',
        source: 'BUYER_COMMENT',
        page_old: null,
        page_new: null,
        comment_text: '（Mock）此為示範資料，請確認新版尺寸是否已套用最新買家要求。',
        related_pom: 'Chest Width',
        severity: 'MINOR',
        language_detected: 'zh-HK',
        requires_human_review: false,
        confidence: 0.8
      };

    case SCHEMA_NAMES.IMAGE_ARTIFACT:
      return {
        image_id: 'img_mock_001',
        page_old: 7,
        page_new: 7,
        region: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
        change_type: 'STYLE',
        before_desc: '（Mock）原版領口為圓領設計。',
        after_desc: '（Mock）新版領口改為 V 領，深度加深約 2cm。',
        diff_summary: '（Mock）領口由圓領改為 V 領。',
        confidence: 0.85,
        near_size_table: true
      };

    case SCHEMA_NAMES.BOM_ARTIFACT:
      return {
        bom_item_id: 'bom_mock_001',
        material_code: 'FAB-CTN-001',
        material_type: 'FABRIC',
        description: '主布 100% Cotton Jersey 180gsm',
        color: 'Navy',
        size_or_spec: '180gsm',
        supplier: 'Luen Thai Textiles',
        old_qty: 1.2,
        new_qty: 1.35,
        diff_qty: 0.15,
        unit: 'YD',
        status: 'CHANGED',
        impact: 'COST',
        severity: 'MAJOR',
        related_pom: 'Body Length',
        source_page_old: 9,
        source_page_new: 9,
        confidence: 0.88,
        notes: '（Mock）主布用量增加 12.5%，建議向採購重新確認單價及最低訂量。'
      };

    case SCHEMA_NAMES.SUMMARY_ARTIFACT:
      return {
        total_changes: 4,
        total_measurement_changes: 1,
        total_comment_items: 1,
        total_image_changes: 1,
        total_bom_changes: 1,
        bullet_points: [
          '（Mock）Chest Width M 碼由 50cm 加大至 51.5cm，已超容差。',
          '（Mock）領口由圓領改為 V 領，深度加深 2cm。',
          '（Mock）主布用量由 1.2 YD 增至 1.35 YD（+12.5%）。',
          '（Mock）買家要求確認新版尺寸已套用最新要求。'
        ],
        cost_risk_items: [
          '（Mock）主布用量 +12.5%，預估物料成本上升約 12%。'
        ],
        production_risk_items: [
          '（Mock）Chest Width 超容差，需 Tech 重新放碼。'
        ],
        decisions: [{
          title: '確認尺寸放碼',
          detail: '建議 Tech 部門依新尺寸重新放碼後再 sample。',
          impacted_poms: ['Chest Width']
        }],
        action_items: [{
          title: '安排新 sample',
          owner: 'Sales',
          due_date: null,
          priority: 'HIGH'
        }],
        follow_up_email:
          '（Mock）你好，已收悉最新 Tech Pack。我們會按新尺寸與新主布用量重新打版，預計三日內回 sample 並更新 BOM 至 PDM。如有任何疑問請隨時告知。',
        generated_at: now
      };

    case SCHEMA_NAMES.QA_REVIEW:
      return {
        status: 'PASS',
        hallucination_risk: 'LOW',
        issues: [],
        artifact_completeness: {
          measurement: true,
          comment: true,
          image: true,
          bom: true,
          summary: true
        },
        reviewed_at: now
      };

    case SCHEMA_NAMES.WORKFLOW_RESULT:
      // 不應由 LLM 產生；coordinator 自己組裝
      return null;

    default:
      logger.warn('mockProvider.unknownSchema', { schemaName });
      return {
        _mock: true,
        msg: `mockProvider 未知 schema: ${schemaName}`,
        echoed_messages_count: Array.isArray(messages) ? messages.length : 0
      };
  }
}

export default { buildMockArtifact };
