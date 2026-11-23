// Perfiles de «Ver la demo como…»: el usuario demo cambia de rol en su proyecto
// de ejemplo para comprobar lo que ve cada uno.

export type DemoRoleKey = "pm" | "hod" | "crew" | "visitor";

export const DEMO_ROLES: Record<DemoRoleKey, {
  label: string; note: string;
  member: { role: string | null; department: string | null; position: string | null; permissions: { config: boolean; accounting: boolean; team: boolean }; accountingAccessLevel: string; boxAccess: boolean };
}> = {
  pm: {
    label: "PM", note: "Rol de proyecto con contabilidad ampliada: lo ves todo.",
    member: { role: "PM", department: null, position: null, permissions: { config: true, accounting: true, team: true }, accountingAccessLevel: "accounting_extended", boxAccess: true },
  },
  hod: {
    label: "Jefatura de Arte", note: "Ves las POs y facturas de Arte y apruebas lo que te toca.",
    member: { role: null, department: "Arte", position: "HOD", permissions: { config: false, accounting: true, team: true }, accountingAccessLevel: "user", boxAccess: false },
  },
  crew: {
    label: "Crew de Arte", note: "Solo ves las POs y facturas que creas tú.",
    member: { role: null, department: "Arte", position: "Crew", permissions: { config: false, accounting: true, team: false }, accountingAccessLevel: "user", boxAccess: false },
  },
  visitor: {
    label: "Visitante", note: "Solo el panel de contabilidad, en lectura.",
    member: { role: null, department: null, position: null, permissions: { config: false, accounting: true, team: false }, accountingAccessLevel: "visitor", boxAccess: false },
  },
};

export function demoRoleOf(m: { role?: string | null; position?: string | null; accountingAccessLevel?: string | null } | null | undefined): DemoRoleKey {
  if (!m) return "pm";
  if (m.role) return "pm";
  if (m.position === "HOD") return "hod";
  if (m.position === "Crew") return "crew";
  if (m.accountingAccessLevel === "visitor") return "visitor";
  return "pm";
}
