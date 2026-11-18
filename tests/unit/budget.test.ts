import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, storage: {} }));
import { actualBySubaccount, committedBySubaccount } from "@/lib/budgetTotals";
import { shouldCommitPO, shouldRealizeInvoice, shouldUncommitPO, type CostSettings } from "@/lib/budgetRules";

const onApprove: CostSettings = { poCommitmentTrigger: "on_approve", invoiceActualTrigger: "on_account" };
const onCreate: CostSettings = { poCommitmentTrigger: "on_create", invoiceActualTrigger: "on_code" };

describe("reglas de coste: POs", () => {
  it("compromete al aprobar (por defecto)", () => {
    expect(shouldCommitPO("approved", onApprove)).toBe(true);
    expect(shouldCommitPO("pending", onApprove)).toBe(false);
    expect(shouldCommitPO("draft", onApprove)).toBe(false);
  });
  it("compromete al crear si así se configura", () => {
    expect(shouldCommitPO("pending", onCreate)).toBe(true);
    expect(shouldCommitPO("cancelled", onCreate)).toBe(false);
  });
  it("una PO aprobada que se anula libera el comprometido", () => {
    expect(shouldUncommitPO("approved", "cancelled", onApprove)).toBe(true);
    expect(shouldUncommitPO("pending", "cancelled", onApprove)).toBe(false);
  });
});

describe("comprometido por subcuenta", () => {
  it("lo pendiente de facturar de cada línea de las POs aprobadas", () => {
    const pos = [
      { status: "approved", items: [
        { subAccountCode: "03.01", baseAmount: 4000, invoicedAmount: 1500 },
        { subAccountCode: "03.02", baseAmount: 600, invoicedAmount: 0 },
        { subAccountCode: "03.02", baseAmount: 200, invoicedAmount: 0, isClosed: true },
      ] },
      { status: "draft", items: [{ subAccountCode: "03.01", baseAmount: 999 }] },
      { status: "cancelled", items: [{ subAccountCode: "03.01", baseAmount: 999 }] },
    ];
    expect(committedBySubaccount(pos, onApprove)).toEqual({ "03.01": 2500, "03.02": 600 });
  });
  it("nunca negativo si se factura de más", () => {
    expect(committedBySubaccount([{ status: "approved", items: [{ subAccountCode: "04", baseAmount: 100, invoicedAmount: 150 }] }], onApprove)).toEqual({ "04": 0 });
  });
  it("una PO en modificación sigue comprometiendo su versión anterior", () => {
    const po = { status: "draft", previousCommittedItems: [{ subAccountCode: "05", baseAmount: 800, invoicedAmount: 300 }], items: [{ subAccountCode: "05", baseAmount: 2000 }] };
    expect(committedBySubaccount([po], onApprove)).toEqual({ "05": 500 });
  });
});

describe("realizado por subcuenta", () => {
  const items = [{ subAccountCode: "03.01", baseAmount: 1000 }, { subAccountCode: "03.02", baseAmount: 250 }];
  it("al contabilizar (por defecto) solo cuentan las contabilizadas", () => {
    const invs = [
      { status: "submitted", accountedAt: new Date(), items },
      { status: "submitted", codedAt: new Date(), items },
      { status: "cancelled", accountedAt: new Date(), items },
    ];
    expect(actualBySubaccount(invs, onApprove)).toEqual({ "03.01": 1000, "03.02": 250 });
  });
  it("al codificar cuentan las codificadas", () => {
    const invs = [{ status: "submitted", codedAt: new Date(), items }, { status: "submitted", items }];
    expect(actualBySubaccount(invs, onCreate)).toEqual({ "03.01": 1000, "03.02": 250 });
  });
  it("las rechazadas o anuladas nunca cuentan", () => {
    expect(shouldRealizeInvoice("rejected", onCreate, { codedAt: new Date() })).toBe(false);
    expect(actualBySubaccount([{ status: "void", codedAt: new Date(), items }], onCreate)).toEqual({});
  });
});
