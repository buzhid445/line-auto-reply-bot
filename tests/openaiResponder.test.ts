import { describe, expect, it, vi } from "vitest";
import { OpenAIResponder } from "../src/openaiResponder.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  LINE_CHANNEL_SECRET: "test-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "test-token",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.4-mini",
  TECH_ESCALATION_TARGET: ""
};

describe("OpenAIResponder", () => {
  it("sends the latest DTC question to OpenAI instead of answering from a local DTC database", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ output_text: "P0122 是節氣門/油門踏板位置感知器低電壓相關故障。" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const responder = new OpenAIResponder(config);

    const reply = await responder.generateReply({
      userId: "user-1",
      currentMessage: "P0122",
      message: "目前最新問題：P0122\n\n歷史對話：\n客戶：P0335 是什麼故障碼？",
      classification: {
        category: "simple_technical",
        riskLevel: "medium",
        reason: "fault code",
        requiredInfo: ["車廠/車型/年份"]
      }
    });

    expect(reply).toContain("P0122");
    expect(reply).not.toContain("P0335");
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock.mockRestore();
  });
});
