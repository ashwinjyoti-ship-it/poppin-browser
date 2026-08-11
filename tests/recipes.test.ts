// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { recipeRunPrompt, sanitizeRecipeSteps } from '../src/shared/recipes';
import type { RecipeSnapshot } from '../src/shared/recipes';

describe('sanitizeRecipeSteps', () => {
  it('drops credential-looking steps', () => {
    const result = sanitizeRecipeSteps([
      { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.', outcome: 'completed' },
      { action: 'fill', target: 'password field', detail: 'Typed secret value', outcome: 'completed' },
      { action: 'click', target: 'Sign in', detail: 'Submitted the form.', outcome: 'completed' },
    ]);
    expect(result).toEqual([
      { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.' },
      { action: 'click', target: 'Sign in', detail: 'Submitted the form.' },
    ]);
  });

  it('strips typed values from fill/type details', () => {
    const result = sanitizeRecipeSteps([
      { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.', outcome: 'completed' },
      { action: 'type', target: 'Email', detail: 'Typed user@example.com', outcome: 'completed' },
      { action: 'click', target: 'Continue', detail: 'Moved to the next step.', outcome: 'completed' },
    ]);
    expect(result?.[1]).toMatchObject({
      action: 'type',
      target: 'Email',
      detail: 'Typed into a non-credential field (value not stored).',
    });
  });

  it('returns null when fewer than two safe steps remain', () => {
    expect(sanitizeRecipeSteps([
      { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.', outcome: 'completed' },
    ])).toBeNull();

    expect(sanitizeRecipeSteps([
      { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.', outcome: 'completed' },
      { action: 'fill', target: 'password', detail: 'Typed secret', outcome: 'completed' },
    ])).toBeNull();
  });
});

describe('recipeRunPrompt', () => {
  it('includes the recipe name and numbered steps', () => {
    const recipe: RecipeSnapshot = {
      id: 'recipe-one',
      name: 'Example sign-in',
      startUrl: 'https://example.com/',
      steps: [
        { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.' },
        { action: 'click', target: 'Sign in', detail: 'Opened the sign-in form.' },
      ],
      enabled: true,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };

    const prompt = recipeRunPrompt(recipe);
    expect(prompt).toContain('Run the saved Poppin recipe "Example sign-in"');
    expect(prompt).toContain('Start from https://example.com/');
    expect(prompt).toContain('1. navigate → https://example.com/ (Opened landing page.)');
    expect(prompt).toContain('2. click → Sign in (Opened the sign-in form.)');
  });
});
