// ─────────────────────────────────────────────────────────────────────────────
// Formato .fwb ("Filma WorkBudget"): el archivo que exporta un borrador de
// Budgeting (ver app/budgeting) y que también se puede importar directamente
// en Accounting > Budget (app/project/[id]/accounting/budget/page.tsx), como
// alternativa al importador de Excel que ya existe ahí.
//
// Es JSON por dentro, con extensión propia. Las categorías son dinámicas por
// borrador (id + label libres, o ninguna si el borrador las tiene
// desactivadas) — se guardan porque Budgeting sí las usa para el Top Sheet,
// pero Accounting > Budget no tiene ese concepto: al importar ahí solo se
// preservan las Cuentas (código y descripción) y las Detail Lines (código,
// descripción y total), aplanadas a filas CUENTA/SUBCUENTA.
// ─────────────────────────────────────────────────────────────────────────────

import { BudgetingCategoryDef } from "./budgeting";

export const FWB_VERSION = 2;
export const FWB_EXTENSION = ".fwb";

export interface FwbDetailLine {
  code: string;
  description: string;
  units: number;
  unit: string;
  multiplier: number;
  rate: number;
  total: number;
}

export interface FwbAccount {
  code: string;
  description: string;
  detailLines: FwbDetailLine[];
}

export interface FwbCategoryBlock {
  id: string;
  label: string;
  accounts: FwbAccount[];
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

/** Construye un .fwb a partir de los datos ya cargados de un borrador (ver app/budgeting/[draftId]/page.tsx). */
export function buildFwbFromDraft(params: {
  name: string;
  currency: string;
  categoriesEnabled: boolean;
  categories: BudgetingCategoryDef[];
  accountsByCategory: (categoryId: string | null) => { id: string; code: string; description: string }[];
  linesByAccount: Record<string, { code: string; description: string; units: number; unit: string; multiplier: number; rate: number; total: number }[]>;
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
      label: cat.label,
      accounts: params.accountsByCategory(params.categoriesEnabled ? cat.id : null).map((account) => ({
        code: account.code,
        description: account.description,
        detailLines: (params.linesByAccount[account.id] || []).map((l) => ({
          code: l.code, description: l.description, units: l.units, unit: l.unit, multiplier: l.multiplier, rate: l.rate, total: l.total,
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
 * importador de Excel de Accounting > Budget (parseImportFile). Las
 * categorías no se preservan aquí — cada Cuenta pasa a ser una CUENTA y cada
 * Detail Line una SUBCUENTA con su propio código, el mismo que luego se
 * elige en una PO.
 */
export function flattenFwbToAccountRows(fwb: FwbFile): FlatAccountRow[] {
  const rows: FlatAccountRow[] = [];
  for (const block of fwb.categories) {
    for (const account of block.accounts) {
      rows.push({ code: account.code, description: account.description, type: "CUENTA", budgeted: 0, parentCode: null });
      for (const line of account.detailLines || []) {
        rows.push({ code: line.code, description: line.description, type: "SUBCUENTA", budgeted: line.total || 0, parentCode: account.code });
      }
    }
  }
  return rows;
}
