import { describe, expect, it } from 'vitest';

import { BROWSER_CONFIRMATION_QUESTION, routeCapabilities, type CapabilityRouterInput } from '../src/shared/capability-router';

function route(prompt: string, overrides: Partial<CapabilityRouterInput> = {}) {
  return routeCapabilities({
    prompt,
    hasProject: false,
    selectedContextCount: 0,
    hasActiveBrowsableTab: false,
    tandem: { available: false, writable: false },
    ...overrides,
  });
}

describe('capability router', () => {
  it('provisions a fresh exploration tab for live research without any magic phrase', () => {
    for (const prompt of [
      'Research current Amazon India prices.',
      'Find three products currently under ₹5,000.',
      'Research three 512GB NVMe drives under ₹5,000 on Amazon India.',
      'Verify this information online.',
      'What are the latest reviews for this camera?',
    ]) {
      const plan = route(prompt);
      expect(plan.browser, prompt).toBe('exploration');
      expect(plan.capabilities, prompt).toContain('browser_exploration');
      expect(plan.confirmation, prompt).toBeNull();
    }
  });

  it('provisions a controllable selected tab when the user acts on the open page', () => {
    const plan = route('Fill the Email field in this open dialog.', { hasActiveBrowsableTab: true });
    expect(plan.browser).toBe('selected-tab');
    expect(plan.capabilities).toContain('selected_tab_control');
    expect(plan.capabilities).toContain('browser_control');
  });

  it('still requires the selected tab when no browsable tab is open, and says so', () => {
    const plan = route('Click Login on this page and stop before submitting.');
    expect(plan.browser).toBe('selected-tab');
    expect(plan.confirmation).toContain('no browsable tab is active');
  });

  it('uses the open website as a browsing context for inspection requests', () => {
    const plan = route('Check the form open on this site.', { hasActiveBrowsableTab: true });
    expect(plan.browser).toBe('selected-tab');
    expect(plan.capabilities).toContain('browser_control');
  });

  it('keeps supplied-content work on context only', () => {
    const plan = route('Summarise this supplied document.', { selectedContextCount: 1 });
    expect(plan.browser).toBe('context-only');
    expect(plan.capabilities).toEqual(['context_read']);
  });

  it('asks before starting when the signal is weak and only documents were supplied', () => {
    const plan = route('Compare the two options and recommend one.', { selectedContextCount: 1 });
    expect(plan.confirmation).toBe(BROWSER_CONFIRMATION_QUESTION);
    expect(plan.browser).toBe('context-only');
  });

  it('makes selected tabs agent-controllable when the request needs live work', () => {
    const plan = route('Compare the two options and recommend one.', {
      selectedContextCount: 1,
      selectedTabContextCount: 1,
    });
    expect(plan.confirmation).toBeNull();
    expect(plan.browser).toBe('selected-tab');
    expect(plan.capabilities).toContain('selected_tab_control');
  });

  it('provisions browsing for a weak-signal request when nothing was supplied', () => {
    // With no selected context there is nothing else the agent could use, so
    // Poppin browses instead of asking or silently running context-only.
    for (const prompt of [
      'Compare the MacBook Air and the Dell XPS.',
      'What is the weather in Mumbai?',
      'Plan a 3 day trip to Jaipur.',
    ]) {
      const plan = route(prompt);
      expect(plan.browser, prompt).toBe('exploration');
      expect(plan.confirmation, prompt).toBeNull();
    }
  });

  it('provisions browsing for mailbox work without a magic phrase', () => {
    for (const prompt of [
      'Check my inbox for unread requests.',
      'Summarise new Gmail threads.',
      'Draft a reply to the quote request in my mailbox.',
    ]) {
      const plan = route(prompt);
      expect(plan.browser, prompt).toBe('exploration');
      expect(plan.confirmation, prompt).toBeNull();
    }
  });

  it('treats navigation commands and bare website names as browser requests', () => {
    for (const prompt of [
      'Go to amazon and find wireless earbuds under 2000.',
      'Visit nytimes.com.',
      'Open YouTube and play lo-fi music.',
      'Order groceries from bigbasket.',
      'Apply to software engineering jobs on LinkedIn.',
      'Check whether poppin.dev is up.',
      'Book a table for two at an Italian restaurant tonight.',
      'Find flights from Delhi to Goa next weekend.',
    ]) {
      const plan = route(prompt);
      expect(plan.browser, prompt).toBe('exploration');
      expect(plan.confirmation, prompt).toBeNull();
    }
  });

  it('sends page interaction at a named site to a fresh exploration tab when none is open', () => {
    const plan = route('Fill out the contact form on stripe.com.');
    expect(plan.browser).toBe('exploration');
    expect(plan.confirmation).toBeNull();
  });

  it('keeps purely generative prompts off the browser', () => {
    for (const prompt of [
      'Write a haiku about spring.',
      'Explain how JWT authentication works.',
      'Rewrite this paragraph to be friendlier.',
      'Brainstorm five names for a coffee shop.',
    ]) {
      const plan = route(prompt);
      expect(plan.browser, prompt).toBe('none');
      expect(plan.confirmation, prompt).toBeNull();
    }
  });

  it('routes Tandem reads and writes when Tandem is connected', () => {
    const write = route('Research X and push the results to Tandem on a new page named Y.', {
      tandem: { available: true, writable: true },
    });
    expect(write.browser).toBe('exploration');
    expect(write.capabilities).toEqual(expect.arrayContaining(['browser_exploration', 'tandem_read', 'tandem_write', 'document_write']));

    const read = route('Read the Tandem page about onboarding.', { tandem: { available: true, writable: true } });
    expect(read.capabilities).toContain('tandem_read');
    expect(read.capabilities).not.toContain('tandem_write');
  });

  it('recognises Tandem work that never names Tandem', () => {
    const plan = route('Open a new Notes page and add the URL of this video.', {
      tandem: { available: true, writable: true },
      hasActiveBrowsableTab: true,
    });
    expect(plan.capabilities).toContain('tandem_write');
  });

  it('never asks for Tandem capabilities when Tandem is not connected', () => {
    const plan = route('Save this to Tandem.', { tandem: { available: false, writable: false } });
    expect(plan.capabilities).not.toContain('tandem_read');
  });

  it('requires project capabilities for code work', () => {
    const plan = route('Refactor the login component and update its tests.', { hasProject: true });
    expect(plan.capabilities).toEqual(expect.arrayContaining(['local_project', 'filesystem', 'terminal']));
    expect(plan.browser).toBe('none');
  });
});
