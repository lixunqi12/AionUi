import type { AcpPermissionOption, AcpPermissionRequest } from '@/common/types/platform/acpTypes';

type AcpPermissionOptionWire = AcpPermissionOption & {
  optionId?: string;
};

type AcpToolCallWire = AcpPermissionRequest['tool_call'] & {
  toolCallId?: string;
  rawInput?: AcpPermissionRequest['tool_call']['raw_input'];
};

type AcpPermissionRequestWire = Partial<AcpPermissionRequest> & {
  sessionId?: string;
  toolCall?: AcpToolCallWire;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function normalizeAcpPermissionRequest(raw: unknown): AcpPermissionRequest | null {
  const record = asRecord(raw);
  if (!record) return null;

  const request = record as AcpPermissionRequestWire;
  const rawToolCall = (request.tool_call ?? request.toolCall) as AcpToolCallWire | undefined;
  const toolCallRecord = asRecord(rawToolCall);
  if (!toolCallRecord) return null;

  const rawInput = (rawToolCall?.raw_input ?? rawToolCall?.rawInput) as
    | AcpPermissionRequest['tool_call']['raw_input']
    | undefined;
  const rawInputRecord = asRecord(rawInput);
  const toolCallId =
    asString(rawToolCall?.tool_call_id) ??
    asString(rawToolCall?.toolCallId) ??
    asString(rawInputRecord?.call_id) ??
    asString(rawInputRecord?.callId);

  const options = Array.isArray(request.options)
    ? request.options.map((option) => {
        const optionWire = option as AcpPermissionOptionWire;
        return {
          ...optionWire,
          option_id: optionWire.option_id ?? optionWire.optionId ?? '',
        };
      })
    : [];

  return {
    ...request,
    session_id: request.session_id ?? request.sessionId ?? '',
    options,
    tool_call: {
      ...rawToolCall,
      tool_call_id: toolCallId ?? '',
      raw_input: rawInputRecord ? { ...rawInputRecord } : rawToolCall?.raw_input,
    },
  } as AcpPermissionRequest;
}

export function getAcpPermissionAllowOption(
  options: Array<AcpPermissionOption | AcpPermissionOptionWire>
): AcpPermissionOption | undefined {
  const normalized = options.map((option) => ({
    ...option,
    option_id: option.option_id ?? (option as AcpPermissionOptionWire).optionId ?? '',
  }));

  return (
    normalized.find((option) => option.kind === 'allow_once') ??
    normalized.find((option) => option.kind === 'allow_always') ??
    normalized.find((option) => option.option_id === 'approved') ??
    normalized.find((option) => option.option_id.startsWith('approved')) ??
    normalized[0]
  );
}

export function getAcpPermissionCallId(request: AcpPermissionRequest): string | undefined {
  return request.tool_call.tool_call_id || asString(request.tool_call.raw_input?.call_id);
}
