import { createHmac, timingSafeEqual } from "node:crypto";

export interface LineMessageEvent {
  type: "message";
  replyToken: string;
  source: LineSource;
  message: {
    type: string;
    id?: string;
    text?: string;
  };
}

export interface LinePostbackEvent {
  type: "postback";
  replyToken: string;
  source: LineSource;
  postback: {
    data: string;
  };
}

export interface LineSource {
  type?: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export type LineEvent = LineMessageEvent | LinePostbackEvent;

export interface LineWebhookBody {
  events: LineEvent[];
}

type LineTextMessage = {
  type: "text";
  text: string;
};

type LineTemplateMessage = {
  type: "template";
  altText: string;
  template: {
    type: "buttons";
    title?: string;
    text: string;
    actions: Array<{
      type: "postback";
      label: string;
      data: string;
      displayText?: string;
    }>;
  };
};

export type LineOutboundMessage = LineTextMessage | LineTemplateMessage;

export function verifyLineSignature(channelSecret: string, rawBody: Buffer, signature?: string): boolean {
  if (!signature) return false;
  const digest = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function replyToLine(accessToken: string, replyToken: string, text: string): Promise<void> {
  await replyMessagesToLine(accessToken, replyToken, [{ type: "text", text: limitLineText(text) }]);
}

export async function replyMessagesToLine(
  accessToken: string,
  replyToken: string,
  messages: LineOutboundMessage[]
): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      replyToken,
      messages: messages.map(limitMessage)
    })
  });

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`);
  }
}

export async function pushToLine(accessToken: string, to: string, text: string): Promise<void> {
  await pushMessagesToLine(accessToken, to, [{ type: "text", text: limitLineText(text) }]);
}

export async function pushMessagesToLine(accessToken: string, to: string, messages: LineOutboundMessage[]): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      to,
      messages: messages.map(limitMessage)
    })
  });

  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status} ${await response.text()}`);
  }
}

export async function downloadLineMessageContent(accessToken: string, messageId: string): Promise<{
  bytes: ArrayBuffer;
  mimeType: string;
}> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`LINE content download failed: ${response.status} ${await response.text()}`);
  }

  return {
    bytes: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") ?? "image/jpeg"
  };
}

function limitMessage(message: LineOutboundMessage): LineOutboundMessage {
  if (message.type === "text") {
    return { ...message, text: limitLineText(message.text) };
  }

  return {
    ...message,
    altText: limitLineText(message.altText),
    template: {
      ...message.template,
      text: limitLineText(message.template.text).slice(0, 160)
    }
  };
}

function limitLineText(text: string): string {
  return text.length <= 4900 ? text : `${text.slice(0, 4890)}...`;
}
