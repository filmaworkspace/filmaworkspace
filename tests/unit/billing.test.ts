import { describe, expect, it } from "vitest";
import {
  counterKey, DEFAULT_SETTINGS, invoiceMonths, invoiceTotals, monthsLabel, numberingRule, phaseMonthlyBase, phaseSchedule, phasesToLines,
  quoteGrandTotal, quoteMonths, renderNumber, type QuotePhase,
} from "@/lib/billing";

const line = (unitPrice: number, quantity = 1, vatRate = 21) => ({ id: Math.random().toString(36).slice(2), description: "Licencia", quantity, unitPrice, vatRate });
const phases: QuotePhase[] = [
  { id: "pre", name: "Preproducción", months: 2, lines: [line(500)] },
  { id: "rod", name: "Rodaje", months: 3, lines: [line(1000), line(200)] },
  { id: "post", name: "Postproducción", months: 1, lines: [line(300)] },
];

describe("numeración", () => {
  it("sin ajustes da la clásica F2026-0001 con el contador de siempre", () => {
    const r = numberingRule(DEFAULT_SETTINGS, "invoice");
    expect(renderNumber(r, "2026-11-23", 1)).toBe("F2026-0001");
    expect(counterKey(r, 2026)).toBe("F-2026");
  });
  it("respeta las series antiguas", () => {
    expect(numberingRule({ ...DEFAULT_SETTINGS, quotePrefix: "PRE" }, "quote").prefix).toBe("PRE");
  });
  it("formato, dígitos y mes", () => {
    const r = numberingRule({ ...DEFAULT_SETTINGS, numbering: { invoice: { prefix: "FW", format: "{SERIE}-{AA}{MM}/{N}", digits: 3 } } }, "invoice");
    expect(renderNumber(r, "2027-03-05", 42)).toBe("FW-2703/042");
  });
  it("sin reinicio anual usa un único contador", () => {
    const r = numberingRule({ ...DEFAULT_SETTINGS, numbering: { invoice: { reset: "never" } } }, "invoice");
    expect(counterKey(r, 2026)).toBe(counterKey(r, 2027));
  });
  it("un formato sin {N} vuelve al de por defecto", () => {
    const r = numberingRule({ ...DEFAULT_SETTINGS, numbering: { invoice: { format: "{SERIE}{AAAA}" } } }, "invoice");
    expect(renderNumber(r, "2026-01-01", 7)).toBe("F2026-0007");
  });
});

describe("presupuesto por fases", () => {
  it("líneas = cuota mensual × meses de cada fase, y el total es el del proyecto", () => {
    const lines = phasesToLines(phases);
    expect(lines).toHaveLength(4);
    expect(lines[0].quantity).toBe(2);
    expect(lines[0].description).toBe("Preproducción · Licencia");
    const t = invoiceTotals(lines);
    expect(t.baseAmount).toBe(500 * 2 + 1200 * 3 + 300);
    expect(quoteGrandTotal({ billingMode: "phases", months: 6, ...t })).toEqual({ base: t.baseAmount, total: t.totalAmount });
  });
  it("cada mes cae en su fase, en orden y cruzando el año", () => {
    const s = phaseSchedule({ startMonth: "2026-11", phases });
    expect(s.map((x) => x.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]);
    expect(s.map((x) => x.phase.id)).toEqual(["pre", "pre", "rod", "rod", "rod", "post"]);
    expect(quoteMonths({ billingMode: "phases", phases, startMonth: "2026-11", months: null })).toHaveLength(6);
  });
  it("cuota de una fase", () => {
    expect(phaseMonthlyBase(phases[1])).toBe(1200);
  });
});

describe("meses de una factura", () => {
  it("una factura puede agrupar varios meses", () => {
    expect(invoiceMonths({ periodMonth: "2027-01", periodMonths: ["2027-01", "2027-02"] })).toEqual(["2027-01", "2027-02"]);
    expect(invoiceMonths({ periodMonth: "2027-01", periodMonths: null })).toEqual(["2027-01"]);
    expect(monthsLabel(["2027-02", "2027-01"])).toContain("2 meses");
  });
});
