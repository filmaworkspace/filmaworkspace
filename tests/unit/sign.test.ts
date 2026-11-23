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

import { classifySignUsage } from "@/lib/sign/usage";
import { signUsageLines, signUsagePrices, DEFAULT_SETTINGS, invoiceTotals } from "@/lib/billing";

describe("Filma Sign por uso", () => {
  const t = (s: string) => new Date(s).getTime();
  const now = t("2026-12-15T12:00:00");
  const rows = [
    { id: "a", title: "A", status: "completed" as const, completedAt: t("2026-11-10T10:00:00"), expiresAt: t("2026-12-30"), events: [] },
    { id: "b", title: "B", status: "completed" as const, completedAt: t("2026-10-30T10:00:00"), expiresAt: t("2026-12-30"), events: [] },
    { id: "c", title: "C", status: "declined" as const, completedAt: null, expiresAt: t("2026-12-30"), events: [{ at: t("2026-11-20T09:00:00"), type: "declined" as const }] },
    { id: "d", title: "D", status: "pending" as const, completedAt: null, expiresAt: t("2026-11-25T00:00:00"), events: [] },
    { id: "e", title: "E", status: "pending" as const, completedAt: null, expiresAt: t("2026-12-28T00:00:00"), events: [] },
    { id: "f", title: "F", status: "cancelled" as const, completedAt: null, expiresAt: t("2026-11-25"), events: [] },
  ];
  it("cuenta firmados y caducados/rechazados del periodo; no los cancelados ni los vivos", () => {
    const u = classifySignUsage(rows, "2026-11", "2026-11", new Set(), now);
    expect(u.signed.map((x) => x.id)).toEqual(["a"]);
    expect(u.expired.map((x) => x.id).sort()).toEqual(["c", "d"]);
  });
  it("no vuelve a contar lo ya facturado", () => {
    const u = classifySignUsage(rows, "2026-10", "2026-11", new Set(["a", "c"]), now);
    expect(u.signed.map((x) => x.id)).toEqual(["b"]);
    expect(u.expired.map((x) => x.id)).toEqual(["d"]);
  });
  it("las líneas usan el precio del presupuesto y si no el de ajustes", () => {
    const quoteLines = signUsageLines({ signed: 20, expired: 2 }, { signed: 3, expired: 1 }, 21);
    expect(signUsagePrices(quoteLines, DEFAULT_SETTINGS)).toEqual({ signed: 3, expired: 1 });
    expect(signUsagePrices(null, { ...DEFAULT_SETTINGS, signPricePerSigned: 4, signPricePerExpired: 2 })).toEqual({ signed: 4, expired: 2 });
    expect(invoiceTotals(signUsageLines({ signed: 7, expired: 3 }, { signed: 3, expired: 1 }, 21)).baseAmount).toBe(24);
  });
});
