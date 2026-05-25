/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpModelInfo } from '@/common/types/acpTypes';

type CodexModel = { id: string; label: string; description: string };

/**
 * Default Codex model list maintained by AionUi.
 * These are known models that Codex CLI supports.
 * Validation is done by Codex CLI itself - AionUi only passes the model name.
 *
 * The first entry is used as the default when the user hasn't made a selection.
 */
export const DEFAULT_CODEX_MODELS: CodexModel[] = [
  { id: 'gpt-5.5', label: 'gpt-5.5', description: 'Latest frontier model for complex coding and agentic work' },
  { id: 'gpt-5.4', label: 'gpt-5.4', description: 'Strong model for everyday coding' },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', description: 'Small, fast, and cost-efficient coding model' },
  { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', description: 'Coding-optimized model' },
  { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark', description: 'Ultra-fast coding model' },
  { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', description: 'Frontier agentic coding model' },
  {
    id: 'gpt-5.1-codex-max',
    label: 'gpt-5.1-codex-max',
    description: 'Codex-optimized flagship for deep and fast reasoning',
  },
  {
    id: 'gpt-5.2',
    label: 'gpt-5.2',
    description: 'Frontier model with improvements across knowledge, reasoning and coding',
  },
  {
    id: 'gpt-5.1-codex-mini',
    label: 'gpt-5.1-codex-mini',
    description: 'Optimized for codex. Cheaper, faster, but less capable',
  },
];

/** The default model ID (first entry in the list) */
export const DEFAULT_CODEX_MODEL_ID = DEFAULT_CODEX_MODELS[0].id;

const DEFAULT_CODEX_MODEL_OPTIONS = DEFAULT_CODEX_MODELS.map((model) => ({ id: model.id, label: model.label }));

export function createDefaultCodexModelInfo(): AcpModelInfo {
  return {
    source: 'models',
    currentModelId: DEFAULT_CODEX_MODEL_ID,
    currentModelLabel: DEFAULT_CODEX_MODELS[0].label,
    availableModels: DEFAULT_CODEX_MODEL_OPTIONS,
    canSwitch: DEFAULT_CODEX_MODEL_OPTIONS.length > 1,
  };
}

export function mergeDefaultCodexModelInfo(modelInfo: AcpModelInfo | null): AcpModelInfo {
  if (!modelInfo) {
    return createDefaultCodexModelInfo();
  }

  const defaultModelIds = new Set(DEFAULT_CODEX_MODEL_OPTIONS.map((model) => model.id));
  const customModels = modelInfo.availableModels.filter((model) => !defaultModelIds.has(model.id));
  const availableModels = [...DEFAULT_CODEX_MODEL_OPTIONS, ...customModels];
  const currentModel = availableModels.find((model) => model.id === modelInfo.currentModelId);

  return {
    ...modelInfo,
    currentModelId: modelInfo.currentModelId || DEFAULT_CODEX_MODEL_ID,
    currentModelLabel:
      currentModel?.label || modelInfo.currentModelLabel || modelInfo.currentModelId || DEFAULT_CODEX_MODELS[0].label,
    availableModels,
    canSwitch: availableModels.length > 1,
  };
}
