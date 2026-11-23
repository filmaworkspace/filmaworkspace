// Cliente de la demo: cambia el perfil con el que el usuario demo ve su
// proyecto de ejemplo (validado en el servidor).
import { auth } from "@/lib/firebase";
import type { DemoRoleKey } from "@/lib/demoRoles";

export async function setDemoRole(role: DemoRoleKey) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/demo/role", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ role }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se ha podido cambiar el perfil");
}
