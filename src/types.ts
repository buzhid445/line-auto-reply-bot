export type QuestionCategory =
  | "simple_technical"
  | "high_risk"
  | "product_recommendation"
  | "service_request"
  | "off_topic"
  | "need_more_info";

export type RiskLevel = "low" | "medium" | "high";

export interface Product {
  id: string;
  name: string;
  category?: string;
  viscosity: string;
  specs: string[];
  suitableFor: string[];
  sellingPoints: string[];
  notSuitableFor: string[];
  packageUnit?: string;
  description?: string;
}

export interface ProductSearchInput {
  vehicleInfo?: string;
  viscosity?: string;
  spec?: string;
  useCase?: string;
}

export interface HandoffInput {
  userId: string;
  summary: string;
  riskLevel: RiskLevel;
  requiredInfo: string[];
}

export interface HandoffRecord extends HandoffInput {
  id: string;
  createdAt: string;
  status: "open";
}

export interface ClassifiedQuestion {
  category: QuestionCategory;
  riskLevel: RiskLevel;
  reason: string;
  requiredInfo: string[];
}

export interface ChatResponder {
  generateReply(input: {
    userId: string;
    currentMessage: string;
    message: string;
    classification: ClassifiedQuestion;
  }): Promise<string>;
}

export interface ImageResponder {
  generateImageReply(input: {
    userId: string;
    imageBase64: string;
    mimeType: string;
  }): Promise<string>;
}
