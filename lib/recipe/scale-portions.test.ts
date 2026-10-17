import { describe, expect, it } from "vitest";
import { scaleIngredients } from "./scale-portions";

describe("scaleIngredients", () => {
  it("scales known numeric quantities proportionally", () => {
    const result = scaleIngredients(
      [
        { name: "farinha", quantity: 200, unit: "g" },
        { name: "ovos", quantity: 2, unit: "unidade" },
      ],
      2,
      4,
    );

    expect(result.map((item) => item.quantity)).toEqual([400, 4]);
    expect(result.map((item) => item.originalQuantity)).toEqual([200, 2]);
    expect(result.every((item) => item.scaled)).toBe(true);
  });

  it("preserves unknown quantities instead of inventing values", () => {
    const result = scaleIngredients(
      [{ name: "sal a gosto", quantity: null, unit: null }],
      4,
      8,
    );

    expect(result[0].quantity).toBeNull();
    expect(result[0].originalQuantity).toBeNull();
    expect(result[0].scaled).toBe(false);
  });

  it("rejects unknown or invalid original servings", () => {
    expect(() => scaleIngredients([], null, 4)).toThrow(RangeError);
    expect(() => scaleIngredients([], 0, 4)).toThrow(RangeError);
  });

  it("rejects non-positive target servings", () => {
    expect(() => scaleIngredients([], 2, 0)).toThrow(RangeError);
    expect(() => scaleIngredients([], 2, Number.NaN)).toThrow(RangeError);
  });

  it("does not round fractional results or convert units", () => {
    const result = scaleIngredients(
      [{ name: "açúcar", quantity: 100, unit: "g" }],
      3,
      2,
    );

    expect(result[0].quantity).toBeCloseTo(66.6666667);
    expect(result[0].unit).toBe("g");
  });
});
