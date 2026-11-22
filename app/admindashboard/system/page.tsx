"use client";

// ─── Admin · Sistema ─────────────────────────────────────────────────────────
// Estado de los servicios, errores de la app, eventos de seguridad,
// auditoría, cron de horarios, flags de función, mantenimiento y resumen
// diario por email.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, addDoc } from "firebase/firestore";
import { Check, Download, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { FeatureFlags, fetchFeatureFlags } from "@/lib/featureFlags";
import { Button, Checkbox, EmptyState, Field, IconButton, Input, Modal, Page, PageHeader, PageLoading, Select, Textarea, useToast } from "@/components/ds";
import SearchBar, { SearchField } from "@/components/SearchBar";
import { useAdminData } from "@/components/admin/AdminData";
import { adminFetch, Dot, downloadCsv, fmtDate, Pills, RowBar, timeAgo, Tone } from "@/components/admin/ui";

type Tab = "status" | "errors" | "security" | "audit" | "cron" | "flags" | "maintenance" | "digest";
const TABS: { value: Tab; label: string }[] = [
  { value: "status", label: "Estado" }, { value: "errors", label: "Errores" }, { value: "security", label: "Seguridad" },
  { value: "audit", label: "Auditoría" }, { value: "cron", label: "Cron" }, { value: "flags", label: "Flags" },
  { value: "maintenance", label: "Mantenimiento" }, { value: "digest", label: "Resumen diario" },
];

const AUDIT_LABEL: Record<string, string> = {
  maintenance_enabled: "activó el mantenimiento", maintenance_disabled: "desactivó el mantenimiento",
  project_deleted: "eliminó un proyecto", producer_deleted: "eliminó una cuenta", user_role_changed: "cambió un rol", user_deleted: "eliminó un usuario",
  budgeting_access_granted: "dio acceso a Budgeting", budgeting_access_revoked: "quitó acceso a Budgeting", broadcast_sent: "envió un comunicado",
  feature_flag_created: "creó un flag", feature_flag_enabled_globally: "activó un flag para todos", feature_flag_disabled_globally: "desactivó un flag para todos", feature_flag_deleted: "borró un flag",
  user_suspended: "suspendió una cuenta", user_reactivated: "reactivó una cuenta", user_sessions_revoked: "cerró las sesiones de", user_email_verified: "verificó el email de",
  user_email_changed: "cambió el email de", user_reset_sent: "envió restablecer contraseña a", user_data_exported: "exportó los datos de",
  impersonation_start: "entró con «Ver como» en", impersonation_end: "salió de «Ver como»",
  project_frozen: "congeló", project_unfrozen: "descongeló", project_trashed: "movió a la papelera", project_restored: "restauró", project_backup: "descargó la copia de",
  email_resent: "reenvió un email", digest_config: "cambió el resumen diario",
};
const SEC_LABEL: Record<string, string> = {
  rate_limited: "Bloqueo por exceso de peticiones", pin_failed: "Código fallido", access_denied: "Acceso denegado",
  impersonation_start: "Inicio de «Ver como»", impersonation_end: "Fin de «Ver como»", account_suspended: "Cuenta suspendida", account_reactivated: "Cuenta reactivada",
  sessions_revoked: "Sesiones cerradas", email_changed: "Email cambiado", data_exported: "Datos exportados",
  project_frozen: "Proyecto congelado", project_trashed: "Proyecto a la papelera", project_restored: "Proyecto restaurado",
};
const SEC_TONE = (t: string): Tone => (["rate_limited", "pin_failed", "access_denied"].includes(t) ? "warn" : ["account_suspended", "project_trashed"].includes(t) ? "bad" : "none");

interface ErrRow { id: string; message: string; stack?: string; count: number; firstSeenAt: Timestamp | null; lastSeenAt: Timestamp | null; lastUrl?: string; lastEmail?: string; lastUserAgent?: string; uids?: string[]; urls?: string[]; resolved: boolean }
interface SecRow { id: string; type: string; uid?: string; actorUid?: string; target?: string; details?: string; ip?: string; createdAt: Timestamp | null }
interface AuditRow { id: string; action: string; details: string; adminName: string; createdAt: Timestamp | null }
interface CronRow { id: string; runAt: Timestamp | null; date: string; checked: number; triggered: string[]; errors: string[] }
interface Check { id: string; label: string; ok: boolean | null; detail: string; ms?: number }

function SystemInner() {
  const params = useSearchParams();
  const { user: me, maintenance } = useUser();
  const { users, userById } = useAdminData();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "status");
  useEffect(() => { const t = params.get("tab") as Tab; if (t) setTab(t); }, [params]);

  const [checks, setChecks] = useState<Check[] | null>(null);
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [sec, setSec] = useState<SecRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [cron, setCron] = useState<CronRow[]>([]);
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [errFilter, setErrFilter] = useState<"open" | "resolved">("open");
  const [errOpen, setErrOpen] = useState<ErrRow | null>(null);
  const [secType, setSecType] = useState("all");
  const [auditQ, setAuditQ] = useState("");
  const [auditField, setAuditField] = useState<"all" | "admin" | "details">("all");
  const [newFlag, setNewFlag] = useState({ label: "", description: "" });
  const [flagUser, setFlagUser] = useState<Record<string, string>>({});
  const [maint, setMaint] = useState({ when: "10", at: "", message: "" });
  const [digest, setDigest] = useState<{ enabled: boolean; recipients: string[] }>({ enabled: true, recipients: [] });

  const audit_ = (action: string, details: string) => addDoc(collection(db, "adminAuditLog"), { action, details, adminId: me?.uid || "", adminName: me?.name || me?.email || "Admin", createdAt: serverTimestamp() }).catch(() => {});

  const loadTab = useCallback(async (t: Tab, force = false) => {
    if (loaded[t] && !force) return;
    try {
      if (t === "status") { setChecks(null); const r = await adminFetch<{ checks: Check[] }>("/api/admin/health", undefined, "GET"); setChecks(r.checks); }
      if (t === "errors") { const s = await getDocs(query(collection(db, "appErrors"), orderBy("lastSeenAt", "desc"), limit(300))); setErrors(s.docs.map((d) => ({ id: d.id, ...d.data() } as ErrRow))); }
      if (t === "security") { const s = await getDocs(query(collection(db, "securityEvents"), orderBy("createdAt", "desc"), limit(500))); setSec(s.docs.map((d) => ({ id: d.id, ...d.data() } as SecRow))); }
      if (t === "audit") { const s = await getDocs(query(collection(db, "adminAuditLog"), orderBy("createdAt", "desc"), limit(500))); setAudit(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditRow))); }
      if (t === "cron") { const s = await getDocs(query(collection(db, "meta/horarioCron/runs"), orderBy("runAt", "desc"), limit(60))); setCron(s.docs.map((d) => ({ id: d.id, ...d.data() } as CronRow))); }
      if (t === "flags") { const raw = await fetchFeatureFlags(db); setFlags(Object.fromEntries(Object.entries(raw).map(([k, f]) => [k, { ...f, id: f.id || k, label: f.label || k, description: f.description || "", enabledGlobally: !!f.enabledGlobally, enabledUserIds: f.enabledUserIds || [] }]))); }
      if (t === "digest") { const d = await getDoc(doc(db, "adminConfig", "digest")); const x = d.data() || {}; setDigest({ enabled: x.enabled !== false, recipients: x.recipients || [] }); }
      setLoaded((l) => ({ ...l, [t]: true }));
    } catch (e) { showToast("error", (e as Error).message || "No se pudo cargar"); }
  }, [loaded, showToast]);
  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const shownErrors = errors.filter((e) => (errFilter === "open" ? !e.resolved : e.resolved));
  const shownSec = sec.filter((s) => secType === "all" || s.type === secType);
  const shownAudit = useMemo(() => {
    const t = auditQ.trim().toLowerCase();
    return audit.filter((a) => !t || (auditField === "admin" ? a.adminName : auditField === "details" ? a.details : `${a.adminName} ${AUDIT_LABEL[a.action] || a.action} ${a.details}`).toLowerCase().includes(t));
  }, [audit, auditQ, auditField]);

  const resolveError = async (e: ErrRow, resolved: boolean) => {
    await updateDoc(doc(db, "appErrors", e.id), { resolved, resolvedAt: resolved ? serverTimestamp() : null, resolvedBy: resolved ? me?.uid || "" : null });
    setErrors((l) => l.map((x) => (x.id === e.id ? { ...x, resolved } : x)));
    setErrOpen(null);
  };

  const saveFlags = async (next: FeatureFlags, action?: string, details?: string) => {
    await setDoc(doc(db, "meta", "featureFlags"), next);
    setFlags(next);
    if (action) audit_(action, details || "");
  };

  const activateMaint = async () => {
    const start = maint.when === "at" ? new Date(maint.at).getTime() : Date.now() + Number(maint.when) * 60000;
    if (!start || Number.isNaN(start)) { showToast("error", "Elige la hora"); return; }
    await setDoc(doc(db, "meta", "maintenance"), { enabled: true, startAt: Timestamp.fromMillis(start), message: maint.message.trim(), activatedAt: serverTimestamp(), activatedBy: me?.uid || "", activatedByName: me?.name || "Admin" });
    audit_("maintenance_enabled", `Para ${fmtDate(start, true)}${maint.message ? ` — "${maint.message.trim()}"` : ""}`);
    showToast("success", maint.when === "0" ? "Mantenimiento activado" : "Mantenimiento programado");
  };
  const deactivateMaint = async () => {
    await setDoc(doc(db, "meta", "maintenance"), { enabled: false, deactivatedAt: serverTimestamp(), deactivatedBy: me?.uid || "" }, { merge: true });
    audit_("maintenance_disabled", "");
    showToast("success", "Mantenimiento desactivado");
  };

  const saveDigest = async (next: typeof digest) => {
    setDigest(next);
    await setDoc(doc(db, "adminConfig", "digest"), { ...next, updatedAt: serverTimestamp(), updatedBy: me?.uid || "" });
    audit_("digest_config", next.enabled ? `Activado (${next.recipients.length ? `${next.recipients.length} destinatarios` : "todos los admins"})` : "Desactivado");
  };

  const admins = users.filter((u) => u.role === "admin");
  const maintStart = maintenance.startAt?.getTime() ?? null;

  return (
    <Page>
      {toast}
      <PageHeader title={TABS.find((t) => t.value === tab)?.label || "Sistema"} actions={<IconButton label="Actualizar" onClick={() => loadTab(tab, true)}><RefreshCw size={15} /></IconButton>} />

      {/* Estado */}
      {tab === "status" && (
        <div className="mt-6 max-w-3xl overflow-hidden rounded-lg border border-slate-200">
          {!checks && <p className="px-4 py-6 text-center text-[13px] text-slate-400">Comprobando…</p>}
          {checks?.map((c) => (
            <div key={c.id} className="relative flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
              <RowBar tone={c.ok === null ? "none" : c.ok ? "ok" : "bad"} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-900">{c.label}</p>
                <p className="truncate text-xs text-slate-500">{c.detail}</p>
              </div>
              <span className={`text-xs ${c.ok === null ? "text-slate-400" : c.ok ? "text-emerald-700" : "text-red-600"}`}>{c.ok === null ? "Sin datos" : c.ok ? "Correcto" : "Revisar"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Errores */}
      {tab === "errors" && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Pills value={errFilter} onChange={setErrFilter} label="Errores" options={[{ value: "open", label: "Sin revisar", count: errors.filter((e) => !e.resolved).length }, { value: "resolved", label: "Revisados", count: errors.filter((e) => e.resolved).length }]} />
          </div>
          {shownErrors.length === 0 ? <div className="mt-4"><EmptyState title={errFilter === "open" ? "Ningún error sin revisar" : "Nada aquí"} /></div> : (
            <table className="tbl mt-4 w-full table-fixed text-[13px]">
              <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Error</th><th className="w-24 px-3 text-right">Veces</th><th className="w-28 px-3 text-right">Usuarios</th><th className="w-36 px-3">Última vez</th></tr></thead>
              <tbody>
                {shownErrors.map((e) => (
                  <tr key={e.id} onClick={() => setErrOpen(e)} className="cursor-pointer hover:bg-[#FAFAFA]">
                    <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={e.resolved ? "none" : e.count > 10 ? "bad" : "warn"} /><div className="truncate tabular-nums text-[12px] text-slate-900">{e.message}</div><div className="truncate text-xs text-slate-500">{e.lastUrl}</div></td>
                    <td className="px-3 text-right tabular-nums">{e.count}</td>
                    <td className="px-3 text-right tabular-nums">{e.uids?.length || 0}</td>
                    <td className="px-3 text-slate-500">{timeAgo(e.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Seguridad */}
      {tab === "security" && (
        <>
          <div className="mt-4 flex justify-end">
            <div className="w-64"><Select value={secType} onChange={(e) => setSecType(e.target.value)}><option value="all">Todos los eventos</option>{Object.entries(SEC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          </div>
          {shownSec.length === 0 ? <div className="mt-4"><EmptyState title="Sin eventos" /></div> : (
            <table className="tbl mt-4 w-full table-fixed text-[13px]">
              <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Evento</th><th className="w-56 px-3">Usuario</th><th className="w-40 px-3">IP</th><th className="w-36 px-3">Cuándo</th></tr></thead>
              <tbody>
                {shownSec.map((s) => {
                  const who = userById(s.uid || "") || null;
                  const actor = userById(s.actorUid || "") || null;
                  return (
                    <tr key={s.id}>
                      <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={SEC_TONE(s.type)} /><div className="truncate text-slate-900">{SEC_LABEL[s.type] || s.type}{actor ? <span className="text-slate-500"> · por {actor.name}</span> : null}</div><div className="truncate text-xs text-slate-500">{s.details || s.target || ""}</div></td>
                      <td className="px-3 text-slate-600"><span className="block truncate">{who ? who.name : s.target || "—"}</span></td>
                      <td className="px-3 font-mono text-[11px] text-slate-500">{s.ip || "—"}</td>
                      <td className="px-3 text-slate-500" title={fmtDate(s.createdAt, true)}>{timeAgo(s.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Auditoría */}
      {tab === "audit" && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar fields={[{ value: "all", label: "Buscar en todo", placeholder: "Admin, acción o detalle" }, { value: "admin", label: "Admin", placeholder: "Nombre" }, { value: "details", label: "Detalle", placeholder: "Detalle" }] as SearchField<"all" | "admin" | "details">[]}
              field={auditField} onField={setAuditField} value={auditQ} onChange={setAuditQ} count={shownAudit.length} />
            <Button onClick={() => downloadCsv(`auditoria_${new Date().toISOString().slice(0, 10)}.csv`, [["Fecha", "Admin", "Acción", "Detalle"], ...shownAudit.map((a) => [a.createdAt?.toDate().toISOString() || "", a.adminName, AUDIT_LABEL[a.action] || a.action, a.details])])}><Download size={13} /> CSV</Button>
          </div>
          {shownAudit.length === 0 ? <div className="mt-4"><EmptyState title="Sin entradas" /></div> : (
            <table className="tbl mt-4 w-full table-fixed text-[13px]">
              <tbody>
                {shownAudit.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 pl-4 pr-3"><div className="truncate text-slate-900"><span className="font-medium">{a.adminName}</span> {AUDIT_LABEL[a.action] || a.action}{a.details ? <span className="text-slate-500"> · {a.details}</span> : null}</div></td>
                    <td className="w-44 px-3 text-slate-500">{fmtDate(a.createdAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Cron */}
      {tab === "cron" && (
        cron.length === 0 ? <div className="mt-6"><EmptyState title="El envío automático de horarios aún no se ha ejecutado" /></div> : (
          <table className="tbl mt-6 w-full table-fixed text-[13px]">
            <thead><tr className="text-left"><th className="w-48 py-2 pl-4 pr-3">Ejecución</th><th className="w-28 px-3 text-right">Revisados</th><th className="w-28 px-3 text-right">Enviados</th><th className="px-3">Errores</th></tr></thead>
            <tbody>
              {cron.map((c) => (
                <tr key={c.id}>
                  <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={c.errors?.length ? "bad" : "ok"} />{fmtDate(c.runAt, true)}</td>
                  <td className="px-3 text-right tabular-nums">{c.checked}</td>
                  <td className="px-3 text-right tabular-nums">{c.triggered?.length || 0}</td>
                  <td className="px-3 text-red-600"><span className="block truncate" title={(c.errors || []).join("\n")}>{(c.errors || []).join(" · ") || <span className="text-slate-300">—</span>}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {/* Flags */}
      {tab === "flags" && (
        <div className="mt-6 max-w-4xl">
          <div className="flex items-end gap-2">
            <Field label="Nuevo flag" className="w-64"><Input value={newFlag.label} onChange={(e) => setNewFlag({ ...newFlag, label: e.target.value })} placeholder="Nombre" /></Field>
            <Field label="Descripción" className="flex-1"><Input value={newFlag.description} onChange={(e) => setNewFlag({ ...newFlag, description: e.target.value })} placeholder="Para qué sirve" /></Field>
            <Button onClick={async () => {
              const label = newFlag.label.trim(); if (!label) return;
              const id = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `flag_${Date.now()}`;
              if (flags[id]) { showToast("error", "Ya existe"); return; }
              await saveFlags({ ...flags, [id]: { id, label, description: newFlag.description.trim(), enabledGlobally: false, enabledUserIds: [] } }, "feature_flag_created", label);
              setNewFlag({ label: "", description: "" });
            }}><Plus size={13} /> Crear</Button>
          </div>
          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            {Object.values(flags).length === 0 && <p className="px-4 py-6 text-center text-[13px] text-slate-400">Sin flags</p>}
            {Object.values(flags).map((f) => (
              <div key={f.id} className="border-b border-slate-100 px-4 py-3 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-900">{f.label} <span className="font-mono text-[11px] font-normal text-slate-400">{f.id}</span></p>
                    {f.description && <p className="text-xs text-slate-500">{f.description}</p>}
                  </div>
                  <Checkbox checked={f.enabledGlobally} onChange={(v) => saveFlags({ ...flags, [f.id]: { ...f, enabledGlobally: v } }, v ? "feature_flag_enabled_globally" : "feature_flag_disabled_globally", f.label)} label="Para todos" />
                  <IconButton label="Borrar flag" onClick={() => { const { [f.id]: _, ...rest } = flags; void _; saveFlags(rest, "feature_flag_deleted", f.label); }}><Trash2 size={13} /></IconButton>
                </div>
                {!f.enabledGlobally && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {f.enabledUserIds.map((id) => (
                      <button key={id} onClick={() => saveFlags({ ...flags, [f.id]: { ...f, enabledUserIds: f.enabledUserIds.filter((x) => x !== id) } })} className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-red-200 hover:text-red-700">{userById(id)?.name || id} ×</button>
                    ))}
                    <div className="w-56">
                      <Select value={flagUser[f.id] || ""} onChange={(e) => { const v = e.target.value; if (v) saveFlags({ ...flags, [f.id]: { ...f, enabledUserIds: [...f.enabledUserIds, v] } }); setFlagUser({ ...flagUser, [f.id]: "" }); }}>
                        <option value="" disabled>Activar para…</option>
                        {users.filter((u) => !f.enabledUserIds.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mantenimiento */}
      {tab === "maintenance" && (
        <div className="mt-6 max-w-xl">
          <div className={`mb-6 flex items-center gap-3 rounded-lg border px-4 py-3 ${maintenance.enabled ? "border-amber-200 bg-[#FFFBEB]" : "border-slate-200"}`}>
            <Dot tone={maintenance.enabled ? "warn" : "ok"} />
            <div className="flex-1 text-[13px]">
              <p className="font-medium text-slate-900">{!maintenance.enabled ? "Funcionando con normalidad" : maintStart && maintStart > Date.now() ? `Mantenimiento programado ${timeAgo(maintStart)}` : "En mantenimiento: los usuarios no pueden entrar"}</p>
              {maintenance.enabled && maintenance.message && <p className="text-xs text-slate-600">“{maintenance.message}”</p>}
            </div>
            {maintenance.enabled && <Button onClick={deactivateMaint}>Desactivar</Button>}
          </div>
          <div className="flex flex-col gap-4">
            <Field label="Cuándo" hint="Los usuarios ven una cuenta atrás hasta que empieza. Los admins pueden seguir entrando.">
              <div className="flex gap-2">
                <div className="w-48"><Select value={maint.when} onChange={(e) => setMaint({ ...maint, when: e.target.value })}>
                  <option value="0">Ahora mismo</option><option value="5">En 5 minutos</option><option value="10">En 10 minutos</option><option value="30">En 30 minutos</option><option value="60">En 1 hora</option><option value="at">A una hora concreta…</option>
                </Select></div>
                {maint.when === "at" && <Input type="datetime-local" value={maint.at} onChange={(e) => setMaint({ ...maint, at: e.target.value })} />}
              </div>
            </Field>
            <Field label="Mensaje para los usuarios"><Textarea rows={2} value={maint.message} onChange={(e) => setMaint({ ...maint, message: e.target.value })} placeholder="Estamos mejorando Filma. Volvemos en 20 minutos." /></Field>
            <div><Button variant="primary" onClick={activateMaint}>{maint.when === "0" ? "Activar mantenimiento" : "Programar mantenimiento"}</Button></div>
          </div>
        </div>
      )}

      {/* Resumen diario */}
      {tab === "digest" && (
        <div className="mt-6 max-w-xl">
          <Checkbox checked={digest.enabled} onChange={(v) => saveDigest({ ...digest, enabled: v })} label="Enviar un resumen diario por email a los admins" hint="Lo que requiere atención y las cifras del día. También vacía la papelera de proyectos de más de 30 días." />
          {digest.enabled && (
            <div className="mt-5">
              <p className="mb-2 text-[13px] text-slate-500">Destinatarios <span className="text-slate-400">(ninguno marcado = todos los admins)</span></p>
              <div className="flex flex-col gap-1">
                {admins.map((a) => (
                  <Checkbox key={a.id} checked={digest.recipients.includes(a.id)} label={`${a.name} · ${a.email}`}
                    onChange={(v) => saveDigest({ ...digest, recipients: v ? [...digest.recipients, a.id] : digest.recipients.filter((x) => x !== a.id) })} />
                ))}
              </div>
            </div>
          )}
          <p className="mt-6 rounded-md border border-slate-200 bg-[#F7F7F8] px-3 py-2 text-xs leading-relaxed text-slate-600">
            Se envía cuando se llama a <code className="tabular-nums">/api/cron/admin-digest</code> con la cabecera <code className="tabular-nums">Authorization: Bearer CRON_SECRET</code>. Prográmalo una vez al día, igual que el envío automático de horarios.
          </p>
        </div>
      )}

      {/* Detalle de un error */}
      <Modal open={!!errOpen} onClose={() => setErrOpen(null)} title="Error de la app" width="max-w-3xl"
        footer={errOpen && <><Button variant="ghost" onClick={() => setErrOpen(null)}>Cerrar</Button>{errOpen.resolved
          ? <Button onClick={() => resolveError(errOpen, false)}><X size={13} /> Volver a abrir</Button>
          : <Button variant="primary" onClick={() => resolveError(errOpen, true)}><Check size={13} /> Marcar como revisado</Button>}</>}>
        {errOpen && (
          <div className="flex flex-col gap-4 text-[13px]">
            <p className="tabular-nums text-[12px] text-slate-900">{errOpen.message}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-600 sm:grid-cols-4">
              <span>Veces: <strong className="text-slate-900">{errOpen.count}</strong></span>
              <span>Usuarios: <strong className="text-slate-900">{errOpen.uids?.length || 0}</strong></span>
              <span>Primera: {fmtDate(errOpen.firstSeenAt, true)}</span>
              <span>Última: {fmtDate(errOpen.lastSeenAt, true)}</span>
            </div>
            {errOpen.lastEmail && <p className="text-xs text-slate-600">Último usuario: {errOpen.lastEmail}</p>}
            {errOpen.urls && <p className="text-xs text-slate-600">Páginas: <span className="font-mono">{errOpen.urls.slice(0, 8).join(" · ")}</span></p>}
            {errOpen.lastUserAgent && <p className="truncate text-xs text-slate-400">{errOpen.lastUserAgent}</p>}
            {errOpen.stack && <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 tabular-nums text-[11px] leading-relaxed text-slate-200">{errOpen.stack}</pre>}
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default function SystemPage() {
  return <Suspense fallback={<PageLoading />}><SystemInner /></Suspense>;
}

