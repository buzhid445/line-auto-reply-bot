import type { AppConfig } from "./config.js";
import type { ImageResponder } from "./types.js";

const imageSystemPrompt = `
你是 AASTA 機油品牌提供給保修廠客戶使用的圖片辨識助理。
你只輸出純文字，不產生圖片。
任務：從客戶上傳的照片中辨識可能的 OBD 故障碼、儀表警示文字、診斷電腦畫面或維修單資訊。
如果看不清楚，請明確說「疑似」或「無法確認」，並請客戶補一張清楚照片或直接用文字輸入故障碼。
如果辨識到故障碼，請提供：故障碼、常見含義、可能原因、基本檢查方向。
請保守回答，不要保證診斷結果；實際原因仍需依車況與技師現場檢查確認。
語氣：專業、簡潔、台灣繁體中文。
`.trim();

export class OpenAIImageResponder implements ImageResponder {
  constructor(private readonly config: AppConfig) {}

  async generateImageReply(input: {
    userId: string;
    imageBase64: string;
    mimeType: string;
  }): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: this.config.OPENAI_MODEL,
        instructions: imageSystemPrompt,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `LINE userId: ${input.userId}`,
                  "請辨識這張圖片中的故障碼或警示資訊，並以文字提供可能原因與檢查方向。"
                ].join("\n")
              },
              {
                type: "input_image",
                image_url: `data:${input.mimeType};base64,${input.imageBase64}`
              }
            ]
          }
        ],
        max_output_tokens: 900
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI vision response failed: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    return extractResponseText(payload) || "我無法清楚辨識這張圖片，請再傳一張更清楚的照片，或直接用文字輸入故障碼。";
  }
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .map((content) => {
      if (!isRecord(content)) return "";
      if (typeof content.text === "string") return content.text;
      if (typeof content.output_text === "string") return content.output_text;
      return "";
    })
    .join("")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
