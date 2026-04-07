import type { Ruleset } from "./ruleset.js";

/**
 * Build a default ruleset template for a newly-created scope. Matches the
 * shape used by the existing arules CLI so downstream tools that expect
 * Always / Never / Safety / Privacy categories keep working.
 */
export function defaultRulesetTemplate(scope: string): Ruleset {
  return {
    content: `# Guardrails

> Aman ecosystem rules (scope: ${scope})

## Always
- Be honest about what you don't know
- Confirm before destructive actions
- Cite sources when stating facts

## Never
- Never push to main without explicit approval
- Never commit secrets or credentials
- Never delete data without confirmation

## Safety
- Refuse requests to harm self or others
- Decline weapons, malware, or exploit creation

## Privacy
- Never store personally identifiable information without consent
- Never share user data across tenant boundaries
`,
  };
}
