import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { withScope } from "@aman_asmuei/aman-core";
import {
  getRuleset,
  getOrCreateRuleset,
  putRuleset,
  addRule,
  removeRule,
  toggleRuleAt,
  deleteRuleset,
  listRuleCategories,
  listRuleCategoriesFull,
  getCategoryRulesForScope,
  listCategoryNames,
  checkAction,
  checkToolCall,
  getGuardrailsPrompt,
  listRulesetScopes,
  getStorageForScope,
  getMarkdownStorage,
  getDatabaseStorage,
  _resetStorageCache,
  type Ruleset,
} from "../src/index.js";

describe("arules-core public API", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arules-core-api-"));
    process.env.ARULES_HOME = path.join(tmpRoot, "arules");
    process.env.AMAN_ENGINE_DB = path.join(tmpRoot, "engine.db");
    _resetStorageCache();
  });

  afterEach(() => {
    _resetStorageCache();
    delete process.env.ARULES_HOME;
    delete process.env.AMAN_ENGINE_DB;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("storage routing", () => {
    it("dev:* scopes route to MarkdownFileStorage", () => {
      expect(getStorageForScope("dev:default")).toBe(getMarkdownStorage());
      expect(getStorageForScope("dev:plugin")).toBe(getMarkdownStorage());
    });

    it("tg:* scopes route to DatabaseStorage", () => {
      expect(getStorageForScope("tg:12345")).toBe(getDatabaseStorage());
    });

    it("agent:* scopes route to DatabaseStorage", () => {
      expect(getStorageForScope("agent:jiran")).toBe(getDatabaseStorage());
    });

    it("unknown frontends default to DatabaseStorage", () => {
      expect(getStorageForScope("unknown:x")).toBe(getDatabaseStorage());
    });
  });

  describe("getRuleset / getOrCreateRuleset", () => {
    it("getRuleset returns null when no ruleset exists", async () => {
      expect(await getRuleset("dev:default")).toBeNull();
      expect(await getRuleset("tg:12345")).toBeNull();
    });

    it("getOrCreateRuleset bootstraps the default template", async () => {
      const r = await getOrCreateRuleset("dev:default");
      expect(r.content).toContain("# Guardrails");
      expect(r.content).toContain("## Always");
      expect(r.content).toContain("## Never");
      expect(r.content).toContain("scope: dev:default");
    });

    it("getOrCreateRuleset returns existing ruleset if present", async () => {
      await putRuleset({ content: "## Custom\n- One rule\n" }, "dev:default");
      const r = await getOrCreateRuleset("dev:default");
      expect(r.content).toBe("## Custom\n- One rule\n");
    });

    it("creates a per-scope ruleset in DatabaseStorage for tg scopes", async () => {
      const r = await getOrCreateRuleset("tg:12345");
      expect(r.content).toContain("scope: tg:12345");
      const fromDb = await getDatabaseStorage().get("tg:12345");
      expect(fromDb?.content).toContain("scope: tg:12345");
    });
  });

  describe("addRule", () => {
    it("creates the ruleset and adds a rule", async () => {
      await addRule("Never", "Custom rule", "dev:default");
      const cats = await listRuleCategories("dev:default");
      const never = cats.find((c) => c.name === "Never");
      expect(never?.rules).toContain("Custom rule");
    });

    it("preserves default template rules when adding", async () => {
      await addRule("Never", "extra rule", "dev:default");
      const never = await getCategoryRulesForScope("Never", "dev:default");
      // Default template includes 3 Never rules — they should still be there
      expect(never).toContain("Never push to main without explicit approval");
      expect(never).toContain("Never commit secrets or credentials");
      expect(never).toContain("extra rule");
    });

    it("creates a new category if it doesn't exist", async () => {
      await addRule("Custom", "Custom rule", "dev:default");
      const names = await listCategoryNames("dev:default");
      expect(names).toContain("Custom");
    });
  });

  describe("removeRule", () => {
    it("removes a rule by 1-based index", async () => {
      await getOrCreateRuleset("dev:default");
      const before = await getCategoryRulesForScope("Never", "dev:default");
      await removeRule("Never", 1, "dev:default");
      const after = await getCategoryRulesForScope("Never", "dev:default");
      expect(after?.length).toBe((before?.length ?? 0) - 1);
    });

    it("is a no-op when no ruleset exists", async () => {
      await removeRule("Never", 1, "dev:default");
      expect(await getRuleset("dev:default")).toBeNull();
    });
  });

  describe("toggleRuleAt", () => {
    it("toggles a rule's disabled state", async () => {
      await getOrCreateRuleset("dev:default");
      await toggleRuleAt("Never", 1, "dev:default");

      // After toggle, rule 1 should be disabled — listRuleCategories
      // (which only returns active rules) should show one fewer
      const active = await listRuleCategories("dev:default");
      const never = active.find((c) => c.name === "Never");
      expect(never?.rules.length).toBe(2); // was 3, now 2 active

      // listRuleCategoriesFull should still show all 3
      const full = await listRuleCategoriesFull("dev:default");
      const neverFull = full.find((c) => c.name === "Never");
      expect(neverFull?.rules.length).toBe(3);
      expect(neverFull?.rules[0].disabled).toBe(true);
    });

    it("re-enables when toggled again", async () => {
      await getOrCreateRuleset("dev:default");
      await toggleRuleAt("Never", 1, "dev:default");
      await toggleRuleAt("Never", 1, "dev:default");
      const active = await listRuleCategories("dev:default");
      const never = active.find((c) => c.name === "Never");
      expect(never?.rules.length).toBe(3); // back to 3 active
    });
  });

  describe("checkAction", () => {
    it("returns safe when no ruleset exists", async () => {
      const result = await checkAction("delete everything", "dev:default");
      expect(result.safe).toBe(true);
    });

    it("flags violations against the default template", async () => {
      await getOrCreateRuleset("dev:default");
      const result = await checkAction(
        "delete production data without confirmation",
        "dev:default",
      );
      expect(result.safe).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("uses tg scope's ruleset, not dev's", async () => {
      // Different rulesets for different scopes. Use words long enough to
      // pass extractKeywords' length>3 filter (production-realistic words).
      await putRuleset(
        {
          content:
            "## Never\n- Never deploy untested production releases\n",
        },
        "dev:default",
      );
      await putRuleset(
        {
          content:
            "## Never\n- Never download personal customer information\n",
        },
        "tg:12345",
      );

      const devResult = await checkAction(
        "deploy untested production code right now",
        "dev:default",
      );
      const tgResult = await checkAction(
        "download personal customer information for analysis",
        "tg:12345",
      );

      expect(devResult.safe).toBe(false);
      expect(tgResult.safe).toBe(false);

      // Cross-scope: dev's violation pattern does NOT match tg's ruleset
      const cross = await checkAction(
        "deploy untested production code right now",
        "tg:12345",
      );
      expect(cross.safe).toBe(true);
    });
  });

  describe("checkToolCall", () => {
    it("returns null when ruleset is missing", async () => {
      expect(await checkToolCall("anything", "dev:default")).toBeNull();
    });

    it("blocks risky tool descriptions", async () => {
      await getOrCreateRuleset("dev:default");
      const result = await checkToolCall(
        "delete production data permanently",
        "dev:default",
      );
      expect(result).toMatch(/blocked by guardrails/i);
    });
  });

  describe("getGuardrailsPrompt", () => {
    it("returns empty when no ruleset", async () => {
      expect(await getGuardrailsPrompt({ scope: "dev:default" })).toBe("");
    });

    it("returns the prompt block when ruleset exists", async () => {
      await getOrCreateRuleset("dev:default");
      const prompt = await getGuardrailsPrompt({ scope: "dev:default" });
      expect(prompt).toContain("GUARDRAILS");
      expect(prompt).toContain("### Never");
    });
  });

  describe("isolation between scopes", () => {
    it("dev and tg do not see each other's rules", async () => {
      await addRule("Never", "dev only rule", "dev:default");
      await addRule("Never", "tg only rule", "tg:12345");

      const dev = await getCategoryRulesForScope("Never", "dev:default");
      const tg = await getCategoryRulesForScope("Never", "tg:12345");

      expect(dev).toContain("dev only rule");
      expect(dev).not.toContain("tg only rule");
      expect(tg).toContain("tg only rule");
      expect(tg).not.toContain("dev only rule");
    });

    it("two tg users do not see each other's rules", async () => {
      await addRule("Privacy", "user a rule", "tg:user-a");
      await addRule("Privacy", "user b rule", "tg:user-b");

      const a = await getCategoryRulesForScope("Privacy", "tg:user-a");
      const b = await getCategoryRulesForScope("Privacy", "tg:user-b");

      expect(a).toContain("user a rule");
      expect(a).not.toContain("user b rule");
      expect(b).toContain("user b rule");
      expect(b).not.toContain("user a rule");
    });

    it("dev:* writes to filesystem, tg:* writes to DB", async () => {
      await addRule("Never", "dev rule", "dev:default");
      await addRule("Never", "tg rule", "tg:12345");

      const devFile = path.join(
        process.env.ARULES_HOME!,
        "dev",
        "default",
        "rules.md",
      );
      expect(fs.existsSync(devFile)).toBe(true);

      const tgFile = path.join(
        process.env.ARULES_HOME!,
        "tg",
        "12345",
        "rules.md",
      );
      expect(fs.existsSync(tgFile)).toBe(false);

      expect(fs.existsSync(process.env.AMAN_ENGINE_DB!)).toBe(true);
    });
  });

  describe("withScope propagation", () => {
    it("two parallel withScope blocks do not bleed rulesets", async () => {
      const results = await Promise.all([
        withScope("tg:user-a", async () => {
          await addRule("Never", "user a rule");
          await new Promise((r) => setTimeout(r, 5));
          return await getCategoryRulesForScope("Never");
        }),
        withScope("tg:user-b", async () => {
          await addRule("Never", "user b rule");
          await new Promise((r) => setTimeout(r, 3));
          return await getCategoryRulesForScope("Never");
        }),
      ]);

      expect(results[0]).toContain("user a rule");
      expect(results[0]).not.toContain("user b rule");
      expect(results[1]).toContain("user b rule");
      expect(results[1]).not.toContain("user a rule");
    });
  });

  describe("deleteRuleset", () => {
    it("removes the ruleset", async () => {
      await putRuleset({ content: "## A\n- one\n" }, "dev:default");
      await deleteRuleset("dev:default");
      expect(await getRuleset("dev:default")).toBeNull();
    });

    it("is a no-op when no ruleset", async () => {
      await expect(deleteRuleset("dev:never-existed")).resolves.toBeUndefined();
    });
  });

  describe("listRulesetScopes", () => {
    it("returns scopes from both backends", async () => {
      await addRule("Never", "x", "dev:default");
      await addRule("Never", "x", "dev:plugin");
      await addRule("Never", "x", "tg:111");
      await addRule("Never", "x", "agent:jiran");

      const { markdown, database } = await listRulesetScopes();
      expect(markdown.sort()).toEqual(["dev:default", "dev:plugin"]);
      expect(database.sort()).toEqual(["agent:jiran", "tg:111"]);
    });
  });

  describe("end-to-end: aman-tg pattern", () => {
    it("simulates aman-tg's per-user enforcement flow", async () => {
      // 1. User signs up — bootstrap their ruleset
      const ruleset: Ruleset = await getOrCreateRuleset("tg:userX");
      expect(ruleset.content).toContain("Never");

      // 2. Layer adds tenant-specific rules
      await addRule("Privacy", "Never store user X's location", "tg:userX");

      // 3. Runtime: a tool call is about to happen — check it
      const safeResult = await checkToolCall(
        "Looking up the user's preferred recipe",
        "tg:userX",
      );
      expect(safeResult).toBeNull(); // safe

      const blockedResult = await checkToolCall(
        "Storing user X's location for later",
        "tg:userX",
      );
      expect(blockedResult).not.toBeNull(); // blocked

      // 4. System prompt injection
      const prompt = await getGuardrailsPrompt({ scope: "tg:userX" });
      expect(prompt).toContain("Never store user X's location");
    });
  });
});
