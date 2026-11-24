import { describe, expect, it } from "vitest";
import { amountForms, matchReceipt, type ReceiptTarget } from "@/lib/payments/matchReceipts";

const T: ReceiptTarget[] = [
  { id: "a", supplier: "Rental Norte S.L.", amount: 1452, numbers: ["FAC-0001", "RN-2026/0142"] },
  { id: "b", supplier: "Catering Cocina Móvil S.L.", amount: 330, numbers: ["FAC-0002", "CM-77"] },
  { id: "c", supplier: "Luz Sur", amount: 1452, numbers: ["FAC-0003"] },
];

describe("justificantes de pago", () => {
  it("formatos de importe", () => {
    expect(amountForms(1452)).toContain("1.452,00");
    expect(amountForms(1452)).toContain("1452.00");
  });
  it("por número en el nombre del archivo", () => {
    expect(matchReceipt("Justificante_FAC-0002.pdf", "", T).itemId).toBe("b");
    expect(matchReceipt("transferencia fac0001.pdf", "", T).itemId).toBe("a");
  });
  it("por el contenido: número del proveedor e importe", () => {
    const r = matchReceipt("doc123.pdf", "Orden de transferencia\nBeneficiario: RENTAL NORTE SL\nConcepto: RN-2026/0142\nImporte: 1.452,00 EUR", T);
    expect(r.itemId).toBe("a");
    expect(r.reasons).toContain("importe");
  });
  it("no propone si hay empate", () => {
    expect(matchReceipt("doc.pdf", "Importe 1.452,00", T).itemId).toBeNull();
  });
  it("no repite un pago ya asignado", () => {
    expect(matchReceipt("FAC-0002.pdf", "", T, new Set(["b"])).itemId).toBeNull();
  });
});
