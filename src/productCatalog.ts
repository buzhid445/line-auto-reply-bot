import products from "../data/products.json" with { type: "json" };
import type { Product, ProductSearchInput } from "./types.js";

const catalog = products as Product[];

export function listProducts(): Product[] {
  return catalog;
}

export function searchProducts(input: ProductSearchInput): Product[] {
  const rawQuery = [input.vehicleInfo ?? "", input.viscosity ?? "", input.spec ?? "", input.useCase ?? ""]
    .join(" ")
    .toLowerCase();
  const query = expandQuery(rawQuery);
  const exactViscosity = normalizeViscosity(query);
  const requestedSpec = query.toLowerCase();
  const requestedCategory = detectCategory(query);
  const candidates = exactViscosity
    ? catalog.filter((product) => product.viscosity.toLowerCase() === exactViscosity.toLowerCase())
    : requestedCategory
      ? catalog.filter((product) => product.category === requestedCategory)
      : catalog;

  return candidates
    .map((product) => ({
      product,
      score:
        scoreViscosity(product, exactViscosity) +
        scoreSpecs(product, requestedSpec) +
        scoreCategory(product, requestedCategory) +
        scoreText(product, query)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, exactViscosity ? 1 : 5)
    .map(({ product }) => product);
}

export function formatProductRecommendation(productsToRecommend: Product[]): string {
  if (productsToRecommend.length === 0) {
    return "目前產品規則表沒有足夠線索可推薦特定 AASTA 產品；可先說明一般規格方向，再請客戶補充車型、年份、引擎與原廠建議規範。";
  }

  return productsToRecommend
    .map((product) => {
      const specs = product.specs.length > 0 ? product.specs.join(" / ") : "無特定認證規格";
      const points = product.sellingPoints.join("、");
      const packageUnit = product.packageUnit ? `，包裝：${product.packageUnit}` : "";
      const viscosity = product.viscosity ? `，${product.viscosity}` : "";
      return `${product.name}（${product.category ?? "產品"}${viscosity}，${specs}${packageUnit}）：${points}`;
    })
    .join("\n");
}

function scoreViscosity(product: Product, requestedViscosity: string): number {
  if (!requestedViscosity || !product.viscosity) return 0;
  return product.viscosity.toLowerCase() === requestedViscosity.toLowerCase() ? 10 : 0;
}

function scoreSpecs(product: Product, requestedSpec: string): number {
  if (!requestedSpec) return 0;
  return product.specs.some((spec) => requestedSpec.includes(spec.toLowerCase())) ? 6 : 0;
}

function scoreCategory(product: Product, requestedCategory: string): number {
  if (!requestedCategory) return 0;
  return product.category === requestedCategory ? 8 : 0;
}

function scoreText(product: Product, query: string): number {
  if (!query) return 0;
  const haystack = [
    product.name,
    product.category ?? "",
    product.viscosity,
    ...product.specs,
    ...product.suitableFor,
    ...product.sellingPoints,
    product.description ?? ""
  ]
    .join(" ")
    .toLowerCase();

  const keywords = query.split(/\s+/).filter((word) => word.length >= 2);
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function normalizeViscosity(input: string): string {
  const match = input.match(/\b(0w|5w|10w|15w)-?(20|30|40|50)\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : "";
}

function detectCategory(query: string): string {
  if (/變速箱油|齒輪油|自排油|atf|cvt|dexron|mercon/.test(query)) return "變速箱油";
  if (/水箱精|冷卻液|coolant|antifreeze/.test(query)) return "冷卻液";
  if (/煞車油|剎車油|dot\s?4|brake fluid/.test(query)) return "煞車油";
  if (/方向機油|動力方向油|power steering|psf/.test(query)) return "方向機油";
  if (/添加劑|機油精|燃油提升劑|fuel enhancer|treatment/.test(query)) return "添加劑";
  if (/清潔劑|化油器|積碳|carburetor|cleaner/.test(query)) return "清潔劑";
  if (/機油|引擎油|用油|engine oil|motor oil/.test(query)) return "引擎油";
  return "";
}

function expandQuery(query: string): string {
  const additions: string[] = [];

  if (/賓士|奔馳|benz|mercedes|s-class|s class|s450/.test(query)) {
    additions.push("mercedes-benz mb 229.51 mb 229.31 acea c3 engine oil motor oil 機油 引擎油");
  }

  if (/推薦|用油|油品|要用什麼/.test(query)) {
    additions.push("機油 引擎油 engine oil motor oil");
  }

  return [query, ...additions].join(" ");
}
