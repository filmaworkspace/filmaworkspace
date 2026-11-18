import { describe, expect, it } from "vitest";
import { documentTotals, lineAmounts, poRemaining, round2, splitByPercent, splitEqually } from "@/lib/amounts";

describe("round2", () => {
  it("redondea a céntimos sin errores de coma flotante", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(3 * 33.33)).toBe(99.99);
    expect(round2(1.005)).toBe(1.01); // medio céntimo hacia arriba
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(NaN)).toBe(0);
  });
});

describe("lineAmounts", () => {
  it("base, IVA 21 %, sin IRPF", () => {
    expect(lineAmounts({ quantity: 1, unitPrice: 1000, vatRate: 21, irpfRate: 0 }))
      .toEqual({ baseAmount: 1000, vatAmount: 210, irpfAmount: 0, totalAmount: 1210 });
  });
  it("profesional: IVA 21 % y retención IRPF 15 %", () => {
    expect(lineAmounts({ quantity: 1, unitPrice: 1500, vatRate: 21, irpfRate: 15 }))
      .toEqual({ baseAmount: 1500, vatAmount: 315, irpfAmount: 225, totalAmount: 1590 });
  });
  it("cantidades y precios con decimales se redondean por línea", () => {
    expect(lineAmounts({ quantity: 3, unitPrice: 33.33, vatRate: 21, irpfRate: 0 }))
      .toEqual({ baseAmount: 99.99, vatAmount: 21, irpfAmount: 0, totalAmount: 120.99 });
    expect(lineAmounts({ quantity: 7, unitPrice: 12.35, vatRate: 10, irpfRate: 7 }))
      .toEqual({ baseAmount: 86.45, vatAmount: 8.65, irpfAmount: 6.05, totalAmount: 89.05 });
  });
  it("IVA reducido y exento", () => {
    expect(lineAmounts({ quantity: 2, unitPrice: 45, vatRate: 10, irpfRate: 0 }).totalAmount).toBe(99);
    expect(lineAmounts({ quantity: 1, unitPrice: 300, vatRate: 0, irpfRate: 0 }).totalAmount).toBe(300);
  });
  it("acepta texto con coma decimal y valores vacíos", () => {
    expect(lineAmounts({ quantity: "2" as any, unitPrice: "10,50" as any, vatRate: 21, irpfRate: "" as any }).totalAmount).toBe(25.41);
    expect(lineAmounts({ quantity: undefined as any, unitPrice: 10, vatRate: 21, irpfRate: 0 }).totalAmount).toBe(0);
  });
  it("abonos (importes negativos)", () => {
    expect(lineAmounts({ quantity: -1, unitPrice: 200, vatRate: 21, irpfRate: 0 }))
      .toEqual({ baseAmount: -200, vatAmount: -42, irpfAmount: 0, totalAmount: -242 });
  });
});

describe("documentTotals", () => {
  it("suma las líneas y cuadra base + IVA − IRPF = total", () => {
    const lines = [
      lineAmounts({ quantity: 1, unitPrice: 1500, vatRate: 21, irpfRate: 15 }),
      lineAmounts({ quantity: 3, unitPrice: 33.33, vatRate: 21, irpfRate: 0 }),
      lineAmounts({ quantity: 10, unitPrice: 0.1, vatRate: 21, irpfRate: 0 }),
    ];
    const t = documentTotals(lines);
    expect(t).toEqual({ baseAmount: 1600.99, vatAmount: 336.21, irpfAmount: 225, totalAmount: 1712.2 });
    expect(round2(t.baseAmount + t.vatAmount - t.irpfAmount)).toBe(t.totalAmount);
  });
  it("documento vacío", () => {
    expect(documentTotals([])).toEqual({ baseAmount: 0, vatAmount: 0, irpfAmount: 0, totalAmount: 0 });
  });
});

describe("splitByPercent / splitEqually", () => {
  it("los vencimientos suman exactamente el total", () => {
    const parts = splitByPercent(1000, [33.33, 33.33, 33.34]);
    expect(parts).toEqual([333.3, 333.3, 333.4]);
    expect(round2(parts.reduce((s, x) => s + x, 0))).toBe(1000);
  });
  it("tres plazos iguales de 100 €", () => {
    const parts = splitByPercent(100, [100 / 3, 100 / 3, 100 / 3]);
    expect(round2(parts.reduce((s, x) => s + x, 0))).toBe(100);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
  });
  it("si los porcentajes no suman 100 no se fuerza el ajuste", () => {
    expect(splitByPercent(1000, [50, 30])).toEqual([500, 300]);
  });
  it("reparto por capítulos a partes iguales", () => {
    expect(splitEqually(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(splitEqually(10, 4)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(splitEqually(10, 0)).toEqual([]);
  });
});

describe("poRemaining", () => {
  it("disponible y porcentaje facturado", () => {
    expect(poRemaining(4000, 3720)).toEqual({ remaining: 280, overInvoiced: 0, percent: 93 });
  });
  it("PO sobrefacturada", () => {
    expect(poRemaining(1000, 1210)).toEqual({ remaining: 0, overInvoiced: 210, percent: 121 });
  });
  it("PO sin base", () => {
    expect(poRemaining(0, 0)).toEqual({ remaining: 0, overInvoiced: 0, percent: 0 });
  });
});
