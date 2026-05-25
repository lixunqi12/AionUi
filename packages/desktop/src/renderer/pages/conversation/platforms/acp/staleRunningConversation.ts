import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';

const STALE_RUNNING_RECHECK_DELAY_MS = 300;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AcpRuntimeState = 'active' | 'awaiting_confirmation' | 'detached' | 'unknown';

export async function hasActiveAcpAgent(conversation_id: string): Promise<boolean> {
  try {
    await ipcBridge.acpConversation.getMode.invoke({ conversation_id });
    return true;
  } catch (firstError) {
    if (!isBackendHttpError(firstError) || firstError.status !== 404) {
      return true;
    }

    await wait(STALE_RUNNING_RECHECK_DELAY_MS);
    try {
      await ipcBridge.acpConversation.getMode.invoke({ conversation_id });
      return true;
    } catch (secondError) {
      if (isBackendHttpError(secondError) && secondError.status === 404) {
        return false;
      }
      return true;
    }
  }
}

export async function getAcpRuntimeState(conversation_id: string): Promise<AcpRuntimeState> {
  const hasActiveAgent = await hasActiveAcpAgent(conversation_id);
  if (hasActiveAgent) {
    return 'active';
  }

  try {
    const confirmations = await ipcBridge.conversation.confirmation.list.invoke({ conversation_id });
    if (confirmations.length > 0) {
      return 'awaiting_confirmation';
    }
    return 'detached';
  } catch (error) {
    console.warn('[staleRunningConversation] Failed to inspect pending confirmations', {
      conversation_id,
      error,
    });
    return 'unknown';
  }
}

export async function markStaleRunningConversationFinished(conversation_id: string): Promise<boolean> {
  return ipcBridge.conversation.update
    .invoke({
      id: conversation_id,
      updates: { status: 'finished' },
    })
    .then(Boolean)
    .catch((error) => {
      console.warn('[staleRunningConversation] Failed to repair stale running conversation status', {
        conversation_id,
        error,
      });
      return false;
    });
}

export async function repairStaleRunningAcpConversation(conversation_id: string): Promise<boolean> {
  const runtimeState = await getAcpRuntimeState(conversation_id);
  if (runtimeState !== 'detached') {
    return false;
  }
  void markStaleRunningConversationFinished(conversation_id);
  return true;
}
