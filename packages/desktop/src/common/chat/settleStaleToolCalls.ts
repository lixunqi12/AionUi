import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup, TMessage } from './chatLib';

const STALE_TOOL_MESSAGE = 'Tool call stopped before reporting a final result.';

const isRunningAcpToolCall = (message: IMessageAcpToolCall): boolean => {
  const status = message.content?.update?.status;
  return status === 'pending' || status === 'in_progress';
};

const isRunningToolCall = (message: IMessageToolCall): boolean => {
  const status = message.content?.status;
  return status === undefined || status === 'running';
};

const isRunningToolGroupItem = (status: IMessageToolGroup['content'][number]['status']): boolean =>
  status === 'Executing' || status === 'Confirming' || status === 'Pending';

export function settleStaleToolCallMessage(message: TMessage): TMessage {
  if (message.type === 'acp_tool_call' && isRunningAcpToolCall(message)) {
    return {
      ...message,
      status: 'error',
      content: {
        ...message.content,
        update: {
          ...message.content.update,
          status: 'failed',
          content: message.content.update.content ?? [
            {
              type: 'content',
              content: {
                type: 'text',
                text: STALE_TOOL_MESSAGE,
              },
            },
          ],
        },
      },
    };
  }

  if (message.type === 'tool_call' && isRunningToolCall(message)) {
    return {
      ...message,
      status: 'error',
      content: {
        ...message.content,
        status: 'error',
        error: message.content.error ?? STALE_TOOL_MESSAGE,
      },
    };
  }

  if (
    message.type === 'tool_group' &&
    Array.isArray(message.content) &&
    message.content.some((item) => isRunningToolGroupItem(item.status))
  ) {
    return {
      ...message,
      status: 'error',
      content: message.content.map((item) =>
        isRunningToolGroupItem(item.status)
          ? {
              ...item,
              status: 'Canceled',
              result_display: item.result_display ?? STALE_TOOL_MESSAGE,
            }
          : item
      ),
    };
  }

  if (message.status === 'work') {
    return {
      ...message,
      status: 'finish',
    };
  }

  return message;
}

export function settleStaleToolCallMessages(messages: TMessage[]): TMessage[] {
  let changed = false;
  const settled = messages.map((message) => {
    const next = settleStaleToolCallMessage(message);
    if (next !== message) {
      changed = true;
    }
    return next;
  });
  return changed ? settled : messages;
}
