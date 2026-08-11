// ─────────────────────────────────────────────────────────────────────────────
// Formato .fwb ("Filma WorkBudget"): el archivo que exporta un borrador de
// Budgeting (ver app/budgeting) y que también se puede importar directamente
// en Accounting > Budget (app/project/[id]/accounting/budget/page.tsx), como
// alternativa al importador de Excel que ya existe ahí.
//
// Es JSON por dentro, con extensión propia. Guarda la jerarquía completa
// (Categoría → Capítulo → Subcapítulo → Detalle) porque Budgeting sí la usa,
// pero Accounting > Budget no tiene más que 2 niveles: al importar ahí, cada
// Subcapítulo pasa a ser una CUENTA (es el que agrupa Detail Lines
// directamente) y cada Detalle una SUBCUENTA con su propio código — el mismo
// que luego se elige en una PO.
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
  supplier?: string;
  notes?: string;
  tags?: string[];
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
interface LiteLine { code: string; description: string; units: number; unit: string; multiplier: number; rate: number; total: number; supplier?: string; notes?: string; tags?: string[]; }

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
  const cats = params.categoriesEnabled ? params.categories : [{ id: "all", label: "Cuentas" }];
  return {
    fwbVersion: FWB_VERSION,
    exportedAt: new Date().toISOString(),
    name: params.name,
    currency: params.currency,
    categoriesEnabled: params.categoriesEnabled,
    categories: cats.map((cat) => ({
      id: cat.id,
      code: cat.code,
      label: cat.label,
      chapters: params.chaptersByCategory(params.categoriesEnabled ? cat.id : null).map((chapter) => ({
        code: chapter.code,
        description: chapter.description,
        subchapters: (params.subchaptersByChapter[chapter.id] || []).map((sub) => ({
          code: sub.code,
          description: sub.description,
          detailLines: (params.linesBySubchapter[sub.id] || []).map((l) => ({
            code: l.code, description: l.description, units: l.units, unit: l.unit,
            multiplier: l.multiplier, rate: l.rate, total: l.total,
            supplier: l.supplier, notes: l.notes, tags: l.tags,
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
 * importador de Excel de Accounting > Budget (parseImportFile). Cada
 * Subcapítulo pasa a ser una CUENTA (agrupa Detail Lines directamente) y
 * cada Detalle una SUBCUENTA con su propio código.
 */
export function flattenFwbToAccountRows(fwb: FwbFile): FlatAccountRow[] {
  const rows: FlatAccountRow[] = [];
  for (const block of fwb.categories) {
    for (const chapter of block.chapters) {
      for (const sub of chapter.subchapters) {
        rows.push({ code: sub.code, description: sub.description, type: "CUENTA", budgeted: 0, parentCode: null });
        for (const line of sub.detailLines || []) {
          rows.push({ code: line.code, description: line.description, type: "SUBCUENTA", budgeted: line.total || 0, parentCode: sub.code });
        }
      }
    }
  }
  return rows;
}
