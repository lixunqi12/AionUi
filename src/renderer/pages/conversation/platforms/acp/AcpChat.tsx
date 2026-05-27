/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import type { AcpBackend } from '@/common/types/acpTypes';
import FlexFullContainer from '@renderer/components/layout/FlexFullContainer';
import MessageList from '@renderer/pages/conversation/Messages/MessageList';
import { MessageListProvider, useMessageLstCache } from '@renderer/pages/conversation/Messages/hooks';
import HOC from '@renderer/utils/ui/HOC';
import React from 'react';
import ConversationChatConfirm from '../../components/ConversationChatConfirm';
import AcpSendBox from './AcpSendBox';

const AcpChat: React.FC<{
  conversation_id: string;
  workspace?: string;
  backend: AcpBackend;
  sessionMode?: string;
  cachedConfigOptions?: import('@/common/types/acpTypes').AcpSessionConfigOption[];
  agentName?: string;
  cronJobId?: string;
  hideSendBox?: boolean;
  teamId?: string;
  agentSlotId?: string;
  emptySlot?: React.ReactNode;
  mobileMode?: boolean;
  messageRefreshIntervalMs?: number;
  messagePageSize?: number;
}> = ({
  conversation_id,
  workspace,
  backend,
  sessionMode,
  cachedConfigOptions,
  agentName,
  cronJobId,
  hideSendBox,
  teamId,
  agentSlotId,
  emptySlot,
  mobileMode,
  messageRefreshIntervalMs,
  messagePageSize,
}) => {
  useMessageLstCache(conversation_id, {
    pageSize: messagePageSize,
    refreshIntervalMs: messageRefreshIntervalMs,
    refreshOnVisibility: Boolean(messageRefreshIntervalMs),
    partialRefresh: Boolean(messagePageSize),
  });

  return (
    <ConversationProvider value={{ conversationId: conversation_id, workspace, type: 'acp', cronJobId, hideSendBox }}>
      <div className={`flex-1 flex flex-col min-h-0 ${mobileMode ? 'mobile-chat__body' : 'px-20px'}`}>
        <FlexFullContainer>
          <MessageList className='flex-1' emptySlot={emptySlot} />
        </FlexFullContainer>
        {!hideSendBox && (
          <ConversationChatConfirm conversation_id={conversation_id}>
            <AcpSendBox
              conversation_id={conversation_id}
              backend={backend}
              sessionMode={sessionMode}
              cachedConfigOptions={cachedConfigOptions}
              agentName={agentName}
              workspacePath={workspace}
              teamId={teamId}
              agentSlotId={agentSlotId}
              mobileMode={mobileMode}
            ></AcpSendBox>
          </ConversationChatConfirm>
        )}
      </div>
    </ConversationProvider>
  );
};

export default HOC(MessageListProvider)(AcpChat);
