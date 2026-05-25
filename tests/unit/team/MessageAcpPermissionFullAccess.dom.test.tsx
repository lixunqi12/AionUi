/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import { TeamPermissionProvider } from '@/renderer/pages/team/hooks/TeamPermissionContext';

const bridgeMocks = vi.hoisted(() => ({
  confirmMessage: vi.fn(),
  ensureSession: vi.fn(),
  setMode: vi.fn(),
  setSessionMode: vi.fn(),
  responseStreamOn: vi.fn(() => vi.fn()),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    confirmMessage: { invoke: bridgeMocks.confirmMessage },
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      ensureSession: { invoke: bridgeMocks.ensureSession },
      setSessionMode: { invoke: bridgeMocks.setSessionMode },
    },
    conversation: {
      confirmMessage: { invoke: bridgeMocks.confirmMessage },
    },
    acpConversation: {
      setMode: { invoke: bridgeMocks.setMode },
      responseStream: { on: bridgeMocks.responseStreamOn },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const permissionMessage: IMessageAcpPermission = {
  id: 'message-1',
  msg_id: 'msg-1',
  type: 'acp_permission',
  conversation_id: 'leader-conv',
  content: {
    session_id: 'session-1',
    options: [
      { option_id: 'approved', name: 'Yes, proceed', kind: 'allow_once' },
      { option_id: 'abort', name: 'No', kind: 'reject_once' },
    ],
    tool_call: {
      tool_call_id: 'call-1',
      kind: 'execute',
      title: 'scp file',
      status: 'pending',
      raw_input: {
        command: 'scp file host:/tmp/file',
      },
    },
  },
};

describe('MessageAcpPermission full-access team behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.confirmMessage.mockResolvedValue(undefined);
    bridgeMocks.ensureSession.mockResolvedValue(undefined);
    bridgeMocks.setMode.mockResolvedValue(undefined);
    bridgeMocks.setSessionMode.mockResolvedValue(undefined);
  });

  it('auto-confirms ACP permission requests for full-access team conversations', async () => {
    const { container } = render(
      <TeamPermissionProvider
        team_id='team-1'
        isLeaderAgent
        leaderConversationId='leader-conv'
        allConversationIds={['leader-conv']}
        sessionMode='full-access'
      >
        <MessageAcpPermission message={permissionMessage} />
      </TeamPermissionProvider>
    );

    expect(container).toBeEmptyDOMElement();

    await waitFor(() => {
      expect(bridgeMocks.confirmMessage).toHaveBeenCalledWith({
        confirm_key: 'approved',
        msg_id: 'msg-1',
        conversation_id: 'leader-conv',
        call_id: 'call-1',
      });
    });
  });

  it('auto-confirms camelCase ACP permission payloads', async () => {
    const camelCaseMessage = {
      ...permissionMessage,
      content: {
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
    } as unknown as IMessageAcpPermission;

    const { container } = render(
      <TeamPermissionProvider
        team_id='team-1'
        isLeaderAgent
        leaderConversationId='leader-conv'
        allConversationIds={['leader-conv']}
        sessionMode='full-access'
      >
        <MessageAcpPermission message={camelCaseMessage} />
      </TeamPermissionProvider>
    );

    expect(container).toBeEmptyDOMElement();

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
