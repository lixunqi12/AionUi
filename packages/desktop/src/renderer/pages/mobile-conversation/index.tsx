import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { LayoutContext, type LayoutContextValue } from '@/renderer/hooks/context/LayoutContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { MESSAGE_LIST_REFRESH_EVENT } from '@/renderer/pages/conversation/Messages/hooks';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import AcpChat from '@/renderer/pages/conversation/platforms/acp/AcpChat';
import NanobotChat from '@/renderer/pages/conversation/platforms/nanobot/NanobotChat';
import OpenClawChat from '@/renderer/pages/conversation/platforms/openclaw/OpenClawChat';
import RemoteChat from '@/renderer/pages/conversation/platforms/remote/RemoteChat';
import { CloseSmall, Down, History, Moon, Plus, Refresh, SettingTwo, SunOne, Up } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
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
  agent_name?: string;
  agentName?: string;
  cron_job_id?: string;
  cronJobId?: string;
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

const getConversationActivityTime = (conversation: TChatConversation): number => {
  return conversation.modified_at || conversation.created_at || 0;
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

const MobileConversationBody: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const extra = getExtra(conversation);
  const workspace = extra.workspace || '';
  const commonRefreshProps = {
    mobileMode: true,
    messageRefreshIntervalMs: MOBILE_REFRESH_INTERVAL_MS,
    messagePageSize: MOBILE_MESSAGE_PAGE_SIZE,
  };

  if (conversation.type === 'acp' || conversation.type === 'codex' || conversation.type === 'gemini') {
    const backend =
      conversation.type === 'codex' ? 'codex' : conversation.type === 'gemini' ? 'gemini' : extra.backend || 'claude';
    return (
      <AcpChat
        conversation_id={conversation.id}
        workspace={workspace}
        backend={backend}
        session_mode={extra.session_mode || extra.sessionMode}
        agent_name={extra.agent_name || extra.agentName}
        cron_job_id={extra.cron_job_id || extra.cronJobId}
        loadedSkills={extra.skills}
        {...commonRefreshProps}
      />
    );
  }

  if (conversation.type === 'remote') {
    return (
      <RemoteChat
        conversation_id={conversation.id}
        workspace={workspace}
        cron_job_id={extra.cron_job_id || extra.cronJobId}
        loadedSkills={extra.skills}
        {...commonRefreshProps}
      />
    );
  }

  if (conversation.type === 'openclaw-gateway') {
    return (
      <OpenClawChat
        conversation_id={conversation.id}
        workspace={workspace}
        cron_job_id={extra.cron_job_id || extra.cronJobId}
        loadedSkills={extra.skills}
        {...commonRefreshProps}
      />
    );
  }

  if (conversation.type === 'nanobot') {
    return (
      <NanobotChat
        conversation_id={conversation.id}
        workspace={workspace}
        cron_job_id={extra.cron_job_id || extra.cronJobId}
        loadedSkills={extra.skills}
        {...commonRefreshProps}
      />
    );
  }

  return (
    <div className='mobile-conversation__unsupported'>
      <div className='mobile-conversation__unsupported-title'>Use full view for this chat</div>
      <div className='mobile-conversation__unsupported-text'>
        This mobile shell supports ACP, Codex, Gemini history, remote, OpenClaw, and Nanobot chats.
      </div>
    </div>
  );
};

const useMobileScrollAction = (
  conversationId?: string
): [ScrollAction, (action: Exclude<ScrollAction, null>) => void] => {
  const [scrollAction, setScrollAction] = useState<ScrollAction>(null);

  useEffect(() => {
    let scroller: HTMLElement | null = null;
    let lastScrollTop = 0;
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
      if (Math.abs(delta) < 8) return;

      const bottomGap = scroller.scrollHeight - scroller.clientHeight - current;
      if (delta < 0 && current > 24) {
        setScrollAction('top');
        scheduleHide();
      } else if (delta > 0 && bottomGap > 24) {
        setScrollAction('bottom');
        scheduleHide();
      } else {
        setScrollAction(null);
      }
    };

    const attach = (): boolean => {
      scroller = document.querySelector<HTMLElement>('.mobile-conversation [data-testid="message-list-scroller"]');
      if (!scroller) return false;
      lastScrollTop = scroller.scrollTop;
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
    const scroller = document.querySelector<HTMLElement>('.mobile-conversation [data-testid="message-list-scroller"]');
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
            <MobileConversationBody conversation={conversation} />
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
