import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, computeLine, checkLines, defaultWindow, ibanValid, migrateLegacyMonth, personFromDocs, personWindow, readSettings, windowFor, windowWarnings,
  type MonthDays, type PayrollRun,
} from "@/lib/payroll/model";

const s = DEFAULT_SETTINGS; // dietas y medios cortan el 20; días y pluses a mes natural

describe("ventanas de corte", () => {
  it("corte el día 20: del 21 del mes anterior al 20", () => {
    expect(defaultWindow("2026-10", { mode: "day", day: 20 })).toEqual({ from: "2026-09-21", to: "2026-10-20" });
    expect(defaultWindow("2026-03", { mode: "day", day: 20 })).toEqual({ from: "2026-02-21", to: "2026-03-20" });
    expect(defaultWindow("2026-01", { mode: "day", day: 20 })).toEqual({ from: "2025-12-21", to: "2026-01-20" });
  });
  it("mes natural", () => {
    expect(defaultWindow("2026-02", { mode: "natural", day: 20 })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("la última nómina a mes entero y la siguiente empieza donde terminó la anterior", () => {
    const runs: Record<string, PayrollRun> = {
      "2026-10": { key: "2026-10", status: "sent", windows: { dietas: { to: "2026-10-31" } } },
      "2026-11": { key: "2026-11", status: "draft" },
    };
    expect(windowFor("2026-10", "dietas", runs, s)).toEqual({ from: "2026-09-21", to: "2026-10-31" });
    expect(windowFor("2026-11", "dietas", runs, s)).toEqual({ from: "2026-11-01", to: "2026-11-20" });
    expect(windowWarnings("2026-11", runs, s)).toEqual([]);
  });
  it("avisa de huecos y solapes", () => {
    const runs: Record<string, PayrollRun> = {
      "2026-10": { key: "2026-10", status: "sent" },
      "2026-11": { key: "2026-11", status: "draft", windows: { dietas: { from: "2026-10-25" } } },
    };
    expect(windowWarnings("2026-11", runs, s)[0]).toMatch(/4 días quedan sin liquidar/);
    runs["2026-11"].windows = { dietas: { from: "2026-10-15" } };
    expect(windowWarnings("2026-11", runs, s)[0]).toMatch(/6 días se liquidan dos veces/);
  });
  it("fin propio de una persona: la siguiente nómina no repite sus días", () => {
    const runs: Record<string, PayrollRun> = {
      "2026-10": { key: "2026-10", status: "sent", people: { a: { to: "2026-10-27" } } },
      "2026-11": { key: "2026-11", status: "draft" },
    };
    expect(personWindow("2026-10", "dietas", "a", runs, s)).toEqual({ from: "2026-09-21", to: "2026-10-27" });
    expect(personWindow("2026-11", "dietas", "a", runs, s)).toEqual({ from: "2026-10-28", to: "2026-11-20" });
    expect(personWindow("2026-11", "dietas", "b", runs, s)).toEqual({ from: "2026-10-21", to: "2026-11-20" });
  });
});

describe("cálculo de la línea", () => {
  const person = personFromDocs("a", { firstName: "Lucía", lastName1: "Pena", dni: "1X", startDate: "2026-10-10", salaryType: "monthly", salaryAmount: 3000, irpfRate: 15 }, {});
  const days: Record<string, MonthDays> = {
    "2026-09": { a: { "25": { w: 1, comida: 1 } } },
    "2026-10": { a: { "15": { w: 1, comida: 1, km: 100 }, "22": { w: 1, comida: 1, horasExtra: 2, comp: 1 } } },
  };
  it("mensual prorrateado por días de alta menos compensación; comidas con corte", () => {
    const l = computeLine("2026-10", person, {}, days, s);
    expect(l.daysAlta).toBe(22);
    expect(l.comp).toBe(1);
    expect(l.gross).toBe(2100); // 3000/30 * (22-1)
    // Comidas 21 sep a 20 oct: el 25 sep y el 15 oct (el 22 va a noviembre)
    expect(l.amounts["217"]).toBe(30);
    expect(l.amounts["698"]).toBe(26);
    expect(l.totalGross).toBe(2156);
  });
  it("semanal y diario por días trabajados; cerrado íntegro", () => {
    const w = { ...person, periodicity: "Semanal" as const, salary: 700 };
    expect(computeLine("2026-10", w, {}, days, s).gross).toBe(200); // 700/7 * 2
    const c = { ...person, periodicity: "Cerrado" as const, salary: 5000 };
    expect(computeLine("2026-10", c, {}, days, s).gross).toBe(5000);
  });
  it("especie se descuenta automáticamente y suma en descuentos", () => {
    const runs: Record<string, PayrollRun> = { "2026-10": { key: "2026-10", status: "draft", people: { a: { amounts: { "269": 50, "723": 200 } } } } };
    const l = computeLine("2026-10", person, runs, days, s);
    expect(l.inKind).toBe(50);
    expect(l.totalDiscounts).toBe(250);
  });
  it("incidencias", () => {
    const bad = personFromDocs("b", { firstName: "X", dni: "1X", bankAccount: "ES00 0000" }, {});
    const lines = [computeLine("2026-10", person, {}, days, s), computeLine("2026-10", bad, {}, days, s)];
    checkLines("2026-10", lines, days);
    expect(lines[1].issues).toEqual(expect.arrayContaining(["Falta apellidos", "Falta alta en SS", "DNI duplicado", "IBAN no válido"]));
    expect(lines[0].issues).toContain("DNI duplicado");
  });
});

it("IBAN con dígito de control", () => {
  expect(ibanValid("ES91 2100 0418 4502 0005 1332")).toBe(true);
  expect(ibanValid("ES92 2100 0418 4502 0005 1332")).toBe(false);
});

it("lee la configuración anterior y migra los días", () => {
  const st = readSettings({ mealRate: 12, carRate: 30 });
  expect(st.items.find((i) => i.id === "comida")!.rate).toBe(12);
  expect(st.items.find((i) => i.id === "coche")!.active).toBe(true);
  expect(migrateLegacyMonth({ a: { "3": { meals: true, perDiem: true, workedOverride: true, car: false } } })).toEqual({ a: { "03": { comida: 1, dieta: 1, w: 1 } } });
});

import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { fillTemplate } from "@/lib/payroll/exportXlsx";

it("rellena la plantilla del cuadro sin tocar las fórmulas", () => {
  const tpl = new Uint8Array(readFileSync("public/templates/cuadro-nominas.xlsx"));
  const p = personFromDocs("a", { firstName: "Lucía", lastName1: "Pena", lastName2: "Mora", dni: "1X", department: "Arte", startDate: "2026-10-10", salaryType: "monthly", salaryAmount: 3000, irpfRate: 15, bankAccount: "ES9121000418450200051332" }, {});
  const l = computeLine("2026-10", p, {}, { "2026-10": { a: { "15": { w: 1, comida: 2 } } } }, s);
  const { bytes } = fillTemplate(tpl, { key: "2026-10", projectName: "La última marea", settings: s, lines: [l] });
  const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  expect(xml).toContain('<c r="C19" s="77" t="inlineStr"><is><t xml:space="preserve">Pena Mora</t></is></c>');
  expect(xml).toContain('<c r="S19" s="81" t="n"><v>3000</v></c>');
  expect(xml).toMatch(/<c r="AB19" s="\d+" t="n"><v>30<\/v><\/c>/);
  expect(xml).toMatch(/<c r="D6" s="5" t="inlineStr"><is><t xml:space="preserve">Octubre<\/t>/);
  expect(xml).toContain("<f>IF(OR(S19=&quot;&quot;,T19=&quot;&quot;)".replace(/&quot;/g, '"'));
  expect(xml).toMatch(/<c r="R19" s="105" t="n"><v>0.15<\/v>/);
});

it("festivo trabajado suma el plus; festivo no trabajado se cobra como día, sin plus", () => {
  const st = readSettings({ items: [{ id: "festivo", label: "Festivo", short: "F", unit: "day", code: 12, rate: 40, active: true }] });
  expect(st.items.find((i) => i.id === "festivo")!.label).toBe("Festivo trabajado");
  const p = personFromDocs("a", { firstName: "A", lastName1: "B", startDate: "2026-10-01", salaryType: "weekly", salaryAmount: 700 }, {});
  const days: Record<string, MonthDays> = { "2026-10": { a: { "12": { fnt: 1 }, "13": { w: 1, festivo: 1 }, "14": { w: 1 } } } };
  const l = computeLine("2026-10", p, {}, days, st);
  expect(l.worked).toBe(3);
  expect(l.holidaysOff).toBe(1);
  expect(l.gross).toBe(300);
  expect(l.amounts["12"]).toBe(40);
});
