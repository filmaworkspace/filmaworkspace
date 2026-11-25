"use client";

// ─── Equipo › Configuración ──────────────────────────────────────────────────
// Mismo esquema que Contabilidad › Configuración: pestañas, bloques con título
// y tablas. Altas (aprobadores, caducidad del enlace y campos del formulario),
// Nóminas (tarifas), Departamentos (orden) y Accesos de coordinación.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, where } from "firebase/firestore";
import { ArrowDown, ArrowUp, ExternalLink, Lock, MoreHorizontal, Plus, RotateCcw, Search, X } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { toast } from "@/lib/toast";
import { PayrollSettingsForm } from "@/components/payroll/PayrollSettingsForm";
import { readSettings, type PayrollSettings } from "@/lib/payroll/model";
import { useUser } from "@/contexts/UserContext";
import { Button, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Select } from "@/components/ds";

// ─── Tipos y valores por defecto ─────────────────────────────────────────────

interface Member { userId: string; name: string; email: string; role?: string }
interface CrewEntry { id: string; firstName: string; lastName1: string; role: string; department: string; section: string }
type AKey = "meals" | "halfPerDiem" | "perDiem" | "halfIntlPerDiem" | "intlPerDiem" | "accommodation" | "car";
interface AccessEntry {
  id: string; name: string; pin: string | null; allowedTypes: AKey[]; active: boolean; createdAt?: Date;
  people: { memberId: string; firstName: string; lastName1: string; department?: string; section?: string }[];
}

const ALLOWANCES: { key: AKey; label: string }[] = [
  { key: "meals", label: "Comidas" }, { key: "halfPerDiem", label: "½ dieta nacional" }, { key: "perDiem", label: "Dieta nacional" },
  { key: "halfIntlPerDiem", label: "½ dieta internacional" }, { key: "intlPerDiem", label: "Dieta internacional" },
  { key: "accommodation", label: "Alojamiento" }, { key: "car", label: "Vehículo" },
];


interface FormCfg {
  showPhoto: boolean; showLastName2: boolean; showArtisticName: boolean; showDocExpiry: boolean; showBirthPlace: boolean; showNationality: boolean;
  showProvince: boolean; showCountry: boolean; showIrpfRate: boolean; showContractReason: boolean; showBankName: boolean; showAccountHolder: boolean;
  showBankCert: boolean; showCv: boolean; linkDays: number;
}
const DEFAULT_FORM: FormCfg = {
  showPhoto: true, showLastName2: true, showArtisticName: false, showDocExpiry: true, showBirthPlace: false, showNationality: true,
  showProvince: true, showCountry: true, showIrpfRate: true, showContractReason: false, showBankName: false, showAccountHolder: false,
  showBankCert: false, showCv: false, linkDays: 14,
};
type FormKey = Exclude<keyof FormCfg, "linkDays">;
const FORM_GROUPS: { label: string; fields: { key: FormKey | null; label: string }[] }[] = [
  { label: "Datos personales", fields: [
    { key: null, label: "Nombre y primer apellido" }, { key: "showLastName2", label: "Segundo apellido" }, { key: "showArtisticName", label: "Nombre artístico" },
    { key: "showPhoto", label: "Foto" }, { key: null, label: "Documento de identidad" }, { key: "showDocExpiry", label: "Caducidad del documento" },
    { key: null, label: "Fecha de nacimiento" }, { key: "showBirthPlace", label: "Lugar de nacimiento" }, { key: "showNationality", label: "Nacionalidad" },
  ] },
  { label: "Contacto", fields: [
    { key: null, label: "Email y teléfono" }, { key: null, label: "Dirección, CP y ciudad" }, { key: "showProvince", label: "Provincia" }, { key: "showCountry", label: "País" },
  ] },
  { label: "Fiscal y bancario", fields: [
    { key: null, label: "Nº Seguridad Social y régimen" }, { key: "showIrpfRate", label: "% IRPF" }, { key: "showContractReason", label: "Causa del contrato" },
    { key: null, label: "IBAN" }, { key: "showBankName", label: "Banco" }, { key: "showAccountHolder", label: "Titular de la cuenta" },
  ] },
  { label: "Documentos", fields: [
    { key: null, label: "DNI / NIE" }, { key: "showBankCert", label: "Certificado de titularidad bancaria" }, { key: "showCv", label: "CV" },
  ] },
];

const SECTION_LABELS: Record<string, string> = { technical: "Equipo técnico", cast: "Cast", specialists: "Especialistas" };
const deptOf = (c: { department?: string; section?: string }) => (c.department || "").trim() || SECTION_LABELS[c.section || "technical"] || "Equipo técnico";
const genCode = () => Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 55)]).join("");
const TH = "border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500";
const ago = (d?: Date) => {
  if (!d) return "";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  return m < 1 ? "ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};

type Tab = "altas" | "payroll" | "departments" | "access";

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamConfigPage() {
  const { id } = useParams();
  const projectId = id as string;
  const router = useRouter();
  const { user } = useUser();
  const userId = user?.uid || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("altas");
  const [projectName, setProjectName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [crew, setCrew] = useState<CrewEntry[]>([]);
  const [accesses, setAccesses] = useState<AccessEntry[]>([]);
  const [lastSaved, setLastSaved] = useState<{ at?: Date; by?: string } | null>(null);

  // Ajustes (borrador y guardado, para saber si hay cambios)
  type Settings = { requireApproval: boolean; approverUserIds: string[]; approverNames: Record<string, string>; form: FormCfg; payroll: PayrollSettings; departments: string[] };
  const [saved, setSaved] = useState<Settings | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const dirty = !!s && !!saved && JSON.stringify(s) !== JSON.stringify(saved);

  // Accesos: modal de creación
  const [accessModal, setAccessModal] = useState(false);
  const [draft, setDraft] = useState({ name: "", people: new Set<string>(), usePin: true, pin: "", types: new Set<AKey>(ALLOWANCES.map((a) => a.key)) });
  const [peopleQ, setPeopleQ] = useState("");
  const [savingAccess, setSavingAccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AccessEntry | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/"); return; }
      await load();
      setLoading(false);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const load = async () => {
    const cfg = (name: string) => getDoc(doc(db, `projects/${projectId}/teamConfig`, name)).then((x) => x.data() || null).catch(() => null);
    const [membersSnap, crewSnap, proj, appr, order, form, payroll] = await Promise.all([
      getDocs(collection(db, `projects/${projectId}/members`)),
      getDocs(collection(db, `projects/${projectId}/crew`)),
      getDoc(doc(db, "projects", projectId)),
      cfg("approvals"), cfg("departmentOrder"), cfg("formConfig"), cfg("payrollConfig"),
    ]);
    setProjectName(proj.data()?.name || proj.data()?.title || "");
    setMembers(membersSnap.docs.map((d) => ({ userId: d.data().userId || d.id, name: d.data().name || d.data().displayName || d.data().email || "Usuario", email: d.data().email || "", role: d.data().role || d.data().position || "" }))
      .sort((a, b) => a.name.localeCompare(b.name)));
    const c = crewSnap.docs.filter((d) => (d.data().status || "active") !== "inactive").map((d) => ({
      id: d.id, firstName: d.data().firstName || d.data().name || "", lastName1: d.data().lastName1 || "", role: d.data().role || "",
      department: d.data().department || "", section: d.data().section || "technical",
    })).sort((a, b) => `${a.firstName} ${a.lastName1}`.localeCompare(`${b.firstName} ${b.lastName1}`));
    setCrew(c);
    const depts = Array.from(new Set(c.map(deptOf)));
    const savedOrder: string[] = order?.order || [];
    const settings: Settings = {
      requireApproval: appr?.requireApproval ?? false,
      approverUserIds: appr?.approverUserIds || [],
      approverNames: appr?.approverNames || {},
      form: { ...DEFAULT_FORM, ...(form || {}) } as FormCfg,
      payroll: readSettings(payroll),
      departments: [...savedOrder.filter((d) => depts.includes(d)), ...depts.filter((d) => !savedOrder.includes(d))],
    };
    // Solo las claves conocidas (los documentos llevan además updatedAt/updatedBy)
    settings.form = Object.fromEntries(Object.keys(DEFAULT_FORM).map((k) => [k, (settings.form as never)[k]])) as unknown as FormCfg;
    setSaved(settings); setS(settings);
    const stamps = [appr, order, form, payroll].filter(Boolean).map((x) => ({ at: x!.updatedAt?.toDate?.() as Date | undefined, by: x!.updatedByName as string | undefined })).filter((x) => x.at);
    stamps.sort((a, b) => b.at!.getTime() - a.at!.getTime());
    setLastSaved(stamps[0] || null);
    await loadAccesses();
  };

  const loadAccesses = async () => {
    const snap = await getDocs(query(collection(db, "access"), where("projectId", "==", projectId))).catch(() => null);
    setAccesses((snap?.docs || []).map((d) => ({
      id: d.id, name: d.data().name || "", people: d.data().people || [], pin: d.data().pin || null,
      allowedTypes: d.data().allowedTypes || [], active: d.data().active ?? true, createdAt: d.data().createdAt?.toDate(),
    })).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)));
  };

  const saveAll = async () => {
    if (!s) return;
    if (s.requireApproval && s.approverUserIds.length === 0) { toast.error("Añade al menos un aprobador o desactiva la aprobación"); return; }
    setSaving(true);
    try {
      const meta = { updatedAt: Timestamp.now(), updatedBy: userId, updatedByName: user?.name || user?.email || "" };
      const base = `projects/${projectId}/teamConfig`;
      await Promise.all([
        setDoc(doc(db, base, "approvals"), { requireApproval: s.requireApproval, approverUserIds: s.approverUserIds, approverNames: s.approverNames, ...meta }),
        setDoc(doc(db, base, "departmentOrder"), { order: s.departments, ...meta }),
        setDoc(doc(db, base, "formConfig"), { ...s.form, linkDays: Math.min(90, Math.max(1, Math.round(s.form.linkDays) || 14)), ...meta }),
        setDoc(doc(db, base, "payrollConfig"), { ...JSON.parse(JSON.stringify(s.payroll)), ...meta }, { merge: true }),
      ]);
      setSaved(s); setLastSaved({ at: new Date(), by: meta.updatedByName });
      toast.success("Configuración guardada");
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };

  // ── Accesos ────────────────────────────────────────────────────────────────
  const openAccess = () => {
    setDraft({ name: "", people: new Set(), usePin: true, pin: String(Math.floor(1000 + Math.random() * 9000)), types: new Set(ALLOWANCES.map((a) => a.key)) });
    setPeopleQ(""); setAccessModal(true);
  };
  const createAccess = async () => {
    if (!draft.name.trim() || draft.people.size === 0 || draft.types.size === 0) return;
    setSavingAccess(true);
    try {
      const code = genCode();
      await setDoc(doc(db, "access", code), {
        code, name: draft.name.trim(), projectId, projectName, color: "#0F172A",
        people: crew.filter((m) => draft.people.has(m.id)).map((m) => ({ memberId: m.id, firstName: m.firstName, lastName1: m.lastName1, department: m.department, section: m.section })),
        pin: draft.usePin && /^\d{4}$/.test(draft.pin) ? draft.pin : null,
        allowedTypes: ALLOWANCES.map((a) => a.key).filter((k) => draft.types.has(k)),
        active: true, createdAt: Timestamp.now(), createdBy: userId,
      });
      setAccessModal(false);
      await loadAccesses();
      toast.success("Acceso creado");
    } catch (e) { toast.error(e); } finally { setSavingAccess(false); }
  };
  const accessUrl = (a: AccessEntry) => `${window.location.origin}/access/${a.id}`;
  const copyAccess = (a: AccessEntry) => {
    navigator.clipboard.writeText([`Enlace para marcar complementos (${projectName}):`, accessUrl(a), ...(a.pin ? [`PIN: ${a.pin}`] : [])].join("\n"));
    toast.success("Enlace copiado");
  };
  const toggleAccess = async (a: AccessEntry) => {
    await setDoc(doc(db, "access", a.id), { active: !a.active }, { merge: true });
    await loadAccesses();
  };
  const removeAccess = async (a: AccessEntry) => {
    await deleteDoc(doc(db, "access", a.id));
    setConfirmDelete(null);
    await loadAccesses();
  };

  const crewByDept = useMemo(() => {
    const m = new Map<string, number>();
    crew.forEach((c) => m.set(deptOf(c), (m.get(deptOf(c)) || 0) + 1));
    return m;
  }, [crew]);
  const peopleFiltered = crew.filter((c) => `${c.firstName} ${c.lastName1} ${c.role} ${deptOf(c)}`.toLowerCase().includes(peopleQ.toLowerCase()));

  if (loading || !s) return <PageLoading />;
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const H2 = ({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) => (
    <div className="mb-2 flex min-h-8 items-center justify-between">
      <h2 className="text-[13px] font-semibold text-slate-900">{children}{count !== undefined && <span className="ml-1.5 font-normal text-slate-400">{count}</span>}</h2>
      {action}
    </div>
  );
  const moveDept = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.departments.length) return;
    const arr = [...s.departments];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ departments: arr });
  };
  const freeMembers = members.filter((m) => !s.approverUserIds.includes(m.userId));

  return (
    <Page>
      <PageHeader
        title="Configuración"
        actions={tab !== "access" ? (
          <>
            {lastSaved?.at && !dirty && <span className="text-xs text-slate-500">Guardado {ago(lastSaved.at)}{lastSaved.by ? ` por ${lastSaved.by}` : ""}</span>}
            {dirty && <Button variant="ghost" onClick={() => setS(saved)}>Descartar</Button>}
            <Button variant="primary" onClick={saveAll} disabled={saving || !dirty}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
          </>
        ) : undefined}
      />

      <div className="mt-6">
        <Segmented value={tab} onChange={setTab} options={[
          { value: "altas", label: "Altas" }, { value: "payroll", label: "Nóminas" },
          { value: "departments", label: "Departamentos" }, { value: "access", label: `Accesos · ${accesses.filter((a) => a.active).length}` },
        ]} />
      </div>

      {/* ── Altas ───────────────────────────────────────────────────────── */}
      {tab === "altas" && (
        <div className="mt-6 flex flex-col gap-8">
          <section>
            <H2>Aprobación</H2>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <p className="text-[13px] font-medium text-slate-900">Las altas se aprueban antes de activarse</p>
                <Segmented value={s.requireApproval ? "yes" : "no"} onChange={(v) => set({ requireApproval: v === "yes" })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Sí" }]} />
              </div>
              {s.requireApproval && (
                <div className="px-4 py-3">
                  <p className="mb-2 text-xs text-slate-500">Aprueban</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.approverUserIds.map((uid) => (
                      <span key={uid} className="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 pl-2.5 pr-1 text-[12.5px] text-slate-800">
                        {s.approverNames[uid] || members.find((m) => m.userId === uid)?.name || "—"}
                        <button aria-label="Quitar aprobador" onClick={() => { const n = { ...s.approverNames }; delete n[uid]; set({ approverUserIds: s.approverUserIds.filter((x) => x !== uid), approverNames: n }); }}
                          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-[#F1F1F3] hover:text-slate-700"><X size={12} /></button>
                      </span>
                    ))}
                    {freeMembers.length > 0 && (
                      <div className="w-56"><Select value="" onChange={(e) => { const m = members.find((x) => x.userId === e.target.value); if (m) set({ approverUserIds: [...s.approverUserIds, m.userId], approverNames: { ...s.approverNames, [m.userId]: m.name } }); }} className="h-7 text-[12.5px]">
                        <option value="">Añadir aprobador…</option>
                        {freeMembers.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.role ? ` · ${m.role}` : ""}</option>)}
                      </Select></div>
                    )}
                    {s.approverUserIds.length === 0 && <span className="text-xs text-amber-800">Sin aprobadores</span>}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <H2>Formulario de alta</H2>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[13px] font-medium text-slate-900">Caducidad del enlace</p>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={90} value={String(s.form.linkDays)} onChange={(e) => set({ form: { ...s.form, linkDays: Number(e.target.value) || 0 } })} className="h-8 w-20 text-right tabular-nums" aria-label="Días de validez" />
                <span className="text-[13px] text-slate-500">días</span>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {FORM_GROUPS.map((g) => (
                <div key={g.label} className="overflow-hidden rounded-lg border border-slate-200">
                  <p className={`${TH} px-4 py-2 font-medium`}>{g.label}</p>
                  {g.fields.map((f) => {
                    const on = f.key ? s.form[f.key] : true;
                    return (
                      <label key={f.label} className={`flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 text-[13px] last:border-0 ${f.key ? "cursor-pointer hover:bg-[#FAFAFA]" : ""}`}>
                        <span className={on ? "text-slate-900" : "text-slate-500"}>{f.label}</span>
                        {f.key
                          ? <input type="checkbox" checked={!!on} onChange={() => set({ form: { ...s.form, [f.key!]: !on } })} className="h-4 w-4 accent-slate-900" />
                          : <span className="flex items-center gap-1 text-[11px] text-slate-500"><Lock size={11} /> Obligatorio</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── Nóminas ─────────────────────────────────────────────────────── */}
      {tab === "payroll" && (
        <div className="mt-6">
          <PayrollSettingsForm value={s.payroll} onChange={(payroll) => set({ payroll })} />
        </div>
      )}

      {/* ── Departamentos ───────────────────────────────────────────────── */}
      {tab === "departments" && (
        <div className="mt-6">
          <H2 count={s.departments.length} action={s.departments.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => set({ departments: [...s.departments].sort((a, b) => a.localeCompare(b, "es")) })}>Orden alfabético</Button>
          ) : undefined}>
            Orden en listados, nóminas y crew list
          </H2>
          {s.departments.length === 0 ? (
            <EmptyState title="Sin departamentos: asigna departamento al crew" />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className={TH}>
                    <th scope="col" className="w-12 px-4 py-2 text-left font-medium">#</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Departamento</th>
                    <th scope="col" className="w-24 px-3 py-2 text-right font-medium">Personas</th>
                    <th scope="col" className="w-24 py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {s.departments.map((d, i) => (
                    <tr key={d} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                      <td className="px-4 py-1.5 tabular-nums text-slate-500">{i + 1}</td>
                      <td className="px-3 py-1.5 text-slate-900">{d}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{crewByDept.get(d) || 0}</td>
                      <td className="py-1.5 pr-3">
                        <div className="flex justify-end gap-0.5">
                          <IconButton label={`Subir ${d}`} onClick={() => moveDept(i, -1)} disabled={i === 0}><ArrowUp size={14} /></IconButton>
                          <IconButton label={`Bajar ${d}`} onClick={() => moveDept(i, 1)} disabled={i === s.departments.length - 1}><ArrowDown size={14} /></IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Accesos ─────────────────────────────────────────────────────── */}
      {tab === "access" && (
        <div className="mt-6">
          <H2 count={accesses.length} action={<Button variant="secondary" size="sm" onClick={openAccess} disabled={crew.length === 0}><Plus size={13} /> Nuevo acceso</Button>}>
            Enlaces de coordinación para marcar complementos
          </H2>
          {accesses.length === 0 ? (
            <p className="border-y border-slate-200 py-8 text-center text-[13px] text-slate-500">Sin accesos</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead>
                  <tr className={TH}>
                    <th scope="col" className="px-4 py-2 text-left font-medium">Acceso</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Personas</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Complementos</th>
                    <th scope="col" className="w-20 px-3 py-2 text-left font-medium">PIN</th>
                    <th scope="col" className="w-24 px-3 py-2 text-left font-medium">Estado</th>
                    <th scope="col" className="w-12 py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {accesses.map((a) => (
                    <tr key={a.id} className={`border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA] ${a.active ? "" : "text-slate-500"}`}>
                      <td className="px-4 py-1.5">
                        <p className={`font-medium ${a.active ? "text-slate-900" : "text-slate-500"}`}>{a.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">/access/{a.id}</p>
                      </td>
                      <td className="px-3 py-1.5" title={a.people.map((p) => `${p.firstName} ${p.lastName1}`).join(", ")}>
                        <span className="tabular-nums">{a.people.length}</span>
                        <span className="ml-1.5 text-xs text-slate-500">{Array.from(new Set(a.people.map(deptOf))).slice(0, 2).join(", ")}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-600">
                        {a.allowedTypes.length === ALLOWANCES.length ? "Todos" : a.allowedTypes.map((k) => ALLOWANCES.find((x) => x.key === k)?.label).filter(Boolean).join(", ")}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{a.pin || <span className="font-sans text-slate-400">—</span>}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${a.active ? "bg-emerald-500" : "bg-slate-300"}`} />{a.active ? "Activo" : "Pausado"}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              <MenuItem onClick={() => { close(); copyAccess(a); }}>Copiar enlace{a.pin ? " y PIN" : ""}</MenuItem>
                              <MenuItem onClick={() => { close(); window.open(accessUrl(a), "_blank", "noopener"); }}>Abrir <ExternalLink size={12} className="ml-1 inline" /></MenuItem>
                              <MenuItem onClick={() => { close(); toggleAccess(a); }}>{a.active ? "Pausar" : "Reactivar"}</MenuItem>
                              <MenuSeparator />
                              <MenuItem danger onClick={() => { close(); setConfirmDelete(a); }}>Eliminar</MenuItem>
                            </>
                          )}
                        </Menu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Nuevo acceso */}
      <Modal open={accessModal} onClose={() => setAccessModal(false)} title="Nuevo acceso" width="max-w-2xl"
        footer={<>
          <Button variant="ghost" onClick={() => setAccessModal(false)}>Cancelar</Button>
          <Button variant="primary" onClick={createAccess} disabled={savingAccess || !draft.name.trim() || draft.people.size === 0 || draft.types.size === 0 || (draft.usePin && !/^\d{4}$/.test(draft.pin))}>
            {savingAccess ? "Creando…" : `Crear acceso${draft.people.size ? ` · ${draft.people.size}` : ""}`}
          </Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
            <Field label="Nombre"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Coordinación de cámara" autoFocus /></Field>
            <Field label="PIN">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={draft.usePin} onChange={(e) => setDraft({ ...draft, usePin: e.target.checked })} aria-label="Usar PIN" className="h-4 w-4 accent-slate-900" />
                <Input value={draft.pin} disabled={!draft.usePin} inputMode="numeric" maxLength={4} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="font-mono tabular-nums" />
              </div>
            </Field>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-600">Complementos</p>
            <div className="flex flex-wrap gap-1.5">
              {ALLOWANCES.map((a) => {
                const on = draft.types.has(a.key);
                return (
                  <button key={a.key} type="button" aria-pressed={on} onClick={() => { const n = new Set(draft.types); if (on) n.delete(a.key); else n.add(a.key); setDraft({ ...draft, types: n }); }}
                    className={`h-7 rounded-md border px-2.5 text-[12.5px] ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{a.label}</button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <p className="text-[12px] font-medium text-slate-600">Personas</p>
              <span className="text-xs tabular-nums text-slate-500">{draft.people.size}/{crew.length}</span>
              <div className="relative ml-auto w-56">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={peopleQ} onChange={(e) => setPeopleQ(e.target.value)} placeholder="Buscar" className="h-8 pl-7" aria-label="Buscar personas" />
              </div>
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {Array.from(crewByDept.keys()).map((d) => {
                const ids = crew.filter((c) => deptOf(c) === d).map((c) => c.id);
                const all = ids.every((i) => draft.people.has(i));
                return (
                  <button key={d} type="button" onClick={() => { const n = new Set(draft.people); ids.forEach((i) => (all ? n.delete(i) : n.add(i))); setDraft({ ...draft, people: n }); }}
                    className={`rounded px-2 py-0.5 text-[11.5px] ${all ? "bg-slate-900 text-white" : "bg-[#F1F1F3] text-slate-600 hover:text-slate-900"}`}>{d} · {ids.length}</button>
                );
              })}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {peopleFiltered.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-slate-500">Sin resultados</p>}
              {peopleFiltered.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-[13px] last:border-0 hover:bg-[#FAFAFA]">
                  <input type="checkbox" checked={draft.people.has(c.id)} onChange={() => { const n = new Set(draft.people); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); setDraft({ ...draft, people: n }); }} className="h-4 w-4 accent-slate-900" />
                  <span className="flex-1 truncate text-slate-900">{c.firstName} {c.lastName1}</span>
                  <span className="truncate text-xs text-slate-500">{c.role}</span>
                  <span className="w-32 truncate text-right text-xs text-slate-500">{deptOf(c)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar acceso"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirmDelete && removeAccess(confirmDelete)}>Eliminar</Button>
        </>}>
        <p className="text-[13px] text-slate-700">El enlace de «{confirmDelete?.name}» dejará de funcionar.</p>
      </Modal>
    </Page>
  );
}
