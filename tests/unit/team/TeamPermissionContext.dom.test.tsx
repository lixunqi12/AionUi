/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamPermissionProvider, useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';

const bridgeMocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  setSessionMode: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      ensureSession: { invoke: bridgeMocks.ensureSession },
      setSessionMode: { invoke: bridgeMocks.setSessionMode },
    },
    acpConversation: {
      setMode: { invoke: bridgeMocks.setMode },
    },
  },
}));

const CaptureContext: React.FC<{ onReady: (propagateMode: (mode: string) => void) => void }> = ({ onReady }) => {
  const context = useTeamPermission();
  if (context) onReady(context.propagateMode);
  return null;
};

describe('TeamPermissionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.ensureSession.mockResolvedValue(undefined);
    bridgeMocks.setSessionMode.mockResolvedValue(undefined);
    bridgeMocks.setMode.mockResolvedValue(undefined);
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
        <CaptureContext onReady={(callback) => (propagateMode = callback)} />
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
});
