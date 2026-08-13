// ─────────────────────────────────────────────────────────────────────────────
// Formato .fwb ("Filma WorkBudget"): el archivo que exporta un borrador de
// Budgeting (ver app/budgeting) y que también se puede importar directamente
// en Accounting > Budget (app/project/[id]/accounting/budget/page.tsx), como
// alternativa al importador de Excel que ya existe ahí.
//
// Es JSON por dentro, con extensión propia. Guarda la jerarquía completa
// (Categoría → Capítulo → Cuenta → Detalle, "Cuenta" es BudgetingSubchapter
// en el modelo de datos) porque Budgeting sí la usa, pero Accounting > Budget
// no tiene más que 2 niveles: al importar ahí, cada Capítulo pasa a ser una
// CUENTA y cada Cuenta de Budgeting una SUBCUENTA, con su importe = suma de
// todas sus líneas de detalle. Las líneas no se importan como entidades
// propias, solo su suma.
// ─────────────────────────────────────────────────────────────────────────────

import { BudgetingCategoryDef } from "./budgeting";

export const FWB_VERSION = 3;
export const FWB_EXTENSION = ".fwb";

export interface FwbDetailLine {
  code: string;
  description: string;
  units: number;
  unit: string;
  multiplier: number;
  rate: number;
  total: number;
  notes?: string;
  tags?: string[];
  /** Si está puesta, la línea cuenta en el Subcapítulo indicado (por código) en vez del suyo propio (ver BudgetingLineRoute). */
  routedToSubchapterCode?: string | null;
}

export interface FwbSubchapter {
  code: string;
  description: string;
  detailLines: FwbDetailLine[];
}

export interface FwbChapter {
  code: string;
  description: string;
  subchapters: FwbSubchapter[];
}

export interface FwbCategoryBlock {
  id: string;
  code?: string;
  label: string;
  chapters: FwbChapter[];
}

export interface FwbFile {
  fwbVersion: number;
  exportedAt: string;
  name: string;
  currency: string;
  categoriesEnabled: boolean;
  categories: FwbCategoryBlock[];
}

export function isFwbFile(data: any): data is FwbFile {
  return !!data &&
    typeof data === "object" &&
    typeof data.fwbVersion === "number" &&
    Array.isArray(data.categories);
}

export function parseFwbText(text: string): FwbFile {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es un .fwb válido (JSON malformado)");
  }
  if (!isFwbFile(data)) throw new Error("El archivo no tiene el formato .fwb esperado");
  return data;
}

export function downloadFwb(fwb: FwbFile, filename: string) {
  const blob = new Blob([JSON.stringify(fwb, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(FWB_EXTENSION) ? filename : `${filename}${FWB_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}

interface LiteEntity { id: string; code: string; description: string; }
interface LiteLine {
  code: string; description: string; units: number; unit: string; multiplier: number; rate: number; total: number;
  notes?: string; tags?: string[]; routedTo?: { subchapterCode: string } | null;
}

/** Construye un .fwb a partir de los datos ya cargados de un borrador. */
export function buildFwbFromDraft(params: {
  name: string;
  currency: string;
  categoriesEnabled: boolean;
  categories: BudgetingCategoryDef[];
  chaptersByCategory: (categoryId: string | null) => LiteEntity[];
  subchaptersByChapter: Record<string, LiteEntity[]>;
  linesBySubchapter: Record<string, LiteLine[]>;
}): FwbFile {
  // Firestore no admite `undefined` como valor de campo (a diferencia de
  // JSON.stringify, que simplemente lo omite): por eso aquí todo lo opcional
  // se normaliza explícitamente a `null`/""/[] en vez de dejarlo pasar tal
  // cual, para que este mismo árbol sirva tanto para descargar un .fwb como
  // para guardarlo directamente en Firestore (plantillas).
  const cats = params.categoriesEnabled ? params.categories : [{ id: "all", label: "Cuentas" }];
  return {
    fwbVersion: FWB_VERSION,
    exportedAt: new Date().toISOString(),
    name: params.name,
    currency: params.currency,
    categoriesEnabled: params.categoriesEnabled,
    categories: cats.map((cat) => ({
      id: cat.id,
      ...(cat.code ? { code: cat.code } : {}),
      label: cat.label,
      chapters: params.chaptersByCategory(params.categoriesEnabled ? cat.id : null).map((chapter) => ({
        code: chapter.code,
        description: chapter.description,
        subchapters: (params.subchaptersByChapter[chapter.id] || []).map((sub) => ({
          code: sub.code,
          description: sub.description,
          detailLines: (params.linesBySubchapter[sub.id] || []).map((l) => ({
            code: l.code, description: l.description, units: l.units ?? 0, unit: l.unit || "",
            multiplier: l.multiplier ?? 0, rate: l.rate ?? 0, total: l.total ?? 0,
            notes: l.notes || "", tags: l.tags || [],
            routedToSubchapterCode: l.routedTo?.subchapterCode ?? null,
          })),
        })),
      })),
    })),
  };
}

export interface FlatAccountRow {
  code: string;
  description: string;
  type: "CUENTA" | "SUBCUENTA";
  budgeted: number;
  parentCode: string | null;
}

/**
 * Aplana un .fwb a filas CUENTA/SUBCUENTA, mismo shape que produce el
 * importador de Excel de Accounting > Budget (parseImportFile). Accounting
 * solo tiene dos niveles: cada Capítulo pasa a ser una CUENTA, y cada Cuenta
 * de Budgeting (el 3er nivel, "Subcapítulo" en el modelo de datos) una
 * SUBCUENTA con su importe = suma de todas sus líneas de detalle. Las
 * líneas de detalle no se importan como entidades propias, solo su suma.
 */
export function flattenFwbToAccountRows(fwb: FwbFile): FlatAccountRow[] {
  // Primera pasada: suma de cada Cuenta (Subcapítulo) por su código,
  // incluyendo las líneas redirigidas ("excl.") desde otra Cuenta hacia ella.
  const sumsByCode = new Map<string, number>();
  for (const block of fwb.categories) {
    for (const chapter of block.chapters) {
      for (const sub of chapter.subchapters) {
        if (!sumsByCode.has(sub.code)) sumsByCode.set(sub.code, 0);
        for (const line of sub.detailLines || []) {
          const targetCode = line.routedToSubchapterCode || sub.code;
          sumsByCode.set(targetCode, (sumsByCode.get(targetCode) || 0) + (line.total || 0));
        }
      }
    }
  }

  const rows: FlatAccountRow[] = [];
  for (const block of fwb.categories) {
    for (const chapter of block.chapters) {
      rows.push({ code: chapter.code, description: chapter.description, type: "CUENTA", budgeted: 0, parentCode: null });
      for (const sub of chapter.subchapters) {
        rows.push({
          code: sub.code,
          description: sub.description,
          type: "SUBCUENTA",
          budgeted: Math.round((sumsByCode.get(sub.code) || 0) * 100) / 100,
          parentCode: chapter.code,
        });
      }
    }
  }
  return rows;
}
