import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { migrateLegacyArulesFile, _resetStorageCache } from "../src/index.js";

describe("migrateLegacyArulesFile", () => {
  let tmpRoot: string;
  let arulesHome: string;
  let legacyPath: string;
  let newPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arules-core-migrate-"));
    arulesHome = path.join(tmpRoot, "arules");
    fs.mkdirSync(arulesHome, { recursive: true });
    process.env.ARULES_HOME = arulesHome;
    _resetStorageCache();
    legacyPath = path.join(arulesHome, "rules.md");
    newPath = path.join(arulesHome, "dev", "default", "rules.md");
  });

  afterEach(() => {
    _resetStorageCache();
    delete process.env.ARULES_HOME;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns no-op when no legacy file exists", () => {
    const report = migrateLegacyArulesFile();
    expect(report.status).toBe("no-op");
    expect(report.message).toMatch(/No legacy file/);
    expect(fs.existsSync(newPath)).toBe(false);
  });

  it("copies legacy file to new path when only legacy exists", () => {
    fs.writeFileSync(legacyPath, "## Never\n- Push to main\n", "utf-8");
    const report = migrateLegacyArulesFile();
    expect(report.status).toBe("copied");
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.readFileSync(newPath, "utf-8")).toBe("## Never\n- Push to main\n");
  });

  it("does NOT delete the legacy file after copying", () => {
    fs.writeFileSync(legacyPath, "## Never\n- x\n", "utf-8");
    migrateLegacyArulesFile();
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it("returns no-op when both legacy and new exist", () => {
    fs.writeFileSync(legacyPath, "legacy", "utf-8");
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.writeFileSync(newPath, "new", "utf-8");

    const report = migrateLegacyArulesFile();
    expect(report.status).toBe("no-op");
    expect(report.message).toMatch(/already exists/);
    expect(fs.readFileSync(newPath, "utf-8")).toBe("new");
  });

  it("is idempotent", () => {
    fs.writeFileSync(legacyPath, "## A\n- one\n", "utf-8");
    expect(migrateLegacyArulesFile().status).toBe("copied");
    expect(migrateLegacyArulesFile().status).toBe("no-op");
    expect(fs.readFileSync(newPath, "utf-8")).toBe("## A\n- one\n");
  });

  it("creates intermediate directories", () => {
    fs.writeFileSync(legacyPath, "x", "utf-8");
    expect(fs.existsSync(path.dirname(newPath))).toBe(false);
    migrateLegacyArulesFile();
    expect(fs.existsSync(path.dirname(newPath))).toBe(true);
  });

  it("preserves legacy bytes exactly", () => {
    const original =
      "# Guardrails\n\n## Always\n- Be honest\n\n## Never\n- ~~old~~\n- new\n";
    fs.writeFileSync(legacyPath, original, "utf-8");
    migrateLegacyArulesFile();
    expect(fs.readFileSync(newPath, "utf-8")).toBe(original);
  });
});
