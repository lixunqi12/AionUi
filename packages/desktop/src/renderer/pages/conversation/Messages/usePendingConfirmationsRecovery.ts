/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IConfirmation, IMessagePermission, TMessage } from '@/common/chat/chatLib';
import { useEffect } from 'react';
import { useUpdateMessageList } from './hooks';

export const pendingConfirmationMsgId = (confirmationId: string) => `confirmation:${confirmationId}`;

export function buildPendingConfirmationMessage(
  conversation_id: string,
  confirmation: IConfirmation<unknown>
): IMessagePermission {
  return {
    id: pendingConfirmationMsgId(confirmation.id),
    msg_id: pendingConfirmationMsgId(confirmation.id),
    type: 'permission',
    position: 'left',
    conversation_id,
    created_at: Date.now(),
    content: confirmation,
  };
}

export function hasPermissionMessageForCallId(list: TMessage[], callId: string): boolean {
  return list.some((message) => message.type === 'permission' && message.content?.call_id === callId);
}

export function removePermissionMessage(list: TMessage[], target: { id?: string; call_id?: string }): TMessage[] {
  return list.filter((message) => {
    if (message.type !== 'permission') return true;
    if (target.id && message.content.id === target.id) return false;
    if (target.call_id && message.content.call_id === target.call_id) return false;
    return true;
  });
}

function upsertPendingConfirmationMessage(
  list: TMessage[],
  conversation_id: string,
  confirmation: IConfirmation<unknown>
): TMessage[] {
  const withoutStale = removePermissionMessage(list, {
    id: confirmation.id,
    call_id: confirmation.call_id,
  });
  return withoutStale.concat(buildPendingConfirmationMessage(conversation_id, confirmation));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePendingConfirmationsRecovery(conversation_id: string) {
  const updateMessageList = useUpdateMessageList();

  useEffect(() => {
    if (!conversation_id) return;
    let cancelled = false;

    const refreshPendingConfirmations = () => {
      void ipcBridge.conversation.confirmation.list
        .invoke({ conversation_id })
        .then((confirmations) => {
          if (cancelled) return;
          updateMessageList((list) => {
            let next = list;
            for (const confirmation of confirmations ?? []) {
              if (hasPermissionMessageForCallId(next, confirmation.call_id)) continue;
              next = next.concat(buildPendingConfirmationMessage(conversation_id, confirmation));
            }
            return next;
          });
        })
        .catch((error) => {
          console.warn('[pending-confirmations] failed to recover pending confirmations', {
            conversation_id,
            error: errorMessage(error),
          });
        });
    };

    refreshPendingConfirmations();

    const offAdd = ipcBridge.conversation.confirmation.add.on((confirmation) => {
      if (confirmation.conversation_id !== conversation_id) return;
      updateMessageList((list) => upsertPendingConfirmationMessage(list, conversation_id, confirmation));
    });

    const offUpdate = ipcBridge.conversation.confirmation.update.on((confirmation) => {
      if (confirmation.conversation_id !== conversation_id) return;
      updateMessageList((list) => upsertPendingConfirmationMessage(list, conversation_id, confirmation));
    });

    const offRemove = ipcBridge.conversation.confirmation.remove.on((event) => {
      if (event.conversation_id !== conversation_id) return;
      updateMessageList((list) => removePermissionMessage(list, { id: event.id, call_id: event.id }));
    });

    const offTurnCompleted = ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id !== conversation_id) return;
      if (event.runtime.pending_confirmations > 0) {
        refreshPendingConfirmations();
      }
    });

    const offVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshPendingConfirmations();
      }
    };
    document.addEventListener('visibilitychange', offVisibility);

    return () => {
      cancelled = true;
      offAdd();
      offUpdate();
      offRemove();
      offTurnCompleted();
      document.removeEventListener('visibilitychange', offVisibility);
    };
  }, [conversation_id, updateMessageList]);
}
