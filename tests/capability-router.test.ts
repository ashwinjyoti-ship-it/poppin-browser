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

  it('asks before starting when the live-access signal is genuinely weak', () => {
    const plan = route('Compare the two options and recommend one.');
    expect(plan.confirmation).toBe(BROWSER_CONFIRMATION_QUESTION);
    expect(plan.browser).toBe('context-only');
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
