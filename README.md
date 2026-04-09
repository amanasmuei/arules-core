<div align="center">

# @aman_asmuei/arules-core

**The guardrails layer for the aman ecosystem.**

Multi-tenant rule sets with a runtime enforcement engine — `checkAction`,
`checkToolCall`, and `getGuardrailsPrompt` — extracted from `aman-tg`'s
production guardrails and made multi-tenant. Same algorithm. Same
behavior. One source of truth across every aman frontend.

[![npm version](https://img.shields.io/npm/v/@aman_asmuei/arules-core?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@aman_asmuei/arules-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-83_passing-brightgreen?style=for-the-badge)](#quality-signals)
[![Part of aman](https://img.shields.io/badge/part_of-aman_ecosystem-ff6b35?style=for-the-badge)](https://github.com/amanasmuei/aman)

[Install](#install) &middot;
[Quick start](#quick-start) &middot;
[The upstream story](#the-upstream-story) &middot;
[Concepts](#concepts) &middot;
[API reference](#api-reference) &middot;
[The aman ecosystem](#the-aman-ecosystem)

</div>

---

## What it is

`arules-core` is the guardrails layer of the aman engine. It manages "what
the AI must NOT do" as a flexible markdown ruleset, with runtime enforcement
helpers that any host can call before executing a tool, generating a
response, or taking a destructive action.

**One ruleset per scope.** The same package serves your local dev rules
(`dev:default`), Claude Code plugin rules (`dev:plugin`), per-agent rules
(`agent:jiran`), and per-user rules for thousands of Telegram users
(`tg:12345`). Complete state isolation. Same algorithm everywhere.

This package extracts a programmable library API out of the existing
`@aman_asmuei/arules` CLI **and** upstreams the runtime enforcement engine
that has been running in production inside `aman-tg`'s
`apps/api/src/guardrails.ts` for months. Both code paths now share one
implementation.

---

## The upstream story

Most aman engine layers were built by extracting a clean library out of an
existing CLI. `arules-core` is different: **its enforcement algorithm
already existed in production**, deployed inside `aman-tg`'s API server,
running per-Telegram-user safety checks for the Jiran agent and 13 others.

This package takes that production code, makes it multi-tenant, exposes it
as a library, and lets every aman frontend share the same enforcement.
After v1 ships, `aman-tg`'s `guardrails.ts` becomes a thin wrapper that
imports from this package — closing the loop on what was originally a
one-way migration.

The result: a bug fix in `arules-core`'s `checkAction` improves Claude
Code's `/rules` slash command, the CLI runtime, the MCP `rules_check` tool,
and `aman-tg`'s per-Telegram-user enforcement — **all from one library,
all from one set of tests**.

---

## Install

```bash
npm install @aman_asmuei/arules-core
```

`arules-core` depends on `@aman_asmuei/aman-core` for the scope substrate
and `Storage<T>` interface. `better-sqlite3` is required at runtime if you
use the `DatabaseStorage` backend (i.e. for non-`dev:*` scopes).

---

## Quick start

```typescript
import {
  getOrCreateRuleset,
  addRule,
  checkAction,
  checkToolCall,
  getGuardrailsPrompt,
  type CheckActionResult,
} from "@aman_asmuei/arules-core";

// Bootstrap a default ruleset for the dev side
await getOrCreateRuleset("dev:default");
// → Creates ~/.arules/dev/default/rules.md with sensible defaults
//   (## Always, ## Never, ## Safety, ## Privacy)

// Add a tenant-specific rule
await addRule("Never", "Never deploy on Friday afternoons", "dev:default");

// Runtime check before letting the LLM take an action
const result: CheckActionResult = await checkAction(
  "deploy production database changes right now",
  "dev:default",
);

if (!result.safe) {
  console.log("Blocked by:", result.violations);
  // → ["Never deploy on Friday afternoons", ...]
}

// Per-Telegram-user rulesets — production pattern
await addRule("Privacy", "Never store user 12345's location", "tg:12345");

// Tool call check before execution
const blockReason = await checkToolCall(
  "Storing user 12345's location",
  "tg:12345",
);
if (blockReason) {
  // → "Action blocked by guardrails: Never store user 12345's location"
  return blockReason; // refuse the tool call
}

// System prompt injection — slot the rules into the LLM's context
const guardPrompt = await getGuardrailsPrompt({ scope: "tg:12345" });
systemPrompt += guardPrompt;
// → "## GUARDRAILS — You MUST follow these rules:\n### Always\n- ...\n### Never\n- ..."
```

That's the full runtime enforcement loop, in 30 seconds.

---

## Concepts

### Ruleset — a markdown blob

`Ruleset` is a markdown string with the same shape `arules` already writes:

```typescript
interface Ruleset {
  content: string;
}
```

Example content:

```markdown
# Guardrails

## Always
- Be honest about what you don't know
- Confirm before destructive actions
- Cite sources when stating facts

## Never
- Never push to main without explicit approval
- Never commit secrets or credentials
- Never delete production data without confirmation
- ~~Old disabled rule~~

## Safety
- Refuse to create weapons or malware
- Refuse harmful or illegal advice

## Privacy
- Never store personally identifiable information without consent
```

The `## Category` headings are the only structural convention. Any
category name works; the `Always`, `Never`, `Safety`, `Privacy` set is just
the default-template choice. Disabled rules wrap in `~~strikethrough~~`
markers and are filtered out by the parser.

### parseRules — active vs disabled

```typescript
import { parseRules, parseRulesetFull } from "@aman_asmuei/arules-core";

const ruleset = { content: rawMarkdown };

// Get active rules only (strikethrough filtered out)
const active = parseRules(ruleset);
// → [
//     { name: "Always", rules: ["Be honest...", "Confirm before..."] },
//     { name: "Never", rules: ["Never push to main...", "Never commit..."] },
//   ]

// Get all rules with their disabled state preserved (for editing UIs)
const full = parseRulesetFull(ruleset);
// → [
//     { name: "Never", rules: [
//         { text: "Never push to main...", disabled: false },
//         { text: "Old disabled rule",     disabled: true  },
//       ] },
//   ]
```

### checkAction — the enforcement algorithm

The same naive-but-effective keyword-overlap algorithm that's been running
in `aman-tg` production:

1. Collect all "prohibition" rules: everything in the `Never` category, plus
   rules in any other category containing prohibition keywords like `never`,
   `don't`, `must not`, `forbidden`, `prohibited`, `refuse`, `decline`.
2. For each prohibition rule, extract its meaningful keywords:
   lowercase, length > 3, with stopwords filtered out
   (`that`, `this`, `with`, `from`, `about`, ...).
3. Lowercase the action description and check if it contains at least 2
   of the rule's keywords. If yes, flag it as a potential violation.

```typescript
import { checkActionPure, type Ruleset } from "@aman_asmuei/arules-core";

const ruleset: Ruleset = {
  content: "## Never\n- Never delete production data without confirmation\n",
};

const result = checkActionPure(
  "delete production database records permanently",
  ruleset,
);
// → { safe: false, violations: ["Never delete production data without confirmation"] }
```

This is intentionally naive. False positives and false negatives both happen.
A future v0.2 may layer in semantic matching, but the keyword approach is
**preserved exactly** because it's the algorithm rule authors have been
writing against. Stability of the enforcement contract matters more than
algorithmic perfection.

### getGuardrailsPrompt — LLM context injection

Generates a system-prompt block listing the safety-critical rules,
formatted so the LLM treats them as hard constraints:

```typescript
const prompt = await getGuardrailsPrompt({ scope: "dev:default" });
// → "
//
// ## GUARDRAILS — You MUST follow these rules:
//
// ### Always
// - Be honest about what you don't know
// - Confirm before destructive actions
//
// ### Never
// - Never push to main without explicit approval
// - Never commit secrets or credentials
//
// ### Safety
// - Refuse to create weapons or malware
//
// ### Privacy
// - Never store personally identifiable information without consent
//
// Violating these rules is NOT allowed under any circumstances."

systemPrompt += prompt;
```

By default it includes the `Always`, `Never`, `Safety`, and `Privacy`
categories. Override via `{ includeCategories: ["...", "..."] }` if you want
a different selection.

### checkToolCall — runtime tool gating

Same as `checkAction`, but designed for the moment a tool is about to fire.
Returns `null` if safe, an error message string if blocked:

```typescript
const result = await checkToolCall(
  "Fetching URL: https://internal.example.com/admin",
  "dev:default",
);
// → null  if safe
// → "Action blocked by guardrails: Never fetch internal URLs"  if blocked
```

The pattern: build a human-readable description of what the tool is about
to do, pass it to `checkToolCall`. If you get a string back, refuse the
tool call and surface the message to the user.

### Auto-routing storage — convention over configuration

Same pattern as the rest of the aman engine: scope prefix picks the backend.

| Scope prefix | Backend                | Where it persists                                  |
|-------------|------------------------|----------------------------------------------------|
| `dev:*`     | `MarkdownFileStorage`  | `~/.arules/{scope.replace(':','/')}/rules.md`      |
| `tg:*`      | `DatabaseStorage`      | `~/.aman/engine.db` table `arules_rulesets`        |
| `agent:*`   | `DatabaseStorage`      | same                                                |
| (other)     | `DatabaseStorage`      | same                                                |

Override the home directory via `$ARULES_HOME`. The engine DB location is
shared with the rest of the aman engine via `$AMAN_ENGINE_DB`.

### Pure helpers — when you have your own loader

If you load rules from a custom location (e.g. a long-running server with
its own `rules.md` file and mtime caching), bypass the storage layer and
use the pure helpers:

```typescript
import {
  parseRules,
  checkActionPure,
  checkToolCallPure,
  getGuardrailsPromptPure,
} from "@aman_asmuei/arules-core";

const ruleset = { content: fs.readFileSync("./my-rules.md", "utf-8") };

const safe = checkActionPure("delete user records", ruleset);
const prompt = getGuardrailsPromptPure(ruleset);
const block = checkToolCallPure("Deleting user 12345 records", ruleset);
```

This is exactly how `aman-tg`'s `guardrails.ts` consumes the library — it
keeps its own deployment-local `rules.md` and its own mtime caching, and
delegates only the parsing + matching to `arules-core`. Best of both worlds.

---

## API reference

### Async (storage-backed) API

#### Read

| Symbol                               | Returns                          | Purpose                                          |
|-------------------------------------|----------------------------------|--------------------------------------------------|
| `getRuleset(scope?)`                | `Promise<Ruleset \| null>`       | Read ruleset; null if missing                    |
| `getOrCreateRuleset(scope?)`        | `Promise<Ruleset>`               | Read or bootstrap from default template          |
| `listRuleCategories(scope?)`        | `Promise<RuleCategory[]>`        | Active categories only                           |
| `listRuleCategoriesFull(scope?)`    | `Promise<FullRuleCategory[]>`    | Categories with active+disabled rules            |
| `getCategoryRulesForScope(name, scope?)` | `Promise<string[] \| null>`  | Active rules in one category                     |
| `listCategoryNames(scope?)`         | `Promise<string[]>`              | All category names in document order             |
| `listRulesetScopes()`               | `Promise<{markdown, database}>`  | All scopes with stored rulesets                  |

#### Write

| Symbol                               | Returns        | Purpose                                          |
|-------------------------------------|----------------|--------------------------------------------------|
| `putRuleset(ruleset, scope?)`       | `Promise<void>` | Replace the entire ruleset                       |
| `addRule(category, rule, scope?)`   | `Promise<void>` | Add a rule; bootstraps + creates category if missing |
| `removeRule(category, idx, scope?)` | `Promise<void>` | Remove rule by 1-based index                     |
| `toggleRuleAt(category, idx, scope?)` | `Promise<void>` | Toggle disabled state by 1-based index         |
| `deleteRuleset(scope?)`             | `Promise<void>` | Remove the ruleset for a scope                   |

#### Enforcement (the runtime hot path)

| Symbol                              | Returns                  | Purpose                                          |
|------------------------------------|--------------------------|--------------------------------------------------|
| `checkAction(action, scope?)`      | `Promise<CheckActionResult>` | Returns `{violations, safe}`                |
| `checkToolCall(description, scope?)` | `Promise<string \| null>` | null if safe, error message if blocked         |
| `getGuardrailsPrompt(opts?)`       | `Promise<string>`        | System prompt block for LLM injection            |

### Pure helpers (no storage)

| Symbol                                | Returns                  | Purpose                                          |
|--------------------------------------|--------------------------|--------------------------------------------------|
| `parseRules(ruleset)`                | `RuleCategory[]`         | Active categories only                           |
| `parseRulesetFull(ruleset)`          | `FullRuleCategory[]`     | Categories with disabled state                   |
| `getCategoryRules(rs, name)`         | `string[] \| null`       | Active rules in one category                     |
| `listCategories(ruleset)`            | `string[]`               | All category names                                |
| `addRuleToCategory(rs, cat, rule)`   | `Ruleset`                | Pure add — returns new Ruleset                   |
| `removeRuleFromCategory(rs, cat, i)` | `Ruleset`                | Pure remove                                       |
| `toggleRule(rs, cat, i)`             | `Ruleset`                | Pure toggle                                       |
| `checkActionPure(action, rs)`        | `CheckActionResult`      | Sync rule check                                  |
| `checkToolCallPure(desc, rs)`        | `string \| null`         | Sync tool call check                             |
| `getGuardrailsPromptPure(rs, opts?)` | `string`                 | Sync prompt builder                              |
| `DEFAULT_PROMPT_CATEGORIES`          | `readonly string[]`      | `["always", "never", "safety", "privacy"]`       |

### Storage routing & migration

| Symbol                              | Returns                       | Purpose                                          |
|------------------------------------|-------------------------------|--------------------------------------------------|
| `getStorageForScope(scope)`        | `Storage<Ruleset>`            | Pick the right backend for a scope              |
| `getMarkdownStorage()`             | `MarkdownFileStorage<Ruleset>` | Cached singleton for `dev:*`                    |
| `getDatabaseStorage()`             | `DatabaseStorage<Ruleset>`    | Cached singleton for everything else             |
| `getArulesHome()`                  | `string`                      | Root directory (`$ARULES_HOME` or `~/.arules`)  |
| `migrateLegacyArulesFile()`        | `ArulesMigrationReport`       | Copy `~/.arules/rules.md` → `~/.arules/dev/default/rules.md` |
| `defaultRulesetTemplate(scope)`    | `Ruleset`                     | Default markdown template for a new scope        |

The legacy migration is idempotent and **never deletes** the legacy file.

---

## Architecture

`arules-core` is one of three "essential" layer libraries in the aman engine v1:

```
                    ┌──────────────────────────┐
                    │     aman engine v1       │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │   aman-core        │  │ ← shared substrate
                    │  │   Scope, Storage   │  │
                    │  └─────────┬──────────┘  │
                    │            │             │
                    │       ┌────┴─────┐       │
                    │       │          │       │
                    │       ▼          ▼       │
                    │  ┌─────────┐ ┌─────────┐ │
                    │  │ acore-  │ │ arules- │ │
                    │  │ core    │ │ core    │ │
                    │  │         │ │ ←YOU    │ │
                    │  │ identity│ │ rules   │ │
                    │  └─────────┘ └─────────┘ │
                    └──────────────────────────┘
                              ▲
                              │ consumed by
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   aman-mcp             aman-agent              aman-tg
   (MCP server         (CLI runtime)         (Telegram backend)
    aggregator)                              ← code originated HERE
```

**Where consumers use it**:

- `aman-mcp` exposes `arules-core` via MCP tools (`rules_list`, `rules_check`,
  `rules_add`, `rules_remove`, `rules_toggle`) — all scope-aware
- `aman-agent` calls `arules-core` directly from its `/rules` slash command
- `aman-tg` consumes `arules-core` from its `apps/api/src/guardrails.ts`,
  closing the loop on the upstream migration. Same algorithm, now multi-tenant,
  shared with every other consumer.

---

## What this is NOT

To stay focused, `arules-core` deliberately does not provide:

- **Tool-specific guardrails.** Things like "block private IP fetches in
  `fetch_url`" are security invariants that should be hardcoded in the
  calling layer, not expressed as rules. `arules-core` handles the
  rule-driven part; the layer wraps it with whatever else it needs.
- **A semantic / LLM-based rule matcher.** Deferred to v0.2. The naive
  keyword approach is preserved because it's the in-production algorithm
  rule authors have been writing against. Stability > algorithmic perfection
  (for now).
- **Authentication or authorization.** This is "what won't the AI do," not
  "who is allowed to ask." Use your auth system; pass the user ID as scope.
- **A CLI.** That's `@aman_asmuei/arules`. This package is the library
  the CLI will eventually wrap.

---

## Quality signals

- **83 unit tests, all passing**, across 4 test files:
  - `ruleset.test.ts` — 27 tests covering parsing, strikethrough handling,
    add/remove/toggle, special section names, case-insensitive lookups
  - `enforce.test.ts` — 19 tests covering `checkAction` keyword overlap,
    prohibition keyword detection, prompt generation with custom categories,
    case insensitivity
  - `api.test.ts` — 30 tests covering scope routing, multi-tenant isolation,
    `withScope` propagation, an end-to-end "Jiran-pattern" test simulating
    aman-tg's per-user enforcement flow
  - `migrate.test.ts` — 7 tests covering idempotent legacy migration with
    byte-exact preservation
- **`tsc --noEmit` clean** with `strict` mode
- **Algorithm-equivalent with the production version** in `aman-tg`'s
  `guardrails.ts`. After Phase 7 of the engine v1 build, `aman-tg` consumes
  this library and its existing 26 tests still pass — proof of behavior equivalence.

---

## The aman ecosystem

`arules-core` is one of several packages in the aman AI companion ecosystem:

| Layer                                                                   | Role                                                |
|------------------------------------------------------------------------|-----------------------------------------------------|
| [@aman_asmuei/aman-core](https://github.com/amanasmuei/aman-core)       | Substrate — Scope, Storage, withScope               |
| [@aman_asmuei/acore-core](https://github.com/amanasmuei/acore-core)     | Identity layer — multi-tenant Identity records      |
| **[@aman_asmuei/arules-core](https://github.com/amanasmuei/arules-core)** | **Guardrails layer (this package)**               |
| [@aman_asmuei/amem-core](https://github.com/amanasmuei/amem)            | Memory layer — semantic recall, embeddings          |
| [@aman_asmuei/aman-mcp](https://github.com/amanasmuei/aman-mcp)         | MCP server aggregating all layers for any host      |
| [@aman_asmuei/aman-agent](https://github.com/amanasmuei/aman-agent)     | Standalone CLI runtime, multi-LLM, scope-aware      |
| [@aman_asmuei/arules](https://github.com/amanasmuei/arules)             | Single-user CLI — predates this library             |
| [aman-claude-code](https://github.com/amanasmuei/aman-claude-code)                | Claude Code plugin (hooks + skills + MCP installer) |
| [@aman_asmuei/aman](https://github.com/amanasmuei/aman)                 | Umbrella installer — one command for the ecosystem  |

---

## License

[MIT](LICENSE) © Aman Asmuei

---

<div align="center">
  <sub>Built with ❤️ in 🇲🇾 <strong>Malaysia</strong> · Part of the <a href="https://github.com/amanasmuei">aman ecosystem</a></sub>
</div>
