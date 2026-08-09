import {
  type CapabilityPlan,
  type CapabilityRequirement,
  type BrowserProvisionMode,
  type PoppinCapability,
} from './capabilities';

/**
 * Capability Router.
 *
 * Its job is *not* to reason about how to solve the task. Its job is:
 *
 *   > Ensure the selected agent begins with a truthful, usable environment.
 *
 * The user must never need a magic phrase such as "use browser". Routing mixes
 * deterministic structural signals (an explicit URL, an interaction verb aimed
 * at the page in front of the user) with a lightweight weighted classifier for
 * "does this need live web access". A genuinely uncertain result asks the user
 * instead of guessing in either direction.
 */

export interface CapabilityRouterInput {
  prompt: string;
  /** A local Git project is connected. */
  hasProject: boolean;
  /** Number of explicitly checked context items (tabs, documents, pages). */
  selectedContextCount: number;
  /** A browsable http(s) tab is currently visible to the user. */
  hasActiveBrowsableTab: boolean;
  tandem: { available: boolean; writable: boolean };
}

interface Signal {
  pattern: RegExp;
  weight: number;
  reason: string;
}

/** Evidence that the task depends on information Poppin does not already hold. */
const LIVE_SIGNALS: Signal[] = [
  { pattern: /https?:\/\/\S+/i, weight: 4, reason: 'the request names a web address' },
  { pattern: /\bdraft\b[\s\S]{0,40}\b(?:e-?mail|mail|message|reply)\b/i, weight: 4, reason: 'drafting inside a web application' },
  { pattern: /\b(?:current|currently|latest|today|todays|today's|right now|this week|live|real[- ]?time|up[- ]to[- ]date)\b/i, weight: 3, reason: 'the answer changes over time' },
  { pattern: /\b(?:price|prices|pricing|cost|costs|deal|deals|discount|in stock|availability|available)\b/i, weight: 3, reason: 'prices or availability must be read live' },
  // An explicit ask for the web is decisive on its own.
  { pattern: /\b(?:browse|browsing|online|web search|search the web|on the (?:web|internet)|google it)\b/i, weight: 4, reason: 'the request explicitly asks for the web' },
  { pattern: /\b(?:search|look up|find me|show me)\b/i, weight: 3, reason: 'the request asks for a lookup' },
  { pattern: /\bsave\b[\s\S]{0,20}\bdraft\b/i, weight: 3, reason: 'saving a draft happens in a live page' },
  // Discovery verbs state outright that Poppin must go and obtain something.
  { pattern: /\b(?:research|find out|look into|investigate|check whether|verify|confirm|fact[- ]?check)\b/i, weight: 4, reason: 'the request asks Poppin to find or verify something' },
  // Judgement verbs can apply to supplied material just as easily as to the web.
  { pattern: /\b(?:compare|recommend|evaluate|shortlist|suggest)\b/i, weight: 2, reason: 'the request weighs options that may not be supplied' },
  { pattern: /\b(?:products?|listings?|hotels?|flights?|restaurants?|reviews?|headlines?|news|weather)\b/i, weight: 2, reason: 'the subject lives on public web pages' },
  { pattern: /(?:₹|\$|€|£|\brs\.?|\binr\b|\busd\b)\s?[\d,]+|\b(?:under|below|less than|cheaper than)\s+[₹$€£]?[\d,]+/i, weight: 2, reason: 'a live price constraint was given' },
  { pattern: /\b(?:buy|purchase|book|order)\b/i, weight: 1, reason: 'buying implies a live storefront' },
];

/** Evidence that everything needed was already supplied to Poppin. */
const STATIC_SIGNALS: Signal[] = [
  { pattern: /\b(?:this|the|that)\s+(?:\w+\s+){0,2}(?:supplied|attached|uploaded|pasted)\b/i, weight: -4, reason: 'the material was supplied directly' },
  { pattern: /\b(?:these|those)\s+(?:\w+\s+){0,2}(?:documents?|files?|pages?|attachments?)\b/i, weight: -4, reason: 'the request points at selected items' },
  { pattern: /\b(?:this|the)\s+(?:\w+\s+){0,2}(?:supplied|selected|attached)\s+(?:document|file|text|page)\b/i, weight: -4, reason: 'the request points at selected items' },
  { pattern: /\bfrom (?:the )?(?:selected|supplied|attached) (?:context|documents?|pages?)\b/i, weight: -3, reason: 'the request scopes itself to selected context' },
];

/** Verbs that mean the agent must be able to drive a page, not just read it. */
const INTERACTION_INTENT = /\b(?:click|fill|fill in|type|enter|select|choose|scroll|submit|press|toggle|tick|drag|upload|sign in|log ?in|check the box)\b/i;

/** A pointer at the page the user is looking at right now. */
const DEICTIC_PAGE = /\b(?:this|that|the current|the open|the)\s+(?:\w+\s+){0,2}(?:page|site|website|tab|form|dialog|modal|field|button|screen|window|checkout|cart)\b/i;

const CODE_INTENT = /\b(fix|implement|code|refactor|debug|build|modify|change|update|add|remove|rename|test|make)\b[\s\S]{0,80}\b(app|application|button|code|component|css|files?|html|interface|layout|page|project|repo(?:sitory)?|test|tsx?|ui)\b|\b(pull request|merge request|commit|branch|github pr|localhost preview)\b/i;

const TANDEM_INTENT = /\btandem\b/i;
const TANDEM_WRITE_INTENT = /\b(?:add|append|save|write|put|push|create|update|record|capture|log)\b/i;
/** "a new Notes page", "a page called X" — Tandem work without naming Tandem. */
const TANDEM_PAGE_INTENT = /\b(?:new\s+)?(?:notes?|page|doc|document)\s+(?:named|called|titled)\b|\bnotes page\b/i;

const EXPLORATION_THRESHOLD = 4;
const UNCERTAIN_THRESHOLD = 2;

export const BROWSER_CONFIRMATION_QUESTION = 'This request needs live web access. Use Browser?';

export function routeCapabilities(input: CapabilityRouterInput): CapabilityPlan {
  const { prompt } = input;
  const requirements: CapabilityRequirement[] = [];
  const add = (capability: PoppinCapability, reason: string) => {
    if (!requirements.some((entry) => entry.capability === capability)) requirements.push({ capability, reason });
  };

  if (input.selectedContextCount > 0) add('context_read', 'explicitly selected context is attached to this task');

  const isCode = CODE_INTENT.test(prompt);
  if (isCode && input.hasProject) {
    add('local_project', 'the request changes the connected project');
    add('filesystem', 'project edits need file access');
    add('terminal', 'verification commands run in the project');
  }

  const { score, reasons } = scorePrompt(prompt);
  const wantsInteraction = INTERACTION_INTENT.test(prompt);
  const pointsAtOpenPage = DEICTIC_PAGE.test(prompt);

  let browser: BrowserProvisionMode = 'none';
  let confirmation: string | null = null;

  if (wantsInteraction && pointsAtOpenPage) {
    // Deterministic: the user is talking about the page in front of them and
    // wants something done to it. Reading extracted text is not enough.
    browser = 'selected-tab';
    add('selected_tab_control', 'the request acts on the page you are looking at');
    add('browser_control', 'the agent needs a controllable browsing context');
  } else if (score >= EXPLORATION_THRESHOLD) {
    browser = 'exploration';
    add('browser_exploration', reasons[0] ?? 'the request needs live web access');
    add('browser_control', 'the agent needs a controllable browsing context');
  } else if (pointsAtOpenPage && input.hasActiveBrowsableTab) {
    // Inspecting the open website: a real browsing context, read-only intent.
    browser = 'selected-tab';
    add('browser_control', 'the request inspects the website you have open');
  } else if (score >= UNCERTAIN_THRESHOLD) {
    confirmation = BROWSER_CONFIRMATION_QUESTION;
    browser = 'context-only';
    add('context_read', 'Poppin is unsure whether live web access is needed');
  } else if (input.selectedContextCount > 0) {
    browser = 'context-only';
  }

  if (wantsInteraction && pointsAtOpenPage && !input.hasActiveBrowsableTab) {
    // The requirement stands; provisioning will report BROWSER_NOT_PROVISIONED.
    confirmation = 'This request acts on an open web page, but no browsable tab is active. Open the page first?';
  }

  if (input.tandem.available && (TANDEM_INTENT.test(prompt) || TANDEM_PAGE_INTENT.test(prompt))) {
    add('tandem_read', 'the request refers to Tandem content');
    if (input.tandem.writable && TANDEM_WRITE_INTENT.test(prompt)) {
      add('tandem_write', 'the request stores something in Tandem');
      add('document_write', 'a Tandem page will be created or updated');
    }
  }

  return {
    capabilities: requirements.map((entry) => entry.capability),
    requirements,
    browser,
    confirmation,
  };
}

/** Weighted classification of "does this need information Poppin does not have". */
export function scorePrompt(prompt: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const signal of [...LIVE_SIGNALS, ...STATIC_SIGNALS]) {
    if (!signal.pattern.test(prompt)) continue;
    score += signal.weight;
    if (signal.weight > 0) reasons.push(signal.reason);
  }
  return { score, reasons };
}
