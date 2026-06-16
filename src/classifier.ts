import type { ClassifiedQuestion } from "./types.js";

const dtcPattern = /\b[pubc]\d{4}\b/i;

const serviceRequestPattern =
  /(有沒有|有在|可以|能不能|會不會|是否).*修|修理|維修|保修|處理|檢修|施工|更換|安裝|你們.*修|你們.*處理|線路圖|電路圖|接線圖|配線圖|維修手冊|原廠手冊|手冊資料|修車資料/i;

const highRiskPatterns = [
  /煞車|剎車|brake/i,
  /方向盤|轉向|steering/i,
  /短路|燒焦|冒煙|起火|漏電/i,
  /安全氣囊|airbag|srs/i,
  /引擎.*異音|異音.*引擎|敲缸|爆震/i,
  /熄火|失速/i
];

const productPatterns = [
  /機油|引擎油|變速箱油|齒輪油|自排油|水箱精|冷卻液|煞車油|剎車油|方向機油|動力方向油|添加劑|機油精|燃油提升劑|清潔劑|化油器|積碳|用油|油品|aasta|oil|atf|cvt|coolant|dot\s?4/i,
  /0w-?20|5w-?30|5w-?40|5w-?50|10w-?40|15w-?40|15w-?50/i,
  /推薦|適合|哪支|哪一支|用什麼|要用什麼|可以用|查詢/i
];

const technicalInfoPatterns = [
  /電路|發電機|啟動馬達|感知器|sensor|充電/i,
  /異音|抖動|不好發|亮燈|check engine/i
];

const automotiveScopePatterns = [
  /車|汽車|機車|引擎|變速箱|冷氣|底盤|輪胎|電瓶|發電機|啟動馬達|水箱|冷卻|煞車|剎車|方向機|避震|火星塞|噴油嘴|節氣門|感知器|感測器|故障碼|儀表|亮燈|保養|維修|保修|技師|車廠|車型/i,
  /obd|dtc|check engine|engine|brake|steering|battery|alternator|sensor|aasta|oil|atf|cvt|coolant|dot\s?4/i,
  /p\d{4}|u\d{4}|b\d{4}|c\d{4}/i
];

const greetingPattern = /^(你好|您好|哈囉|hello|hi|嗨|早安|午安|晚安)[！!。.\s]*$/i;

export function classifyQuestion(message: string): ClassifiedQuestion {
  const normalized = message.trim();

  if (!isInAutomotiveScope(normalized)) {
    return {
      category: "off_topic",
      riskLevel: "low",
      reason: "問題與汽車維修、故障碼、保養品、AASTA 產品或真人技師服務無關。",
      requiredInfo: []
    };
  }

  if (serviceRequestPattern.test(normalized) && !isProductQuestion(normalized)) {
    return {
      category: "service_request",
      riskLevel: "medium",
      reason: "客戶詢問維修服務或線路圖/手冊資料，應詢問是否轉接真人技師確認。",
      requiredInfo: ["車廠/車型/年份", "引擎型號或排氣量", "需要的系統或線路項目", "目前症狀"]
    };
  }

  if (!isBrakeFluidProductQuestion(normalized) && highRiskPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      category: "high_risk",
      riskLevel: "high",
      reason: "客戶最新問題可能涉及行車安全或重大機件風險。",
      requiredInfo: ["車廠/車型/年份", "引擎型號或排氣量", "故障碼", "症狀", "已檢查或更換過的零件"]
    };
  }

  if (dtcPattern.test(normalized)) {
    return {
      category: "simple_technical",
      riskLevel: "medium",
      reason: "客戶提供標準 OBD 故障碼，應由 GPT 先回答通用含義與檢查方向。",
      requiredInfo: ["車廠/車型/年份", "引擎型號或排氣量", "症狀", "已檢查或更換過的零件"]
    };
  }

  if (isProductQuestion(normalized)) {
    const hasVehicle = hasVehicleContext(normalized);
    const hasSpecificProductSpec = /0w-?20|5w-?30|5w-?40|5w-?50|10w-?40|15w-?40|15w-?50|dot\s?4|dexron|mercon|atf\s?[ad]\d|cvt\s?d5|50%|100%/i.test(
      normalized
    );
    const explicitlyAsksAasta = /aasta|直接推薦/i.test(normalized);
    const hasCategoryOnly = /變速箱油|齒輪油|自排油|水箱精|冷卻液|煞車油|剎車油|方向機油|動力方向油|添加劑|機油精|燃油提升劑|清潔劑|化油器|積碳/i.test(
      normalized
    );

    return {
      category:
        hasVehicle || hasSpecificProductSpec || explicitlyAsksAasta || hasCategoryOnly
          ? "product_recommendation"
          : "need_more_info",
      riskLevel: "low",
      reason: "客戶正在詢問油品或 AASTA 產品推薦。",
      requiredInfo:
        hasVehicle || hasSpecificProductSpec || explicitlyAsksAasta || hasCategoryOnly
          ? []
          : ["車廠/車型/年份", "引擎型號或排氣量", "原廠建議黏度或規範"]
    };
  }

  if (technicalInfoPatterns.some((pattern) => pattern.test(normalized)) && !hasVehicleContext(normalized)) {
    return {
      category: "need_more_info",
      riskLevel: "medium",
      reason: "技術問題缺少車型、年份或症狀脈絡。",
      requiredInfo: ["車廠/車型/年份", "引擎型號或排氣量", "故障碼", "症狀", "已檢查或更換過的零件"]
    };
  }

  return {
    category: "simple_technical",
    riskLevel: "low",
    reason: "可提供一般性保養或檢查方向。",
    requiredInfo: []
  };
}

function isInAutomotiveScope(message: string): boolean {
  return (
    greetingPattern.test(message) ||
    isProductQuestion(message) ||
    serviceRequestPattern.test(message) ||
    automotiveScopePatterns.some((pattern) => pattern.test(message))
  );
}

function isProductQuestion(message: string): boolean {
  return productPatterns.some((pattern) => pattern.test(message));
}

function isBrakeFluidProductQuestion(message: string): boolean {
  return /煞車油|剎車油|dot\s?4|brake fluid/i.test(message);
}

function hasVehicleContext(message: string): boolean {
  return /toyota|honda|nissan|ford|bmw|benz|mercedes|lexus|mazda|mitsubishi|volvo|vw|audi|altis|camry|rav4|focus|cr-v|s-class|s class|s450|賓士|奔馳|豐田|本田|日產|福特|凌志|馬自達|三菱|奧迪|福斯|20\d{2}|19\d{2}|車型|年份|引擎/i.test(
    message
  );
}
