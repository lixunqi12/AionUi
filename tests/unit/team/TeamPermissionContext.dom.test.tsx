/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamPermissionProvider, useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';

const bridgeMocks = vi.hoisted(() => {
  const responseStreamHandlers: Array<(message: unknown) => void> = [];
  return {
    ensureSession: vi.fn(),
    conversationWarmup: vi.fn(),
    confirmMessage: vi.fn(),
    setSessionMode: vi.fn(),
    setMode: vi.fn(),
    responseStreamHandlers,
    responseStreamOn: vi.fn((handler: (message: unknown) => void) => {
      responseStreamHandlers.push(handler);
      return vi.fn();
    }),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      ensureSession: { invoke: bridgeMocks.ensureSession },
      setSessionMode: { invoke: bridgeMocks.setSessionMode },
    },
    conversation: {
      warmup: { invoke: bridgeMocks.conversationWarmup },
      confirmMessage: { invoke: bridgeMocks.confirmMessage },
    },
    acpConversation: {
      setMode: { invoke: bridgeMocks.setMode },
      responseStream: { on: bridgeMocks.responseStreamOn },
    },
  },
}));

const CaptureContext: React.FC<{ onReady: (context: ReturnType<typeof useTeamPermission>) => void }> = ({
  onReady,
}) => {
  const context = useTeamPermission();
  onReady(context);
  return null;
};

describe('TeamPermissionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.ensureSession.mockResolvedValue(undefined);
    bridgeMocks.conversationWarmup.mockResolvedValue(undefined);
    bridgeMocks.confirmMessage.mockResolvedValue(undefined);
    bridgeMocks.setSessionMode.mockResolvedValue(undefined);
    bridgeMocks.setMode.mockResolvedValue(undefined);
    bridgeMocks.responseStreamHandlers.length = 0;
  });

  it('persists leader mode changes and applies them to existing team conversations', async () => {
    let propagateMode: ((mode: string) => void) | undefined;

    render(
      <TeamPermissionProvider
        team_id='team-1'
        isLeaderAgent
        leaderConversationId='leader-conv'
        allConversationIds={['leader-conv', 'member-conv', 'member-conv']}
      >
        <CaptureContext onReady={(context) => (propagateMode = context?.propagateMode)} />
      </TeamPermissionProvider>
    );

    propagateMode?.('full-access');

    await waitFor(() => {
      expect(bridgeMocks.setSessionMode).toHaveBeenCalledWith({
        team_id: 'team-1',
        session_mode: 'full-access',
      });
      expect(bridgeMocks.ensureSession).toHaveBeenCalledWith({ team_id: 'team-1' });
      expect(bridgeMocks.setMode).toHaveBeenCalledTimes(2);
    });

    expect(bridgeMocks.setMode).toHaveBeenCalledWith({ conversation_id: 'leader-conv', mode: 'full-access' });
    expect(bridgeMocks.setMode).toHaveBeenCalledWith({ conversation_id: 'member-conv', mode: 'full-access' });
  });

  it('re-applies saved session mode to existing conversations when an old team is opened', async () => {
    render(
      <TeamPermissionProvider
        team_id='team-1'
        isLeaderAgent
        leaderConversationId='leader-conv'
        allConversationIds={['leader-conv', 'member-conv']}
        sessionMode='full-access'
      >
        <div />
      </TeamPermissionProvider>
    );

    await waitFor(() => {
      expect(bridgeMocks.ensureSession).toHaveBeenCalledWith({ team_id: 'team-1' });
      expect(bridgeMocks.setMode).toHaveBeenCalledTimes(2);
    });

    expect(bridgeMocks.setSessionMode).not.toHaveBeenCalled();
    expect(bridgeMocks.setMode).toHaveBeenCalledWith({ conversation_id: 'leader-conv', mode: 'full-access' });
    expect(bridgeMocks.setMode).toHaveBeenCalledWith({ conversation_id: 'member-conv', mode: 'full-access' });
  });

  it('warms the active conversation before re-applying saved mode for an old team send', async () => {
    let warmupSession: ((conversation_id?: string) => Promise<void>) | undefined;

    render(
      <TeamPermissionProvider
        team_id='team-1'
        isLeaderAgent
        leaderConversationId='leader-conv'
        allConversationIds={['leader-conv', 'member-conv']}
        sessionMode='full-access'
      >
        <CaptureContext onReady={(context) => (warmupSession = context?.warmupSession)} />
      </TeamPermissionProvider>
    );

    await waitFor(() => {
      expect(bridgeMocks.setMode).toHaveBeenCalledTimes(2);
    });

    vi.clearAllMocks();
    bridgeMocks.ensureSession.mockResolvedValue(undefined);
    bridgeMocks.conversationWarmup.mockResolvedValue(undefined);
    bridgeMocks.setMode.mockResolvedValue(undefined);

    await act(async () => {
      await warmupSession?.('leader-conv');
    });

    expect(bridgeMocks.ensureSession).not.toHaveBeenCalled();
    expect(bridgeMocks.conversationWarmup).toHaveBeenCalledWith({ conversation_id: 'leader-conv' });
    expect(bridgeMocks.setMode).toHaveBeenCalledWith({ conversation_id: 'leader-conv', mode: 'full-access' });
    expect(bridgeMocks.setMode).toHaveBeenCalledWith({ conversation_id: 'member-conv', mode: 'full-access' });
  });

  it('auto-confirms camelCase ACP permission stream events for full-access teams', async () => {
    render(
      <TeamPermissionProvider
        team_id='team-1'
        isLeaderAgent
        leaderConversationId='leader-conv'
        allConversationIds={['leader-conv', 'member-conv']}
        sessionMode='full-access'
      >
        <div />
      </TeamPermissionProvider>
    );

    await waitFor(() => {
      expect(bridgeMocks.responseStreamOn).toHaveBeenCalled();
    });

    act(() => {
      for (const handler of bridgeMocks.responseStreamHandlers) {
        handler({
          type: 'acp_permission',
          conversation_id: 'leader-conv',
          msg_id: 'msg-1',
          data: {
            sessionId: 'session-1',
            options: [
              { optionId: 'approved', name: 'Yes, proceed', kind: 'allow_once' },
              { optionId: 'abort', name: 'No', kind: 'reject_once' },
            ],
            toolCall: {
              toolCallId: 'call-1',
              kind: 'execute',
              title: 'scp file',
              status: 'pending',
            },
          },
        });
      }
    });

    await waitFor(() => {
      expect(bridgeMocks.confirmMessage).toHaveBeenCalledWith({
        confirm_key: 'approved',
        msg_id: 'msg-1',
        conversation_id: 'leader-conv',
        call_id: 'call-1',
      });
    });
  });
});
