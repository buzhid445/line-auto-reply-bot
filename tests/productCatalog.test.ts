import { describe, expect, it } from "vitest";
import { searchProducts } from "../src/productCatalog.js";

describe("searchProducts", () => {
  it("returns only the matching 5W-30 product for explicit viscosity", () => {
    const results = searchProducts({ viscosity: "5W-30", spec: "API SP" });
    expect(results).toHaveLength(1);
    expect(results[0]?.viscosity).toBe("5W-30");
    expect(results[0]?.specs).toContain("API SP");
  });

  it("does not return products without matching evidence", () => {
    const results = searchProducts({ vehicleInfo: "完全未知條件" });
    expect(results).toEqual([]);
  });

  it("maps Mercedes S450 oil questions to available MB/ACEA engine oil products", () => {
    const results = searchProducts({ vehicleInfo: "賓士 S450 2024 推薦用油" });
    expect(results[0]?.category).toBe("引擎油");
    expect(results[0]?.specs.join(" ")).toMatch(/MB|ACEA C3/);
  });

  it.each([
    ["推薦ATF變速箱油", "變速箱油"],
    ["有沒有CVT油", "變速箱油"],
    ["推薦水箱精", "冷卻液"],
    ["推薦煞車油 DOT4", "煞車油"],
    ["有方向機油嗎", "方向機油"],
    ["推薦燃油提升劑", "添加劑"],
    ["有化油器積碳清潔劑嗎", "清潔劑"]
  ])("returns %s category products", (query, category) => {
    const results = searchProducts({ useCase: query });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((product) => product.category === category)).toBe(true);
  });
});
