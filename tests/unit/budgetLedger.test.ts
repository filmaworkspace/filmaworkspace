import { describe, expect, it } from "vitest";
import { computeLedger, DEFAULT_LEDGER_SETTINGS as D, normalizeSettings, type LedgerSettings } from "@/lib/budgetLedger";

const po = (id: string, status: string, lines: [string, number, boolean?][], extra = {}) => ({
  id, number: id, status, items: lines.map(([code, base, closed]) => ({ subAccountCode: code, baseAmount: base, isClosed: !!closed })), ...extra,
});
const inv = (id: string, lines: [string, number, number?][], extra: Record<string, unknown> = {}) => ({
  id, status: "submitted", documentType: "invoice", items: lines.map(([code, base, idx]) => ({ subAccountCode: code, baseAmount: base, poItemIndex: idx })), ...extra,
});
const coded = { codedAt: 1 };
const S = (p: Partial<LedgerSettings> = {}) => ({ ...D, ...p });

/** Invariante: comprometido + realizado de lo que cuelga de una PO = base mientras esté abierta. */
const sum = (l: ReturnType<typeof computeLedger>, code: string) => (l.bySub[code]?.committed || 0) + (l.bySub[code]?.actual || 0);

describe("valores por defecto", () => {
  it("al aprobar la PO, al codificar la factura, al codificar el sobre, proformas realizan", () => {
    expect(D).toEqual({ poCommitmentTrigger: "on_approve", invoiceActualTrigger: "on_code", boxActualTrigger: "on_create", proformaRealizes: true });
    expect(normalizeSettings(null)).toEqual(D);
    expect(normalizeSettings({ invoiceActualTrigger: "on_paid", boxActualTrigger: "on_approve" })).toMatchObject({ invoiceActualTrigger: "on_account", boxActualTrigger: "on_create" });
  });
});

describe("POs → comprometido", () => {
  it("pendiente no compromete (al aprobar); aprobada sí", () => {
    expect(computeLedger({ pos: [po("a", "pending", [["01", 1000]])], invoices: [] }, S()).totals.committed).toBe(0);
    expect(computeLedger({ pos: [po("a", "pending", [["01", 1000]])], invoices: [] }, S({ poCommitmentTrigger: "on_create" })).totals.committed).toBe(1000);
    expect(computeLedger({ pos: [po("a", "approved", [["01", 1000]])], invoices: [] }, S()).bySub["01"].committed).toBe(1000);
  });
  it("borrador, rechazada y anulada sin facturas no comprometen", () => {
    for (const st of ["draft", "rejected", "cancelled"]) expect(computeLedger({ pos: [po("a", st, [["01", 1000]])], invoices: [] }, S()).totals.committed).toBe(0);
  });
});

describe("factura vinculada: sale del comprometido exactamente al realizarse", () => {
  const P = po("p", "approved", [["01", 1000], ["02", 500]]);
  it("factura sin codificar: sigue todo comprometido, nada realizado", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 400, 0]], { poId: "p" })] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 1000, actual: 0, box: 0 });
    expect(l.pos.p.invoiced).toBe(400);
    expect(l.pos.p.realized).toBe(0);
  });
  it("al codificarla: 400 pasan de comprometido a realizado (sin duplicar ni perder)", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 400, 0]], { poId: "p", ...coded })] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 600, actual: 400, box: 0 });
    expect(sum(l, "01")).toBe(1000);
  });
  it("con 'al contabilizar' codificar no basta", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 400, 0]], { poId: "p", ...coded })] }, S({ invoiceActualTrigger: "on_account" }));
    expect(l.bySub["01"]).toEqual({ committed: 1000, actual: 0, box: 0 });
    const l2 = computeLedger({ pos: [P], invoices: [inv("i", [["01", 400, 0]], { poId: "p", ...coded, accountedAt: 1 })] }, S({ invoiceActualTrigger: "on_account" }));
    expect(l2.bySub["01"]).toEqual({ committed: 600, actual: 400, box: 0 });
  });
  it("factura por encima de la PO: el comprometido no baja de 0 y el realizado es el real", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 1200, 0]], { poId: "p", ...coded })] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 0, actual: 1200, box: 0 });
    expect(l.issues.some((x) => x.kind === "over_invoiced")).toBe(true);
  });
  it("anular una factura realizada la devuelve al comprometido", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 400, 0]], { poId: "p", ...coded, status: "cancelled" })] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 1000, actual: 0, box: 0 });
  });
  it("la cuenta de la factura puede ser distinta: baja el comprometido de la línea de la PO", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["03", 300, 1]], { poId: "p", ...coded })] }, S());
    expect(l.bySub["02"].committed).toBe(200);
    expect(l.bySub["03"].actual).toBe(300);
  });
  it("línea sin índice: se asocia por cuenta", () => {
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["02", 100]], { poId: "p", ...coded })] }, S());
    expect(l.bySub["02"].committed).toBe(400);
  });
});

describe("cierres", () => {
  it("línea cerrada libera lo no facturado pero mantiene lo facturado pendiente de realizar", () => {
    const P = po("p", "approved", [["01", 1000, true]]);
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 300, 0]], { poId: "p" })] }, S());
    expect(l.bySub["01"].committed).toBe(300);
    const l2 = computeLedger({ pos: [P], invoices: [inv("i", [["01", 300, 0]], { poId: "p", ...coded })] }, S());
    expect(l2.bySub["01"]).toEqual({ committed: 0, actual: 300, box: 0 });
  });
  it("PO cerrada: igual", () => {
    const l = computeLedger({ pos: [po("p", "closed", [["01", 1000]])], invoices: [inv("i", [["01", 300, 0]], { poId: "p", ...coded })] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 0, actual: 300, box: 0 });
  });
  it("PO aprobada en modificación cuenta con su versión anterior", () => {
    const P = po("p", "pending", [["01", 2000]], { previousCommittedItems: [{ subAccountCode: "01", baseAmount: 1000 }] });
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 250, 0]], { poId: "p", ...coded })] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 750, actual: 250, box: 0 });
  });
});

describe("proformas", () => {
  const P = po("p", "approved", [["01", 1000]]);
  const prf = (extra = {}) => inv("prf", [["01", 400, 0]], { poId: "p", documentType: "proforma", ...coded, ...extra });
  it("si realizan: la proforma codificada realiza", () => {
    expect(computeLedger({ pos: [P], invoices: [prf()] }, S()).bySub["01"]).toEqual({ committed: 600, actual: 400, box: 0 });
  });
  it("si no realizan: queda comprometida hasta la definitiva", () => {
    expect(computeLedger({ pos: [P], invoices: [prf()] }, S({ proformaRealizes: false })).bySub["01"]).toEqual({ committed: 1000, actual: 0, box: 0 });
  });
  it("sustituida por factura nueva: nunca se cuentan las dos", () => {
    const fin = (extra = {}) => inv("fra", [["01", 400, 0]], { poId: "p", ...extra });
    // definitiva aún sin codificar: sigue contando la proforma
    let l = computeLedger({ pos: [P], invoices: [prf({ replacedByInvoiceId: "fra" }), fin()] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 600, actual: 400, box: 0 });
    expect(l.pos.p.invoiced).toBe(400);
    // definitiva codificada: cuenta solo la definitiva
    l = computeLedger({ pos: [P], invoices: [prf({ replacedByInvoiceId: "fra" }), fin(coded)] }, S());
    expect(l.bySub["01"]).toEqual({ committed: 600, actual: 400, box: 0 });
    expect(l.invoiceRealized).toEqual({ prf: false, fra: true });
  });
});

describe("caja", () => {
  const card = (status: string) => ({ id: "c" + status, status, subAccountCode: "05", baseAmount: 90, items: [{ subAccountCode: "05", baseAmount: 60 }, { subAccountCode: "06", baseAmount: 30 }] });
  it("tarjeta: al codificar (revisado) o al contabilizar; por líneas", () => {
    const input = { pos: [], invoices: [], cardExpenses: [card("pending"), card("reviewed"), card("accounted")] };
    expect(computeLedger(input, S()).totals.box).toBe(180);
    expect(computeLedger(input, S()).bySub["06"].box).toBe(60);
    expect(computeLedger(input, S({ boxActualTrigger: "on_account" })).totals.box).toBe(90);
  });
  it("transferencias: al codificar cuentan; al contabilizar solo con el sobre liquidado", () => {
    const input = {
      pos: [], invoices: [],
      transferEnvelopes: [{ id: "e1", status: "draft" }, { id: "e2", status: "settled" }],
      transferExpenses: [{ id: "t1", envelopeId: "e1", items: [{ subAccountCode: "07", baseAmount: 50 }] }, { id: "t2", envelopeId: "e2", items: [{ subAccountCode: "07", baseAmount: 20 }] }],
    };
    expect(computeLedger(input, S()).bySub["07"].box).toBe(70);
    expect(computeLedger(input, S({ boxActualTrigger: "on_account" })).bySub["07"].box).toBe(20);
  });
  it("efectivo", () => {
    const input = { pos: [], invoices: [], cashMovements: [
      { id: "m1", type: "expense", status: "reviewed", lines: [{ subAccountCode: "08", baseAmount: 10 }] },
      { id: "m2", type: "expense", status: "pending", lines: [{ subAccountCode: "08", baseAmount: 99 }] },
      { id: "m3", type: "funding", status: "reviewed", amount: 500 },
    ] };
    expect(computeLedger(input, S()).bySub["08"].box).toBe(10);
  });
});

describe("cuadre", () => {
  it("importes sin cuenta no se pierden", () => {
    const l = computeLedger({ pos: [], invoices: [inv("i", [["", 100]], coded)] }, S());
    expect(l.totals.actual).toBe(100);
    expect(l.issues[0].kind).toBe("no_account");
  });
  it("factura rechazada en aprobación no realiza aunque esté codificada", () => {
    expect(computeLedger({ pos: [], invoices: [inv("i", [["01", 100]], { ...coded, approvalStatus: "rejected" })] }, S()).totals.actual).toBe(0);
  });
});

describe("ítems como POs dentro de la PO", () => {
  it("pasarse en un ítem no quita comprometido a otro", () => {
    const P = po("p", "approved", [["01", 100], ["01", 900]]);
    const l = computeLedger({ pos: [P], invoices: [inv("i", [["01", 300, 0]], { poId: "p", ...coded })] }, S());
    expect(l.pos.p.lines.map((x) => x.committed)).toEqual([0, 900]);
    expect(l.bySub["01"]).toEqual({ committed: 900, actual: 300, box: 0 });
  });
  it("una línea puede realizar sobre un ítem de otra PO", () => {
    const A = po("a", "approved", [["01", 500]]), B = po("b", "approved", [["02", 800]]);
    const l = computeLedger({ pos: [A, B], invoices: [inv("i", [["01", 100, 0], ["02", 200]], { poId: "a", ...coded })].map((x) => ({ ...x, items: [x.items[0], { ...x.items[1], poId: "b", poItemIndex: 0 }] })) }, S());
    expect(l.pos.a.lines[0].committed).toBe(400);
    expect(l.pos.b.lines[0].committed).toBe(600);
  });
});
