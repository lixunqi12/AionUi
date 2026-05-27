import { ipcBridge } from '@/common';
import type { IMessageAcpPermission, IMessagePermission, TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { parseError, uuid } from '@/common/utils';
import MarkdownView from '@/renderer/components/Markdown';
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
import { emitter } from '@/renderer/utils/emitter';
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
};

type SheetName = 'history' | 'settings' | null;
type ScrollAction = 'top' | 'bottom' | null;

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
    return items
      .filter((item) => {
        const extra = getExtra(item);
        return extra.is_health_check !== true && !extra.team_id && !extra.teamId;
      })
      .toSorted((a, b) => getConversationActivityTime(b) - getConversationActivityTime(a));
  }, [conversationsResult]);

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

  const createConversation = () => {
    setActiveSheet(null);
    void navigate('/guid');
  };

  const extra = getExtra(conversation);
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
            <span>New chat</span>
          </button>
          <div className='mobile-conversation__history-list'>
            {conversations.map((item) => (
              <button
                id={`mobile-history-${item.id}`}
                key={item.id}
                type='button'
                className={classNames('mobile-conversation__history-item', item.id === id && 'is-active')}
                onClick={() => goToConversation(item.id)}
              >
                <span className='mobile-conversation__history-title'>{item.name}</span>
                <span className='mobile-conversation__history-meta'>
                  {item.type} - {formatHistoryTime(item)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <aside className={classNames('mobile-conversation__sheet', activeSheet === 'settings' && 'is-open')}>
          <div className='mobile-conversation__sheet-head'>
            <div className='mobile-conversation__sheet-title'>Chat</div>
            <MobileIconButton label='Close settings' onClick={() => setActiveSheet(null)}>
              <CloseSmall theme='outline' size='20' />
            </MobileIconButton>
          </div>
          <div className='mobile-conversation__settings-list'>
            <div className='mobile-conversation__settings-row'>
              <span>Type</span>
              <strong>{conversation?.type || '-'}</strong>
            </div>
            <div className='mobile-conversation__settings-row'>
              <span>Agent</span>
              <strong>{extra.agent_name || extra.agentName || extra.backend || conversation?.type || '-'}</strong>
            </div>
            <div className='mobile-conversation__settings-row'>
              <span>Model</span>
              <strong>{getModelLabel(conversation)}</strong>
            </div>
            <div className='mobile-conversation__settings-row'>
              <span>Access</span>
              <strong>{getModeLabel(conversation)}</strong>
            </div>
            <div className='mobile-conversation__settings-row'>
              <span>Workspace</span>
              <strong>{extra.workspace || 'Temporary'}</strong>
            </div>
            <div className='mobile-conversation__settings-row'>
              <span>Theme</span>
              <MobileThemeToggle />
            </div>
          </div>
          <button className='mobile-conversation__wide-action' type='button' onClick={refreshConversation}>
            <Refresh theme='outline' size='17' />
            <span>Refresh messages</span>
          </button>
          <button className='mobile-conversation__wide-action' type='button' onClick={openFullView}>
            <span>Open full desktop view</span>
          </button>
        </aside>
      </div>
    </LayoutContext.Provider>
  );
};

export default MobileConversationPage;
