import { ipcBridge } from '@/common';
import type { ICronAgentConfig, ICronJob, ICronSchedule } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { useCronJobs } from '@/renderer/pages/cron';
import { formatNextRun } from '@/renderer/pages/cron/cronUtils';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Input, Message, Popover, Tooltip } from '@arco-design/web-react';
import { AlarmClock } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const HEARTBEAT_DESCRIPTION_PREFIX = '[aionui-heartbeat]';

const isHeartbeatJob = (job: ICronJob): boolean => job.description?.startsWith(HEARTBEAT_DESCRIPTION_PREFIX) ?? false;

function atSchedule(atMs: number, description: string): ICronSchedule {
  return {
    kind: 'at',
    at_ms: atMs,
    description,
  } as unknown as ICronSchedule;
}

function resolveAgentType(conversation: TChatConversation): string {
  if (conversation.type === 'aionrs') return 'aionrs';
  if (conversation.type === 'acp') return (conversation.extra?.backend as string | undefined) || 'claude';
  if (conversation.type === 'codex') return 'codex';
  return conversation.type;
}

function resolveAgentConfig(conversation: TChatConversation): ICronAgentConfig | undefined {
  const backend = resolveAgentType(conversation);
  if (!backend) return undefined;
  const extra = conversation.extra as Record<string, unknown>;
  return {
    backend,
    name: (extra.agent_name as string | undefined) || backend,
    mode: extra.session_mode as string | undefined,
    model_id: (extra.current_model_id as string | undefined) || (extra.codex_model as string | undefined),
    workspace: extra.workspace as string | undefined,
  };
}

const defaultPrompt =
  'Continue this thread from the existing context. Check what is unfinished, summarize the current state briefly, then proceed with the next useful step.';

const ThreadHeartbeatButton: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const { t } = useTranslation();
  const { jobs, refetch } = useCronJobs(conversation.id);
  const [visible, setVisible] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [submitting, setSubmitting] = useState(false);

  const activeHeartbeat = useMemo(
    () =>
      jobs
        .filter((job) => isHeartbeatJob(job) && job.enabled)
        .sort((a, b) => (a.state.next_run_at_ms ?? 0) - (b.state.next_run_at_ms ?? 0))[0],
    [jobs]
  );

  const createHeartbeat = useCallback(
    async (delayMs: number, label: string) => {
      const dueAt = Date.now() + delayMs;
      const description = `${HEARTBEAT_DESCRIPTION_PREFIX} ${label}`;
      setSubmitting(true);
      try {
        await ipcBridge.cron.addJob.invoke({
          name: t('conversation.heartbeat.jobName', {
            defaultValue: 'Continue thread',
          }),
          description,
          schedule: atSchedule(dueAt, label),
          prompt: prompt.trim() || defaultPrompt,
          conversation_id: conversation.id,
          conversation_title: conversation.name,
          agent_type: resolveAgentType(conversation),
          created_by: 'user',
          execution_mode: 'existing',
          agent_config: resolveAgentConfig(conversation),
        });
        await refetch();
        setVisible(false);
        Message.success(t('conversation.heartbeat.created', { defaultValue: 'Continuation scheduled' }));
      } catch (error) {
        console.error('[ThreadHeartbeatButton] Failed to create heartbeat:', error);
        Message.error(String(error));
      } finally {
        setSubmitting(false);
      }
    },
    [conversation, prompt, refetch, t]
  );

  const cancelHeartbeat = useCallback(async () => {
    if (!activeHeartbeat) return;
    setSubmitting(true);
    try {
      await ipcBridge.cron.removeJob.invoke({ job_id: activeHeartbeat.id });
      await refetch();
      Message.success(t('conversation.heartbeat.cancelled', { defaultValue: 'Continuation cancelled' }));
    } catch (error) {
      console.error('[ThreadHeartbeatButton] Failed to cancel heartbeat:', error);
      Message.error(String(error));
    } finally {
      setSubmitting(false);
    }
  }, [activeHeartbeat, refetch, t]);

  const statusText = activeHeartbeat?.state.next_run_at_ms
    ? t('conversation.heartbeat.nextRun', {
        defaultValue: 'Next continuation {{time}}',
        time: formatNextRun(activeHeartbeat.state.next_run_at_ms),
      })
    : t('conversation.heartbeat.tooltip', { defaultValue: 'Continue later' });

  const content = (
    <div className='w-280px max-w-[calc(100vw-32px)] flex flex-col gap-10px p-4px'>
      <div className='text-13px font-500 text-t-primary'>
        {t('conversation.heartbeat.title', { defaultValue: 'Continue later' })}
      </div>
      {activeHeartbeat?.state.next_run_at_ms && (
        <div className='text-12px leading-18px text-t-secondary'>
          {t('conversation.heartbeat.active', {
            defaultValue: 'Scheduled for {{time}}',
            time: formatNextRun(activeHeartbeat.state.next_run_at_ms),
          })}
        </div>
      )}
      <Input.TextArea
        value={prompt}
        onChange={setPrompt}
        autoSize={{ minRows: 3, maxRows: 5 }}
        placeholder={t('conversation.heartbeat.promptPlaceholder', { defaultValue: 'Prompt for the continuation' })}
      />
      <div className='grid grid-cols-3 gap-8px'>
        <Button size='mini' loading={submitting} onClick={() => createHeartbeat(30 * 60 * 1000, '30 minutes')}>
          30m
        </Button>
        <Button size='mini' loading={submitting} onClick={() => createHeartbeat(2 * 60 * 60 * 1000, '2 hours')}>
          2h
        </Button>
        <Button size='mini' loading={submitting} onClick={() => createHeartbeat(24 * 60 * 60 * 1000, 'Tomorrow')}>
          {t('common.tomorrow', { defaultValue: 'Tomorrow' })}
        </Button>
      </div>
      {activeHeartbeat && (
        <Button size='mini' status='danger' loading={submitting} onClick={cancelHeartbeat}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
      )}
    </div>
  );

  return (
    <Popover
      trigger='click'
      position='bottom'
      content={content}
      popupVisible={visible}
      onVisibleChange={setVisible}
    >
      <Tooltip content={statusText}>
        <Button type='text' size='small' className='!h-auto !w-auto !min-w-0 !px-0 !py-0'>
          <span className='inline-flex items-center gap-2px rounded-full px-8px py-2px bg-2'>
            <AlarmClock theme='outline' size={16} fill={activeHeartbeat ? iconColors.primary : iconColors.disabled} />
            <span
              className={`ml-4px h-8px w-8px rounded-full ${activeHeartbeat ? 'bg-[#00b42a]' : 'bg-[#86909c]'}`}
            />
          </span>
        </Button>
      </Tooltip>
    </Popover>
  );
};

export default ThreadHeartbeatButton;
