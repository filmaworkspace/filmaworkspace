// Lista plana de quienes aprueban un documento (POs y facturas). Se guarda en
// el campo `approverIds` porque las reglas de Firestore no pueden recorrer
// `approvalSteps`: así un aprobador puede leer lo que tiene que aprobar aunque
// no sea de contabilidad ni de su departamento.
export function approverIdsOf(steps: { approvers?: string[] }[] | null | undefined): string[] {
  const ids = new Set<string>();
  for (const s of steps || []) for (const id of s.approvers || []) if (id) ids.add(id);
  return [...ids];
}
