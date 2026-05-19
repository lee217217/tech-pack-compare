/**
 * Path: src/schemas/index.js
 * Purpose: 集中匯出所有 JSON Schema + schema name 常數。
 *          schemaValidator.js 啟動時會 import 此檔，把全部 schema 預載入 AJV
 *          避免每次 validate 都要重新 compile（compile 是貴的）
 * Depends on: ./*.schema.json
 *
 * 新增 schema 步驟：
 *   1. 在這個資料夾建立 <name>.schema.json，定義 $id
 *   2. 在這個檔案 import 並加入 SCHEMAS 陣列
 *   3. 在 SCHEMA_NAMES 加常數 key，agent / service 統一用這個常數，不要寫 string literal
 */

import measurementChange from './measurementChange.schema.json' with { type: 'json' };
import commentArtifact   from './commentArtifact.schema.json'   with { type: 'json' };
import imageArtifact     from './imageArtifact.schema.json'     with { type: 'json' };
import bomArtifact       from './bomArtifact.schema.json'       with { type: 'json' };
import summaryArtifact   from './summaryArtifact.schema.json'   with { type: 'json' };
import qaReview          from './qaReview.schema.json'          with { type: 'json' };
import workflowResult    from './workflowResult.schema.json'    with { type: 'json' };

/**
 * Schema 名稱常數（給 agent / validator 引用，避免拼錯字串）
 */
export const SCHEMA_NAMES = Object.freeze({
  MEASUREMENT_CHANGE: 'measurementChange',
  COMMENT_ARTIFACT:   'commentArtifact',
  IMAGE_ARTIFACT:     'imageArtifact',
  BOM_ARTIFACT:       'bomArtifact',
  SUMMARY_ARTIFACT:   'summaryArtifact',
  QA_REVIEW:          'qaReview',
  WORKFLOW_RESULT:    'workflowResult'
});

/**
 * 全部 schema 的對應表（name → schema JSON）
 */
export const SCHEMAS = Object.freeze({
  [SCHEMA_NAMES.MEASUREMENT_CHANGE]: measurementChange,
  [SCHEMA_NAMES.COMMENT_ARTIFACT]:   commentArtifact,
  [SCHEMA_NAMES.IMAGE_ARTIFACT]:     imageArtifact,
  [SCHEMA_NAMES.BOM_ARTIFACT]:       bomArtifact,
  [SCHEMA_NAMES.SUMMARY_ARTIFACT]:   summaryArtifact,
  [SCHEMA_NAMES.QA_REVIEW]:          qaReview,
  [SCHEMA_NAMES.WORKFLOW_RESULT]:    workflowResult
});

/**
 * Schema $id 對應表（給 AJV addSchema 用，因 workflowResult 內部用 $ref 連到其他 schema）
 */
export const SCHEMA_IDS = Object.freeze({
  [SCHEMA_NAMES.MEASUREMENT_CHANGE]: measurementChange.$id,
  [SCHEMA_NAMES.COMMENT_ARTIFACT]:   commentArtifact.$id,
  [SCHEMA_NAMES.IMAGE_ARTIFACT]:     imageArtifact.$id,
  [SCHEMA_NAMES.BOM_ARTIFACT]:       bomArtifact.$id,
  [SCHEMA_NAMES.SUMMARY_ARTIFACT]:   summaryArtifact.$id,
  [SCHEMA_NAMES.QA_REVIEW]:          qaReview.$id,
  [SCHEMA_NAMES.WORKFLOW_RESULT]:    workflowResult.$id
});

/**
 * 給 Perplexity / OpenAI 的 response_format.json_schema 用
 * 把純 JSON Schema 轉成 LLM 廠商需要的格式（包一層 name + schema + strict）
 * 注意：Perplexity 不接受 $ref 跨 schema，所以 workflowResult 不會用這個 helper
 *       agent 通常只用單一 artifact schema 作為 LLM response_format
 * @param {string} name SCHEMA_NAMES 中的 key
 * @returns {{ type: 'json_schema', json_schema: { name: string, strict: true, schema: object } } | null}
 */
export function asResponseFormat(name) {
  const schema = SCHEMAS[name];
  if (!schema) return null;
  // 製作一個 inline 版（移除 $id / $schema，避免某些 provider 嫌棄）
  const inline = { ...schema };
  delete inline.$id;
  delete inline.$schema;
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema: inline
    }
  };
}

export default { SCHEMA_NAMES, SCHEMAS, SCHEMA_IDS, asResponseFormat };
