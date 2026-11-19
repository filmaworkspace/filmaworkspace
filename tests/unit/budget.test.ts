import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, storage: {} }));
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

