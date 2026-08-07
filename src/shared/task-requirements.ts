import type { TaskKind } from './task';

export interface TaskRequirements {
  kind: TaskKind;
  browserUse: boolean;
  modifiesProject: boolean;
  consequentialActions: string[];
}

const CODE_INTENT = /\b(fix|implement|code|refactor|debug|build|modify|change|update|add|remove|rename|test|make)\b[\s\S]{0,80}\b(app|application|button|code|component|css|html|interface|layout|page|project|repo(?:sitory)?|source|test|tsx?|ui)\b|\b(pull request|merge request|commit|branch|github pr|localhost preview)\b/i;
const BROWSER_INTENT = /\b(browse|browser|click|navigate|open (?:the )?page|scroll|search (?:the )?(?:web|site)|use (?:the )?(?:tab|website)|read (?:the )?(?:transcript|captions))\b|\bdraft[\s\S]{0,40}\b(?:email|mail|reply)\b|\bsave[\s\S]{0,20}\bdraft\b/i;
const DELIVERY_INTENT = /\b(push|create (?:a )?(?:pull request|pr)|merge (?:the )?(?:pull request|pr)|publish|send (?:an )?(?:email|mail|message|reply)|upload|download|purchase|buy|delete)\b/gi;

export function inferTaskRequirements(prompt: string, hasProject: boolean): TaskRequirements {
  const kind: TaskKind = CODE_INTENT.test(prompt) ? 'code' : 'work';
  const consequentialActions = Array.from(prompt.matchAll(DELIVERY_INTENT), (match) => match[0]!.toLowerCase());
  return {
    kind,
    browserUse: BROWSER_INTENT.test(prompt),
    modifiesProject: kind === 'code' && hasProject,
    consequentialActions: [...new Set(consequentialActions)],
  };
}
