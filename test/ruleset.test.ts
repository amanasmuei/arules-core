import { describe, it, expect } from "vitest";
import {
  type Ruleset,
  parseRules,
  parseRulesetFull,
  getCategoryRules,
  listCategories,
  addRuleToCategory,
  removeRuleFromCategory,
  toggleRule,
} from "../src/index.js";

const sample: Ruleset = {
  content: `# Guardrails

## Always
- Be honest about what you don't know
- Confirm before destructive actions

## Never
- Never push to main without approval
- Never commit secrets
- ~~Old disabled rule~~

## Safety
- Refuse harmful requests

## Privacy
- No PII without consent
`,
};

describe("parseRules", () => {
  it("parses categories and active rules", () => {
    const cats = parseRules(sample);
    expect(cats).toHaveLength(4);
    expect(cats[0].name).toBe("Always");
    expect(cats[0].rules).toEqual([
      "Be honest about what you don't know",
      "Confirm before destructive actions",
    ]);
  });

  it("filters out strikethrough (disabled) rules", () => {
    const cats = parseRules(sample);
    const never = cats.find((c) => c.name === "Never");
    expect(never?.rules).toEqual([
      "Never push to main without approval",
      "Never commit secrets",
    ]);
    expect(never?.rules).not.toContain("Old disabled rule");
  });

  it("returns empty when no categories", () => {
    expect(parseRules({ content: "no rules here" })).toEqual([]);
  });

  it("preserves category order from the document", () => {
    const cats = parseRules(sample);
    expect(cats.map((c) => c.name)).toEqual([
      "Always",
      "Never",
      "Safety",
      "Privacy",
    ]);
  });

  it("ignores bullet lines outside any category", () => {
    const stray: Ruleset = { content: "- stray bullet\n## Real\n- in category\n" };
    const cats = parseRules(stray);
    expect(cats).toHaveLength(1);
    expect(cats[0].rules).toEqual(["in category"]);
  });
});

describe("parseRulesetFull", () => {
  it("preserves disabled rules with disabled=true", () => {
    const cats = parseRulesetFull(sample);
    const never = cats.find((c) => c.name === "Never");
    expect(never?.rules).toEqual([
      { text: "Never push to main without approval", disabled: false },
      { text: "Never commit secrets", disabled: false },
      { text: "Old disabled rule", disabled: true },
    ]);
  });

  it("strips ~~ markers from disabled rule text", () => {
    const cats = parseRulesetFull({ content: "## A\n- ~~hidden~~\n" });
    expect(cats[0].rules[0]).toEqual({ text: "hidden", disabled: true });
  });

  it("handles `~~` not as a strikethrough marker when content is too short", () => {
    // "~~" alone is too short to be a strikethrough — treat as literal
    const cats = parseRulesetFull({ content: "## A\n- ~~\n" });
    expect(cats[0].rules).toEqual([{ text: "~~", disabled: false }]);
  });
});

describe("getCategoryRules", () => {
  it("returns rules for an existing category (case-insensitive)", () => {
    expect(getCategoryRules(sample, "Never")).toEqual([
      "Never push to main without approval",
      "Never commit secrets",
    ]);
    expect(getCategoryRules(sample, "never")).toEqual([
      "Never push to main without approval",
      "Never commit secrets",
    ]);
  });

  it("returns null for a missing category", () => {
    expect(getCategoryRules(sample, "Nonexistent")).toBeNull();
  });
});

describe("listCategories", () => {
  it("returns all category names in document order", () => {
    expect(listCategories(sample)).toEqual([
      "Always",
      "Never",
      "Safety",
      "Privacy",
    ]);
  });

  it("returns empty for an empty ruleset", () => {
    expect(listCategories({ content: "" })).toEqual([]);
  });
});

describe("addRuleToCategory", () => {
  it("appends a rule to an existing category", () => {
    const updated = addRuleToCategory(sample, "Never", "No --no-verify commits");
    const never = parseRules(updated).find((c) => c.name === "Never");
    expect(never?.rules).toContain("No --no-verify commits");
  });

  it("does not affect rules in other categories", () => {
    const updated = addRuleToCategory(sample, "Never", "new rule");
    const always = parseRules(updated).find((c) => c.name === "Always");
    expect(always?.rules).toEqual([
      "Be honest about what you don't know",
      "Confirm before destructive actions",
    ]);
  });

  it("creates a new category if it doesn't exist", () => {
    const updated = addRuleToCategory(sample, "Compliance", "Follow GDPR");
    const cats = parseRules(updated);
    expect(cats.find((c) => c.name === "Compliance")?.rules).toEqual([
      "Follow GDPR",
    ]);
  });

  it("ignores empty rule text", () => {
    const updated = addRuleToCategory(sample, "Never", "   ");
    expect(updated.content).toBe(sample.content);
  });

  it("does not mutate the input ruleset", () => {
    const original = sample.content;
    addRuleToCategory(sample, "Never", "added");
    expect(sample.content).toBe(original);
  });

  it("handles case-insensitive category lookup", () => {
    const updated = addRuleToCategory(sample, "never", "case test");
    const never = parseRules(updated).find((c) => c.name === "Never");
    expect(never?.rules).toContain("case test");
  });
});

describe("removeRuleFromCategory", () => {
  it("removes the Nth rule (1-based)", () => {
    const updated = removeRuleFromCategory(sample, "Never", 2);
    const never = parseRules(updated).find((c) => c.name === "Never");
    expect(never?.rules).toEqual(["Never push to main without approval"]);
  });

  it("counts disabled rules in the index", () => {
    // Sample has: 1=push to main, 2=commit secrets, 3=~~old disabled~~
    const updated = removeRuleFromCategory(sample, "Never", 3);
    // Index 3 was the disabled rule — it should be gone now
    const full = parseRulesetFull(updated).find((c) => c.name === "Never");
    expect(full?.rules.find((r) => r.text === "Old disabled rule")).toBeUndefined();
  });

  it("is a no-op for an out-of-range index", () => {
    const updated = removeRuleFromCategory(sample, "Never", 99);
    expect(updated.content).toBe(sample.content);
  });

  it("is a no-op for a missing category", () => {
    const updated = removeRuleFromCategory(sample, "Nonexistent", 1);
    expect(updated.content).toBe(sample.content);
  });

  it("does not affect other categories", () => {
    const updated = removeRuleFromCategory(sample, "Never", 1);
    expect(parseRules(updated).find((c) => c.name === "Always")?.rules).toEqual([
      "Be honest about what you don't know",
      "Confirm before destructive actions",
    ]);
  });
});

describe("toggleRule", () => {
  it("disables an active rule by wrapping in ~~", () => {
    const updated = toggleRule(sample, "Never", 1);
    const never = parseRulesetFull(updated).find((c) => c.name === "Never");
    expect(never?.rules[0]).toEqual({
      text: "Never push to main without approval",
      disabled: true,
    });
  });

  it("re-enables a disabled rule by unwrapping ~~", () => {
    const updated = toggleRule(sample, "Never", 3); // index 3 is the ~~Old~~ rule
    const never = parseRulesetFull(updated).find((c) => c.name === "Never");
    expect(never?.rules[2]).toEqual({
      text: "Old disabled rule",
      disabled: false,
    });
  });

  it("is a no-op for out-of-range index", () => {
    const updated = toggleRule(sample, "Never", 99);
    expect(updated.content).toBe(sample.content);
  });

  it("is a no-op for missing category", () => {
    const updated = toggleRule(sample, "Nonexistent", 1);
    expect(updated.content).toBe(sample.content);
  });
});
