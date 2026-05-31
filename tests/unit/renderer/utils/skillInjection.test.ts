import { describe, expect, it } from 'vitest';
import { selectRelevantSkillsForMessage } from '@/renderer/pages/conversation/utils/skillInjection';

describe('selectRelevantSkillsForMessage', () => {
  const candidates = [
    { name: 'pdf', description: 'Read and manipulate PDF files' },
    { name: 'shared-skill-deploy', description: 'Install one shared skill across Codex, Claude Code, and AionUi' },
    { name: 'rtl-review', description: 'Review Verilog and SystemVerilog RTL code' },
  ];

  it('prioritizes explicit slash skill requests', () => {
    expect(selectRelevantSkillsForMessage('Please use /rtl-review on this FSM.', candidates)[0]).toBe('rtl-review');
  });

  it('selects file-type skills from task hints', () => {
    expect(selectRelevantSkillsForMessage('Summarize this paper.pdf', candidates)).toContain('pdf');
  });

  it('matches Chinese local skill hints without relying on non-ascii source text', () => {
    expect(
      selectRelevantSkillsForMessage(
        '\u8fd9\u4e2a\u672c\u5730\u6280\u80fd\u5e2e\u6211\u90e8\u7f72\u4e00\u4e0b',
        candidates
      )
    ).toContain('shared-skill-deploy');
  });
});
