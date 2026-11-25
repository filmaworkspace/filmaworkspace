// ─── Cuadro de nóminas en la plantilla original ──────────────────────────────
// Se rellena la plantilla tal cual (public/templates/cuadro-nominas.xlsx):
// mismas columnas, códigos, formato y fórmulas. Solo se escriben las celdas de
// entrada; las fórmulas se recalculan al abrir el archivo.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { AMOUNT_COLUMNS, MONTHS_ES, PROJECT_CONCEPT_COLS, PROJECT_DISCOUNT_COLS, parseRunKey, projectKey, type Line, type PayrollSettings } from "./model";

export const TEMPLATE_URL = "/templates/cuadro-nominas.xlsx";
export const TEMPLATE_FIRST_ROW = 19;
export const TEMPLATE_LAST_ROW = 168;

type Val = string | number | null | undefined;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Número de serie de Excel para una fecha ISO. */
export const excelDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
};

function cellXml(ref: string, style: string, v: Val): string {
  const s = style ? ` s="${style}"` : "";
  if (v === null || v === undefined || v === "") return `<c r="${ref}"${s} t="n"></c>`;
  if (typeof v === "number") return `<c r="${ref}"${s} t="n"><v>${Number.isFinite(v) ? v : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

/** Aplica cambios {fila: {columna: valor}} a la hoja en una sola pasada. */
export function patchSheet(xml: string, edits: Map<number, Map<string, Val>>): string {
  return xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (whole, rs: string, attrs: string, body: string) => {
    const row = edits.get(Number(rs));
    if (!row) return whole;
    const pending = new Map(row);
    const newBody = body.replace(/<c r="([A-Z]+)(\d+)"((?:\s+[a-z]+="[^"]*")*)\s*(?:\/>|>[\s\S]*?<\/c>)/g, (cw: string, col: string, _r: string, cattrs: string) => {
      if (!pending.has(col)) return cw;
      const style = /\bs="(\d+)"/.exec(cattrs)?.[1] || "";
      const v = pending.get(col);
      pending.delete(col);
      return cellXml(`${col}${rs}`, style, v);
    });
    if (pending.size) console.warn("Celdas no encontradas en la plantilla", rs, [...pending.keys()]);
    return `<row r="${rs}"${attrs}>${newBody}</row>`;
  });
}

export interface ExportInput {
  key: string;
  projectName: string;
  notes?: string;
  sentDate?: string; // ISO
  settings: PayrollSettings;
  lines: Line[];
}

export function fillTemplate(template: Uint8Array, input: ExportInput): { bytes: Uint8Array; skipped: number } {
  const files = unzipSync(template);
  const path = "xl/worksheets/sheet1.xml";
  const xml = strFromU8(files[path]);
  const edits = new Map<number, Map<string, Val>>();
  const set = (r: number, c: string, v: Val) => { if (!edits.has(r)) edits.set(r, new Map()); edits.get(r)!.set(c, v); };

  const { y, m0 } = parseRunKey(input.key);
  set(2, "D", input.settings.company || null);
  set(3, "D", input.projectName || null);
  set(4, "D", input.notes || null);
  set(5, "D", y);
  set(6, "D", MONTHS_ES[m0]);
  set(7, "D", input.sentDate ? excelDate(input.sentDate) : null);
  set(11, "D", input.settings.baseMonth);
  set(12, "D", input.settings.baseWeek);

  // Conceptos y descuentos propios del proyecto
  input.settings.projectConcepts.forEach((pc, i) => {
    const col = PROJECT_CONCEPT_COLS[i];
    set(15, col, pc.code ?? null);
    if (pc.code == null && pc.label) set(18, col, pc.label);
  });
  input.settings.projectDiscounts.forEach((pc, i) => {
    const col = PROJECT_DISCOUNT_COLS[i];
    set(15, col, pc.code ?? null);
    if (pc.code == null && pc.label) set(18, col, pc.label);
  });

  const capacity = TEMPLATE_LAST_ROW - TEMPLATE_FIRST_ROW + 1;
  input.lines.slice(0, capacity).forEach((l, i) => {
    const r = TEMPLATE_FIRST_ROW + i, p = l.person;
    const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v);
    set(r, "C", p.lastNames); set(r, "D", p.firstName); set(r, "E", p.dni);
    set(r, "F", p.controlCode || null); set(r, "G", p.budgetAccount || null);
    set(r, "H", p.crewNumber || null); set(r, "I", p.periodId || null);
    set(r, "J", p.department || null); set(r, "K", p.role || null); set(r, "M", p.jobTitle || null);
    set(r, "N", p.iban ? p.iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim() : null);
    set(r, "O", p.startDate ? excelDate(p.startDate) : null);
    set(r, "P", p.endDateApprox ? excelDate(p.endDateApprox) : null);
    set(r, "Q", p.ssEndDate ? excelDate(p.ssEndDate) : null);
    set(r, "R", p.irpf != null ? p.irpf / 100 : null);
    set(r, "S", num(l.salaryUsed)); set(r, "T", p.periodicity || null);
    set(r, "V", l.worked || null); set(r, "W", l.comp || null);
    for (const c of AMOUNT_COLUMNS) set(r, c.col, num(l.amounts[String(c.code)]) || null);
    PROJECT_CONCEPT_COLS.forEach((col, k) => set(r, col, num(l.amounts[projectKey("p", k)]) || null));
    PROJECT_DISCOUNT_COLS.forEach((col, k) => set(r, col, num(l.amounts[projectKey("d", k)]) || null));
    set(r, "BQ", l.itDays || null);
    set(r, "CE", p.embargo ? "Sí" : "No");
    set(r, "CF", p.agreedHours ?? null);
    set(r, "CG", l.breakdown || null);
    set(r, "CI", l.comment || null);
  });

  files[path] = strToU8(patchSheet(xml, edits));
  return { bytes: zipSync(files, { level: 6 }), skipped: Math.max(0, input.lines.length - capacity) };
}

/** Descarga el cuadro desde el navegador. */
export async function downloadCuadro(input: ExportInput): Promise<number> {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("No se pudo cargar la plantilla del cuadro");
  const { bytes, skipped } = fillTemplate(new Uint8Array(await res.arrayBuffer()), input);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  const { y, m0 } = parseRunKey(input.key);
  a.href = URL.createObjectURL(blob);
  a.download = `Cuadro_Nominas_${MONTHS_ES[m0]}_${y}${input.projectName ? "_" + input.projectName.replace(/[^\p{L}\p{N}]+/gu, "_") : ""}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return skipped;
}
