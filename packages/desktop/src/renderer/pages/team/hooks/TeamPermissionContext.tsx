import { ipcBridge } from '@/common';
import {
  getAcpPermissionAllowOption,
  getAcpPermissionCallId,
  normalizeAcpPermissionRequest,
} from '@/common/chat/acpPermission';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

const MODE_SYNC_RETRY_DELAY_MS = 250;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function setConversationModeWithRetry(conversation_id: string, mode: string): Promise<boolean> {
  try {
    await ipcBridge.acpConversation.setMode.invoke({ conversation_id, mode });
    return true;
  } catch (firstError) {
    await wait(MODE_SYNC_RETRY_DELAY_MS);
    try {
      await ipcBridge.acpConversation.setMode.invoke({ conversation_id, mode });
      return true;
    } catch (secondError) {
      console.warn('[TeamPermissionContext] Failed to sync mode to conversation', {
        conversation_id,
        mode,
        firstError,
        secondError,
      });
      return false;
    }
  }
}

type TeamPermissionContextValue = {
  /** Whether we are in team mode */
  isTeamMode: true;
  /** Whether the current active agent is the team leader */
  isLeaderAgent: boolean;
  /** Conversation ID of the leader agent */
  leaderConversationId: string;
  /** All agent conversation IDs in this team (for centralized confirmation listening) */
  allConversationIds: string[];
  /** Current team permission mode, if persisted on the team record */
  sessionMode?: string;
  /** Whether team permission mode should bypass per-command prompts */
  isFullAccessMode: boolean;
  /** Propagate a permission mode change from the leader to all member agents */
  propagateMode: (mode: string) => void;
  /** Trigger session warmup and re-apply the saved mode to the current ACP session. */
  warmupSession: (conversation_id?: string) => Promise<void>;
};

const TeamPermissionContext = createContext<TeamPermissionContextValue | null>(null);

export const TeamPermissionProvider: React.FC<{
  children: React.ReactNode;
  team_id: string;
  isLeaderAgent: boolean;
  leaderConversationId: string;
  allConversationIds: string[];
  sessionMode?: string;
}> = ({ children, team_id, isLeaderAgent, leaderConversationId, allConversationIds, sessionMode }) => {
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const lastSessionModeSyncKeyRef = useRef<string | null>(null);
  const autoApprovedPermissionKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    warmupPromiseRef.current = null;
    lastSessionModeSyncKeyRef.current = null;
    autoApprovedPermissionKeysRef.current.clear();
  }, [team_id]);

  const targetConversationIds = useMemo(
    () => Array.from(new Set([leaderConversationId, ...allConversationIds].filter((id): id is string => Boolean(id)))),
    [leaderConversationId, allConversationIds]
  );
  const targetConversationIdsKey = targetConversationIds.join('\n');
  const normalizedSessionMode = sessionMode?.trim();
  const isFullAccessMode = normalizedSessionMode === 'full-access';

  const ensureTeamSession = useCallback((): Promise<void> => {
    if (!warmupPromiseRef.current) {
      warmupPromiseRef.current = ipcBridge.team.ensureSession.invoke({ team_id }).catch(() => {});
    }
    return warmupPromiseRef.current;
  }, [team_id]);

  const syncModeToConversations = useCallback(
    async (mode: string, extraConversationIds: string[] = []): Promise<boolean> => {
      const ids = Array.from(new Set([...targetConversationIds, ...extraConversationIds].filter(Boolean)));
      if (ids.length === 0) return true;
      const results = await Promise.all(
        ids.map((conversation_id) => setConversationModeWithRetry(conversation_id, mode))
      );
      return results.every(Boolean);
    },
    [targetConversationIds]
  );

  const warmupSession = useCallback(
    async (conversation_id?: string): Promise<void> => {
      await ensureTeamSession();
      if (conversation_id) {
        await ipcBridge.conversation.warmup.invoke({ conversation_id }).catch((error) => {
          console.warn('[TeamPermissionContext] Failed to warm team conversation', { conversation_id, error });
        });
      }

      const mode = normalizedSessionMode;
      if (mode) {
        await syncModeToConversations(mode, conversation_id ? [conversation_id] : []);
      }
    },
    [ensureTeamSession, normalizedSessionMode, syncModeToConversations]
  );

  const syncModeToTeamAgents = useCallback(
    (mode: string, { persistTeamMode = false }: { persistTeamMode?: boolean } = {}) => {
      const nextMode = mode.trim();
      if (!nextMode || targetConversationIds.length === 0) return;

      void (async () => {
        if (persistTeamMode) {
          await ipcBridge.team.setSessionMode.invoke({ team_id, session_mode: nextMode }).catch((error) => {
            console.warn('[TeamPermissionContext] Failed to persist team session mode', {
              team_id,
              mode: nextMode,
              error,
            });
          });
        }

        await ensureTeamSession();
        await syncModeToConversations(nextMode);
      })();
    },
    [ensureTeamSession, syncModeToConversations, targetConversationIds.length, team_id]
  );

  const propagateMode = useCallback(
    (mode: string) => {
      syncModeToTeamAgents(mode, { persistTeamMode: true });
    },
    [syncModeToTeamAgents]
  );

  useEffect(() => {
    if (!normalizedSessionMode || targetConversationIds.length === 0) return;

    lastSessionModeSyncKeyRef.current = `${team_id}:${normalizedSessionMode}:${targetConversationIdsKey}`;
  }, [normalizedSessionMode, targetConversationIds.length, targetConversationIdsKey, team_id]);

  useEffect(() => {
    if (!isFullAccessMode || targetConversationIds.length === 0) return;

    const idSet = new Set(targetConversationIds);
    const autoApprove = async (params: {
      conversation_id: string;
      msg_id: string;
      call_id: string;
      confirm_key: string;
    }) => {
      const key = `${params.conversation_id}:${params.call_id}`;
      if (autoApprovedPermissionKeysRef.current.has(key)) return;
      autoApprovedPermissionKeysRef.current.add(key);

      try {
        await ipcBridge.conversation.confirmMessage.invoke(params);
      } catch (error) {
        autoApprovedPermissionKeysRef.current.delete(key);
        console.warn('[TeamPermissionContext] Failed to auto-approve full-access team permission', {
          ...params,
          error,
        });
      }
    };

    return ipcBridge.acpConversation.responseStream.on((message) => {
      if (message.type !== 'acp_permission' || !idSet.has(message.conversation_id)) return;

      const permissionRequest = normalizeAcpPermissionRequest(message.data);
      if (!permissionRequest) return;

      const option = getAcpPermissionAllowOption(permissionRequest.options);
      const callId = getAcpPermissionCallId(permissionRequest);
      if (!option?.option_id || !callId) return;

      void autoApprove({
        conversation_id: message.conversation_id,
        msg_id: message.msg_id || callId,
        call_id: callId,
        confirm_key: option.option_id,
      });
    });
  }, [isFullAccessMode, targetConversationIds, targetConversationIds.length]);

  const value = useMemo<TeamPermissionContextValue>(
    () => ({
      isTeamMode: true,
      isLeaderAgent,
      leaderConversationId,
      allConversationIds,
      sessionMode: normalizedSessionMode,
      isFullAccessMode,
      propagateMode,
      warmupSession,
    }),
    [
      isLeaderAgent,
      leaderConversationId,
      allConversationIds,
      normalizedSessionMode,
      isFullAccessMode,
      propagateMode,
      warmupSession,
    ]
  );

  return <TeamPermissionContext.Provider value={value}>{children}</TeamPermissionContext.Provider>;
};

/**
 * Returns team permission context if inside a team, or null for standalone conversations.
 * This ensures all team-only logic is gated behind a null check — no impact on single agent mode.
 */
export const useTeamPermission = (): TeamPermissionContextValue | null => {
  return useContext(TeamPermissionContext);
};
