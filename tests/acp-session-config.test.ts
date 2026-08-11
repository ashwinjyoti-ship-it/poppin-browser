// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { discoverControlsFromSession } from '../src/main/acp/acp-session-config';

describe('discoverControlsFromSession', () => {
  it('maps ACP model configOptions into Poppin model selectors', () => {
    const discovered = discoverControlsFromSession({
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'default[]',
        options: [
          { value: 'default[]', name: 'Auto' },
          { value: 'grok-4.5[effort=high,fast=true]', name: 'grok-4.5' },
          { value: 'composer-2.5[fast=true]', name: 'composer-2.5' },
        ],
      }],
    });

    expect(discovered.controls).toEqual({ model: true, reasoning: false });
    expect(discovered.modelConfigId).toBe('model');
    expect(discovered.models.map((model) => model.name)).toEqual(['Auto', 'grok-4.5', 'composer-2.5']);
    expect(discovered.models.find((model) => model.isDefault)?.id).toBe('default[]');
  });

  it('falls back to the legacy Cursor models field', () => {
    const discovered = discoverControlsFromSession({
      models: {
        currentModelId: 'composer-2.5[fast=true]',
        availableModels: [
          { modelId: 'default[]', name: 'Auto' },
          { modelId: 'composer-2.5[fast=true]', name: 'composer-2.5' },
        ],
      },
    });
    expect(discovered.controls.model).toBe(true);
    expect(discovered.models.find((model) => model.isDefault)?.name).toBe('composer-2.5');
  });
});
