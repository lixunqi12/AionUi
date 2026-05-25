import { ipcBridge } from '@/common';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

const MODE_SYNC_RETRY_DELAY_MS = 250;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function setConversationModeWithRetry(conversation_id: string, mode: string): Promise<void> {
  try {
    await ipcBridge.acpConversation.setMode.invoke({ conversation_id, mode });
    return;
  } catch (firstError) {
    await wait(MODE_SYNC_RETRY_DELAY_MS);
    try {
      await ipcBridge.acpConversation.setMode.invoke({ conversation_id, mode });
    } catch (secondError) {
      console.warn('[TeamPermissionContext] Failed to sync mode to conversation', {
        conversation_id,
        mode,
        firstError,
        secondError,
      });
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
  /** Trigger session warmup (idempotent, returns cached promise) */
  warmupSession: () => Promise<void>;
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

  useEffect(() => {
    warmupPromiseRef.current = null;
    lastSessionModeSyncKeyRef.current = null;
  }, [team_id]);

  const targetConversationIds = useMemo(
    () => Array.from(new Set([leaderConversationId, ...allConversationIds].filter((id): id is string => Boolean(id)))),
    [leaderConversationId, allConversationIds]
  );
  const targetConversationIdsKey = targetConversationIds.join('\n');
  const normalizedSessionMode = sessionMode?.trim();
  const isFullAccessMode = normalizedSessionMode === 'full-access';

  const warmupSession = useCallback((): Promise<void> => {
    if (!warmupPromiseRef.current) {
      warmupPromiseRef.current = ipcBridge.team.ensureSession.invoke({ team_id }).catch(() => {});
    }
    return warmupPromiseRef.current;
  }, [team_id]);

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

        await warmupSession();
        await Promise.allSettled(
          targetConversationIds.map((conversation_id) => setConversationModeWithRetry(conversation_id, nextMode))
        );
      })();
    },
    [team_id, targetConversationIds, warmupSession]
  );

  const propagateMode = useCallback(
    (mode: string) => {
      syncModeToTeamAgents(mode, { persistTeamMode: true });
    },
    [syncModeToTeamAgents]
  );

  useEffect(() => {
    const mode = normalizedSessionMode;
    if (!mode || targetConversationIds.length === 0) return;

    const syncKey = `${team_id}:${mode}:${targetConversationIdsKey}`;
    if (lastSessionModeSyncKeyRef.current === syncKey) return;
    lastSessionModeSyncKeyRef.current = syncKey;

    syncModeToTeamAgents(mode);
  }, [normalizedSessionMode, syncModeToTeamAgents, targetConversationIds.length, targetConversationIdsKey, team_id]);

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
