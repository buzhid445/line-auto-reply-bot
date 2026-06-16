import type { HandoffRecord, RiskLevel } from "./types.js";

export type HumanModeStatus = "auto" | "human";

export interface HumanState {
  mode: HumanModeStatus;
  caseId: string;
  userId: string;
  summary: string;
  humanUntil: number;
  assignedTo?: string;
}

export interface PendingHandoff {
  requestId: string;
  userId: string;
  summary: string;
  riskLevel: RiskLevel;
  requiredInfo: string[];
  createdAt: number;
  expiresAt: number;
}

const humanStates = new Map<string, HumanState>();
const cases = new Map<string, HumanState>();
const pendingRequests = new Map<string, PendingHandoff>();
export const humanModeDurationMs = 60 * 60 * 1000;
export const pendingHandoffDurationMs = 10 * 60 * 1000;

const humanRequestPattern = /真人|人工|技師|專員|客服|轉接|轉介|找人|真人回|人工客服|請人聯絡/i;

export function isHumanRequest(message: string): boolean {
  return humanRequestPattern.test(message);
}

export function createPendingHandoff(input: {
  userId: string;
  summary: string;
  riskLevel: RiskLevel;
  requiredInfo: string[];
  now?: number;
}): PendingHandoff {
  const now = input.now ?? Date.now();
  const request: PendingHandoff = {
    requestId: crypto.randomUUID(),
    userId: input.userId,
    summary: input.summary,
    riskLevel: input.riskLevel,
    requiredInfo: input.requiredInfo,
    createdAt: now,
    expiresAt: now + pendingHandoffDurationMs
  };
  pendingRequests.set(request.requestId, request);
  return request;
}

export function consumePendingHandoff(requestId: string, now = Date.now()): PendingHandoff | undefined {
  const request = pendingRequests.get(requestId);
  if (!request) return undefined;
  pendingRequests.delete(requestId);
  return request.expiresAt > now ? request : undefined;
}

export function activateHumanMode(input: {
  userId: string;
  summary: string;
  caseId?: string;
  now?: number;
}): HumanState {
  const now = input.now ?? Date.now();
  const state: HumanState = {
    mode: "human",
    caseId: input.caseId ?? crypto.randomUUID(),
    userId: input.userId,
    summary: input.summary,
    humanUntil: now + humanModeDurationMs
  };

  humanStates.set(input.userId, state);
  cases.set(state.caseId, state);
  return state;
}

export function activateHumanModeFromRecord(record: HandoffRecord, now = Date.now()): HumanState {
  return activateHumanMode({
    userId: record.userId,
    summary: record.summary,
    caseId: record.id,
    now
  });
}

export function getHumanState(userId: string, now = Date.now()): HumanState | undefined {
  const state = humanStates.get(userId);
  if (!state) return undefined;

  if (state.humanUntil <= now) {
    humanStates.delete(userId);
    cases.delete(state.caseId);
    return undefined;
  }

  return state;
}

export function claimCase(caseId: string, technicianId?: string, now = Date.now()): HumanState | undefined {
  const state = getCase(caseId, now);
  if (!state) return undefined;
  state.assignedTo = technicianId;
  return state;
}

export function extendCase(caseId: string, minutes: number, now = Date.now()): HumanState | undefined {
  const state = getCase(caseId, now);
  if (!state) return undefined;
  state.humanUntil = Math.max(state.humanUntil, now) + minutes * 60 * 1000;
  humanStates.set(state.userId, state);
  cases.set(caseId, state);
  return state;
}

export function closeCase(caseId: string): HumanState | undefined {
  const state = cases.get(caseId);
  if (!state) return undefined;
  humanStates.delete(state.userId);
  cases.delete(caseId);
  return state;
}

export function getCase(caseId: string, now = Date.now()): HumanState | undefined {
  const state = cases.get(caseId);
  if (!state) return undefined;
  return getHumanState(state.userId, now);
}

export function createHandoffSummary(input: {
  caseId: string;
  userId: string;
  summary: string;
  riskLevel: RiskLevel;
  requiredInfo: string[];
  humanUntil: number;
}): string {
  return [
    "新的技師轉接案件",
    `案件編號：${input.caseId}`,
    `客戶ID：${input.userId}`,
    `風險：${input.riskLevel}`,
    `人工模式到：${new Date(input.humanUntil).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`,
    `問題：${input.summary}`,
    `需補資料：${input.requiredInfo.join("、") || "無"}`
  ].join("\n");
}
