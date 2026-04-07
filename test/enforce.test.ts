import { describe, it, expect } from "vitest";
import {
  type Ruleset,
  checkActionPure,
  checkToolCallPure,
  getGuardrailsPromptPure,
  DEFAULT_PROMPT_CATEGORIES,
} from "../src/index.js";

const ruleset: Ruleset = {
  content: `# Guardrails

## Always
- Be honest about what you don't know
- Confirm before destructive actions

## Never
- Never push to main without approval
- Never commit secrets or credentials
- Never delete production data without confirmation

## Safety
- Refuse to create weapons or malware

## Privacy
- Never store personal information without consent
`,
};

describe("checkActionPure", () => {
  it("returns safe when no rules match", () => {
    const result = checkActionPure("write a hello world function", ruleset);
    expect(result.safe).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags an action that matches a Never rule by keyword overlap", () => {
    const result = checkActionPure(
      "delete production database records permanently",
      ruleset,
    );
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => v.includes("delete production data"))).toBe(
      true,
    );
  });

  it("flags actions with prohibition keywords from non-Never categories", () => {
    const result = checkActionPure(
      "store personal information about users",
      ruleset,
    );
    expect(result.safe).toBe(false);
    expect(
      result.violations.some((v) => v.toLowerCase().includes("personal")),
    ).toBe(true);
  });

  it("requires at least 2 keyword matches (not just one)", () => {
    // "personal" alone shouldn't trigger — needs ≥2 keyword overlap
    const result = checkActionPure("write a personal note", ruleset);
    // "personal" appears in the rule "Never store personal information without consent"
    // but only one keyword matches; the test verifies the ≥2 threshold
    expect(result.safe).toBe(true);
  });

  it("returns safe when ruleset is empty", () => {
    const result = checkActionPure("delete everything", { content: "" });
    expect(result.safe).toBe(true);
  });

  it("is case-insensitive", () => {
    const lowercase = checkActionPure("DELETE PRODUCTION DATA NOW", ruleset);
    expect(lowercase.safe).toBe(false);
  });

  it("flags secret commits", () => {
    const result = checkActionPure(
      "commit the credentials file to the repo",
      ruleset,
    );
    expect(result.safe).toBe(false);
  });

  it("flags pushing to main without approval", () => {
    const result = checkActionPure(
      "push the changes to main branch directly",
      ruleset,
    );
    expect(result.safe).toBe(false);
  });
});

describe("checkToolCallPure", () => {
  it("returns null for safe tool calls", () => {
    expect(
      checkToolCallPure("Reading file: /tmp/safe.txt", ruleset),
    ).toBeNull();
  });

  it("returns an error message for blocked tool calls", () => {
    const result = checkToolCallPure(
      "Deleting production database records",
      ruleset,
    );
    expect(result).not.toBeNull();
    expect(result).toMatch(/blocked by guardrails/i);
  });

  it("returns null when ruleset is empty", () => {
    expect(checkToolCallPure("anything", { content: "" })).toBeNull();
  });
});

describe("getGuardrailsPromptPure", () => {
  it("includes the default categories (Always, Never, Safety, Privacy)", () => {
    const prompt = getGuardrailsPromptPure(ruleset);
    expect(prompt).toContain("GUARDRAILS");
    expect(prompt).toContain("### Always");
    expect(prompt).toContain("### Never");
    expect(prompt).toContain("### Safety");
    expect(prompt).toContain("### Privacy");
  });

  it("includes the actual rules under each category heading", () => {
    const prompt = getGuardrailsPromptPure(ruleset);
    expect(prompt).toContain("Be honest about what you don't know");
    expect(prompt).toContain("Never push to main without approval");
    expect(prompt).toContain("Refuse to create weapons or malware");
  });

  it("filters out strikethrough rules from the prompt", () => {
    const withDisabled: Ruleset = {
      content: "## Never\n- Active rule\n- ~~Disabled rule~~\n",
    };
    const prompt = getGuardrailsPromptPure(withDisabled);
    expect(prompt).toContain("Active rule");
    expect(prompt).not.toContain("Disabled rule");
  });

  it("respects custom includeCategories", () => {
    const prompt = getGuardrailsPromptPure(ruleset, {
      includeCategories: ["Safety"],
    });
    expect(prompt).toContain("### Safety");
    expect(prompt).not.toContain("### Always");
    expect(prompt).not.toContain("### Never");
  });

  it("returns empty string when no matching categories exist", () => {
    const minimal: Ruleset = { content: "## Performance\n- Be fast\n" };
    expect(getGuardrailsPromptPure(minimal)).toBe("");
  });

  it("returns empty string for an empty ruleset", () => {
    expect(getGuardrailsPromptPure({ content: "" })).toBe("");
  });

  it("ends with the violation warning", () => {
    const prompt = getGuardrailsPromptPure(ruleset);
    expect(prompt).toMatch(/Violating these rules is NOT allowed/);
  });
});

describe("DEFAULT_PROMPT_CATEGORIES", () => {
  it("contains the safety-critical categories", () => {
    expect(DEFAULT_PROMPT_CATEGORIES).toEqual([
      "always",
      "never",
      "safety",
      "privacy",
    ]);
  });
});
