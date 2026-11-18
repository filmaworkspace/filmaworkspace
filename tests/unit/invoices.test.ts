import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endOfThisWeek, getInvoiceDisplayState, inInvoiceView } from "@/lib/invoiceHelpers";
import { matchAmount } from "@/lib/search";

describe("estado visible de una factura", () => {
  it("prioridad: pagada > contabilizada > codificada > aprobada", () => {
    const now = new Date();
    expect(getInvoiceDisplayState({ status: "submitted", approvedAt: now, codedAt: now, paidAt: now })).toBe("paid");
    expect(getInvoiceDisplayState({ status: "submitted", approvedAt: now, accountedAt: now })).toBe("accounted");
    expect(getInvoiceDisplayState({ status: "submitted", approvedAt: now })).toBe("approved");
  });
  it("vencida si está recibida y pasó el vencimiento", () => {
    expect(getInvoiceDisplayState({ status: "submitted", dueDate: new Date("2020-01-01") })).toBe("overdue");
    expect(getInvoiceDisplayState({ status: "cancelled", dueDate: new Date("2020-01-01") })).toBe("cancelled");
  });
});

describe("circuito de facturas del panel", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T10:00:00")); }); // miércoles
  afterEach(() => vi.useRealTimers());

  it("la semana termina el domingo a las 23:59", () => {
    const end = endOfThisWeek();
    expect(end.getDay()).toBe(0);
    expect(end.getDate()).toBe(22);
    expect(end.getHours()).toBe(23);
  });
  it("vencen esta semana: sin pagar y con vencimiento hasta el domingo (incluidas las vencidas)", () => {
    expect(inInvoiceView("semana", "submitted", new Date("2026-11-22T12:00:00"))).toBe(true);
    expect(inInvoiceView("semana", "overdue", new Date("2026-11-10"))).toBe(true);
    expect(inInvoiceView("semana", "submitted", new Date("2026-11-23"))).toBe(false);
    expect(inInvoiceView("semana", "paid", new Date("2026-11-20"))).toBe(false);
    expect(inInvoiceView("semana", "cancelled", new Date("2026-11-20"))).toBe(false);
  });
  it("recibidas, aprobadas y pagadas", () => {
    expect(inInvoiceView("recibidas", "overdue")).toBe(true);
    expect(inInvoiceView("aprobadas", "coded")).toBe(true);
    expect(inInvoiceView("aprobadas", "submitted")).toBe(false);
    expect(inInvoiceView("pagadas", "paid")).toBe(true);
  });
});

describe("búsqueda por importe", () => {
  it("importe exacto en formato español", () => {
    expect(matchAmount("1.452,00", 1452)).toBe(true);
    expect(matchAmount("1452", 1452.4)).toBe(true);
    expect(matchAmount("1452", 1453)).toBe(false);
  });
  it("comparaciones y rangos", () => {
    expect(matchAmount(">1000", 1000.01)).toBe(true);
    expect(matchAmount("<=500", 500)).toBe(true);
    expect(matchAmount("1000-2000", 1500)).toBe(true);
    expect(matchAmount("2000-1000", 2500)).toBe(false);
  });
  it("texto que no es un importe", () => {
    expect(matchAmount("rental", 100)).toBeNull();
  });
});
