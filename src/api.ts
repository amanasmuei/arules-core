import { getCurrentScopeOr, type Scope } from "@aman_asmuei/aman-core";
import {
  type Ruleset,
  type RuleCategory,
  type FullRuleCategory,
  parseRules,
  parseRulesetFull,
  getCategoryRules as getCategoryRulesPure,
  listCategories as listCategoriesPure,
  addRuleToCategory,
  removeRuleFromCategory,
  toggleRule,
} from "./ruleset.js";
import {
  checkAction as checkActionPure,
  checkToolCall as checkToolCallPure,
  getGuardrailsPrompt as getGuardrailsPromptPure,
  type CheckActionResult,
} from "./enforce.js";
import { getStorageForScope } from "./storage.js";
import { defaultRulesetTemplate } from "./default-template.js";

const DEFAULT_FALLBACK_SCOPE: Scope = "dev:default";

function resolveScope(explicit: Scope | undefined): Scope {
  return explicit ?? getCurrentScopeOr(DEFAULT_FALLBACK_SCOPE);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read the ruleset for a scope. If no scope is passed, the active
 * `withScope()` value is used (or `dev:default` if no scope is active).
 *
 * Returns `null` if no ruleset has been written for this scope yet.
 */
export async function getRuleset(scope?: Scope): Promise<Ruleset | null> {
  const s = resolveScope(scope);
  return getStorageForScope(s).get(s);
}

/**
 * Read the ruleset for a scope, creating it from the default template if
 * none exists. Always returns a Ruleset (never null).
 */
export async function getOrCreateRuleset(scope?: Scope): Promise<Ruleset> {
  const s = resolveScope(scope);
  const storage = getStorageForScope(s);
  const existing = await storage.get(s);
  if (existing) return existing;
  const fresh = defaultRulesetTemplate(s);
  await storage.put(s, fresh);
  return fresh;
}

/**
 * List active categories (parsed) for a scope.
 */
export async function listRuleCategories(
  scope?: Scope,
): Promise<RuleCategory[]> {
  const ruleset = await getRuleset(scope);
  if (!ruleset) return [];
  return parseRules(ruleset);
}

/**
 * List all categories with active+disabled rules preserved (for editing UIs).
 */
export async function listRuleCategoriesFull(
  scope?: Scope,
): Promise<FullRuleCategory[]> {
  const ruleset = await getRuleset(scope);
  if (!ruleset) return [];
  return parseRulesetFull(ruleset);
}

/**
 * Get all active rules in a category. Returns null if the category does not
 * exist or no ruleset is stored for the scope.
 */
export async function getCategoryRules(
  categoryName: string,
  scope?: Scope,
): Promise<string[] | null> {
  const ruleset = await getRuleset(scope);
  if (!ruleset) return null;
  return getCategoryRulesPure(ruleset, categoryName);
}

/**
 * List all category names in document order.
 */
export async function listCategoryNames(scope?: Scope): Promise<string[]> {
  const ruleset = await getRuleset(scope);
  if (!ruleset) return [];
  return listCategoriesPure(ruleset);
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Replace the entire ruleset for a scope.
 */
export async function putRuleset(
  ruleset: Ruleset,
  scope?: Scope,
): Promise<void> {
  const s = resolveScope(scope);
  await getStorageForScope(s).put(s, ruleset);
}

/**
 * Add a rule to a category. Creates the ruleset from the default template
 * if none exists. Creates the category if it doesn't exist.
 */
export async function addRule(
  categoryName: string,
  rule: string,
  scope?: Scope,
): Promise<void> {
  const s = resolveScope(scope);
  const storage = getStorageForScope(s);
  const ruleset = await getOrCreateRuleset(s);
  const updated = addRuleToCategory(ruleset, categoryName, rule);
  await storage.put(s, updated);
}

/**
 * Remove a rule from a category by 1-based index.
 * No-op if the category or index is invalid.
 */
export async function removeRule(
  categoryName: string,
  ruleIndex1Based: number,
  scope?: Scope,
): Promise<void> {
  const s = resolveScope(scope);
  const storage = getStorageForScope(s);
  const ruleset = await storage.get(s);
  if (!ruleset) return;
  const updated = removeRuleFromCategory(
    ruleset,
    categoryName,
    ruleIndex1Based,
  );
  if (updated.content !== ruleset.content) {
    await storage.put(s, updated);
  }
}

/**
 * Toggle a rule's enabled/disabled state by 1-based index.
 * No-op if the category or index is invalid.
 */
export async function toggleRuleAt(
  categoryName: string,
  ruleIndex1Based: number,
  scope?: Scope,
): Promise<void> {
  const s = resolveScope(scope);
  const storage = getStorageForScope(s);
  const ruleset = await storage.get(s);
  if (!ruleset) return;
  const updated = toggleRule(ruleset, categoryName, ruleIndex1Based);
  if (updated.content !== ruleset.content) {
    await storage.put(s, updated);
  }
}

/**
 * Delete the ruleset for a scope.
 */
export async function deleteRuleset(scope?: Scope): Promise<void> {
  const s = resolveScope(scope);
  await getStorageForScope(s).delete(s);
}

// ── Enforcement (the runtime hot path) ───────────────────────────────────────

/**
 * Check if a proposed action might violate any active rules in this scope's
 * ruleset. Returns `{ violations: [], safe: true }` when no ruleset exists.
 *
 * This is the runtime function that aman-tg's `guardrails.checkAction()`
 * calls — it now lives here, scope-aware, multi-tenant.
 */
export async function checkAction(
  action: string,
  scope?: Scope,
): Promise<CheckActionResult> {
  const ruleset = await getRuleset(scope);
  if (!ruleset) return { violations: [], safe: true };
  return checkActionPure(action, ruleset);
}

/**
 * Check a tool call's description against the ruleset. Returns null if safe,
 * or an error message string if blocked.
 */
export async function checkToolCall(
  description: string,
  scope?: Scope,
): Promise<string | null> {
  const ruleset = await getRuleset(scope);
  if (!ruleset) return null;
  return checkToolCallPure(description, ruleset);
}

/**
 * Generate a system prompt block to inject into an LLM's context, listing
 * the safety-critical rules from this scope's ruleset.
 *
 * Returns empty string if no ruleset exists or no matching categories are
 * found — callers can append the result unconditionally.
 */
export async function getGuardrailsPrompt(
  opts: { includeCategories?: string[]; scope?: Scope } = {},
): Promise<string> {
  const ruleset = await getRuleset(opts.scope);
  if (!ruleset) return "";
  return getGuardrailsPromptPure(ruleset, {
    includeCategories: opts.includeCategories,
  });
}

/**
 * List all scopes that have a ruleset stored across both backends.
 */
export async function listRulesetScopes(): Promise<{
  markdown: Scope[];
  database: Scope[];
}> {
  const { getMarkdownStorage, getDatabaseStorage } = await import("./storage.js");
  return {
    markdown: await getMarkdownStorage().listScopes(),
    database: await getDatabaseStorage().listScopes(),
  };
}
