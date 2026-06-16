import type { AppConfig } from "./config.js";
import { formatProductRecommendation, searchProducts } from "./productCatalog.js";
import type { ChatResponder, ClassifiedQuestion } from "./types.js";

const systemPrompt = `
你是 AASTA 機油品牌提供給保修廠客戶使用的 LINE 技術助理。
只能輸出純文字，不可產生圖片、貼圖、語音、影片、檔案或任何非文字內容。
請優先回答「目前最新問題」，歷史對話只用來理解上下文，不可把上一題的故障碼或車款套到最新問題。
技術問題與 OBD 故障碼由你依一般汽車維修知識回答，不要依賴本地故障碼資料庫。
使用者提供 OBD 故障碼時，即使沒有車型，也要先說明常見含義、可能原因、基本檢查方向，再簡短追問車型、年份、引擎、症狀與已檢查項目。
遇到煞車、轉向、短路、冒煙、引擎嚴重異音、安全氣囊、熄火等高風險問題，先提供安全的初步方向，再提醒需技師實車檢查。
油品推薦流程：先依車廠/車型/年份說明一般可能黏度或原廠規範方向；最後才根據「AASTA 產品規則表」推薦自有品牌產品。
推薦 AASTA 產品時，只能根據提供的產品規則表結果，不得編造產品、規格、認證或庫存。
若缺少車型、年份、引擎或原廠規範，請先提供可確定的一般方向，再簡短追問缺少資料；不要只回覆「請補資料」。
語氣：專業、簡潔、保守、台灣繁體中文。
`.trim();

export class OpenAIResponder implements ChatResponder {
  constructor(private readonly config: AppConfig) {}

  async generateReply(input: {
    userId: string;
    currentMessage: string;
    message: string;
    classification: ClassifiedQuestion;
  }): Promise<string> {
    const productContext =
      input.classification.category === "product_recommendation"
        ? formatProductRecommendation(
            searchProducts({
              vehicleInfo: input.message,
              viscosity: input.message,
              spec: input.message,
              useCase: input.message
            })
          )
        : "本次不需要推薦 AASTA 產品，除非使用者明確詢問油品或保養品。";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: this.config.OPENAI_MODEL,
        instructions: systemPrompt,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `LINE userId: ${input.userId}`,
                  `分類: ${input.classification.category}`,
                  `風險: ${input.classification.riskLevel}`,
                  `分類原因: ${input.classification.reason}`,
                  `需補資料: ${input.classification.requiredInfo.join("、") || "無"}`,
                  `AASTA 產品規則表結果:\n${productContext}`,
                  `目前最新問題:\n${input.currentMessage}`,
                  `包含歷史對話的上下文:\n${input.message}`
                ].join("\n\n")
              }
            ]
          }
        ],
        max_output_tokens: 900
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI response failed: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    return extractResponseText(payload) || fallbackReply(input.classification);
  }
}

export function fallbackReply(classification: ClassifiedQuestion): string {
  if (classification.category === "high_risk") {
    return [
      "這個狀況可能涉及行車安全，建議由技師實車確認。",
      "我可以先協助整理資訊，請補充車廠/車型/年份、引擎型號或排氣量、故障碼、症狀，以及已檢查或更換過的零件。"
    ].join("\n");
  }

  if (classification.category === "need_more_info") {
    return `我需要多一點資料才不會誤判。請補充：${classification.requiredInfo.join("、")}。`;
  }

  return "收到，我可以先提供一般檢查方向；實際原因仍需依車況與技師現場檢查確認。";
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
