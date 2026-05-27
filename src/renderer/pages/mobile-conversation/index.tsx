import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { AcpBackend } from '@/common/types/acpTypes';
import { LayoutContext, type LayoutContextValue } from '@/renderer/hooks/context/LayoutContext';
import { MESSAGE_LIST_REFRESH_EVENT } from '@/renderer/pages/conversation/Messages/hooks';
import AcpChat from '@/renderer/pages/conversation/platforms/acp/AcpChat';
import NanobotChat from '@/renderer/pages/conversation/platforms/nanobot/NanobotChat';
import OpenClawChat from '@/renderer/pages/conversation/platforms/openclaw/OpenClawChat';
import RemoteChat from '@/renderer/pages/conversation/platforms/remote/RemoteChat';
import { CloseSmall, History, Plus, Refresh, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import './mobile-conversation.css';

const MOBILE_REFRESH_INTERVAL_MS = 1800;
const MOBILE_MESSAGE_PAGE_SIZE = 320;
const HISTORY_PAGE_SIZE = 120;

type ConversationExtra = {
  backend?: AcpBackend;
  workspace?: string;
  sessionMode?: string;
  cachedConfigOptions?: import('@/common/types/acpTypes').AcpSessionConfigOption[];
  agentName?: string;
  cronJobId?: string;
};

type SheetName = 'history' | 'settings' | null;

const getExtra = (conversation?: TChatConversation): ConversationExtra => {
  return ((conversation?.extra || {}) as ConversationExtra) || {};
};

const formatHistoryTime = (conversation: TChatConversation): string => {
  const rawTime = conversation.modifyTime || conversation.createTime || 0;
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

const MobileConversationBody: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const extra = getExtra(conversation);
  const workspace = extra.workspace || '';
  const commonRefreshProps = {
    mobileMode: true,
    messageRefreshIntervalMs: MOBILE_REFRESH_INTERVAL_MS,
    messagePageSize: MOBILE_MESSAGE_PAGE_SIZE,
  };

  if (conversation.type === 'acp' || conversation.type === 'codex') {
    return (
      <AcpChat
        conversation_id={conversation.id}
        workspace={workspace}
        backend={conversation.type === 'codex' ? 'codex' : extra.backend || 'claude'}
        sessionMode={extra.sessionMode}
        cachedConfigOptions={extra.cachedConfigOptions}
        agentName={extra.agentName}
        cronJobId={extra.cronJobId}
        {...commonRefreshProps}
      />
    );
  }

  if (conversation.type === 'remote') {
    return (
      <RemoteChat
        conversation_id={conversation.id}
        workspace={workspace}
        cronJobId={extra.cronJobId}
        {...commonRefreshProps}
      />
    );
  }

  if (conversation.type === 'openclaw-gateway') {
    return (
      <OpenClawChat
        conversation_id={conversation.id}
        workspace={workspace}
        cronJobId={extra.cronJobId}
        {...commonRefreshProps}
      />
    );
  }

  if (conversation.type === 'nanobot') {
    return (
      <NanobotChat
        conversation_id={conversation.id}
        workspace={workspace}
        cronJobId={extra.cronJobId}
        {...commonRefreshProps}
      />
    );
  }

  return (
    <div className='mobile-conversation__unsupported'>
      <div className='mobile-conversation__unsupported-title'>Use full view for this chat</div>
      <div className='mobile-conversation__unsupported-text'>
        This mobile shell currently supports ACP, Codex, remote, OpenClaw, and Nanobot chats.
      </div>
    </div>
  );
};

const MobileConversationPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeSheet, setActiveSheet] = useState<SheetName>(null);

  const {
    data: conversation,
    isLoading,
    mutate: mutateConversation,
  } = useSWR(id ? ['mobile-conversation', id] : null, () => ipcBridge.conversation.get.invoke({ id: id! }));

  const { data: conversations = [], mutate: mutateHistory } = useSWR('mobile-conversation-history', () =>
    ipcBridge.database.getUserConversations.invoke({ page: 0, pageSize: HISTORY_PAGE_SIZE })
  );

  useEffect(() => {
    return ipcBridge.conversation.listChanged.on((event) => {
      void mutateHistory();
      if (event.conversationId === id) {
        void mutateConversation();
      }
    });
  }, [id, mutateConversation, mutateHistory]);

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
    window.dispatchEvent(new CustomEvent(MESSAGE_LIST_REFRESH_EVENT, { detail: { conversationId: id } }));
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
              <strong>{extra.agentName || extra.backend || conversation?.type || '-'}</strong>
            </div>
            <div className='mobile-conversation__settings-row'>
              <span>Workspace</span>
              <strong>{extra.workspace || 'Temporary'}</strong>
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
