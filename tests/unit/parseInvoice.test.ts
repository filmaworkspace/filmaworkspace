import { describe, expect, it } from "vitest";
import { parseAmount, parseInvoiceText, validIban, validTaxId } from "@/lib/ocr/parseInvoice";

const TEXT = `RENTAL NORTE S.L.
CIF: B-12345674
C/ Mayor 5, 28001 Madrid
FACTURA Nº: RN-2026/0142
Fecha factura: 14/11/2026
Cliente: Lumen Films S.L.  NIF B12345678
Concepto                      Importe
Alquiler cámara ARRI 5 días   1.200,00 €
Base imponible                1.200,00 €
IVA 21%                         252,00 €
TOTAL FACTURA                 1.452,00 €
Vencimiento: 14/12/2026
IBAN: ES91 2100 0418 4502 0005 1332`;

const get = (f: string) => parseInvoiceText(TEXT, { exclude: ["B12345678"] }).find((p) => p.field === f);

describe("lectura de facturas", () => {
  it("importes en formato español y anglosajón", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1234,5")).toBe(1234.5);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("252.00")).toBe(252);
  });
  it("valida NIF/CIF e IBAN", () => {
    expect(validTaxId("12345678Z")).toBe(true);
    expect(validTaxId("12345678A")).toBe(false);
    expect(validIban("ES9121000418450200051332")).toBe(true);
    expect(validIban("ES9121000418450200051333")).toBe(false);
  });
  it("propone los datos de la factura", () => {
    expect(get("supplierNumber")?.value).toBe("RN-2026/0142");
    expect(get("invoiceDate")?.value).toBe("2026-11-14");
    expect(get("dueDate")?.value).toBe("2026-12-14");
    expect(get("baseAmount")?.value).toBe(1200);
    expect(get("vatRate")?.value).toBe(21);
    expect(get("vatAmount")?.value).toBe(252);
    expect(get("totalAmount")?.value).toBe(1452);
    expect(get("totalAmount")?.confidence).toBe("alta");
    expect(get("supplierIban")?.value).toBe("ES9121000418450200051332");
  });
  it("no propone nuestro propio NIF como el del proveedor", () => {
    expect(get("supplierTaxId")?.value).not.toBe("B12345678");
  });
});
