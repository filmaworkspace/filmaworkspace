"use client";

// Cambiar el rol global de un usuario (usuario / admin / agente de soporte).
import { useEffect, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Button, Field, Modal, Select } from "@/components/ds";
import { AdminUser } from "./AdminData";

const SPECIALTY: Record<string, string> = { sales: "Ventas", technical: "Técnico", both: "Ventas y técnico" };

export function RoleModal({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: (msg: string) => void }) {
  const { user: me } = useUser();
  const [role, setRole] = useState("user");
  const [specialty, setSpecialty] = useState("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (user) { setRole(user.role); setSpecialty(user.supportSpecialty || "both"); setError(""); } }, [user]);
  if (!user) return null;

  const save = async () => {
    setBusy(true); setError("");
    try {
      await updateDoc(doc(db, "users", user.id), { role, supportSpecialty: role === "support_agent" ? specialty : null });
      addDoc(collection(db, "adminAuditLog"), {
        action: "user_role_changed",
        details: `${user.name}: ${user.role} → ${role}${role === "support_agent" ? ` (${SPECIALTY[specialty]})` : ""}`,
        adminId: me?.uid || "", adminName: me?.name || me?.email || "Admin", createdAt: serverTimestamp(),
      }).catch(() => {});
      onDone("Rol actualizado");
      onClose();
    } catch (e) { setError((e as Error).message || "No se pudo cambiar"); } finally { setBusy(false); }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`Rol de ${user.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={busy || (role === user.role && (role !== "support_agent" || specialty === user.supportSpecialty))}>{busy ? "Guardando…" : "Guardar"}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Rol">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">Usuario</option>
            <option value="support_agent">Agente de soporte</option>
            <option value="admin">Administrador</option>
          </Select>
        </Field>
        {role === "support_agent" && (
          <Field label="Especialidad">
            <Select value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
              <option value="both">Ventas y técnico</option><option value="sales">Ventas</option><option value="technical">Técnico</option>
            </Select>
          </Field>
        )}
        {role === "admin" && <p className="rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2 text-xs text-amber-900">Tendrá acceso completo al panel de administración.</p>}
        {role === "support_agent" && <p className="text-xs text-slate-500">Solo verá Soporte y Guías.</p>}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
