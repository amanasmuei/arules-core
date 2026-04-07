// ── Ruleset record + parser + helpers ────────────────────────────────────────
export {
  type Ruleset,
  type RuleCategory,
  type ParsedRule,
  type FullRuleCategory,
  parseRules,
  parseRulesetFull,
  getCategoryRules,
  listCategories,
  addRuleToCategory,
  removeRuleFromCategory,
  toggleRule,
} from "./ruleset.js";

// ── Default template ─────────────────────────────────────────────────────────
export { defaultRulesetTemplate } from "./default-template.js";

// ── Enforcement (pure functions) ─────────────────────────────────────────────
export {
  type CheckActionResult,
  checkAction as checkActionPure,
  checkToolCall as checkToolCallPure,
  getGuardrailsPrompt as getGuardrailsPromptPure,
  DEFAULT_PROMPT_CATEGORIES,
} from "./enforce.js";

// ── Storage routing ──────────────────────────────────────────────────────────
export {
  getArulesHome,
  getMarkdownStorage,
  getDatabaseStorage,
  getStorageForScope,
  _resetStorageCache,
} from "./storage.js";

// ── Public API (scope-aware, async, the main surface) ───────────────────────
export {
  // read
  getRuleset,
  getOrCreateRuleset,
  listRuleCategories,
  listRuleCategoriesFull,
  getCategoryRules as getCategoryRulesForScope,
  listCategoryNames,
  // write
  putRuleset,
  addRule,
  removeRule,
  toggleRuleAt,
  deleteRuleset,
  // enforcement
  checkAction,
  checkToolCall,
  getGuardrailsPrompt,
  // admin
  listRulesetScopes,
} from "./api.js";

// ── Migration ────────────────────────────────────────────────────────────────
export {
  type ArulesMigrationReport,
  migrateLegacyArulesFile,
} from "./migrate.js";
