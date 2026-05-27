import { ipcBridge } from '@/common';
import type { IMessageAcpPermission, IMessagePermission, TMessage } from '@/common/chat/chatLib';
import type { IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import { parseError, uuid } from '@/common/utils';
import MarkdownView from '@/renderer/components/Markdown';
import { useAcpModelInfo } from '@/renderer/hooks/agent/useAcpModelInfo';
import { useAgentModesForBackend } from '@/renderer/hooks/agent/useAgentModesForBackend';
import { useAgents } from '@/renderer/hooks/agent/useAgents';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { ConversationProvider, type ConversationContextValue } from '@/renderer/hooks/context/ConversationContext';
import { LayoutContext, type LayoutContextValue } from '@/renderer/hooks/context/LayoutContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import {
  MESSAGE_LIST_REFRESH_EVENT,
  MessageListLoadingProvider,
  MessageListProvider,
  useAddOrUpdateMessage,
  useMessageList,
  useMessageListLoading,
  useMessageLstCache,
} from '@/renderer/pages/conversation/Messages/hooks';
import { usePendingConfirmationsRecovery } from '@/renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';
import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { buildCliAgentParams } from '@/renderer/pages/conversation/utils/createConversationParams';
import { useTeamList } from '@/renderer/pages/team/hooks/useTeamList';
import { emitter } from '@/renderer/utils/emitter';
import { getAgentKey } from '@/renderer/pages/guid/hooks/agentSelectionUtils';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import { Message as ArcoMessage } from '@arco-design/web-react';
import { ArrowUp, CloseSmall, Down, History, Moon, Plus, Refresh, SettingTwo, SunOne, Up } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import './mobile-conversation.css';

const MOBILE_REFRESH_INTERVAL_MS = 1800;
const MOBILE_MESSAGE_PAGE_SIZE = 320;
const HISTORY_PAGE_SIZE = 120;
const MOBILE_DEFAULT_WORKSPACE = 'F:\\AI_tool\\AionUi-mobile-workspace';
const MODEL_OPTION_LIMIT = 16;
const REASONING_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

type ConversationExtra = {
  backend?: string;
  workspace?: string;
  session_mode?: string;
  sessionMode?: string;
  sandboxMode?: string;
  sandbox_mode?: string;
  agent_name?: string;
  agentName?: string;
  cron_job_id?: string;
  cronJobId?: string;
  current_model_id?: string;
  currentModelId?: string;
  codexModel?: string;
  codex_model?: string;
  skills?: string[];
  is_health_check?: boolean;
  team_id?: string;
  teamId?: string;
  custom_workspace?: boolean;
  pinned?: boolean;
  pinned_at?: number;
  is_temporary_workspace?: boolean;
};

type SheetName = 'history' | 'settings' | 'new-chat' | null;
type ScrollAction = 'top' | 'bottom' | null;
type HistorySectionKey = 'pinned' | 'teams' | 'workspaces' | 'normal';

type MobileWorkspaceGroup = {
  workspace: string;
  displayName: string;
  conversations: TChatConversation[];
};

type MobileTeamGroup = {
  teamId: string;
  name: string;
  team?: TTeam;
  conversations: TChatConversation[];
};

type MobileHistoryGroups = {
  pinned: TChatConversation[];
  teams: MobileTeamGroup[];
  workspaces: MobileWorkspaceGroup[];
  normal: TChatConversation[];
};

const getExtra = (conversation?: TChatConversation | null): ConversationExtra => {
  return ((conversation?.extra || {}) as ConversationExtra) || {};
};

const pickString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

const getConversationActivityTime = (conversation: TChatConversation): number => {
  return conversation.modified_at || conversation.created_at || 0;
};

const getConversationBackend = (conversation?: TChatConversation | null): string | undefined => {
  if (!conversation) return undefined;
  const extra = getExtra(conversation);
  if (conversation.type === 'acp') return extra.backend || 'claude';
  if (conversation.type === 'codex') return 'codex';
  if (conversation.type === 'aionrs') return 'aionrs';
  if (conversation.type === 'gemini') return 'gemini';
  return conversation.type;
};

const isTeamConversation = (conversation: TChatConversation): boolean => {
  const extra = getExtra(conversation);
  return Boolean(extra.team_id || extra.teamId);
};

const getConversationTeamId = (conversation: TChatConversation): string => {
  const extra = getExtra(conversation);
  return pickString(extra.team_id, extra.teamId);
};

const isPinnedConversation = (conversation: TChatConversation): boolean => {
  return Boolean(getExtra(conversation).pinned);
};

const isWorkspaceConversation = (conversation: TChatConversation): boolean => {
  const extra = getExtra(conversation);
  return Boolean(extra.custom_workspace && extra.workspace);
};

const buildMobileHistoryGroups = (items: TChatConversation[], teams: TTeam[]): MobileHistoryGroups => {
  const visibleItems = items
    .filter((item) => getExtra(item).is_health_check !== true)
    .toSorted((a, b) => getConversationActivityTime(b) - getConversationActivityTime(a));

  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const teamConversationMap = new Map<string, TChatConversation[]>();
  const pinned: TChatConversation[] = [];
  const workspaceMap = new Map<string, TChatConversation[]>();
  const normal: TChatConversation[] = [];

  for (const item of visibleItems) {
    if (isTeamConversation(item)) {
      const teamId = getConversationTeamId(item);
      if (!teamId) continue;
      const group = teamConversationMap.get(teamId) ?? [];
      group.push(item);
      teamConversationMap.set(teamId, group);
      continue;
    }

    if (isPinnedConversation(item)) {
      pinned.push(item);
      continue;
    }

    if (isWorkspaceConversation(item)) {
      const workspace = getExtra(item).workspace!;
      const group = workspaceMap.get(workspace) ?? [];
      group.push(item);
      workspaceMap.set(workspace, group);
      continue;
    }

    normal.push(item);
  }

  const sortedTeams: MobileTeamGroup[] = [...teams]
    .toSorted((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0))
    .map((team) => ({
      teamId: team.id,
      name: team.name,
      team,
      conversations: teamConversationMap.get(team.id) ?? [],
    }));

  for (const [teamId, conversations] of teamConversationMap) {
    if (teamsById.has(teamId)) continue;
    sortedTeams.push({
      teamId,
      name: `Team ${teamId.slice(0, 8)}`,
      team: undefined,
      conversations,
    });
  }

  const workspaces = [...workspaceMap.entries()]
    .map(([workspace, conversations]) => ({
      workspace,
      displayName: getWorkspaceDisplayName(workspace, false),
      conversations: conversations.toSorted((a, b) => getConversationActivityTime(b) - getConversationActivityTime(a)),
    }))
    .toSorted(
      (a, b) => getConversationActivityTime(b.conversations[0]) - getConversationActivityTime(a.conversations[0])
    );

  return {
    pinned,
    teams: sortedTeams.filter((team) => team.conversations.length > 0 || team.team),
    workspaces,
    normal,
  };
};

const getModelLabel = (conversation?: TChatConversation | null): string => {
  if (!conversation) return '-';
  const extra = getExtra(conversation);
  const model = (conversation as { model?: Record<string, unknown> }).model;
  return (
    pickString(
      extra.current_model_id,
      extra.currentModelId,
      extra.codexModel,
      extra.codex_model,
      model?.use_model,
      model?.useModel,
      model?.name,
      model?.id
    ) || '-'
  );
};

const getModeLabel = (conversation?: TChatConversation | null): string => {
  if (!conversation) return '-';
  const extra = getExtra(conversation);
  return pickString(extra.session_mode, extra.sessionMode, extra.sandboxMode, extra.sandbox_mode) || '-';
};

const formatHistoryTime = (conversation: TChatConversation): string => {
  const rawTime = getConversationActivityTime(conversation);
  if (!rawTime) return '';
  const date = new Date(rawTime);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatMessageTime = (createdAt?: number): string => {
  if (!createdAt) return '';
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const MobileIconButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ label, onClick, children, disabled }) => {
  return (
    <button
      className='mobile-conversation__icon-btn'
      type='button'
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

const MobileThemeToggle: React.FC = () => {
  const { theme, setTheme } = useThemeContext();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button className='mobile-conversation__theme-toggle' type='button' onClick={() => void setTheme(nextTheme)}>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      {theme === 'dark' ? <SunOne theme='outline' size='18' /> : <Moon theme='outline' size='18' />}
    </button>
  );
};

const MobileSettingsRow: React.FC<{ label: string; children: React.ReactNode; stacked?: boolean }> = ({
  label,
  children,
  stacked,
}) => {
  return (
    <div className={classNames('mobile-conversation__settings-row', stacked && 'is-stacked')}>
      <span>{label}</span>
      <div className='mobile-conversation__settings-control'>{children}</div>
    </div>
  );
};

const MobileSettingValue: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <strong className='mobile-conversation__settings-value'>{children}</strong>;
};

const MobileOptionChip: React.FC<{
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}> = ({ label, active, disabled, onClick }) => {
  return (
    <button
      className={classNames('mobile-conversation__option-chip', active && 'is-active')}
      type='button'
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {label}
    </button>
  );
};

const MobileOptionList: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className='mobile-conversation__option-list'>{children}</div>;
};

const getReasoningValue = (modelId?: string | null): string => {
  if (!modelId || !modelId.includes('/')) return '';
  return modelId.split('/').at(-1) || '';
};

const getModelBase = (modelId?: string | null): string => {
  if (!modelId) return '';
  const parts = modelId.split('/');
  if (parts.length <= 1) return modelId;
  return parts.slice(0, -1).join('/');
};

const MobileHistoryConversationButton: React.FC<{
  item: TChatConversation;
  activeId?: string;
  onClick: (conversationId: string) => void;
}> = ({ item, activeId, onClick }) => {
  return (
    <button
      id={`mobile-history-${item.id}`}
      type='button'
      className={classNames('mobile-conversation__history-item', item.id === activeId && 'is-active')}
      onClick={() => onClick(item.id)}
    >
      <span className='mobile-conversation__history-title'>{item.name}</span>
      <span className='mobile-conversation__history-meta'>
        {item.type} - {formatHistoryTime(item)}
      </span>
    </button>
  );
};

const MobileHistorySection: React.FC<{
  title: string;
  count?: number;
  children: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}> = ({ title, count, children, collapsed, onToggle }) => {
  const titleContent = (
    <>
      <span>{title}</span>
      <span className='mobile-conversation__history-section-right'>
        {typeof count === 'number' && <strong>{count}</strong>}
        {onToggle && (
          <Down
            className={classNames('mobile-conversation__history-section-icon', collapsed && 'is-collapsed')}
            theme='outline'
            size='14'
          />
        )}
      </span>
    </>
  );

  return (
    <section className='mobile-conversation__history-section'>
      {onToggle ? (
        <button
          className='mobile-conversation__history-section-title'
          type='button'
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          {titleContent}
        </button>
      ) : (
        <div className='mobile-conversation__history-section-title'>{titleContent}</div>
      )}
      {!collapsed && children}
    </section>
  );
};

const MobileHistoryTeamButton: React.FC<{
  group: MobileTeamGroup;
  onOpenTeam: (teamId: string) => void;
}> = ({ group, onOpenTeam }) => {
  const latest = group.conversations[0];
  const agentCount = group.team?.agents?.length ?? group.conversations.length;
  return (
    <button className='mobile-conversation__history-team' type='button' onClick={() => onOpenTeam(group.teamId)}>
      <span className='mobile-conversation__history-title'>{group.name}</span>
      <span className='mobile-conversation__history-meta'>
        {agentCount} agents{latest ? ` - ${formatHistoryTime(latest)}` : ''}
      </span>
    </button>
  );
};

const MobileConversationSettings: React.FC<{
  conversation: TChatConversation;
  onConversationChanged: () => void;
  onStartNewChatWithAgent: (agentKey?: string) => void;
}> = ({ conversation, onConversationChanged, onStartNewChatWithAgent }) => {
  const extra = getExtra(conversation);
  const backend = getConversationBackend(conversation);
  const initialModelId = getModelLabel(conversation);
  const {
    model_info,
    canSwitch: canSwitchAcpModel,
    selectModel,
  } = useAcpModelInfo({
    conversation_id: conversation.id,
    backend,
    initialModelId: initialModelId === '-' ? undefined : initialModelId,
  });
  const modes = useAgentModesForBackend(backend);
  const [currentMode, setCurrentMode] = useState(getModeLabel(conversation));
  const [isModeSwitching, setIsModeSwitching] = useState(false);
  const { providers, getAvailableModels } = useModelProviderList();
  const { agents } = useAgents();

  const aionrsProviders = useMemo(
    () => providers.filter((provider) => !provider.platform?.toLowerCase().includes('gemini-with-google-auth')),
    [providers]
  );

  const aionrsModelOptions = useMemo(() => {
    return aionrsProviders.flatMap((provider) =>
      getAvailableModels(provider)
        .slice(0, MODEL_OPTION_LIMIT)
        .map((modelName) => ({ provider, modelName }))
    );
  }, [aionrsProviders, getAvailableModels]);

  const visibleAgents = useMemo(() => {
    return agents.filter((agent) => agent.enabled !== false && agent.available !== false).slice(0, 8);
  }, [agents]);

  useEffect(() => {
    setCurrentMode(getModeLabel(conversation));
  }, [conversation]);

  useEffect(() => {
    if (!conversation.id || modes.length === 0) return;
    let cancelled = false;
    void ipcBridge.acpConversation.getMode
      .invoke({ conversation_id: conversation.id })
      .then((result) => {
        if (cancelled || !result || result.initialized === false) return;
        setCurrentMode(result.mode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation.id, modes.length]);

  const handleModeChange = async (mode: string) => {
    if (mode === currentMode || isModeSwitching) return;
    setIsModeSwitching(true);
    try {
      await ipcBridge.acpConversation.setMode.invoke({ conversation_id: conversation.id, mode });
      setCurrentMode(mode);
      onConversationChanged();
      ArcoMessage.success('Access changed');
    } catch (error) {
      ArcoMessage.error(parseError(error) || 'Access change failed');
    } finally {
      setIsModeSwitching(false);
    }
  };

  const currentAcpModelId = model_info?.current_model_id || (initialModelId === '-' ? null : initialModelId);
  const currentModelBase = getModelBase(currentAcpModelId);
  const reasoningChoices = useMemo(() => {
    if (!currentModelBase || !model_info?.available_models.length) return [];
    const options = new Set(
      model_info.available_models
        .map((model) => model.id)
        .filter((modelId) => getModelBase(modelId) === currentModelBase)
        .map(getReasoningValue)
        .filter(Boolean)
    );
    return REASONING_ORDER.filter((reasoning) => options.has(reasoning));
  }, [currentModelBase, model_info?.available_models]);
  const currentReasoning = getReasoningValue(currentAcpModelId);

  const handleAcpModelSelect = (modelId: string) => {
    selectModel(modelId);
    onConversationChanged();
    ArcoMessage.success('Model changed');
  };

  const handleAionrsModelSelect = async (provider: IProvider, modelName: string) => {
    const selected = { ...provider, use_model: modelName } as TProviderWithModel;
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id: conversation.id });
      const ok = await ipcBridge.conversation.update.invoke({ id: conversation.id, updates: { model: selected } });
      if (!ok) throw new Error('Update returned false');
      onConversationChanged();
      ArcoMessage.success('Model changed');
    } catch (error) {
      ArcoMessage.error(parseError(error) || 'Model change failed');
    }
  };

  const aionrsModel = conversation.type === 'aionrs' ? conversation.model : undefined;
  const agentLabel = extra.agent_name || extra.agentName || backend || conversation.type || '-';

  return (
    <div className='mobile-conversation__settings-list'>
      <MobileSettingsRow label='Agent' stacked>
        <MobileSettingValue>{agentLabel}</MobileSettingValue>
        {visibleAgents.length > 0 && (
          <>
            <div className='mobile-conversation__settings-note'>Start a new chat with another agent</div>
            <MobileOptionList>
              {visibleAgents.map((agent) => {
                const key = getAgentKey(agent);
                const agentBackend = agent.backend || agent.agent_type;
                return (
                  <MobileOptionChip
                    key={agent.id}
                    label={agent.name || agentBackend}
                    active={agentBackend === backend || key === backend}
                    onClick={() => onStartNewChatWithAgent(key)}
                  />
                );
              })}
            </MobileOptionList>
          </>
        )}
      </MobileSettingsRow>

      <MobileSettingsRow label='Model' stacked>
        {conversation.type === 'aionrs' ? (
          <>
            <MobileSettingValue>{aionrsModel?.use_model || '-'}</MobileSettingValue>
            {aionrsModelOptions.length > 0 && (
              <MobileOptionList>
                {aionrsModelOptions.slice(0, MODEL_OPTION_LIMIT).map(({ provider, modelName }) => (
                  <MobileOptionChip
                    key={`${provider.id}-${modelName}`}
                    label={modelName}
                    active={aionrsModel?.id === provider.id && aionrsModel?.use_model === modelName}
                    onClick={() => void handleAionrsModelSelect(provider, modelName)}
                  />
                ))}
              </MobileOptionList>
            )}
          </>
        ) : (
          <>
            <MobileSettingValue>{model_info?.current_model_label || currentAcpModelId || '-'}</MobileSettingValue>
            {canSwitchAcpModel ? (
              <MobileOptionList>
                {model_info!.available_models.slice(0, MODEL_OPTION_LIMIT).map((model) => (
                  <MobileOptionChip
                    key={model.id}
                    label={model.label || model.id}
                    active={model_info!.current_model_id === model.id}
                    onClick={() => handleAcpModelSelect(model.id)}
                  />
                ))}
              </MobileOptionList>
            ) : (
              <div className='mobile-conversation__settings-note'>No switchable model list from this agent yet</div>
            )}
          </>
        )}
      </MobileSettingsRow>

      <MobileSettingsRow label='Reasoning' stacked>
        {reasoningChoices.length > 0 ? (
          <MobileOptionList>
            {reasoningChoices.map((reasoning) => (
              <MobileOptionChip
                key={reasoning}
                label={reasoning}
                active={currentReasoning === reasoning}
                onClick={() => handleAcpModelSelect(`${currentModelBase}/${reasoning}`)}
              />
            ))}
          </MobileOptionList>
        ) : (
          <MobileSettingValue>{currentReasoning || 'Model default'}</MobileSettingValue>
        )}
      </MobileSettingsRow>

      <MobileSettingsRow label='Access' stacked>
        {modes.length > 0 ? (
          <MobileOptionList>
            {modes.map((mode) => (
              <MobileOptionChip
                key={mode.value}
                label={mode.label}
                active={currentMode === mode.value}
                disabled={isModeSwitching}
                onClick={() => void handleModeChange(mode.value)}
              />
            ))}
          </MobileOptionList>
        ) : (
          <MobileSettingValue>{currentMode || '-'}</MobileSettingValue>
        )}
      </MobileSettingsRow>

      <MobileSettingsRow label='Workspace'>
        <MobileSettingValue>{extra.workspace || 'Temporary'}</MobileSettingValue>
      </MobileSettingsRow>

      <MobileSettingsRow label='Theme'>
        <MobileThemeToggle />
      </MobileSettingsRow>
    </div>
  );
};

const MobileNewChatSheet: React.FC<{
  initialAgentKey?: string;
  onCreated: (conversationId: string) => void;
}> = ({ initialAgentKey, onCreated }) => {
  const { agents } = useAgents();
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>(initialAgentKey || '');
  const [selectedMode, setSelectedMode] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const availableAgents = useMemo(() => {
    return agents.filter((agent) => agent.enabled !== false && agent.available !== false);
  }, [agents]);

  const selectedAgent = useMemo(() => {
    if (selectedAgentKey) {
      return availableAgents.find((agent) => getAgentKey(agent) === selectedAgentKey || agent.id === selectedAgentKey);
    }
    return (
      availableAgents.find((agent) => (agent.backend ?? agent.agent_type) === 'codex') ||
      availableAgents.find((agent) => (agent.backend ?? agent.agent_type) === 'claude') ||
      availableAgents[0]
    );
  }, [availableAgents, selectedAgentKey]);

  const selectedBackend = selectedAgent?.backend || selectedAgent?.agent_type;
  const modes = useAgentModesForBackend(selectedBackend);

  useEffect(() => {
    if (!selectedAgent || selectedAgentKey) return;
    setSelectedAgentKey(getAgentKey(selectedAgent));
  }, [selectedAgent, selectedAgentKey]);

  useEffect(() => {
    if (initialAgentKey) setSelectedAgentKey(initialAgentKey);
  }, [initialAgentKey]);

  useEffect(() => {
    if (!modes.length) {
      setSelectedMode('');
      return;
    }
    setSelectedMode((prev) => (modes.some((mode) => mode.value === prev) ? prev : modes[0].value));
  }, [modes]);

  const createMobileConversation = async () => {
    if (!selectedAgent || isCreating) return;
    const input = draft.trim();
    setIsCreating(true);

    try {
      const params = await buildCliAgentParams(selectedAgent, MOBILE_DEFAULT_WORKSPACE);
      const title = input.split(/\r?\n/)[0]?.trim() || `${selectedAgent.name || selectedBackend || 'Agent'} chat`;
      const conversation = await ipcBridge.conversation.create.invoke({
        ...params,
        name: title,
        extra: {
          ...params.extra,
          workspace: MOBILE_DEFAULT_WORKSPACE,
          custom_workspace: true,
          session_mode: selectedMode || params.extra?.session_mode,
        },
      });

      if (!conversation?.id) {
        throw new Error('Conversation create returned empty id');
      }

      updateWorkspaceTime(MOBILE_DEFAULT_WORKSPACE);

      if (input) {
        await ipcBridge.conversation.warmup.invoke({ conversation_id: conversation.id }).catch(() => {});
        await ipcBridge.conversation.sendMessage.invoke({
          input,
          conversation_id: conversation.id,
        });
      }

      emitter.emit('chat.history.refresh');
      setDraft('');
      onCreated(conversation.id);
    } catch (error) {
      ArcoMessage.error(parseError(error) || 'Create chat failed');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className='mobile-new-chat'>
      <div className='mobile-new-chat__workspace'>
        <span>Workspace</span>
        <strong>{MOBILE_DEFAULT_WORKSPACE}</strong>
      </div>

      <div className='mobile-new-chat__group'>
        <div className='mobile-new-chat__label'>Agent</div>
        {availableAgents.length > 0 ? (
          <MobileOptionList>
            {availableAgents.slice(0, 12).map((agent) => {
              const key = getAgentKey(agent);
              return (
                <MobileOptionChip
                  key={agent.id}
                  label={agent.name || agent.backend || agent.agent_type}
                  active={selectedAgentKey === key}
                  onClick={() => setSelectedAgentKey(key)}
                />
              );
            })}
          </MobileOptionList>
        ) : (
          <div className='mobile-conversation__settings-note'>No available agents</div>
        )}
      </div>

      {modes.length > 0 && (
        <div className='mobile-new-chat__group'>
          <div className='mobile-new-chat__label'>Access</div>
          <MobileOptionList>
            {modes.map((mode) => (
              <MobileOptionChip
                key={mode.value}
                label={mode.label}
                active={selectedMode === mode.value}
                onClick={() => setSelectedMode(mode.value)}
              />
            ))}
          </MobileOptionList>
        </div>
      )}

      <div className='mobile-new-chat__group'>
        <div className='mobile-new-chat__label'>Message</div>
        <textarea
          className='mobile-new-chat__input'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder='Start a mobile chat'
          rows={5}
        />
      </div>

      <button
        className='mobile-conversation__wide-action is-primary'
        type='button'
        disabled={!selectedAgent || isCreating}
        onClick={() => void createMobileConversation()}
      >
        <span>{isCreating ? 'Creating...' : 'Create mobile chat'}</span>
      </button>
    </div>
  );
};

const getTextContent = (message: TMessage): string => {
  if (message.type === 'text' || message.type === 'tips' || message.type === 'thinking') {
    return message.content.content || '';
  }
  return '';
};

const getToolSummary = (message: TMessage): { title: string; detail: string; status: string } => {
  if (message.type === 'tool_call') {
    return {
      title: message.content.description || message.content.name || 'Tool call',
      detail: pickString(message.content.output, message.content.error, JSON.stringify(message.content.args ?? {})),
      status: message.content.status || 'running',
    };
  }

  if (message.type === 'tool_group') {
    const calls = Array.isArray(message.content) ? message.content : [];
    const active = calls.find((call) => call.status === 'Executing' || call.status === 'Confirming') || calls.at(-1);
    return {
      title: active?.description || active?.name || `${calls.length} tool calls`,
      detail: calls
        .map((call) => call.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(' / '),
      status: active?.status || 'pending',
    };
  }

  if (message.type === 'acp_tool_call') {
    const update = message.content.update;
    return {
      title: update.title || update.kind || 'Tool call',
      detail: pickString(update.kind, update.locations?.map((item) => item.path).join(' / ')),
      status: update.status || 'pending',
    };
  }

  if (message.type === 'agent_status') {
    return {
      title: pickString(message.content.agent_name, message.content.backend, 'Agent'),
      detail: message.content.has_active_session ? 'Active session' : '',
      status: message.content.status,
    };
  }

  return {
    title: message.type,
    detail: '',
    status: '',
  };
};

const MobileCompactCard: React.FC<{ message: TMessage }> = ({ message }) => {
  if (message.type === 'permission') {
    return (
      <div className='mobile-message__card mobile-message__permission'>
        <MessagePermission message={message as IMessagePermission} />
      </div>
    );
  }

  if (message.type === 'acp_permission') {
    return (
      <div className='mobile-message__card mobile-message__permission'>
        <MessageAcpPermission message={message as IMessageAcpPermission} />
      </div>
    );
  }

  if (message.type === 'tips') {
    return (
      <div className={classNames('mobile-message__notice', `is-${message.content.type}`)}>
        <MarkdownView hiddenCodeCopyButton>{message.content.content}</MarkdownView>
      </div>
    );
  }

  if (message.type === 'thinking') {
    const text = pickString(message.content.subject, message.content.content);
    if (!text && message.content.status === 'done') return null;
    return (
      <div className='mobile-message__card mobile-message__thinking'>
        <div className='mobile-message__card-title'>{message.content.status === 'done' ? 'Thought' : 'Thinking'}</div>
        {text && <div className='mobile-message__card-detail'>{text}</div>}
      </div>
    );
  }

  if (message.type === 'plan') {
    const entries = message.content.entries ?? [];
    return (
      <div className='mobile-message__card'>
        <div className='mobile-message__card-title'>Plan</div>
        <div className='mobile-message__plan-list'>
          {entries.slice(0, 6).map((entry, index) => (
            <div key={`${entry.content}-${index}`} className={classNames('mobile-message__plan-item', entry.status)}>
              <span>{entry.content}</span>
              <strong>{entry.status.replace(/_/g, ' ')}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (
    message.type === 'tool_call' ||
    message.type === 'tool_group' ||
    message.type === 'acp_tool_call' ||
    message.type === 'agent_status' ||
    message.type === 'available_commands'
  ) {
    const summary =
      message.type === 'available_commands'
        ? {
            title: 'Commands ready',
            detail: message.content.commands.map((command) => command.name).join(' / '),
            status: `${message.content.commands.length}`,
          }
        : getToolSummary(message);
    return (
      <div className='mobile-message__card'>
        <div className='mobile-message__card-head'>
          <span className='mobile-message__card-title'>{summary.title}</span>
          {summary.status && <span className='mobile-message__status-pill'>{summary.status}</span>}
        </div>
        {summary.detail && <div className='mobile-message__card-detail'>{summary.detail}</div>}
      </div>
    );
  }

  return null;
};

const MobileMessageBubble: React.FC<{ message: TMessage }> = ({ message }) => {
  if (message.hidden) return null;

  if (message.type !== 'text') {
    const card = <MobileCompactCard message={message} />;
    if (!card) return null;
    return (
      <div className='mobile-message mobile-message--left'>
        <div className='mobile-message__bubble mobile-message__bubble--system'>{card}</div>
      </div>
    );
  }

  const text = getTextContent(message);
  if (!text.trim()) return null;

  const isUser = message.position === 'right';
  return (
    <div className={classNames('mobile-message', isUser ? 'mobile-message--right' : 'mobile-message--left')}>
      <div
        className={classNames(
          'mobile-message__bubble',
          isUser ? 'mobile-message__bubble--user' : 'mobile-message__bubble--assistant'
        )}
      >
        {isUser ? <div className='mobile-message__plain-text'>{text}</div> : <MarkdownView>{text}</MarkdownView>}
        <div className='mobile-message__time'>{formatMessageTime(message.created_at)}</div>
      </div>
    </div>
  );
};

const MobileTyping: React.FC = () => {
  return (
    <div className='mobile-message mobile-message--left'>
      <div className='mobile-message__typing' aria-label='Assistant is responding'>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
};

const MobileComposer: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  running?: boolean;
  readOnly?: boolean;
}> = ({ value, onChange, onSend, onStop, onOpenSettings, disabled, running, readOnly }) => {
  const canSend = Boolean(value.trim()) && !disabled && !readOnly;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <form
      className='mobile-composer'
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className='mobile-composer__bar'>
        <button className='mobile-composer__tool' type='button' onClick={onOpenSettings} aria-label='Chat options'>
          <Plus theme='outline' size='22' />
        </button>
        <textarea
          className='mobile-composer__input'
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={readOnly}
          placeholder={readOnly ? 'Legacy history is read-only' : 'Message AionUi'}
        />
        {running ? (
          <button className='mobile-composer__send is-stop' type='button' onClick={onStop} aria-label='Stop response'>
            <CloseSmall theme='outline' size='20' />
          </button>
        ) : (
          <button className='mobile-composer__send' type='submit' disabled={!canSend} aria-label='Send message'>
            <ArrowUp theme='outline' size='20' />
          </button>
        )}
      </div>
    </form>
  );
};

const MobileAgentChat: React.FC<{ conversation: TChatConversation; openSettings: () => void }> = ({
  conversation,
  openSettings,
}) => {
  return (
    <MessageListProvider value={[]}>
      <MessageListLoadingProvider value={false}>
        <MobileAgentChatInner conversation={conversation} openSettings={openSettings} />
      </MessageListLoadingProvider>
    </MessageListProvider>
  );
};

const getConversationContextType = (conversation: TChatConversation): ConversationContextValue['type'] => {
  return conversation.type === 'gemini' ? 'acp' : conversation.type;
};

const MobileAgentChatInner: React.FC<{ conversation: TChatConversation; openSettings: () => void }> = ({
  conversation,
  openSettings,
}) => {
  const extra = getExtra(conversation);
  const messages = useMessageList();
  const isLoading = useMessageListLoading();
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const userScrolledAwayRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  useMessageLstCache(conversation.id, {
    pageSize: MOBILE_MESSAGE_PAGE_SIZE,
    refreshIntervalMs: MOBILE_REFRESH_INTERVAL_MS,
    refreshOnVisibility: true,
    partialRefresh: true,
  });
  usePendingConfirmationsRecovery(conversation.id);
  const acpState = useAcpMessage(conversation.id, { skipWarmup: conversation.type === 'gemini' });

  const visibleMessages = useMemo(() => messages.filter((message) => !message.hidden), [messages]);
  const readOnly = conversation.type === 'gemini';
  const running = acpState.running || acpState.aiProcessing || conversation.status === 'running';

  const conversationValue = useMemo<ConversationContextValue>(
    () => ({
      conversation_id: conversation.id,
      workspace: extra.workspace,
      type: getConversationContextType(conversation),
      cron_job_id: extra.cron_job_id || extra.cronJobId,
      loadedSkills: extra.skills,
    }),
    [conversation, extra]
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight - scroller.clientHeight, behavior });
  }, []);

  useEffect(() => {
    userScrolledAwayRef.current = false;
    window.requestAnimationFrame(() => scrollToBottom('auto'));
  }, [conversation.id, scrollToBottom]);

  useEffect(() => {
    if (userScrolledAwayRef.current) return;
    window.requestAnimationFrame(() => scrollToBottom('smooth'));
  }, [visibleMessages.length, running, scrollToBottom]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const bottomGap = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    userScrolledAwayRef.current = bottomGap > 120;
  };

  const sendMessage = async () => {
    const input = draft.trim();
    if (!input || isSending || readOnly) return;

    setDraft('');
    setIsSending(true);
    acpState.setAiProcessing(true);
    userScrolledAwayRef.current = false;

    try {
      const result = await ipcBridge.conversation.sendMessage.invoke({
        input,
        conversation_id: conversation.id,
      });
      const msgId = result?.msg_id || uuid();
      addOrUpdateMessage(
        {
          id: msgId,
          msg_id: msgId,
          type: 'text',
          position: 'right',
          conversation_id: conversation.id,
          created_at: Date.now(),
          content: { content: input },
        },
        true
      );
      emitter.emit('chat.history.refresh');
      window.dispatchEvent(
        new CustomEvent(MESSAGE_LIST_REFRESH_EVENT, {
          detail: { conversation_id: conversation.id, conversationId: conversation.id },
        })
      );
    } catch (error) {
      const message = parseError(error) || 'Send failed';
      ArcoMessage.error(message);
      addOrUpdateMessage(
        {
          id: uuid(),
          msg_id: uuid(),
          type: 'tips',
          position: 'center',
          conversation_id: conversation.id,
          created_at: Date.now(),
          content: { content: `Send failed: ${message}`, type: 'error' },
        } as TMessage,
        true
      );
      acpState.setAiProcessing(false);
    } finally {
      setIsSending(false);
    }
  };

  const stopResponse = async () => {
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id: conversation.id });
    } catch (error) {
      ArcoMessage.error(parseError(error) || 'Stop failed');
    } finally {
      acpState.resetState();
    }
  };

  return (
    <ConversationProvider value={conversationValue}>
      <div className='mobile-agent-chat'>
        <div
          className='mobile-agent-chat__messages'
          ref={scrollerRef}
          data-testid='mobile-message-scroller'
          onScroll={handleScroll}
        >
          {isLoading && !visibleMessages.length ? (
            <div className='mobile-agent-chat__empty'>Loading messages...</div>
          ) : visibleMessages.length ? (
            visibleMessages.map((message) => (
              <MobileMessageBubble key={`${message.id}-${message.msg_id}`} message={message} />
            ))
          ) : (
            <div className='mobile-agent-chat__empty'>No messages yet</div>
          )}
          {running && <MobileTyping />}
        </div>
        <MobileComposer
          value={draft}
          onChange={setDraft}
          onSend={sendMessage}
          onStop={stopResponse}
          onOpenSettings={openSettings}
          disabled={isSending}
          running={running}
          readOnly={readOnly}
        />
      </div>
    </ConversationProvider>
  );
};

const useMobileScrollAction = (
  conversationId?: string
): [ScrollAction, (action: Exclude<ScrollAction, null>) => void] => {
  const [scrollAction, setScrollAction] = useState<ScrollAction>(null);

  useEffect(() => {
    let scroller: HTMLElement | null = null;
    let lastScrollTop = 0;
    let attachedAt = 0;
    let hideTimer: number | undefined;

    const clearHideTimer = () => {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
      }
    };

    const scheduleHide = () => {
      clearHideTimer();
      hideTimer = window.setTimeout(() => setScrollAction(null), 2400);
    };

    const onScroll = () => {
      if (!scroller) return;
      const current = scroller.scrollTop;
      const delta = current - lastScrollTop;
      lastScrollTop = current;
      if (Date.now() - attachedAt < 600) return;
      if (Math.abs(delta) < 8) return;

      const bottomGap = scroller.scrollHeight - scroller.clientHeight - current;
      if (delta > 0 && current > 24) {
        setScrollAction('top');
        scheduleHide();
      } else if (delta < 0 && bottomGap > 24) {
        setScrollAction('bottom');
        scheduleHide();
      } else {
        setScrollAction(null);
      }
    };

    const attach = (): boolean => {
      scroller = document.querySelector<HTMLElement>('.mobile-conversation [data-testid="mobile-message-scroller"]');
      if (!scroller) return false;
      lastScrollTop = scroller.scrollTop;
      attachedAt = Date.now();
      scroller.addEventListener('scroll', onScroll, { passive: true });
      return true;
    };

    const retry = window.setInterval(() => {
      if (attach()) {
        window.clearInterval(retry);
      }
    }, 160);

    return () => {
      window.clearInterval(retry);
      clearHideTimer();
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [conversationId]);

  const jump = (action: Exclude<ScrollAction, null>) => {
    const scroller = document.querySelector<HTMLElement>(
      '.mobile-conversation [data-testid="mobile-message-scroller"]'
    );
    if (!scroller) return;
    scroller.scrollTo({
      top: action === 'top' ? 0 : scroller.scrollHeight - scroller.clientHeight,
      behavior: 'smooth',
    });
    setScrollAction(null);
  };

  return [scrollAction, jump];
};

const MobileConversationPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeSheet, setActiveSheet] = useState<SheetName>(null);
  const [newChatAgentKey, setNewChatAgentKey] = useState<string | undefined>();
  const [collapsedHistorySections, setCollapsedHistorySections] = useState<Record<HistorySectionKey, boolean>>(() => {
    try {
      const stored = localStorage.getItem('mobile-history-collapsed-sections');
      if (!stored) return { pinned: false, teams: false, workspaces: false, normal: false };
      return {
        pinned: false,
        teams: false,
        workspaces: false,
        normal: false,
        ...(JSON.parse(stored) as Partial<Record<HistorySectionKey, boolean>>),
      };
    } catch {
      return { pinned: false, teams: false, workspaces: false, normal: false };
    }
  });
  const { teams } = useTeamList();

  const {
    data: conversation,
    isLoading,
    mutate: mutateConversation,
  } = useSWR(id ? ['mobile-conversation', id] : null, () => getConversationOrNull(id!));

  const { data: conversationsResult, mutate: mutateHistory } = useSWR('mobile-conversation-history', () =>
    ipcBridge.database.getUserConversations.invoke({ limit: HISTORY_PAGE_SIZE })
  );

  const conversations = useMemo(() => {
    const items = conversationsResult?.items ?? [];
    return items.toSorted((a, b) => getConversationActivityTime(b) - getConversationActivityTime(a));
  }, [conversationsResult]);

  const historyGroups = useMemo(() => buildMobileHistoryGroups(conversations, teams), [conversations, teams]);

  useEffect(() => {
    return ipcBridge.conversation.listChanged.on((event) => {
      void mutateHistory();
      if (event.conversation_id === id) {
        void mutateConversation();
      }
    });
  }, [id, mutateConversation, mutateHistory]);

  useEffect(() => {
    if (activeSheet !== 'history' || !id) return;
    requestAnimationFrame(() => {
      document.getElementById(`mobile-history-${id}`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [activeSheet, id]);

  const [scrollAction, jumpScroll] = useMobileScrollAction(conversation?.id);

  const layoutValue = useMemo<LayoutContextValue>(
    () => ({
      isMobile: true,
      siderCollapsed: true,
      setSiderCollapsed: (_value: boolean): void => undefined,
    }),
    []
  );

  const refreshConversation = () => {
    void mutateConversation();
    void mutateHistory();
    window.dispatchEvent(
      new CustomEvent(MESSAGE_LIST_REFRESH_EVENT, { detail: { conversation_id: id, conversationId: id } })
    );
  };

  const openFullView = () => {
    if (!id) return;
    void navigate(`/conversation/${id}?desktop=1`);
  };

  const goToConversation = (conversationId: string) => {
    setActiveSheet(null);
    void navigate(`/mobile/conversation/${conversationId}`);
  };

  const goToTeam = (teamId: string) => {
    setActiveSheet(null);
    void navigate(`/team/${teamId}`);
  };

  const createConversation = () => {
    setNewChatAgentKey(undefined);
    setActiveSheet('new-chat');
  };

  const toggleHistorySection = (section: HistorySectionKey) => {
    setCollapsedHistorySections((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      localStorage.setItem('mobile-history-collapsed-sections', JSON.stringify(next));
      return next;
    });
  };

  const startNewChatWithAgent = (agentKey?: string) => {
    setNewChatAgentKey(agentKey);
    setActiveSheet('new-chat');
  };

  const handleMobileChatCreated = (conversationId: string) => {
    setActiveSheet(null);
    void mutateHistory();
    void navigate(`/mobile/conversation/${conversationId}`);
  };

  const title = conversation?.name || 'AionUi';
  const status = conversation?.status || (isLoading ? 'loading' : 'ready');

  return (
    <LayoutContext.Provider value={layoutValue}>
      <div className='mobile-conversation'>
        <header className='mobile-conversation__topbar'>
          <MobileIconButton label='History' onClick={() => setActiveSheet('history')}>
            <History theme='outline' size='20' />
          </MobileIconButton>
          <div className='mobile-conversation__title-block'>
            <div className='mobile-conversation__title'>{title}</div>
            <div className='mobile-conversation__status'>
              <span className={classNames('mobile-conversation__status-dot', `is-${status}`)} />
              <span>{status}</span>
            </div>
          </div>
          <div className='mobile-conversation__top-actions'>
            <MobileIconButton label='Refresh' onClick={refreshConversation}>
              <Refresh theme='outline' size='19' />
            </MobileIconButton>
            <MobileIconButton label='Settings' onClick={() => setActiveSheet('settings')}>
              <SettingTwo theme='outline' size='20' />
            </MobileIconButton>
          </div>
        </header>

        <main className='mobile-conversation__main'>
          {conversation ? (
            <MobileAgentChat conversation={conversation} openSettings={() => setActiveSheet('settings')} />
          ) : (
            <div className='mobile-conversation__loading'>{isLoading ? 'Loading chat...' : 'Chat not found'}</div>
          )}
          {scrollAction && (
            <button
              className='mobile-conversation__scroll-jump'
              type='button'
              onClick={() => jumpScroll(scrollAction)}
              aria-label={scrollAction === 'top' ? 'Go to top' : 'Go to bottom'}
            >
              {scrollAction === 'top' ? <Up theme='outline' size='18' /> : <Down theme='outline' size='18' />}
              <span>{scrollAction === 'top' ? 'Top' : 'Bottom'}</span>
            </button>
          )}
        </main>

        <div
          className={classNames('mobile-conversation__sheet-backdrop', activeSheet && 'is-open')}
          onClick={() => setActiveSheet(null)}
          aria-hidden='true'
        />

        <aside className={classNames('mobile-conversation__sheet', activeSheet === 'history' && 'is-open')}>
          <div className='mobile-conversation__sheet-head'>
            <div className='mobile-conversation__sheet-title'>History</div>
            <MobileIconButton label='Close history' onClick={() => setActiveSheet(null)}>
              <CloseSmall theme='outline' size='20' />
            </MobileIconButton>
          </div>
          <button className='mobile-conversation__wide-action' type='button' onClick={createConversation}>
            <Plus theme='outline' size='17' />
            <span>New mobile chat</span>
          </button>
          <div className='mobile-conversation__history-list'>
            {historyGroups.pinned.length > 0 && (
              <MobileHistorySection
                title='Pinned'
                count={historyGroups.pinned.length}
                collapsed={collapsedHistorySections.pinned}
                onToggle={() => toggleHistorySection('pinned')}
              >
                {historyGroups.pinned.map((item) => (
                  <MobileHistoryConversationButton key={item.id} item={item} activeId={id} onClick={goToConversation} />
                ))}
              </MobileHistorySection>
            )}

            {historyGroups.teams.length > 0 && (
              <MobileHistorySection
                title='Team Work'
                count={historyGroups.teams.length}
                collapsed={collapsedHistorySections.teams}
                onToggle={() => toggleHistorySection('teams')}
              >
                {historyGroups.teams.map((group) => (
                  <div className='mobile-conversation__history-team-group' key={group.teamId}>
                    <MobileHistoryTeamButton group={group} onOpenTeam={goToTeam} />
                    {group.conversations.slice(0, 4).map((item) => (
                      <MobileHistoryConversationButton
                        key={item.id}
                        item={item}
                        activeId={id}
                        onClick={goToConversation}
                      />
                    ))}
                  </div>
                ))}
              </MobileHistorySection>
            )}

            {historyGroups.workspaces.length > 0 && (
              <MobileHistorySection
                title='Workspaces'
                count={historyGroups.workspaces.length}
                collapsed={collapsedHistorySections.workspaces}
                onToggle={() => toggleHistorySection('workspaces')}
              >
                {historyGroups.workspaces.map((group) => (
                  <div className='mobile-conversation__history-workspace' key={group.workspace}>
                    <div className='mobile-conversation__history-workspace-title'>
                      <span>{group.displayName}</span>
                      <strong>{group.conversations.length}</strong>
                    </div>
                    {group.conversations.map((item) => (
                      <MobileHistoryConversationButton
                        key={item.id}
                        item={item}
                        activeId={id}
                        onClick={goToConversation}
                      />
                    ))}
                  </div>
                ))}
              </MobileHistorySection>
            )}

            <MobileHistorySection
              title='Conversations'
              count={historyGroups.normal.length}
              collapsed={collapsedHistorySections.normal}
              onToggle={() => toggleHistorySection('normal')}
            >
              {historyGroups.normal.length > 0 ? (
                historyGroups.normal.map((item) => (
                  <MobileHistoryConversationButton key={item.id} item={item} activeId={id} onClick={goToConversation} />
                ))
              ) : (
                <div className='mobile-conversation__history-empty'>No regular conversations</div>
              )}
            </MobileHistorySection>
          </div>
        </aside>

        <aside className={classNames('mobile-conversation__sheet', activeSheet === 'settings' && 'is-open')}>
          <div className='mobile-conversation__sheet-head'>
            <div className='mobile-conversation__sheet-title'>Chat</div>
            <MobileIconButton label='Close settings' onClick={() => setActiveSheet(null)}>
              <CloseSmall theme='outline' size='20' />
            </MobileIconButton>
          </div>
          {conversation ? (
            <MobileConversationSettings
              conversation={conversation}
              onConversationChanged={refreshConversation}
              onStartNewChatWithAgent={startNewChatWithAgent}
            />
          ) : (
            <div className='mobile-conversation__settings-list'>
              <MobileSettingsRow label='Chat'>
                <MobileSettingValue>Not loaded</MobileSettingValue>
              </MobileSettingsRow>
            </div>
          )}
          <button className='mobile-conversation__wide-action' type='button' onClick={refreshConversation}>
            <Refresh theme='outline' size='17' />
            <span>Refresh messages</span>
          </button>
          <button className='mobile-conversation__wide-action' type='button' onClick={openFullView}>
            <span>Open full desktop view</span>
          </button>
        </aside>

        <aside className={classNames('mobile-conversation__sheet', activeSheet === 'new-chat' && 'is-open')}>
          <div className='mobile-conversation__sheet-head'>
            <div className='mobile-conversation__sheet-title'>New Chat</div>
            <MobileIconButton label='Close new chat' onClick={() => setActiveSheet(null)}>
              <CloseSmall theme='outline' size='20' />
            </MobileIconButton>
          </div>
          <MobileNewChatSheet initialAgentKey={newChatAgentKey} onCreated={handleMobileChatCreated} />
        </aside>
      </div>
    </LayoutContext.Provider>
  );
};

export default MobileConversationPage;
