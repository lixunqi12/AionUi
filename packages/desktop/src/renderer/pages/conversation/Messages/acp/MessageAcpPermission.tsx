/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import {
  getAcpPermissionAllowOption,
  getAcpPermissionCallId,
  normalizeAcpPermissionRequest,
} from '@/common/chat/acpPermission';
import { conversation } from '@/common/adapter/ipcBridge';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import { Button, Card, Radio, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface MessageAcpPermissionProps {
  message: IMessageAcpPermission;
}

const MessageAcpPermission: React.FC<MessageAcpPermissionProps> = React.memo(({ message }) => {
  const permissionRequest = useMemo(() => normalizeAcpPermissionRequest(message.content), [message.content]);
  const { options = [], tool_call } = permissionRequest || {};
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();

  // 基于实际数据生成显示信息
  const getToolInfo = () => {
    if (!tool_call) {
      return {
        title: t('messages.permissionRequest'),
        description: t('messages.agentRequestingPermission'),
        icon: '🔐',
      };
    }

    const displayTitle = tool_call.title || tool_call.raw_input?.description || t('messages.permissionRequest');

    // 简单的图标映射
    const kindIcons: Record<string, string> = {
      edit: '✏️',
      read: '📖',
      fetch: '🌐',
      execute: '⚡',
    };

    return {
      title: displayTitle,
      icon: kindIcons[tool_call.kind || 'execute'] || '⚡',
    };
  };
  const { title, icon } = getToolInfo();
  const [selected, setSelected] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);
  const allowOnceOption = useMemo(() => getAcpPermissionAllowOption(options), [options]);
  const callId = useMemo(
    () => (permissionRequest ? getAcpPermissionCallId(permissionRequest) : undefined),
    [permissionRequest]
  );
  const shouldAutoApprove =
    Boolean(teamPermission?.isFullAccessMode) && teamPermission?.allConversationIds.includes(message.conversation_id);
  const canAutoApprove = shouldAutoApprove && Boolean(allowOnceOption?.option_id && callId);

  const confirmWithOption = useCallback(
    async (confirm_key: string) => {
      if (hasResponded || isResponding || !confirm_key) return;

      setIsResponding(true);
      try {
        const invokeData = {
          confirm_key,
          msg_id: message.msg_id || message.id,
          conversation_id: message.conversation_id,
          call_id: callId || message.id,
        };

        await conversation.confirmMessage.invoke(invokeData);
        setHasResponded(true);
      } catch (error) {
        // Handle error case - could add error logging here
        console.error('Error confirming permission:', error);
      } finally {
        setIsResponding(false);
      }
    },
    [callId, hasResponded, isResponding, message.conversation_id, message.id, message.msg_id]
  );

  useEffect(() => {
    if (!canAutoApprove || !allowOnceOption?.option_id || hasResponded || isResponding) return;
    void confirmWithOption(allowOnceOption.option_id);
  }, [allowOnceOption?.option_id, canAutoApprove, confirmWithOption, hasResponded, isResponding]);

  const handleConfirm = async () => {
    if (!selected) return;
    await confirmWithOption(selected);
  };

  if (!tool_call) {
    return null;
  }

  if (canAutoApprove) {
    return null;
  }

  return (
    <Card
      className='mb-4'
      bordered={false}
      style={{ background: 'var(--bg-1)' }}
      data-testid='message-acp-permission-card'
    >
      <div className='space-y-4'>
        {/* Header with icon and title */}
        <div className='flex items-center space-x-2'>
          <span className='text-2xl'>{icon}</span>
          <Text className='block'>{title}</Text>
        </div>
        {(tool_call.raw_input?.command || tool_call.title) && (
          <div>
            <Text className='text-xs text-t-secondary mb-1'>{t('messages.command')}</Text>
            <code className='text-xs bg-1 p-2 rounded block text-t-primary break-all'>
              {tool_call.raw_input?.command || tool_call.title}
            </code>
          </div>
        )}
        {!hasResponded && (
          <>
            <div className='mt-10px'>{t('messages.chooseAction')}</div>
            <Radio.Group direction='vertical' size='mini' value={selected} onChange={setSelected}>
              {options && options.length > 0 ? (
                options.map((option, index) => {
                  const optionName = option?.name || `${t('messages.option')} ${index + 1}`;
                  const option_id = option?.option_id || `option_${index}`;
                  return (
                    <div key={option_id} data-testid={`message-acp-permission-option-${option_id}`}>
                      <Radio value={option_id}>{optionName}</Radio>
                    </div>
                  );
                })
              ) : (
                <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
              )}
            </Radio.Group>
            <div className='flex justify-start pl-20px'>
              <Button
                type='primary'
                size='mini'
                disabled={!selected || isResponding}
                onClick={handleConfirm}
                data-testid='message-acp-permission-confirm'
              >
                {isResponding ? t('messages.processing') : t('messages.confirm')}
              </Button>
            </div>
          </>
        )}

        {hasResponded && (
          <div
            className='mt-10px p-2 rounded-md border'
            style={{ backgroundColor: 'var(--color-success-light-1)', borderColor: 'rgb(var(--success-3))' }}
          >
            <Text className='text-sm' style={{ color: 'rgb(var(--success-6))' }}>
              ✓ {t('messages.responseSentSuccessfully')}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageAcpPermission;
