import type { BrowserCommand, BrowserSnapshot, BrowserTabSnapshot } from '../../shared/browser';

export interface AddressIssue {
  tabId: string;
  url: string;
  message: string;
}

export function issueForCommand(
  command: BrowserCommand,
  message: string,
  snapshot: BrowserSnapshot,
  activeTab: BrowserTabSnapshot | null,
): AddressIssue {
  const tabId = 'tabId' in command ? command.tabId : activeTab?.id ?? '';
  const tab = snapshot.tabs.find((candidate) => candidate.id === tabId) ?? activeTab;
  return { tabId, url: tab?.url ?? '', message };
}

export function visibleAddressIssue(issue: AddressIssue | null, activeTab: BrowserTabSnapshot | null): string {
  return issue && activeTab?.id === issue.tabId && activeTab.url === issue.url ? issue.message : '';
}
