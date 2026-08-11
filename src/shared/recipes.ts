/**
 * Transparent site recipes (Phase 13): local, visible, parameterized records of
 * a successful verified browser workflow. Never store credentials, cookies,
 * tokens, or private fill values unless the user explicitly opts in later.
 */

export interface RecipeStepSnapshot {
  /** Human-readable action label from the automation log (navigate, click, …). */
  action: string;
  /** Safe target summary (URL, role/name, or ref description) — never password values. */
  target: string;
  /** Outcome-safe detail for inspection. */
  detail: string;
}

export interface RecipeSnapshot {
  id: string;
  name: string;
  /** Optional starting http(s) URL captured from the first navigate step. */
  startUrl: string | null;
  /** Inspectable, sanitized step list from a successful run. */
  steps: RecipeStepSnapshot[];
  /** When false, the recipe stays listed but cannot be run. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const CREDENTIAL_HINT = /\b(password|passkey|credential|otp|one[-_ ]?time|verification[-_ ]?code|cookie|token|secret)\b/i;
const HTTP_URL = /^https?:\/\//i;

/**
 * Builds a recipe draft from a successful automation log. Credential-looking
 * targets/details are dropped; fill/type steps keep the target but strip typed
 * values from detail. Returns null when fewer than two safe steps remain.
 */
export function sanitizeRecipeSteps(
  entries: ReadonlyArray<{ action: string; target: string; detail: string; outcome: string }>,
): RecipeStepSnapshot[] | null {
  const completed = entries.filter((entry) => entry.outcome === 'completed' || entry.outcome === 'started');
  const steps: RecipeStepSnapshot[] = [];
  for (const entry of completed) {
    if (CREDENTIAL_HINT.test(entry.action) || CREDENTIAL_HINT.test(entry.target) || CREDENTIAL_HINT.test(entry.detail)) {
      continue;
    }
    const action = collapse(entry.action).slice(0, 80);
    if (!action || /^(Agent Tabs|Browser (use|access|action)|User took|Keep Agent|Close Agent Tabs after)/i.test(action)) {
      continue;
    }
    let detail = collapse(entry.detail).slice(0, 240);
    if (/^(type|fill)$/i.test(action) || /\btyped\b/i.test(detail)) {
      detail = 'Typed into a non-credential field (value not stored).';
    }
    steps.push({
      action,
      target: collapse(entry.target).slice(0, 240),
      detail,
    });
  }
  return steps.length >= 2 ? steps.slice(0, 80) : null;
}

export function recipeStartUrl(steps: readonly RecipeStepSnapshot[]): string | null {
  for (const step of steps) {
    if (/^navigate$/i.test(step.action) && HTTP_URL.test(step.target)) return step.target;
    if (HTTP_URL.test(step.target)) return step.target;
  }
  return null;
}

/** Prompt used when "Run recipe" starts a browser-enabled Work follow-up. */
export function recipeRunPrompt(recipe: RecipeSnapshot): string {
  const lines = recipe.steps.map((step, index) => `${index + 1}. ${step.action} → ${step.target}${step.detail ? ` (${step.detail})` : ''}`);
  return [
    `Run the saved Poppin recipe "${recipe.name}" using Agent Tabs.`,
    recipe.startUrl ? `Start from ${recipe.startUrl} when helpful.` : null,
    'Follow these inspectable steps, adapt if the page changed, and stop for any critical or credential action:',
    ...lines,
    'Finish with a short verified summary and cite sources with markdown links.',
  ].filter(Boolean).join('\n');
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
