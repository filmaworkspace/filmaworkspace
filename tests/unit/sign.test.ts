import { describe, expect, it } from "vitest";
import { plain, stableJson } from "@/lib/sign/hash";

describe("Filma Sign: huella del documento", () => {
  it("no depende del orden de las claves", () => {
    expect(stableJson({ b: 1, a: { d: [1, 2], c: "x" } })).toBe(stableJson({ a: { c: "x", d: [1, 2] }, b: 1 }));
  });
  it("cualquier cambio de contenido la cambia", () => {
    expect(stableJson({ total: 100 })).not.toBe(stableJson({ total: 100.01 }));
  });
  it("congela fechas como milisegundos y quita undefined", () => {
    expect(plain({ at: { toMillis: () => 5 }, x: undefined, y: [{ toMillis: () => 7 }] })).toEqual({ at: 5, y: [7] });
  });
});
