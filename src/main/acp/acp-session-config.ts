import type { AgentControlSupport, AgentModelOption } from '../../shared/agent';
import type { AcpConfigOption, AcpLegacyModelsState, AcpNewSessionResponse } from './acp-protocol';

const AGENT_DEFAULT_EFFORT = 'agent-default';

export interface AcpDiscoveredControls {
  models: AgentModelOption[];
  controls: AgentControlSupport;
  modelConfigId: string | null;
  thoughtConfigId: string | null;
}

/**
 * Map ACP `session/new` configOptions (and the legacy Cursor `models` field)
 * into Poppin's harness-agnostic model / reasoning selectors.
 */
export function discoverControlsFromSession(response: Pick<AcpNewSessionResponse, 'configOptions' | 'models'>): AcpDiscoveredControls {
  const options = Array.isArray(response.configOptions) ? response.configOptions : [];
  const modelOption = findSelectOption(options, 'model') ?? findSelectOptionById(options, 'model');
  const thoughtOption = findSelectOption(options, 'thought_level')
    ?? findSelectOptionById(options, 'thought_level')
    ?? findSelectOptionById(options, 'reasoning');

  const thoughtEfforts = selectValues(thoughtOption);
  const defaultThought = currentSelectValue(thoughtOption) ?? thoughtEfforts[0] ?? AGENT_DEFAULT_EFFORT;

  let models = modelOption
    ? selectValues(modelOption).map((value, index) => {
        const entry = modelOption.options?.find((candidate) => candidate.value === value);
        return {
          id: value,
          name: entry?.name ?? value,
          description: entry?.description ?? 'ACP session model',
          reasoningEfforts: thoughtEfforts.length > 0 ? thoughtEfforts : [AGENT_DEFAULT_EFFORT],
          defaultReasoningEffort: defaultThought,
          isDefault: value === (currentSelectValue(modelOption) ?? modelOption.options?.[0]?.value) || (index === 0 && !currentSelectValue(modelOption)),
        } satisfies AgentModelOption;
      })
    : modelsFromLegacy(response.models, thoughtEfforts, defaultThought);

  if (models.length === 0) {
    return {
      models: [],
      controls: { model: false, reasoning: false },
      modelConfigId: null,
      thoughtConfigId: null,
    };
  }

  // Ensure exactly one default.
  if (!models.some((model) => model.isDefault)) {
    models = models.map((model, index) => ({ ...model, isDefault: index === 0 }));
  }

  return {
    models,
    controls: {
      model: true,
      reasoning: thoughtEfforts.length > 1,
    },
    modelConfigId: modelOption?.id ?? null,
    thoughtConfigId: thoughtOption?.id ?? null,
  };
}

function modelsFromLegacy(
  legacy: AcpLegacyModelsState | null | undefined,
  thoughtEfforts: string[],
  defaultThought: string,
): AgentModelOption[] {
  const available = Array.isArray(legacy?.availableModels) ? legacy.availableModels : [];
  if (available.length === 0) return [];
  const current = typeof legacy?.currentModelId === 'string' ? legacy.currentModelId : available[0]?.modelId;
  return available
    .filter((entry) => typeof entry.modelId === 'string' && entry.modelId)
    .map((entry) => ({
      id: entry.modelId,
      name: entry.name || entry.modelId,
      description: entry.description ?? 'ACP session model',
      reasoningEfforts: thoughtEfforts.length > 0 ? thoughtEfforts : [AGENT_DEFAULT_EFFORT],
      defaultReasoningEffort: defaultThought,
      isDefault: entry.modelId === current,
    }));
}

function findSelectOption(options: AcpConfigOption[], category: string): AcpConfigOption | null {
  return options.find((option) => option.category === category && isSelectOption(option)) ?? null;
}

function findSelectOptionById(options: AcpConfigOption[], id: string): AcpConfigOption | null {
  return options.find((option) => option.id === id && isSelectOption(option)) ?? null;
}

function isSelectOption(option: AcpConfigOption): boolean {
  return option.type === undefined || option.type === 'select';
}

function selectValues(option: AcpConfigOption | null): string[] {
  if (!option?.options?.length) return [];
  return option.options.map((entry) => entry.value).filter(Boolean);
}

function currentSelectValue(option: AcpConfigOption | null): string | null {
  return typeof option?.currentValue === 'string' ? option.currentValue : null;
}
