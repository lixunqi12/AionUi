import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { settleStaleToolCallMessage, settleStaleToolCallMessages } from '@/common/chat/settleStaleToolCalls';

describe('settleStaleToolCalls', () => {
  it('marks running ACP tool calls as failed for display recovery', () => {
    const message: TMessage = {
      id: 'call-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      position: 'left',
      status: 'work',
      content: {
        session_id: 'session-1',
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'call-1',
          status: 'in_progress',
          title: 'Read FSDB',
          kind: 'execute',
          rawInput: { command: 'python probe.py' },
        },
      },
    };

    const settled = settleStaleToolCallMessage(message);

    expect(settled).not.toBe(message);
    expect(settled.status).toBe('error');
    expect(settled.type).toBe('acp_tool_call');
    if (settled.type === 'acp_tool_call') {
      expect(settled.content.update.status).toBe('failed');
      expect(settled.content.update.content?.[0]?.type).toBe('content');
    }
  });

  it('leaves completed ACP tool calls unchanged', () => {
    const message: TMessage = {
      id: 'call-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      position: 'left',
      status: 'finish',
      content: {
        session_id: 'session-1',
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'call-1',
          status: 'completed',
          title: 'Read FSDB',
          kind: 'execute',
        },
      },
    };

    expect(settleStaleToolCallMessage(message)).toBe(message);
  });

  it('marks running tool groups as canceled', () => {
    const message: TMessage = {
      id: 'tool-group-1',
      conversation_id: 'conv-1',
      type: 'tool_group',
      position: 'left',
      status: 'work',
      content: [
        {
          call_id: 'call-1',
          description: 'PowerShell command',
          name: 'Shell',
          render_output_as_markdown: false,
          status: 'Executing',
        },
      ],
    };

    const settled = settleStaleToolCallMessage(message);

    expect(settled.type).toBe('tool_group');
    if (settled.type === 'tool_group') {
      expect(settled.content[0].status).toBe('Canceled');
    }
  });

  it('returns the original list when nothing changes', () => {
    const messages: TMessage[] = [
      {
        id: 'text-1',
        conversation_id: 'conv-1',
        type: 'text',
        position: 'left',
        status: 'finish',
        content: { content: 'done' },
      },
    ];

    expect(settleStaleToolCallMessages(messages)).toBe(messages);
  });
});
