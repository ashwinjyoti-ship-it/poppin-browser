import type { CapabilityPlan } from './capabilities';
import { routeCapabilities, type CapabilityRouterInput } from './capability-router';
import type { TaskKind } from './task';

export interface TaskRequirements {
  kind: TaskKind;
  browserUse: boolean;
  modifiesProject: boolean;
  consequentialActions: string[];
  /** The full machine-readable plan behind the summary flags above. */
  plan: CapabilityPlan;
}

const CODE_INTENT = /\b(fix|implement|code|refactor|debug|build|modify|change|update|add|remove|rename|test|make)\b[\s\S]{0,80}\b(app|application|button|code|component|css|files?|html|interface|layout|page|project|repo(?:sitory)?|test|tsx?|ui)\b|\b(pull request|merge request|commit|branch|github pr|localhost preview)\b/i;
const DELIVERY_INTENT = /\b(push|create (?:a )?(?:pull request|pr)|merge (?:the )?(?:pull request|pr)|publish|send (?:an )?(?:email|mail|message|reply)|upload|download|purchase|buy|delete)\b/gi;

export interface TaskRequirementContext {
  selectedContextCount?: number;
  selectedTabContextCount?: number;
  hasActiveBrowsableTab?: boolean;
  tandem?: { available: boolean; writable: boolean };
}

/**
 * Product-level summary of what a prompt needs, backed by the Capability Router.
 * Poppin decides this before the agent starts so the user never has to say
 * "use browser".
 */
export function inferTaskRequirements(
  prompt: string,
  hasProject: boolean,
  context: TaskRequirementContext = {},
): TaskRequirements {
  const kind: TaskKind = CODE_INTENT.test(prompt) ? 'code' : 'work';
  const consequentialActions = Array.from(prompt.matchAll(DELIVERY_INTENT), (match) => match[0]!.toLowerCase());
  const routerInput: CapabilityRouterInput = {
    prompt,
    hasProject,
    selectedContextCount: context.selectedContextCount ?? 0,
    selectedTabContextCount: context.selectedTabContextCount ?? 0,
    hasActiveBrowsableTab: context.hasActiveBrowsableTab ?? false,
    tandem: context.tandem ?? { available: false, writable: false },
  };
  const plan = routeCapabilities(routerInput);
  return {
    kind,
    browserUse: plan.browser === 'exploration' || plan.browser === 'selected-tab',
    modifiesProject: kind === 'code' && hasProject,
    consequentialActions: [...new Set(consequentialActions)],
    plan,
  };
}
