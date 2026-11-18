import { describe, expect, it } from "vitest";
import { advanceOutstanding, balanceOf, cashEffect, lineTotals, type CashMovement } from "@/lib/cashBox";

const mv = (p: Partial<CashMovement>): CashMovement => ({
  id: Math.random().toString(36).slice(2), floatId: "f1", type: "expense", number: "", date: "2026-11-18",
  description: "", amount: 0, status: "pending", createdAt: null, ...p,
});

describe("caja de efectivo", () => {
  it("efecto de cada movimiento sobre el efectivo", () => {
    expect(cashEffect(mv({ type: "funding", amount: 1000 }))).toBe(1000);
    expect(cashEffect(mv({ type: "advance", amount: 200 }))).toBe(-200);
    expect(cashEffect(mv({ type: "settlement", amount: 180 }))).toBe(0);
    expect(cashEffect(mv({ type: "return", amount: 20 }))).toBe(20);
    expect(cashEffect(mv({ type: "adjustment", amount: -1.5 }))).toBe(-1.5);
    // Reposición pedida a tesorería: no entra en caja hasta que llega
    expect(cashEffect(mv({ type: "funding", amount: 500, pendingFunding: true }))).toBe(0);
  });

  it("saldo: 1.000 − 200 − 50 + 18,50 = 768,50", () => {
    const movements = [
      mv({ type: "funding", amount: 1000 }),
      mv({ type: "advance", amount: 200 }),
      mv({ type: "expense", amount: 50 }),
      mv({ type: "return", amount: 18.5 }),
      mv({ type: "funding", amount: 300, pendingFunding: true }),
    ];
    expect(balanceOf(movements)).toBe(768.5);
  });

  it("pendiente de justificar de un anticipo", () => {
    const adv = mv({ id: "a1", type: "advance", amount: 200 });
    const rest = [
      mv({ type: "settlement", amount: 181.5, advanceId: "a1" }),
      mv({ type: "return", amount: 18.5, advanceId: "a1" }),
    ];
    expect(advanceOutstanding(adv, [adv, ...rest])).toBe(0);
    // Gastó más de lo anticipado y se le reembolsa la diferencia
    const over = [mv({ type: "settlement", amount: 230, advanceId: "a1" }), mv({ type: "reimbursement", amount: 30, advanceId: "a1" })];
    expect(advanceOutstanding(adv, [adv, ...over])).toBe(0);
  });

  it("totales de las líneas de un ticket", () => {
    const lines = [
      { subAccountCode: "03.02", subAccountDescription: "", description: "", baseAmount: 10.33, vatRate: 21, vatAmount: 2.17 },
      { subAccountCode: "08.03", subAccountDescription: "", description: "", baseAmount: 5.45, vatRate: 10, vatAmount: 0.55 },
    ];
    expect(lineTotals(lines)).toEqual({ base: 15.78, vat: 2.72, total: 18.5 });
  });
});
