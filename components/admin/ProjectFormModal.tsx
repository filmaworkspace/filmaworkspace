"use client";

// Crear o editar un proyecto desde el admin (nombre, fase, productoras,
// idioma y, al crear, un ID propio opcional).
import { useEffect, useState } from "react";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from "@/components/ds";
import { AdminProducer, AdminProject } from "./AdminData";
import { PHASES } from "./ui";

const DEFAULT_DEPARTMENTS = ["Producción", "Dirección", "Fotografía", "Arte", "Sonido", "Vestuario", "Maquillaje", "Montaje"];

const shortId = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

export function ProjectFormModal({ open, onClose, project, producers, onSaved }: {
  open: boolean;
  onClose: () => void;
  project?: AdminProject | null;
  producers: AdminProducer[];
  onSaved: (id: string) => void;
}) {
  const editing = !!project;
  const [f, setF] = useState({ name: "", description: "", phase: "Desarrollo", producers: [] as string[], language: "es", customId: "", sign: false, signBillTo: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setF(project
      ? { name: project.name, description: project.description, phase: project.phase, producers: project.producers, language: project.language || "es", customId: "", sign: !!project.sign, signBillTo: project.signBillTo || "" }
      : { name: "", description: "", phase: "Desarrollo", producers: [], language: "es", customId: "", sign: false, signBillTo: "" });
  }, [open, project]);

  const save = async () => {
    if (!f.name.trim()) { setError("El nombre es obligatorio"); return; }
    if (f.sign && !f.producers.length) { setError("Filma Sign se factura a una cuenta: añade una productora"); return; }
    // Filma Sign: cuenta a la que se factura (la elegida o la única productora).
    const signBillTo = f.sign ? (f.producers.includes(f.signBillTo) ? f.signBillTo : f.producers[0]) : null;
    setSaving(true); setError("");
    try {
      if (editing && project) {
        await updateDoc(doc(db, "projects", project.id), { name: f.name.trim(), description: f.description.trim(), phase: f.phase, producers: f.producers, language: f.language, "modules.sign": f.sign, signBillTo });
        for (const pid of project.producers) if (!f.producers.includes(pid)) await deleteDoc(doc(db, `companyProjects/${pid}/projects`, project.id));
        for (const pid of f.producers) await setDoc(doc(db, `companyProjects/${pid}/projects`, project.id), { projectId: project.id, name: f.name.trim(), phase: f.phase, addedAt: serverTimestamp() });
        onSaved(project.id);
      } else {
        const raw = f.customId.trim();
        if (raw && !/^[a-zA-Z0-9_-]+$/.test(raw)) throw new Error("El ID solo admite letras, números, guiones y guiones bajos");
        const id = raw || shortId();
        if ((await getDoc(doc(db, "projects", id))).exists()) throw new Error(`Ya existe un proyecto con el ID "${id}"`);
        await setDoc(doc(db, "projects", id), {
          name: f.name.trim(), description: f.description.trim(), phase: f.phase, producers: f.producers,
          departments: DEFAULT_DEPARTMENTS, language: f.language, createdAt: serverTimestamp(),
          modules: { accounting: true, team: true, sign: f.sign }, signBillTo,
        });
        for (const pid of f.producers) await setDoc(doc(db, `companyProjects/${pid}/projects`, id), { projectId: id, name: f.name.trim(), phase: f.phase, addedAt: serverTimestamp() });
        onSaved(id);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Editar proyecto" : "Nuevo proyecto"}
      width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : editing ? "Guardar" : "Crear proyecto"}</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nombre"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Descripción"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fase">
            <Select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>
              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Idioma">
            <Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </div>
        {!editing && (
          <Field label="ID del proyecto" hint="Opcional. Si lo dejas vacío se genera uno de 6 caracteres.">
            <Input value={f.customId} onChange={(e) => setF({ ...f, customId: e.target.value })} placeholder="p. ej. ULTIMALUZ" className="tabular-nums" />
          </Field>
        )}
        <Field label="Productoras">
          <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 p-2">
            {producers.length === 0 && <p className="px-1 text-xs text-slate-400">No hay cuentas creadas</p>}
            {producers.map((p) => (
              <Checkbox key={p.id} checked={f.producers.includes(p.id)} label={p.name}
                onChange={(v) => setF({ ...f, producers: v ? [...f.producers, p.id] : f.producers.filter((x) => x !== p.id) })} />
            ))}
          </div>
        </Field>
        <div className="rounded-md border border-slate-200 p-3">
          <Checkbox checked={f.sign} onChange={(v) => setF({ ...f, sign: v })} label="Filma Sign" />
          {f.sign && f.producers.length > 1 && (
            <div className="mt-2"><Field label="Se factura a">
              <Select value={f.producers.includes(f.signBillTo) ? f.signBillTo : f.producers[0]} onChange={(e) => setF({ ...f, signBillTo: e.target.value })}>
                {f.producers.map((id) => <option key={id} value={id}>{producers.find((p) => p.id === id)?.name || id}</option>)}
              </Select>
            </Field></div>
          )}
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
