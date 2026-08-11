// ─────────────────────────────────────────────────────────────────────────────
// Formato .fwb ("Filma WorkBudget"): el archivo que exporta un borrador de
// Budgeting (ver app/budgeting) y que también se puede importar directamente
// en Accounting > Budget (app/project/[id]/accounting/budget/page.tsx), como
// alternativa al importador de Excel que ya existe ahí.
//
// Es JSON por dentro, con extensión propia. Guarda las categorías (Above the
// Line / Below the Line...) porque Budgeting sí las usa para el Top Sheet,
// pero Accounting > Budget no tiene ese concepto — al importar ahí solo se
// preservan las Cuentas (con su código y descripción) y las Detail Lines
// (con su código, descripción y total), aplanadas a filas CUENTA/SUBCUENTA
// como ya hace el importador de Excel existente.
// ─────────────────────────────────────────────────────────────────────────────

export const FWB_VERSION = 1;
export const FWB_EXTENSION = ".fwb";

export type FwbCategory = "atl" | "btl_production" | "btl_post" | "other";

export const FWB_CATEGORIES: FwbCategory[] = ["atl", "btl_production", "btl_post", "other"];

export interface FwbDetailLine {
  code: string;
  description: string;
  units: number;
  multiplier: number;
  rate: number;
  total: number;
}

export interface FwbAccount {
  code: string;
  description: string;
  detailLines: FwbDetailLine[];
}

export interface FwbFile {
  fwbVersion: number;
  exportedAt: string;
  name: string;
  currency: string;
  categories: Record<FwbCategory, FwbAccount[]>;
}

export function isFwbFile(data: any): data is FwbFile {
  return !!data &&
    typeof data === "object" &&
    typeof data.fwbVersion === "number" &&
    typeof data.categories === "object" &&
    data.categories !== null;
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
 * categorías son solo agrupación visual de Budgeting — no se preservan aquí,
 * cada Cuenta pasa a ser una CUENTA y cada Detail Line una SUBCUENTA con su
 * propio código, el mismo que luego se elige en una PO.
 */
export function flattenFwbToAccountRows(fwb: FwbFile): FlatAccountRow[] {
  const rows: FlatAccountRow[] = [];
  for (const category of FWB_CATEGORIES) {
    const accounts = fwb.categories[category] || [];
    for (const account of accounts) {
      rows.push({ code: account.code, description: account.description, type: "CUENTA", budgeted: 0, parentCode: null });
      for (const line of account.detailLines || []) {
        rows.push({ code: line.code, description: line.description, type: "SUBCUENTA", budgeted: line.total || 0, parentCode: account.code });
      }
    }
  }
  return rows;
}
