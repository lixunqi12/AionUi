/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

const bridgeMocks = vi.hoisted(() => ({
  getMode: vi.fn(),
  updateConversation: vi.fn(),
  warmup: vi.fn().mockResolvedValue(undefined),
  getSlashCommands: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getMode: {
        invoke: bridgeMocks.getMode,
      },
      responseStream: {
        on: vi.fn(() => vi.fn()),
      },
    },
    conversation: {
      warmup: {
        invoke: bridgeMocks.warmup,
      },
      update: {
        invoke: bridgeMocks.updateConversation,
      },
      getSlashCommands: {
        invoke: bridgeMocks.getSlashCommands,
      },
    },
  },
}));

describe('useAcpMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.getMode.mockResolvedValue({ mode: 'full-access', initialized: true });
    bridgeMocks.updateConversation.mockResolvedValue(true);
    bridgeMocks.warmup.mockResolvedValue(undefined);
    bridgeMocks.getSlashCommands.mockResolvedValue([]);
  });

  it('completes hydration when the conversation lookup fails', async () => {
    vi.mocked(getConversationOrNull).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('repairs stale running state when no active ACP agent exists', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue({
      id: 'conv-stale',
      name: 'stale',
      type: 'acp',
      status: 'running',
      pinned: false,
      created_at: Date.now(),
      modified_at: Date.now(),
      extra: {},
    } as TChatConversation);
    const notFound = { name: 'BackendHttpError', status: 404, code: 'NOT_FOUND' };
    bridgeMocks.getMode.mockRejectedValue(notFound);

    const { result } = renderHook(() => useAcpMessage('conv-stale'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
    expect(bridgeMocks.updateConversation).toHaveBeenCalledWith({
      id: 'conv-stale',
      updates: { status: 'finished' },
    });
  });
});
