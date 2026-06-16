import express from "express";
import type { AppConfig } from "./config.js";
import { classifyQuestion } from "./classifier.js";
import { addConversationTurn, getConversationContext, getUserConversationContext } from "./conversationStore.js";
import { HandoffStore } from "./handoffStore.js";
import {
  activateHumanModeFromRecord,
  claimCase,
  closeCase,
  consumePendingHandoff,
  createHandoffSummary,
  createPendingHandoff,
  extendCase,
  getHumanState,
  isHumanRequest
} from "./humanHandoff.js";
import { OpenAIImageResponder } from "./imageResponder.js";
import {
  downloadLineMessageContent,
  pushMessagesToLine,
  replyMessagesToLine,
  replyToLine,
  verifyLineSignature,
  type LineOutboundMessage,
  type LinePostbackEvent,
  type LineWebhookBody
} from "./line.js";
import { OpenAIResponder } from "./openaiResponder.js";
import type { ChatResponder, ImageResponder, RiskLevel } from "./types.js";

interface AppOptions {
  config: AppConfig;
  responder?: ChatResponder;
  imageResponder?: ImageResponder;
  handoffStore?: HandoffStore;
}

const unsupportedMessageNotice = "目前我支援文字與圖片。若要辨識故障碼，請傳清楚的診斷電腦、儀表板或維修單照片。";
const handoffReply = "已轉交技師，請稍候。這段期間我會暫停自動回覆，避免干擾真人技師協助。";

export function createApp({
  config,
  responder = new OpenAIResponder(config),
  imageResponder = new OpenAIImageResponder(config),
  handoffStore = new HandoffStore()
}: AppOptions) {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/webhook/line", async (req, res) => {
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
    const signature = req.header("x-line-signature");

    if (!verifyLineSignature(config.LINE_CHANNEL_SECRET, rawBody, signature)) {
      res.status(401).json({ error: "Invalid LINE signature" });
      return;
    }

    const body = req.body as LineWebhookBody;

    await Promise.all(
      (body.events ?? []).map(async (event) => {
        if (event.source.groupId) {
          console.log(`LINE groupId: ${event.source.groupId}`);
        }

        if (event.source.roomId) {
          console.log(`LINE roomId: ${event.source.roomId}`);
        }

        if (event.type === "postback") {
          await handlePostbackEvent(config, handoffStore, event);
          return;
        }

        if (isTechnicianGroupMessage(config, event.source.groupId)) {
          return;
        }

        const userId = event.source.userId ?? event.source.groupId ?? event.source.roomId ?? "unknown-line-source";

        if (event.message.type === "image" && event.message.id) {
          if (getHumanState(userId)) {
            addConversationTurn(userId, "user", "[圖片訊息]");
            return;
          }

          const content = await downloadLineMessageContent(config.LINE_CHANNEL_ACCESS_TOKEN, event.message.id);
          const reply = await imageResponder.generateImageReply({
            userId,
            imageBase64: Buffer.from(content.bytes).toString("base64"),
            mimeType: content.mimeType
          });
          addConversationTurn(userId, "user", "[圖片訊息]");
          addConversationTurn(userId, "assistant", reply);
          await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, reply);
          return;
        }

        if (event.message.type !== "text" || !event.message.text) {
          await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, unsupportedMessageNotice);
          return;
        }

        const currentMessage = event.message.text;

        if (getHumanState(userId)) {
          addConversationTurn(userId, "user", currentMessage);
          return;
        }

        if (isHumanRequest(currentMessage)) {
          addConversationTurn(userId, "user", currentMessage);
          await createHumanHandoff({
            config,
            handoffStore,
            userId,
            summary: currentMessage,
            riskLevel: "medium",
            requiredInfo: ["車廠/車型/年份", "引擎型號或排氣量", "問題描述", "已檢查或更換過的零件"]
          });
          await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, handoffReply);
          return;
        }

        const previousUserContext = getUserConversationContext(userId);
        const fullPreviousContext = getConversationContext(userId);
        const classificationInput = [currentMessage, previousUserContext].filter(Boolean).join("\n");
        const messageWithContext = [
          `目前最新問題：${currentMessage}`,
          previousUserContext ? `客戶先前問題：\n${previousUserContext}` : "",
          fullPreviousContext ? `完整歷史對話：\n${fullPreviousContext}` : ""
        ]
          .filter(Boolean)
          .join("\n\n");
        const classification = classifyQuestion(classificationInput);

        addConversationTurn(userId, "user", currentMessage);

        if (classification.category === "off_topic") {
          const reply = "我主要協助汽車故障碼、電路檢查、保養品與 AASTA 產品相關問題。若有車況、故障碼、油品或維修需求，請直接告訴我。";
          addConversationTurn(userId, "assistant", reply);
          await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, reply);
          return;
        }

        if (classification.category === "service_request") {
          const reply = [
            "我們可以先協助初步判斷你的需求，但實際是否能施工或維修，仍需要真人技師依車型、狀況與現場條件確認。",
            "如果你希望技師協助確認，請按下方「轉接真人」。"
          ].join("\n");
          const pending = createPendingHandoff({
            userId,
            summary: currentMessage,
            riskLevel: classification.riskLevel,
            requiredInfo: classification.requiredInfo
          });
          addConversationTurn(userId, "assistant", reply);
          await replyMessagesToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [
            { type: "text", text: reply },
            createCustomerHandoffConfirmButtons(pending.requestId)
          ]);
          return;
        }

        const reply = await responder.generateReply({
          userId,
          currentMessage,
          message: messageWithContext,
          classification
        });

        addConversationTurn(userId, "assistant", reply);

        if (classification.category === "high_risk") {
          const pending = createPendingHandoff({
            userId,
            summary: currentMessage,
            riskLevel: classification.riskLevel,
            requiredInfo: classification.requiredInfo
          });
          await replyMessagesToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [
            { type: "text", text: reply },
            createCustomerHandoffConfirmButtons(pending.requestId)
          ]);
          return;
        }

        await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, reply);
      })
    );

    res.status(200).json({ ok: true });
  });

  return app;
}

async function handlePostbackEvent(config: AppConfig, handoffStore: HandoffStore, event: LinePostbackEvent): Promise<void> {
  const params = new URLSearchParams(event.postback.data);
  const action = params.get("action");
  const caseId = params.get("caseId");
  const requestId = params.get("requestId");

  if (action === "confirm_handoff") {
    if (!requestId) {
      await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, "找不到轉接請求。");
      return;
    }

    const request = consumePendingHandoff(requestId);
    if (!request) {
      await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, "轉接請求已過期，若仍需要真人協助，請再告訴我。");
      return;
    }

    await createHumanHandoff({
      config,
      handoffStore,
      userId: request.userId,
      summary: request.summary,
      riskLevel: request.riskLevel,
      requiredInfo: request.requiredInfo
    });
    await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, handoffReply);
    return;
  }

  if (action === "decline_handoff") {
    await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, "了解，先不轉接真人。我會繼續用文字協助你。");
    return;
  }

  if (!caseId) {
    await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, "找不到案件編號。");
    return;
  }

  if (action === "claim") {
    const state = claimCase(caseId, event.source.userId);
    await replyToLine(
      config.LINE_CHANNEL_ACCESS_TOKEN,
      event.replyToken,
      state ? `案件 ${caseId} 已標記由此技師接手。` : `案件 ${caseId} 不存在或人工模式已到期。`
    );
    return;
  }

  if (action === "extend") {
    const state = extendCase(caseId, 60);
    await replyToLine(
      config.LINE_CHANNEL_ACCESS_TOKEN,
      event.replyToken,
      state
        ? `案件 ${caseId} 已延長 1 小時，人工模式到 ${new Date(state.humanUntil).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}。`
        : `案件 ${caseId} 不存在或人工模式已到期。`
    );
    return;
  }

  if (action === "close") {
    const state = closeCase(caseId);
    await replyToLine(
      config.LINE_CHANNEL_ACCESS_TOKEN,
      event.replyToken,
      state ? `案件 ${caseId} 已結束人工模式，該客戶恢復 GPT 自動回覆。` : `案件 ${caseId} 不存在或已結束。`
    );
    return;
  }

  await replyToLine(config.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, "未知的案件操作。");
}

async function createHumanHandoff(input: {
  config: AppConfig;
  handoffStore: HandoffStore;
  userId: string;
  summary: string;
  riskLevel: RiskLevel;
  requiredInfo: string[];
}): Promise<void> {
  const record = await input.handoffStore.create({
    userId: input.userId,
    summary: input.summary,
    riskLevel: input.riskLevel,
    requiredInfo: input.requiredInfo
  });
  const state = activateHumanModeFromRecord(record);

  if (!input.config.TECH_ESCALATION_TARGET) return;

  await pushMessagesToLine(input.config.LINE_CHANNEL_ACCESS_TOKEN, input.config.TECH_ESCALATION_TARGET, [
    { type: "text", text: createHandoffSummary({ ...record, caseId: record.id, humanUntil: state.humanUntil }) },
    createTechnicianHandoffButtons(record.id)
  ]);
}

function createCustomerHandoffConfirmButtons(requestId: string): LineOutboundMessage {
  return {
    type: "template",
    altText: "是否轉接真人客服",
    template: {
      type: "buttons",
      title: "需要真人協助嗎？",
      text: "這個問題風險較高，如需真人技師協助，可按下方按鈕轉接。",
      actions: [
        {
          type: "postback",
          label: "轉接真人",
          data: `action=confirm_handoff&requestId=${encodeURIComponent(requestId)}`,
          displayText: "我要轉接真人"
        },
        {
          type: "postback",
          label: "暫不轉接",
          data: `action=decline_handoff&requestId=${encodeURIComponent(requestId)}`,
          displayText: "暫不轉接"
        }
      ]
    }
  };
}

function createTechnicianHandoffButtons(caseId: string): LineOutboundMessage {
  return {
    type: "template",
    altText: `技師轉接案件 ${caseId}`,
    template: {
      type: "buttons",
      title: "技師案件操作",
      text: "請選擇案件處理動作",
      actions: [
        {
          type: "postback",
          label: "我來處理",
          data: `action=claim&caseId=${encodeURIComponent(caseId)}`,
          displayText: "我來處理"
        },
        {
          type: "postback",
          label: "延長1小時",
          data: `action=extend&caseId=${encodeURIComponent(caseId)}`,
          displayText: "延長1小時"
        },
        {
          type: "postback",
          label: "結束人工",
          data: `action=close&caseId=${encodeURIComponent(caseId)}`,
          displayText: "結束人工"
        }
      ]
    }
  };
}

function isTechnicianGroupMessage(config: AppConfig, groupId?: string): boolean {
  return Boolean(groupId && config.TECH_ESCALATION_TARGET && groupId === config.TECH_ESCALATION_TARGET);
}
