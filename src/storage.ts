import * as path from "node:path";
import * as os from "node:os";
import {
  type Scope,
  type Storage,
  MarkdownFileStorage,
  DatabaseStorage,
  parseScope,
} from "@aman_asmuei/aman-core";
import type { Ruleset } from "./ruleset.js";

/**
 * Codec between Ruleset records and the string form that storage backends
 * persist. Ruleset is a markdown blob, so the codec is the identity function.
 */
const rulesetCodec = {
  serialize: (r: Ruleset): string => r.content,
  deserialize: (raw: string): Ruleset => ({ content: raw }),
};

const ARULES_FILENAME = "rules.md";
const ARULES_DB_TABLE = "arules_rulesets";

/**
 * Default root for human-editable arules files. Defaults to `~/.arules` so
 * the legacy `~/.arules/rules.md` location stays nearby. Override with
 * `$ARULES_HOME`.
 *
 * The new layout is `~/.arules/{scope.replace(':','/')}/rules.md` — for example:
 *   scope `dev:default`  → ~/.arules/dev/default/rules.md
 *
 * `tg:*` and `agent:*` scopes use DatabaseStorage instead of files, via
 * `getStorageForScope()`.
 */
export function getArulesHome(): string {
  if (process.env.ARULES_HOME) return process.env.ARULES_HOME;
  return path.join(os.homedir(), ".arules");
}

let _markdownStorage: MarkdownFileStorage<Ruleset> | null = null;
let _databaseStorage: DatabaseStorage<Ruleset> | null = null;

/**
 * Default read-only scope inheritance policy for arules (mirrors acore-core):
 *
 *   dev:plugin   → no fallback (root of the chain)
 *   dev:<other>  → falls back to dev:plugin
 *
 * Rationale: a user who set up guardrails via aman-plugin should see the
 * same guardrails in any new surface (Copilot, aman-agent, ...) without
 * re-entry. Writes never cascade — each scope's ruleset mutations stay
 * local. See acore-core's storage.ts for the full rationale.
 */
function defaultDevFallbackChain(requested: Scope): Scope[] {
  if (requested.startsWith("dev:") && requested !== "dev:plugin") {
    return ["dev:plugin"];
  }
  return [];
}

/**
 * Get the markdown-backed storage for dev-side scopes. Cached.
 */
export function getMarkdownStorage(): MarkdownFileStorage<Ruleset> {
  if (!_markdownStorage) {
    const root = getArulesHome();
    _markdownStorage = new MarkdownFileStorage<Ruleset>({
      root,
      filename: ARULES_FILENAME,
      fallbackChain: defaultDevFallbackChain,
      legacyPath: path.join(root, ARULES_FILENAME),
      ...rulesetCodec,
    });
  }
  return _markdownStorage;
}

/**
 * Get the SQLite-backed storage for server/multi-tenant scopes. Cached.
 * Uses the shared engine DB at `~/.aman/engine.db` (or `$AMAN_ENGINE_DB`).
 */
export function getDatabaseStorage(): DatabaseStorage<Ruleset> {
  if (!_databaseStorage) {
    _databaseStorage = new DatabaseStorage<Ruleset>({
      tableName: ARULES_DB_TABLE,
      ...rulesetCodec,
    });
  }
  return _databaseStorage;
}

/**
 * Pick the right storage backend for a given scope.
 *
 *   dev:*     → MarkdownFileStorage (human-editable, git-versionable)
 *   tg:*      → DatabaseStorage (server-side, multi-tenant)
 *   agent:*   → DatabaseStorage (per-agent rule sets)
 *   <other>   → DatabaseStorage (default)
 */
export function getStorageForScope(scope: string): Storage<Ruleset> {
  const parsed = parseScope(scope);
  if (parsed.frontend === "dev") {
    return getMarkdownStorage();
  }
  return getDatabaseStorage();
}

/**
 * Reset cached storage instances. Tests only.
 */
export function _resetStorageCache(): void {
  if (_databaseStorage) {
    _databaseStorage.close();
  }
  _markdownStorage = null;
  _databaseStorage = null;
}
