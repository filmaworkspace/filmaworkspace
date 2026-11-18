// ─── Alcance de POs y facturas por usuario ───────────────────────────────────
// Las reglas de Firestore solo dejan leer a cada uno lo que le corresponde:
//   · contabilidad (nivel contabilidad / ampliado) y roles de proyecto: todo
//   · HOD y Coordinator: lo de su departamento
//   · resto: lo que han creado ellos y las facturas de sus POs
//   · y, además, cualquiera puede leer lo que tiene que aprobar (approverIds)
// Una consulta sobre toda la colección fallaría para quien no lo ve todo, así
// que aquí se lanzan consultas acotadas y se juntan los resultados.

import {
  getDocs, query, where,
  type CollectionReference, type QueryConstraint, type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";

export type DocScope =
  | { all: true }
  | { all: false; uid: string; department?: string | null };

export function scopeFromPermissions(p: {
  userId: string | null;
  canViewAllPOs: boolean;
  canViewDepartmentPOs: boolean;
  department: string | null;
}): DocScope {
  if (p.canViewAllPOs) return { all: true };
  return { all: false, uid: p.userId || "", department: p.canViewDepartmentPOs ? p.department : null };
}

/** Rol y nivel del miembro → alcance (misma lógica que las reglas). */
export function scopeFromMember(uid: string, m: { role?: string; position?: string; department?: string; accountingAccessLevel?: string } | null): DocScope {
  const role = m?.role || "";
  const level = m?.accountingAccessLevel || "user";
  if (["EP", "PM", "Controller", "PC"].includes(role) || level === "accounting" || level === "accounting_extended") return { all: true };
  const lead = m?.position === "HOD" || m?.position === "Coordinator";
  return { all: false, uid, department: lead ? m?.department || null : null };
}

/**
 * Documentos visibles de la colección. `constraints` solo se aplican cuando el
 * usuario lo ve todo; con alcance limitado se devuelve todo lo suyo y quien
 * llama debe filtrar y ordenar (sortByTime) en el cliente.
 */
export async function getScopedDocs(
  col: CollectionReference<DocumentData>,
  scope: DocScope,
  constraints: QueryConstraint[] = [],
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  if (scope.all) return (await getDocs(query(col, ...constraints))).docs;
  // Sin filtros extra (evita índices compuestos): quien llama filtra después.
  const queries = [
    query(col, where("createdBy", "==", scope.uid)),
    query(col, where("approverIds", "array-contains", scope.uid)),
    // Facturas de sus POs aunque las haya subido otra persona (contabilidad)
    query(col, where("poCreatedBy", "==", scope.uid)),
  ];
  if (scope.department) queries.push(query(col, where("department", "==", scope.department)));
  const results = await Promise.allSettled(queries.map((q) => getDocs(q)));
  const byId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  for (const r of results) if (r.status === "fulfilled") r.value.docs.forEach((d) => byId.set(d.id, d));
  return [...byId.values()];
}

/** Ordena instantáneas por un campo Timestamp/Date (desc por defecto). */
export function sortByTime<T extends { data: () => DocumentData }>(docs: T[], field = "createdAt", dir: "asc" | "desc" = "desc"): T[] {
  const t = (v: any) => (v?.toDate ? v.toDate().getTime() : v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) || 0 : 0);
  return docs.slice().sort((a, b) => (dir === "desc" ? t(b.data()[field]) - t(a.data()[field]) : t(a.data()[field]) - t(b.data()[field])));
}
