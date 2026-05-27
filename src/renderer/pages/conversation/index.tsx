import { ipcBridge } from '@/common';
import { Spin } from '@arco-design/web-react';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import ChatConversation from './components/ChatConversation';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useConversationTabs } from './hooks/ConversationTabsContext';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import { isElectronDesktop } from '@/renderer/utils/platform';

const shouldUseMobileWebConversation = (): boolean => {
  if (typeof window === 'undefined' || isElectronDesktop()) return false;
  if (window.location.search.includes('desktop=1') || window.location.hash.includes('desktop=1')) return false;
  return window.innerWidth < 768 || window.matchMedia('(hover: none) and (pointer: coarse)').matches;
};

const ChatConversationIndex: React.FC = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { closePreview } = usePreviewContext();
  const { openTab } = useConversationTabs();
  const { syncTitleFromHistory } = useAutoTitle();
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const defaultConversationTitle = t('conversation.welcome.newConversation');

  useEffect(() => {
    if (!id || !shouldUseMobileWebConversation()) return;
    void navigate(`/mobile/conversation/${id}`, { replace: true });
  }, [id, location.search, navigate]);

  useEffect(() => {
    if (!id) return;

    // 切换会话时自动关闭预览面板，避免跨会话残留
    // Close preview on every conversation change, including initial mount
    // (component may remount via React Router, resetting the ref to undefined)
    if (previousConversationIdRef.current !== id) {
      closePreview();
    }

    previousConversationIdRef.current = id;
  }, [id, closePreview]);

  const { data, isLoading, mutate } = useSWR(`conversation/${id}`, () => {
    return ipcBridge.conversation.get.invoke({ id });
  });

  useEffect(() => {
    if (!id) return;

    return ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversationId !== id || event.action !== 'updated') {
        return;
      }

      void mutate();
    });
  }, [id, mutate]);

  useEffect(() => {
    if (!data || data.name !== defaultConversationTitle) {
      return;
    }

    void syncTitleFromHistory(data.id);
  }, [data, defaultConversationTitle, syncTitleFromHistory]);

  // 当会话数据加载完成后，自动打开 tab
  // Automatically open tab when conversation data is loaded
  useEffect(() => {
    if (data) {
      openTab(data);
    }
  }, [data, openTab]);

  if (isLoading) return <Spin loading></Spin>;
  return <ChatConversation conversation={data}></ChatConversation>;
};

export default ChatConversationIndex;
