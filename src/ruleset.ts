/**
 * A Ruleset record. Like Identity in acore-core, the content is the full
 * markdown of the rules file (the same shape that ~/.arules/rules.md uses
 * today). All operations are layered on top via the parser and helpers in
 * this module — the storage layer doesn't know or care about the structure.
 *
 * Markdown blob over typed schema is intentional: it stays backward-compatible
 * with the existing arules CLI, lets users hand-edit rules.md in vim, and
 * lets both storage backends (MarkdownFileStorage, DatabaseStorage) treat
 * the value as an opaque string.
 */
export interface Ruleset {
  content: string;
}

/**
 * A category of rules parsed from a `## CategoryName` markdown section.
 * Only the active (non-strikethrough) rules are included.
 */
export interface RuleCategory {
  name: string;
  rules: string[];
}

/**
 * A rule with its enabled/disabled state preserved. Used by the editing
 * helpers (toggleRule etc) and admin tools that need to see disabled rules.
 */
export interface ParsedRule {
  /** The rule text without strikethrough markers. */
  text: string;
  /** True if the rule was wrapped in `~~...~~` (disabled). */
  disabled: boolean;
}

export interface FullRuleCategory {
  name: string;
  rules: ParsedRule[];
}

const HEADING_PATTERN = /^## (.+?)\s*$/;
const BULLET_PATTERN = /^(- )(.+?)\s*$/;

/**
 * Parse a Ruleset into structured RuleCategories. ONLY active rules are
 * returned — strikethrough (disabled) rules are filtered out. This is the
 * function the runtime enforcement engine uses.
 *
 * Use `parseRulesetFull()` if you need to see disabled rules too (e.g. for
 * an editing UI or `toggleRule`).
 */
export function parseRules(ruleset: Ruleset): RuleCategory[] {
  const full = parseRulesetFull(ruleset);
  return full.map((cat) => ({
    name: cat.name,
    rules: cat.rules.filter((r) => !r.disabled).map((r) => r.text),
  }));
}

/**
 * Parse a Ruleset into FullRuleCategories, preserving the disabled state of
 * each rule. Use this for editing UIs that need to show all rules including
 * disabled ones.
 */
export function parseRulesetFull(ruleset: Ruleset): FullRuleCategory[] {
  const categories: FullRuleCategory[] = [];
  let current: FullRuleCategory | null = null;

  for (const line of ruleset.content.split("\n")) {
    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      if (current) categories.push(current);
      current = { name: headingMatch[1].trim(), rules: [] };
      continue;
    }

    if (!current) continue;

    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch) {
      const raw = bulletMatch[2].trim();
      if (!raw) continue;
      const isDisabled = raw.startsWith("~~") && raw.endsWith("~~") && raw.length > 4;
      const text = isDisabled ? raw.slice(2, -2).trim() : raw;
      if (text) {
        current.rules.push({ text, disabled: isDisabled });
      }
    }
  }

  if (current) categories.push(current);
  return categories;
}

/**
 * Get all active rules in a named category. Returns null if the category
 * doesn't exist. Empty array if it exists but has no active rules.
 */
export function getCategoryRules(
  ruleset: Ruleset,
  categoryName: string,
): string[] | null {
  const categories = parseRules(ruleset);
  const found = categories.find(
    (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
  );
  return found ? found.rules : null;
}

/**
 * List all category names in the ruleset, in document order.
 */
export function listCategories(ruleset: Ruleset): string[] {
  return parseRulesetFull(ruleset).map((c) => c.name);
}

// ── Editing helpers (used by the arules CLI and api.ts) ─────────────────────

/**
 * Add a new rule to a named category. If the category doesn't exist, it is
 * appended to the end of the document. Returns a new Ruleset (does not mutate).
 */
export function addRuleToCategory(
  ruleset: Ruleset,
  categoryName: string,
  rule: string,
): Ruleset {
  const lines = ruleset.content.split("\n");
  const trimmedRule = rule.trim();
  if (!trimmedRule) return ruleset;

  let categoryStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(HEADING_PATTERN);
    if (
      headingMatch &&
      headingMatch[1].trim().toLowerCase() === categoryName.toLowerCase()
    ) {
      categoryStart = i;
      break;
    }
  }

  if (categoryStart < 0) {
    // Category not found — append at end
    const sep = ruleset.content.endsWith("\n") || ruleset.content === "" ? "" : "\n";
    return {
      content: `${ruleset.content}${sep}\n## ${categoryName}\n- ${trimmedRule}\n`,
    };
  }

  // Find where this category ends (next ## heading or EOF)
  let categoryEnd = lines.length;
  for (let i = categoryStart + 1; i < lines.length; i++) {
    if (HEADING_PATTERN.test(lines[i])) {
      categoryEnd = i;
      break;
    }
  }

  // Find the last bullet line in the category, insert after it
  let insertAt = categoryStart + 1;
  for (let i = categoryStart + 1; i < categoryEnd; i++) {
    if (BULLET_PATTERN.test(lines[i])) {
      insertAt = i + 1;
    }
  }

  lines.splice(insertAt, 0, `- ${trimmedRule}`);
  return { content: lines.join("\n") };
}

/**
 * Remove a rule from a category by 1-based index. Counts ALL bullet lines
 * (active and disabled) so the index lines up with what `parseRulesetFull`
 * returns and what an editing UI displays.
 *
 * Returns the unchanged ruleset if the category or index is invalid.
 */
export function removeRuleFromCategory(
  ruleset: Ruleset,
  categoryName: string,
  ruleIndex1Based: number,
): Ruleset {
  return modifyBulletInCategory(
    ruleset,
    categoryName,
    ruleIndex1Based,
    () => null,
  );
}

/**
 * Toggle a rule's disabled state by 1-based index. If the rule is active,
 * wrap it in `~~...~~`. If it's already disabled, unwrap it.
 *
 * Returns the unchanged ruleset if the category or index is invalid.
 */
export function toggleRule(
  ruleset: Ruleset,
  categoryName: string,
  ruleIndex1Based: number,
): Ruleset {
  return modifyBulletInCategory(
    ruleset,
    categoryName,
    ruleIndex1Based,
    (current) => {
      const trimmed = current.trim();
      if (
        trimmed.startsWith("~~") &&
        trimmed.endsWith("~~") &&
        trimmed.length > 4
      ) {
        return trimmed.slice(2, -2);
      }
      return `~~${trimmed}~~`;
    },
  );
}

/**
 * Find the Nth bullet (1-based) in a named category and apply a transformer.
 * If the transformer returns null, the bullet is removed.
 */
function modifyBulletInCategory(
  ruleset: Ruleset,
  categoryName: string,
  ruleIndex1Based: number,
  transform: (rule: string) => string | null,
): Ruleset {
  if (ruleIndex1Based < 1) return ruleset;

  const lines = ruleset.content.split("\n");
  const result: string[] = [];
  let inCategory = false;
  let bulletCount = 0;
  let modified = false;

  for (const line of lines) {
    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      inCategory =
        headingMatch[1].trim().toLowerCase() === categoryName.toLowerCase();
      bulletCount = 0;
      result.push(line);
      continue;
    }

    if (inCategory && !modified) {
      const bulletMatch = line.match(BULLET_PATTERN);
      if (bulletMatch) {
        bulletCount++;
        if (bulletCount === ruleIndex1Based) {
          const next = transform(bulletMatch[2]);
          modified = true;
          if (next === null) {
            // remove — skip pushing the line
            continue;
          }
          result.push(`${bulletMatch[1]}${next}`);
          continue;
        }
      }
    }

    result.push(line);
  }

  if (!modified) return ruleset;
  return { content: result.join("\n") };
}
