import type { Ruleset } from "./ruleset.js";
import { parseRules } from "./ruleset.js";

/**
 * Result of checking an action against the active rules.
 */
export interface CheckActionResult {
  /** Rules whose keywords match the action description (likely violations). */
  violations: string[];
  /** True if no violations were found. */
  safe: boolean;
}

/**
 * Words that are too common to be useful as rule-matching signals. Filtered
 * out before keyword matching to reduce false positives.
 */
const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "about",
  "than",
  "them",
  "they",
  "their",
  "when",
  "where",
  "what",
  "which",
  "will",
  "have",
  "been",
  "would",
  "could",
  "should",
  "into",
  "your",
  "yours",
  "ours",
  "they",
  "those",
  "these",
  "such",
  "very",
]);

/**
 * Categories that contain prohibitions by convention. The "Never" category
 * is treated as fully prohibitive; other categories are scanned for rules
 * containing prohibition keywords.
 */
const PROHIBITION_CATEGORY = "never";
const PROHIBITION_KEYWORDS = [
  "never",
  "don't",
  "do not",
  "must not",
  "forbidden",
  "prohibited",
  "refuse",
  "decline",
];

/**
 * Categories included in the system prompt by default. The runtime enforcer
 * (`checkAction`) doesn't use this list — it scans all rules — but the
 * prompt-injection helper (`getGuardrailsPrompt`) does.
 */
export const DEFAULT_PROMPT_CATEGORIES = [
  "always",
  "never",
  "safety",
  "privacy",
];

/**
 * Check if a proposed action might violate any active rules.
 *
 * Algorithm: collect all "prohibition" rules (everything in the Never
 * category, plus rules in other categories that contain prohibition
 * keywords like "never", "don't", "must not"). For each prohibition rule,
 * extract the meaningful keywords (length > 3, not a stopword) and check if
 * the action description contains at least 2 of them. If so, flag it as a
 * potential violation.
 *
 * This is the same naive keyword-overlap algorithm `aman-tg/guardrails.ts`
 * has used in production. It has known false positives and false negatives —
 * a future version should layer in semantic matching. For now, the API
 * stability is more important than perfection.
 */
export function checkAction(
  action: string,
  ruleset: Ruleset,
): CheckActionResult {
  const categories = parseRules(ruleset);
  if (categories.length === 0) return { violations: [], safe: true };

  const prohibitions: string[] = [];

  for (const cat of categories) {
    if (cat.name.toLowerCase() === PROHIBITION_CATEGORY) {
      prohibitions.push(...cat.rules);
      continue;
    }
    for (const rule of cat.rules) {
      const lower = rule.toLowerCase();
      if (PROHIBITION_KEYWORDS.some((kw) => containsWord(lower, kw))) {
        if (!prohibitions.includes(rule)) {
          prohibitions.push(rule);
        }
      }
    }
  }

  const actionLower = action.toLowerCase();
  const violations = prohibitions.filter((rule) => {
    const keywords = extractKeywords(rule);
    if (keywords.length === 0) return false;
    const matchCount = keywords.filter((kw) => actionLower.includes(kw)).length;
    return matchCount >= 2;
  });

  return { violations, safe: violations.length === 0 };
}

/**
 * Extract meaningful keywords from a rule for matching. Lowercase, length > 3,
 * stopwords removed.
 */
function extractKeywords(rule: string): string[] {
  return rule
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter((w) => w.length > 3)
    .filter((w) => !STOPWORDS.has(w));
}

function containsWord(haystack: string, word: string): boolean {
  // Loose word-boundary check that works for both single tokens and phrases
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
  return pattern.test(haystack);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate a system prompt block to inject into an LLM's context. Includes
 * the rules from the most safety-critical categories (Always, Never, Safety,
 * Privacy by default) so the LLM treats them as hard constraints.
 *
 * Empty string is returned if no matching categories are found — callers can
 * append the result unconditionally.
 */
export function getGuardrailsPrompt(
  ruleset: Ruleset,
  opts: { includeCategories?: string[] } = {},
): string {
  const include = (opts.includeCategories ?? DEFAULT_PROMPT_CATEGORIES).map(
    (s) => s.toLowerCase(),
  );

  const categories = parseRules(ruleset);
  if (categories.length === 0) return "";

  const lines: string[] = [];
  let any = false;

  for (const cat of categories) {
    if (!include.includes(cat.name.toLowerCase())) continue;
    if (cat.rules.length === 0) continue;
    if (!any) {
      lines.push("\n\n## GUARDRAILS — You MUST follow these rules:");
      any = true;
    }
    lines.push(`\n### ${cat.name}`);
    for (const rule of cat.rules) {
      lines.push(`- ${rule}`);
    }
  }

  if (!any) return "";

  lines.push("\nViolating these rules is NOT allowed under any circumstances.");
  return lines.join("\n");
}

/**
 * Check a tool call against the ruleset before execution. Returns null if
 * the action is safe; an error message if it should be blocked.
 *
 * The caller provides a human-readable description of what the tool will
 * do, which is then matched against the ruleset using `checkAction`. This
 * lets layers like aman-tg add tool-specific descriptions (e.g.
 * `"Fetching URL: https://internal.example.com"`) and have the rule engine
 * evaluate them naturally.
 *
 * Tool-specific guards (e.g. blocking private IPs in `fetch_url`) belong in
 * the calling layer, not in arules-core. arules-core handles the
 * rule-driven part; the layer wraps it with whatever else it needs.
 */
export function checkToolCall(
  description: string,
  ruleset: Ruleset,
): string | null {
  const { violations, safe } = checkAction(description, ruleset);
  if (safe) return null;
  return `Action blocked by guardrails: ${violations[0]}`;
}
