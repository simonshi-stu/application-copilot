// 公开入口：受控 Moka 浏览器适配层。
// 依赖 Node 内置模块，不新增 npm 依赖；创建驱动时不启动浏览器，openCompany 才 spawn。

export { createMokaBrowserDriver } from './driver.js';
export {
  MOKA_DRIVER_LIMITATIONS,
  MOKA_FILL_RESULT_NOTE,
  MOKA_RESEARCH_LIMITS,
  limitationsForFill,
  limitationsForResearch,
} from './limitations.js';
export {
  MOKA_FILL_PLAN_SCHEMA_VERSION,
  MOKA_REGION_TYPES,
  MOKA_PLAN_TOP_KEYS,
  MOKA_PLAN_ITEM_KEYS,
  MOKA_FORBIDDEN_PLAN_KEYS,
  validateMokaFillPlan,
  normalizePlanText,
} from './fill-plan.js';
export {
  MOKA_FACT_KEYS,
  MOKA_FACT_LABELS,
  normalizeFieldLabel,
  suggestMokaFieldMappings,
} from './field-semantics.js';
export {
  MOKA_HOST,
  MOKA_URL_SCHEMA_VERSION,
  MokaUrlError,
  approvedMokaHref,
  describeMokaPolicy,
  isApprovedMokaOrigin,
  isApprovedMokaUrl,
  normalizeNewlines,
  parseApprovedMokaUrl,
} from './url-policy.js';
export { OBSERVATION_SCHEMA_VERSION } from './observation.js';
export {
  BROWSER_NAMES,
  BrowserLaunchError,
  resolveInstalledBrowser,
} from './chrome.js';
