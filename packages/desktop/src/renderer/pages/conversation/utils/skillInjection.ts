export type SkillInjectionCandidate = {
  name: string;
  description?: string;
};

const MAX_AUTO_INJECT_SKILLS = 3;

const EXTENSION_HINTS: Array<{ pattern: RegExp; names: string[] }> = [
  { pattern: /\b(pdf|\.pdf)\b/i, names: ['pdf'] },
  { pattern: /\b(docx?|word|\.docx?)\b/i, names: ['documents', 'officecli'] },
  { pattern: /\b(xlsx?|spreadsheet|csv|\.xlsx?|\.csv)\b/i, names: ['spreadsheets', 'officecli'] },
  { pattern: /\b(pptx?|slides?|presentation|\.pptx?)\b/i, names: ['presentations', 'officecli'] },
  { pattern: /\b(verilog|systemverilog|rtl|cdc|reset|fsm|\.sv|\.v)\b/i, names: ['rtl-debug-playbook', 'rtl-review'] },
  { pattern: /\b(fsdb|waveform|signal|pynpi)\b/i, names: ['fsdb-pynpi'] },
  { pattern: /\b(github|pull request|\bpr\b|issue|ci|actions)\b/i, names: ['github', 'gh-fix-ci', 'gh-address-comments'] },
  {
    pattern: /\b(aionui|codex|claude code|skill|mcp|local agent)\b|\u672c\u5730|\u6280\u80fd/i,
    names: ['local-ai-tool-bootstrap', 'shared-skill-deploy'],
  },
  { pattern: /\b(job|resume|application|workday|linkedin)\b/i, names: ['job-application-workflow'] },
];

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
}

function nameTokens(name: string): string[] {
  return normalizeToken(name)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function scoreCandidate(message: string, candidate: SkillInjectionCandidate): number {
  const name = candidate.name.trim();
  if (!name) return 0;

  const lowerMessage = message.toLowerCase();
  const lowerName = name.toLowerCase();
  let score = 0;

  if (lowerMessage.includes(`/${lowerName}`)) score += 100;
  if (lowerMessage.includes(lowerName)) score += 40;

  for (const token of nameTokens(name)) {
    if (lowerMessage.includes(token)) score += 8;
  }

  const description = candidate.description ? normalizeToken(candidate.description) : '';
  for (const token of normalizeToken(message).split(/\s+/)) {
    if (token.length >= 4 && description.includes(token)) score += 2;
  }

  for (const hint of EXTENSION_HINTS) {
    if (!hint.pattern.test(message)) continue;
    if (hint.names.some((hintName) => lowerName === hintName || lowerName.includes(hintName))) {
      score += 30;
    }
  }

  return score;
}

export function selectRelevantSkillsForMessage(
  message: string,
  candidates: SkillInjectionCandidate[],
  maxCount = MAX_AUTO_INJECT_SKILLS
): string[] {
  const trimmed = message.trim();
  if (!trimmed || candidates.length === 0 || maxCount <= 0) return [];

  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate) => {
    const name = candidate.name.trim();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  return uniqueCandidates
    .map((candidate) => ({
      name: candidate.name,
      score: scoreCandidate(trimmed, candidate),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, maxCount)
    .map((item) => item.name);
}
