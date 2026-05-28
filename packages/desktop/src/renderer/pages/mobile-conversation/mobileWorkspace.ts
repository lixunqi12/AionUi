const LEGACY_MOBILE_DEFAULT_WORKSPACE = 'F:\\AI_tool\\AionUi-mobile-workspace';

const pickString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeWorkspacePath = (workspace?: string | null): string => {
  return (workspace || '').replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
};

export const isLegacyMobileWorkspace = (workspace?: string | null): boolean => {
  return normalizeWorkspacePath(workspace) === normalizeWorkspacePath(LEGACY_MOBILE_DEFAULT_WORKSPACE);
};

export const isGeneratedTemporaryWorkspace = (workspace?: string | null): boolean => {
  const normalized = normalizeWorkspacePath(workspace);
  return /\\conversations\\[^\\]+-temp-[^\\]+$/.test(normalized);
};

export const resolveMobileWorkspace = (preferredWorkspace?: string, systemWorkDir?: string): string => {
  const preferred = pickString(preferredWorkspace);
  if (preferred && !isLegacyMobileWorkspace(preferred)) return preferred;
  return pickString(systemWorkDir, preferred);
};
