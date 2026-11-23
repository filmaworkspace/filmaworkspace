"use client";

// Crear o editar una cuenta (productora): plan, módulos incluidos, límites,
// renovación y contacto. Los módulos se copian a sus proyectos
// (projects/{id}.modules) para que la app oculte lo que el plan no incluye.
import { useEffect, useState } from "react";
import { collection, doc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button, Checkbox, Field, Input, Modal, Select } from "@/components/ds";
import { AdminProducer, AdminProject } from "./AdminData";

export const PLANS = ["", "Prueba", "Básico", "Profesional", "Empresa"];

const toDateInput = (t?: Timestamp | null) => (t ? t.toDate().toISOString().slice(0, 10) : "");

/** Copia los módulos de las cuentas a sus proyectos (un proyecto con varias cuentas tiene lo que tenga cualquiera). */
export async function syncProjectModules(projects: AdminProject[], producers: AdminProducer[]) {
  await Promise.all(projects.filter((p) => p.producers.length).map((p) => {
    const mods = p.producers.map((id) => producers.find((x) => x.id === id)?.modules).filter(Boolean) as NonNullable<AdminProducer["modules"]>[];
    const modules = mods.length
      ? { accounting: mods.some((m) => m.accounting !== false), team: mods.some((m) => m.team !== false) }
      : { accounting: true, team: true };
    // Campo a campo: Filma Sign (modules.sign) es del proyecto, no de la cuenta.
    return updateDoc(doc(db, "projects", p.id), { "modules.accounting": modules.accounting, "modules.team": modules.team }).catch(() => {});
  }));
}

export function AccountFormModal({ open, onClose, account, projects, producers, onSaved }: {
  open: boolean;
  onClose: () => void;
  account?: AdminProducer | null;
  projects: AdminProject[];
  producers: AdminProducer[];
  onSaved: (id: string) => void;
}) {
  const editing = !!account;
  const blank = { name: "", plan: "", accounting: true, team: true, budgeting: false, maxProjects: "", maxUsers: "", renewalAt: "", contactName: "", contactEmail: "", contactPhone: "", taxId: "",
    bName: "", bAddress: "", bPostal: "", bCity: "", bProvince: "", bCountry: "España", bEmail: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setF(account ? {
      name: account.name, plan: account.plan || "",
      accounting: account.modules?.accounting !== false, team: account.modules?.team !== false, budgeting: !!account.modules?.budgeting,
      maxProjects: account.maxProjects ? String(account.maxProjects) : "", maxUsers: account.maxUsers ? String(account.maxUsers) : "",
      renewalAt: toDateInput(account.renewalAt), contactName: account.contactName || "", contactEmail: account.contactEmail || "",
      contactPhone: account.contactPhone || "", taxId: account.taxId || "",
      bName: account.billing?.name || "", bAddress: account.billing?.address || "", bPostal: account.billing?.postalCode || "",
      bCity: account.billing?.city || "", bProvince: account.billing?.province || "", bCountry: account.billing?.country || "España", bEmail: account.billing?.email || "",
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account]);

  const save = async () => {
    if (!f.name.trim()) { setError("El nombre es obligatorio"); return; }
    setSaving(true); setError("");
    try {
      const ref = account ? doc(db, "producers", account.id) : doc(collection(db, "producers"));
      const modules = { accounting: f.accounting, team: f.team, budgeting: f.budgeting };
      await setDoc(ref, {
        name: f.name.trim(), plan: f.plan || null, modules,
        maxProjects: f.maxProjects ? Number(f.maxProjects) : null, maxUsers: f.maxUsers ? Number(f.maxUsers) : null,
        renewalAt: f.renewalAt ? Timestamp.fromDate(new Date(`${f.renewalAt}T12:00:00`)) : null,
        contactName: f.contactName.trim(), contactEmail: f.contactEmail.trim(), contactPhone: f.contactPhone.trim(), taxId: f.taxId.trim().toUpperCase(),
        billing: { name: f.bName.trim(), address: f.bAddress.trim(), postalCode: f.bPostal.trim(), city: f.bCity.trim(), province: f.bProvince.trim(), country: f.bCountry.trim() || "España", email: f.bEmail.trim() },
        ...(account ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });
      if (account) {
        const next = producers.map((p) => (p.id === account.id ? { ...p, modules } : p));
        await syncProjectModules(projects.filter((p) => p.producers.includes(account.id)), next);
      }
      onSaved(ref.id);
      onClose();
    } catch (e) { setError((e as Error).message || "No se pudo guardar"); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar cuenta" : "Nueva cuenta"} width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : editing ? "Guardar" : "Crear cuenta"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_180px] gap-3">
          <Field label="Productora"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Plan">
            <Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
              {PLANS.map((p) => <option key={p} value={p}>{p || "Sin plan"}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Módulos incluidos" hint="Lo que no esté incluido se oculta en los proyectos de la cuenta.">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Checkbox checked={f.accounting} onChange={(v) => setF({ ...f, accounting: v })} label="Contabilidad" />
            <Checkbox checked={f.team} onChange={(v) => setF({ ...f, team: v })} label="Equipo" />
            <Checkbox checked={f.budgeting} onChange={(v) => setF({ ...f, budgeting: v })} label="Budgeting" />
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Máx. proyectos"><Input type="number" min={0} value={f.maxProjects} onChange={(e) => setF({ ...f, maxProjects: e.target.value })} placeholder="Sin límite" /></Field>
          <Field label="Máx. usuarios"><Input type="number" min={0} value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value })} placeholder="Sin límite" /></Field>
          <Field label="Renovación"><Input type="date" value={f.renewalAt} onChange={(e) => setF({ ...f, renewalAt: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contacto"><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
          <Field label="NIF / CIF"><Input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} className="tabular-nums" /></Field>
          <Field label="Email de contacto"><Input value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
          <Field label="Teléfono"><Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <p className="mb-3 text-[13px] font-medium text-slate-900">Datos de facturación</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Razón social" className="col-span-2"><Input value={f.bName} onChange={(e) => setF({ ...f, bName: e.target.value })} placeholder={f.name || "Nombre legal de la empresa"} /></Field>
            <Field label="Dirección fiscal" className="col-span-2"><Input value={f.bAddress} onChange={(e) => setF({ ...f, bAddress: e.target.value })} placeholder="Calle, número, piso" /></Field>
            <div className="col-span-2 grid grid-cols-[110px_1fr_1fr] gap-3">
              <Field label="C. P."><Input value={f.bPostal} onChange={(e) => setF({ ...f, bPostal: e.target.value })} /></Field>
              <Field label="Ciudad"><Input value={f.bCity} onChange={(e) => setF({ ...f, bCity: e.target.value })} /></Field>
              <Field label="Provincia"><Input value={f.bProvince} onChange={(e) => setF({ ...f, bProvince: e.target.value })} /></Field>
            </div>
            <Field label="País"><Input value={f.bCountry} onChange={(e) => setF({ ...f, bCountry: e.target.value })} /></Field>
            <Field label="Email para facturas"><Input value={f.bEmail} onChange={(e) => setF({ ...f, bEmail: e.target.value })} placeholder={f.contactEmail || "administracion@…"} /></Field>
          </div>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
