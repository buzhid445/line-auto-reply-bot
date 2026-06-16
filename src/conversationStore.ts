interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

const conversations = new Map<string, ConversationTurn[]>();
const maxTurns = 6;
const maxAgeMs = 30 * 60 * 1000;

export function addConversationTurn(userId: string, role: ConversationTurn["role"], text: string): void {
  const now = Date.now();
  const existing = getFreshTurns(userId, now);
  conversations.set(userId, [...existing, { role, text, createdAt: now }].slice(-maxTurns));
}

export function getConversationContext(userId: string): string {
  const turns = getFreshTurns(userId, Date.now());
  conversations.set(userId, turns);

  return turns.map((turn) => `${turn.role === "user" ? "客戶" : "助理"}：${turn.text}`).join("\n");
}

export function getUserConversationContext(userId: string): string {
  const turns = getFreshTurns(userId, Date.now()).filter((turn) => turn.role === "user");
  return turns.map((turn) => `客戶：${turn.text}`).join("\n");
}

function getFreshTurns(userId: string, now: number): ConversationTurn[] {
  return (conversations.get(userId) ?? []).filter((turn) => now - turn.createdAt <= maxAgeMs);
}
