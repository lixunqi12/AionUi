import type {
  IConversationMcpStatus,
  ISessionMcpServer,
  TChatConversation,
  TProviderWithModel,
  TokenUsageData,
} from '@/common/config/storage';
import type { TeamAgent, TeammateStatus } from '@/common/types/team/teamTypes';
import { Tag, Tooltip } from '@arco-design/web-react';
import React, { useMemo } from 'react';

export type TeamRuntimeStatusInfo = {
  status: TeammateStatus;
  last_message?: string;
};

type RuntimeExtra = {
  workspace?: string;
  backend?: string;
  skills?: string[];
  mcp_servers?: string[];
  mcp_statuses?: IConversationMcpStatus[];
  session_mcp_servers?: ISessionMcpServer[];
  acp_session_id?: string;
  acp_session_conversation_id?: string;
  session_mode?: string;
  current_model_id?: string;
  codexModel?: string;
  sandboxMode?: string;
  last_token_usage?: TokenUsageData;
  last_context_limit?: number;
};

type RuntimeChip = {
  key: string;
  label: string;
  tone?: 'primary' | 'danger' | 'warning' | 'neutral';
  tooltip?: React.ReactNode;
};

const getConversationModel = (conversation?: TChatConversation | null): string | undefined => {
  if (!conversation || !('model' in conversation)) return undefined;
  return (conversation.model as TProviderWithModel | undefined)?.use_model;
};

const shorten = (value?: string, left = 6, right = 4): string | undefined => {
  if (!value) return undefined;
  if (value.length <= left + right + 1) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
};

const formatContext = (usage?: TokenUsageData, limit?: number): string | undefined => {
  const used = usage?.total_tokens;
  if (!used && !limit) return undefined;
  if (used && limit) return `${Math.round((used / limit) * 100)}%`;
  if (used) return `${used.toLocaleString()} tok`;
  return `${limit?.toLocaleString()} max`;
};

const statusTone = (status?: TeammateStatus): RuntimeChip['tone'] => {
  switch (status) {
    case 'active':
      return 'primary';
    case 'failed':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
};

const tagColor = (tone?: RuntimeChip['tone']) => {
  switch (tone) {
    case 'primary':
      return 'arcoblue';
    case 'danger':
      return 'red';
    case 'warning':
      return 'orange';
    default:
      return 'gray';
  }
};

const TeamRuntimeInspector: React.FC<{
  agent: TeamAgent;
  conversation?: TChatConversation | null;
  statusInfo?: TeamRuntimeStatusInfo;
  isLeader: boolean;
}> = ({ agent, conversation, statusInfo, isLeader }) => {
  const chips = useMemo<RuntimeChip[]>(() => {
    const extra = (conversation?.extra ?? {}) as RuntimeExtra;
    const role = isLeader ? 'Lead' : 'Worker';
    const status = statusInfo?.status ?? agent.status;
    const mode = extra.session_mode ?? extra.sandboxMode;
    const model = extra.current_model_id ?? extra.codexModel ?? agent.model ?? getConversationModel(conversation);
    const skills = extra.skills ?? [];
    const mcpStatuses = extra.mcp_statuses ?? [];
    const sessionMcpServers = extra.session_mcp_servers ?? [];
    const mcpNames =
      extra.mcp_servers && extra.mcp_servers.length > 0
        ? extra.mcp_servers
        : sessionMcpServers.map((server) => server.name);
    const mcpCount = mcpStatuses.length || mcpNames.length;
    const failedMcp = mcpStatuses.filter((item) => item.status !== 'loaded');
    const contextUsage = formatContext(extra.last_token_usage, extra.last_context_limit);
    const sessionId = extra.acp_session_id ?? extra.acp_session_conversation_id;

    return [
      { key: 'role', label: role, tone: isLeader ? 'primary' : 'neutral' },
      {
        key: 'status',
        label: status,
        tone: statusTone(status),
        tooltip: statusInfo?.last_message,
      },
      mode ? { key: 'mode', label: `Mode ${mode}`, tone: mode === 'full-access' ? 'danger' : 'neutral' } : undefined,
      model ? { key: 'model', label: `Model ${model}`, tooltip: model } : undefined,
      contextUsage
        ? {
            key: 'context',
            label: `Ctx ${contextUsage}`,
            tooltip:
              extra.last_token_usage && extra.last_context_limit
                ? `${extra.last_token_usage.total_tokens.toLocaleString()} / ${extra.last_context_limit.toLocaleString()} tokens`
                : undefined,
          }
        : undefined,
      skills.length > 0
        ? {
            key: 'skills',
            label: `Skills ${skills.length}`,
            tooltip: skills.join(', '),
          }
        : undefined,
      mcpCount > 0
        ? {
            key: 'mcp',
            label: failedMcp.length > 0 ? `MCP ${mcpCount}/${failedMcp.length} err` : `MCP ${mcpCount}`,
            tone: failedMcp.length > 0 ? 'warning' : 'neutral',
            tooltip:
              mcpStatuses.length > 0
                ? mcpStatuses
                    .map((item) => `${item.name}: ${item.status}${item.reason ? ` (${item.reason})` : ''}`)
                    .join('\n')
                : mcpNames.join(', '),
          }
        : undefined,
      sessionId
        ? {
            key: 'session',
            label: `Sid ${shorten(sessionId)}`,
            tooltip: sessionId,
          }
        : undefined,
    ].filter(Boolean) as RuntimeChip[];
  }, [agent.model, agent.status, conversation, isLeader, statusInfo]);

  if (chips.length === 0) return null;

  return (
    <div className='flex-1 min-w-0 flex items-center gap-4px overflow-hidden'>
      {chips.map((chip) => {
        const tag = (
          <Tag
            key={chip.key}
            color={tagColor(chip.tone)}
            className='max-w-120px shrink truncate [&_.arco-tag-content]:truncate'
            size='small'
          >
            {chip.label}
          </Tag>
        );
        if (!chip.tooltip) return tag;
        return (
          <Tooltip key={chip.key} content={<span className='whitespace-pre-wrap'>{chip.tooltip}</span>}>
            {tag}
          </Tooltip>
        );
      })}
    </div>
  );
};

export default TeamRuntimeInspector;
