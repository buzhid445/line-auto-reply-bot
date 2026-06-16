import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { HandoffInput, HandoffRecord } from "./types.js";

const defaultPath = resolve("work", "handoffs.jsonl");

export class HandoffStore {
  constructor(private readonly filePath = defaultPath) {}

  async create(input: HandoffInput): Promise<HandoffRecord> {
    const record: HandoffRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "open"
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }
}
