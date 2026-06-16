import { describe, expect, it } from "vitest";
import { classifyQuestion } from "../src/classifier.js";

describe("classifyQuestion", () => {
  it("marks unrelated questions as off topic", () => {
    const result = classifyQuestion("今天台積電股價多少？");
    expect(result.category).toBe("off_topic");
  });

  it("allows simple greetings", () => {
    const result = classifyQuestion("你好");
    expect(result.category).toBe("simple_technical");
  });

  it("marks brake issues as high risk", () => {
    const result = classifyQuestion("煞車踩下去會沉，怎麼辦？");
    expect(result.category).toBe("high_risk");
    expect(result.riskLevel).toBe("high");
  });

  it("answers standard OBD fault codes before asking for vehicle details", () => {
    const result = classifyQuestion("P0335 是什麼故障碼？");
    expect(result.category).toBe("simple_technical");
    expect(result.riskLevel).toBe("medium");
    expect(result.requiredInfo).toContain("車廠/車型/年份");
  });

  it("asks for more info before oil recommendations without vehicle context", () => {
    const result = classifyQuestion("你們機油哪支比較適合？");
    expect(result.category).toBe("need_more_info");
    expect(result.requiredInfo).toContain("車廠/車型/年份");
  });

  it("treats explicit 5W30 oil requests as product recommendations, not high risk", () => {
    const result = classifyQuestion("推薦我5W30的油");
    expect(result.category).toBe("product_recommendation");
    expect(result.riskLevel).toBe("low");
  });

  it("treats non-engine-oil product categories as product recommendations", () => {
    const result = classifyQuestion("有推薦的煞車油或水箱精嗎？");
    expect(result.category).toBe("product_recommendation");
    expect(result.riskLevel).toBe("low");
  });

  it("uses prior customer product context for direct AASTA follow-up", () => {
    const result = classifyQuestion("直接推薦 AASTA 產品\n客戶：推薦我5W30的油");
    expect(result.category).toBe("product_recommendation");
    expect(result.riskLevel).toBe("low");
  });

  it("allows product recommendation when vehicle context exists", () => {
    const result = classifyQuestion("Altis 可以用你們哪支油？");
    expect(result.category).toBe("product_recommendation");
  });

  it("uses conversation context for follow-up oil questions", () => {
    const result = classifyQuestion("客戶：賓士/S450/2024\n客戶：先告訴我需要用什麼油，推薦我");
    expect(result.category).toBe("product_recommendation");
  });

  it("routes repair service availability questions to service request", () => {
    const result = classifyQuestion("你們有在修冷氣嗎？");
    expect(result.category).toBe("service_request");
    expect(result.riskLevel).toBe("medium");
  });

  it("routes wiring diagram requests to service request", () => {
    const result = classifyQuestion("有沒有賓士 S450 的引擎線路圖？");
    expect(result.category).toBe("service_request");
    expect(result.riskLevel).toBe("medium");
  });
});
