import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { ChatResponder, ImageResponder } from "../src/types.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,
  LINE_CHANNEL_SECRET: "test-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "test-token",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.4-mini",
  TECH_ESCALATION_TARGET: "Ctech-group"
};

function lineSignature(body: string): string {
  return createHmac("sha256", config.LINE_CHANNEL_SECRET).update(body).digest("base64");
}

describe("LINE webhook", () => {
  it("rejects invalid signature", async () => {
    const app = createApp({ config, responder: fakeResponder("ok") });
    await request(app).post("/webhook/line").set("x-line-signature", "bad").send({ events: [] }).expect(401);
  });

  it("replies to text message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const app = createApp({ config, responder: fakeResponder("這是測試回覆") });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "reply-token",
          source: { userId: "user-1" },
          message: { type: "text", text: "P0171 是什麼？" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    const replyPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(replyPayload.messages).toEqual([{ type: "text", text: "這是測試回覆" }]);

    fetchMock.mockRestore();
  });

  it("downloads image messages and replies with text from image analysis", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const responder = fakeResponder("不應該被呼叫");
    const imageResponder = fakeImageResponder("我從圖片中疑似辨識到 P0335。");
    const app = createApp({ config, responder, imageResponder });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "image-reply-token",
          source: { userId: "user-1" },
          message: { type: "image", id: "image-id" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    expect(responder.generateReply).not.toHaveBeenCalled();
    expect(imageResponder.generateImageReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        imageBase64: "AQID",
        mimeType: "image/jpeg"
      })
    );
    const replyPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(replyPayload.messages[0].type).toBe("text");
    expect(replyPayload.messages[0].text).toContain("P0335");

    fetchMock.mockRestore();
  });

  it("activates human mode and pushes technician buttons when customer directly requests a human", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const responder = fakeResponder("不應該呼叫 GPT");
    const app = createApp({ config, responder });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "human-reply-token",
          source: { type: "user", userId: "human-user-1" },
          message: { type: "text", text: "我要問真人技師" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    expect(responder.generateReply).not.toHaveBeenCalled();
    const pushPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(pushPayload.to).toBe("Ctech-group");
    expect(pushPayload.messages[1].type).toBe("template");
    expect(pushPayload.messages[1].template.actions.map((action: { label: string }) => action.label)).toEqual([
      "我來處理",
      "延長1小時",
      "結束人工"
    ]);

    const replyPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(replyPayload.messages[0].text).toContain("已轉交技師");

    fetchMock.mockRestore();
  });

  it("silences later customer messages while the same user is in human mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const responder = fakeResponder("不應該呼叫 GPT");
    const app = createApp({ config, responder });
    const firstBody = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "first-human-token",
          source: { type: "user", userId: "human-user-2" },
          message: { type: "text", text: "轉人工客服" }
        }
      ]
    });
    const secondBody = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "second-human-token",
          source: { type: "user", userId: "human-user-2" },
          message: { type: "text", text: "技師您好，補充一下車型" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(firstBody))
      .send(firstBody)
      .expect(200);
    fetchMock.mockClear();

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(secondBody))
      .send(secondBody)
      .expect(200);

    expect(responder.generateReply).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("asks the customer to confirm handoff for high-risk GPT replies without notifying technicians yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const app = createApp({ config, responder: fakeResponder("煞車問題可能涉及安全，請先避免繼續行駛。") });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "high-risk-token",
          source: { type: "user", userId: "high-risk-user-1" },
          message: { type: "text", text: "煞車踩下去會沉" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const replyPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(replyPayload.messages[0].text).toContain("煞車問題可能涉及安全");
    expect(replyPayload.messages[1].type).toBe("template");
    expect(replyPayload.messages[1].template.actions.map((action: { label: string }) => action.label)).toEqual([
      "轉接真人",
      "暫不轉接"
    ]);

    fetchMock.mockRestore();
  });

  it("notifies technicians only after the customer confirms high-risk handoff", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const app = createApp({ config, responder: fakeResponder("煞車問題可能涉及安全，請先避免繼續行駛。") });
    const highRiskBody = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "confirm-source-token",
          source: { type: "user", userId: "high-risk-user-2" },
          message: { type: "text", text: "煞車踩下去會沉" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(highRiskBody))
      .send(highRiskBody)
      .expect(200);

    const replyPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const confirmData = replyPayload.messages[1].template.actions[0].data;
    fetchMock.mockClear();

    const confirmBody = JSON.stringify({
      events: [
        {
          type: "postback",
          replyToken: "confirm-token",
          source: { type: "user", userId: "high-risk-user-2" },
          postback: { data: confirmData }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(confirmBody))
      .send(confirmBody)
      .expect(200);

    const pushPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(pushPayload.to).toBe("Ctech-group");
    expect(pushPayload.messages[1].template.actions.map((action: { label: string }) => action.label)).toEqual([
      "我來處理",
      "延長1小時",
      "結束人工"
    ]);

    const confirmReplyPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(confirmReplyPayload.messages[0].text).toContain("已轉交技師");

    fetchMock.mockRestore();
  });

  it("asks whether to hand off when customer asks about repair service", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const responder = fakeResponder("不應該呼叫 GPT");
    const app = createApp({ config, responder });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "service-token",
          source: { type: "user", userId: "service-user-1" },
          message: { type: "text", text: "你們有在修冷氣嗎？" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    expect(responder.generateReply).not.toHaveBeenCalled();
    const replyPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(replyPayload.messages[0].text).toContain("真人技師");
    expect(replyPayload.messages[1].type).toBe("template");
    expect(replyPayload.messages[1].template.actions.map((action: { label: string }) => action.label)).toEqual([
      "轉接真人",
      "暫不轉接"
    ]);

    fetchMock.mockRestore();
  });

  it("asks whether to hand off when customer asks for a wiring diagram", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const responder = fakeResponder("不應該呼叫 GPT");
    const app = createApp({ config, responder });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "wiring-token",
          source: { type: "user", userId: "wiring-user-1" },
          message: { type: "text", text: "有沒有賓士 S450 的引擎線路圖？" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    expect(responder.generateReply).not.toHaveBeenCalled();
    const replyPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(replyPayload.messages[0].text).toContain("真人技師");
    expect(replyPayload.messages[1].type).toBe("template");

    fetchMock.mockRestore();
  });

  it("does not call GPT for unrelated questions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const responder = fakeResponder("不應該呼叫 GPT");
    const app = createApp({ config, responder });
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "off-topic-token",
          source: { type: "user", userId: "off-topic-user-1" },
          message: { type: "text", text: "今天台積電股價多少？" }
        }
      ]
    });

    await request(app)
      .post("/webhook/line")
      .set("content-type", "application/json")
      .set("x-line-signature", lineSignature(body))
      .send(body)
      .expect(200);

    expect(responder.generateReply).not.toHaveBeenCalled();
    const replyPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(replyPayload.messages[0].text).toContain("汽車故障碼");

    fetchMock.mockRestore();
  });
});

function fakeResponder(reply: string): ChatResponder & { generateReply: ReturnType<typeof vi.fn> } {
  return {
    generateReply: vi.fn(async () => reply)
  };
}

function fakeImageResponder(reply: string): ImageResponder & { generateImageReply: ReturnType<typeof vi.fn> } {
  return {
    generateImageReply: vi.fn(async () => reply)
  };
}
