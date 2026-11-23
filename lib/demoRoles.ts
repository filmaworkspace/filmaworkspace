// Perfiles con los que se puede ver la demo: al terminar la intro se elige uno
// y el usuario demo pasa a tener ese rol en su proyecto de ejemplo.

export type DemoRoleKey = "pm" | "controller" | "hod" | "crew";

export const DEMO_ROLES: Record<DemoRoleKey, {
  label: string; note: string;
  member: { role: string | null; department: string | null; position: string | null; permissions: { config: boolean; accounting: boolean; team: boolean }; accountingAccessLevel: string; boxAccess: boolean };
}> = {
  pm: {
    label: "PM", note: "Dirige la producción. Lo ve y lo decide todo.",
    member: { role: "PM", department: null, position: null, permissions: { config: true, accounting: true, team: true }, accountingAccessLevel: "accounting_extended", boxAccess: true },
  },
  controller: {
    label: "Controller", note: "Lleva la contabilidad del proyecto.",
    member: { role: "Controller", department: null, position: null, permissions: { config: false, accounting: true, team: false }, accountingAccessLevel: "accounting_extended", boxAccess: true },
  },
  hod: {
    label: "Jefatura de Arte", note: "Gestiona y aprueba lo de su departamento.",
    member: { role: null, department: "Arte", position: "HOD", permissions: { config: false, accounting: true, team: true }, accountingAccessLevel: "user", boxAccess: false },
  },
  crew: {
    label: "Crew de Arte", note: "Pide lo que necesita y sigue sus documentos.",
    member: { role: null, department: "Arte", position: "Crew", permissions: { config: false, accounting: true, team: false }, accountingAccessLevel: "user", boxAccess: false },
  },
};

export const DEMO_ROLE_ORDER: DemoRoleKey[] = ["pm", "controller", "hod", "crew"];

export function demoRoleOf(m: { role?: string | null; position?: string | null } | null | undefined): DemoRoleKey {
  if (!m) return "pm";
  if (m.role === "Controller") return "controller";
  if (m.role) return "pm";
  if (m.position === "HOD") return "hod";
  if (m.position === "Crew") return "crew";
  return "pm";
}
