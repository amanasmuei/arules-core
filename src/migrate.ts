import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir } from "@aman_asmuei/aman-core";
import { getArulesHome } from "./storage.js";

export interface ArulesMigrationReport {
  legacyPath: string;
  newPath: string;
  status: "no-op" | "copied" | "error";
  message: string;
}

/**
 * One-time migration of the legacy `~/.arules/rules.md` (single-tenant
 * layout) to the new multi-tenant layout at `~/.arules/dev/default/rules.md`.
 *
 * Same shape as `acore-core`'s migrateLegacyAcoreFile: COPY only (never
 * delete the legacy file), idempotent, no-op if the new path already exists.
 *
 * After this migration, `getRuleset('dev:default')` reads from the new path
 * via MarkdownFileStorage with no further action needed.
 */
export function migrateLegacyArulesFile(): ArulesMigrationReport {
  const root = getArulesHome();
  const legacyPath = path.join(root, "rules.md");
  const newPath = path.join(root, "dev", "default", "rules.md");

  if (!fs.existsSync(legacyPath)) {
    return {
      legacyPath,
      newPath,
      status: "no-op",
      message: `No legacy file at ${legacyPath} — nothing to migrate.`,
    };
  }

  if (fs.existsSync(newPath)) {
    return {
      legacyPath,
      newPath,
      status: "no-op",
      message: `New file already exists at ${newPath}; legacy file left in place.`,
    };
  }

  try {
    ensureDir(path.dirname(newPath));
    fs.copyFileSync(legacyPath, newPath);
    return {
      legacyPath,
      newPath,
      status: "copied",
      message: `Copied ${legacyPath} → ${newPath}. Legacy file preserved; remove it manually if migration is verified.`,
    };
  } catch (err) {
    return {
      legacyPath,
      newPath,
      status: "error",
      message: `Failed to copy: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
