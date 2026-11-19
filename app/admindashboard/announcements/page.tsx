"use client";

// ─── Admin · Avisos ──────────────────────────────────────────────────────────
// Avisos dentro de la app (tarjeta abajo a la izquierda) para todos o para un
// grupo, con inicio y fin programables; novedades ("Qué hay de nuevo", se ven
// una vez) y comunicados por email. Cada aviso puede salir también por email.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDocs, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
import { Mail, Megaphone, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Announcement, isLive } from "@/lib/announcements";
import { Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Select, Textarea, useToast } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import { adminFetch, fmtDate, Pills, RowBar, timeAgo, Tone } from "@/components/admin/ui";

type Tab = "live" | "scheduled" | "past" | "changelog" | "emails";
type AudMode = "all" | "projects" | "accounts" | "users" | "segment";
const DAY = 86_400_000;
const toLocal = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

interface Draft {
  id?: string;
  kind: "banner" | "changelog";
  level: "info" | "warning" | "success";
  title: string;
  body: string;
  linkLabel: string;
  linkUrl: string;
  mode: AudMode;
  ids: string[];
  segment: string;
  startsAt: string;
  ends: "none" | "1" | "7" | "30" | "custom";
  endsAt: string;
  email: boolean;
}
const blankDraft = (kind: "banner" | "changelog" = "banner"): Draft => ({
  kind, level: "info", title: "", body: "", linkLabel: "", linkUrl: "", mode: "all", ids: [], segment: "budgeting",
  startsAt: toLocal(Date.now()), ends: kind === "changelog" ? "30" : "7", endsAt: toLocal(Date.now() + 7 * DAY), email: false,
});

function AnnouncementsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user: me } = useUser();
  const { loading, users, projects, producers, stats } = useAdminData();
  const [toast, showToast] = useToast();
  const [items, setItems] = useState<Announcement[]>([]);
  const [broadcasts, setBroadcasts] = useState<{ id: string; details: string; adminName: string; createdAt: Timestamp | null }[]>([]);
  const [tab, setTab] = useState<Tab>("live");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [emailOnly, setEmailOnly] = useState(false);
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [pick, setPick] = useState("");

  const load = async () => {
    const [a, b] = await Promise.all([
      getDocs(collection(db, "announcements")).catch(() => null),
      getDocs(query(collection(db, "adminAuditLog"), where("action", "==", "broadcast_sent"), limit(200))).catch(() => null),
    ]);
    setItems((a?.docs || []).map((d) => ({ id: d.id, ...d.data() } as Announcement)).sort((x, y) => (y.createdAt?.toMillis?.() ?? 0) - (x.createdAt?.toMillis?.() ?? 0)));
    setBroadcasts((b?.docs || []).map((d) => ({ id: d.id, ...d.data() } as { id: string; details: string; adminName: string; createdAt: Timestamp | null })).sort((x, y) => (y.createdAt?.toMillis?.() ?? 0) - (x.createdAt?.toMillis?.() ?? 0)));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const n = params.get("new");
    if (n === "banner" || n === "changelog") {
      const d = blankDraft(n);
      const pid = params.get("project");
      if (pid) { d.mode = "projects"; d.ids = [pid]; }
      setEmailOnly(false); setDraft(d);
    } else if (n === "email") { setEmailOnly(true); setSubject(""); setDraft({ ...blankDraft(), email: true }); }
  }, [params]);

  // Segmentos que se recalculan solos
  const segments = useMemo(() => {
    const now = Date.now();
    const quiet = new Set(projects.filter((p) => p.phase !== "Finalizado" && (stats[p.id]?.lastActivityAt ?? 0) < now - 30 * DAY).flatMap((p) => p.members.map((m) => m.uid)));
    return [
      { id: "budgeting", label: "Con acceso a Budgeting", ids: users.filter((u) => u.budgetingAccess).map((u) => u.id) },
      { id: "accounts", label: "Usuarios de cuentas (productoras)", ids: users.filter((u) => u.companyId).map((u) => u.id) },
      { id: "active", label: "Activos en los últimos 30 días", ids: users.filter((u) => (u.lastSeenAt?.toMillis?.() ?? 0) > now - 30 * DAY).map((u) => u.id) },
      { id: "inactive", label: "Inactivos (más de 30 días)", ids: users.filter((u) => (u.lastSeenAt?.toMillis?.() ?? 0) <= now - 30 * DAY).map((u) => u.id) },
      { id: "quiet", label: "De proyectos sin actividad", ids: users.filter((u) => quiet.has(u.id)).map((u) => u.id) },
      { id: "demo", label: "Usuarios demo", ids: users.filter((u) => u.isDemo).map((u) => u.id) },
      { id: "admins", label: "Administradores", ids: users.filter((u) => u.role === "admin").map((u) => u.id) },
    ];
  }, [users, projects, stats]);

  const resolve = (d: Draft): { all: boolean; ids: string[]; label: string } => {
    if (d.mode === "all") return { all: true, ids: users.map((u) => u.id), label: "Todos" };
    if (d.mode === "projects") {
      const ids = new Set(projects.filter((p) => d.ids.includes(p.id)).flatMap((p) => p.members.map((m) => m.uid)));
      return { all: false, ids: Array.from(ids), label: projects.filter((p) => d.ids.includes(p.id)).map((p) => p.name).join(", ") || "Proyectos" };
    }
    if (d.mode === "accounts") {
      const pids = projects.filter((p) => p.producers.some((x) => d.ids.includes(x))).map((p) => p.id);
      const ids = new Set([...users.filter((u) => u.companyId && d.ids.includes(u.companyId)).map((u) => u.id), ...projects.filter((p) => pids.includes(p.id)).flatMap((p) => p.members.map((m) => m.uid))]);
      return { all: false, ids: Array.from(ids), label: producers.filter((p) => d.ids.includes(p.id)).map((p) => p.name).join(", ") || "Cuentas" };
    }
    if (d.mode === "users") return { all: false, ids: d.ids, label: `${d.ids.length} usuario${d.ids.length === 1 ? "" : "s"}` };
    const seg = segments.find((s) => s.id === d.segment);
    return { all: false, ids: seg?.ids || [], label: seg?.label || "Segmento" };
  };

  const audience = draft ? resolve(draft) : null;

  const publish = async () => {
    if (!draft || !audience) return;
    if (!emailOnly && !draft.title.trim()) { showToast("error", "Pon un título"); return; }
    if (emailOnly && (!subject.trim() || !draft.body.trim())) { showToast("error", "Escribe el asunto y el mensaje"); return; }
    if (audience.ids.length === 0) { showToast("error", "No hay nadie en ese público"); return; }
    if ((draft.email || emailOnly) && confirmCount === null) { setConfirmCount(audience.ids.length); return; }
    setSaving(true);
    try {
      if (!emailOnly) {
        const startsMs = new Date(draft.startsAt).getTime() || Date.now();
        const endsMs = draft.ends === "none" ? null : draft.ends === "custom" ? new Date(draft.endsAt).getTime() : startsMs + Number(draft.ends) * DAY;
        const data = {
          kind: draft.kind, level: draft.level, title: draft.title.trim(), body: draft.body.trim(),
          link: draft.linkUrl.trim() ? { label: draft.linkLabel.trim() || "Ver más", url: draft.linkUrl.trim() } : null,
          active: true, audienceAll: audience.all, audienceUserIds: audience.all ? [] : audience.ids, audienceLabel: audience.label,
          startsAt: Timestamp.fromMillis(startsMs), endsAt: endsMs ? Timestamp.fromMillis(endsMs) : null,
          createdByName: me?.name || me?.email || "Admin",
        };
        if (draft.id) await updateDoc(doc(db, "announcements", draft.id), data);
        else await setDoc(doc(collection(db, "announcements")), { ...data, createdAt: serverTimestamp(), createdBy: me?.uid || "" });
      }
      if (draft.email || emailOnly) {
        const emails = audience.ids.map((id) => users.find((u) => u.id === id)?.email).filter(Boolean) as string[];
        const content = emailOnly ? draft.body.trim() : `${draft.title.trim()}\n\n${draft.body.trim()}${draft.linkUrl ? `\n\n${draft.linkUrl}` : ""}`;
        const { sent } = await adminFetch<{ sent: number }>("/api/send-broadcast", { to: emails, content, subject: emailOnly ? subject.trim() : draft.title.trim() });
        await addDoc(collection(db, "adminAuditLog"), {
          action: "broadcast_sent", details: `"${(emailOnly ? subject : draft.title).trim().slice(0, 140)}" → ${sent} email${sent === 1 ? "" : "s"} (${audience.label})`,
          adminId: me?.uid || "", adminName: me?.name || me?.email || "Admin", createdAt: serverTimestamp(),
        }).catch(() => {});
      }
      showToast("success", emailOnly ? "Comunicado enviado" : draft.id ? "Aviso actualizado" : "Aviso publicado");
      closeDraft();
      load();
    } catch (e) { showToast("error", (e as Error).message || "No se pudo publicar"); } finally { setSaving(false); }
  };

  const closeDraft = () => { setDraft(null); setConfirmCount(null); setPick(""); if (params.get("new")) router.replace("/admindashboard/announcements"); };
  const edit = (a: Announcement) => {
    setEmailOnly(false);
    setDraft({
      id: a.id, kind: a.kind, level: a.level, title: a.title, body: a.body, linkLabel: a.link?.label || "", linkUrl: a.link?.url || "",
      mode: a.audienceAll ? "all" : "users", ids: a.audienceAll ? [] : a.audienceUserIds, segment: "budgeting",
      startsAt: toLocal(a.startsAt?.toMillis?.() ?? Date.now()), ends: a.endsAt ? "custom" : "none", endsAt: toLocal(a.endsAt?.toMillis?.() ?? Date.now() + 7 * DAY), email: false,
    });
  };

  const now = Date.now();
  const inTab = (a: Announcement, t: Tab) =>
    t === "changelog" ? a.kind === "changelog" :
    a.kind !== "banner" ? false :
    t === "live" ? isLive(a) :
    t === "scheduled" ? a.active && (a.startsAt?.toMillis?.() ?? 0) > now :
    !a.active || (a.endsAt?.toMillis?.() ?? Infinity) <= now;
  const shown = items.filter((a) => inTab(a, tab));

  if (loading) return <PageLoading />;

  const stateOf = (a: Announcement): { label: string; tone: Tone } =>
    isLive(a) ? { label: "Publicado", tone: "ok" } : !a.active ? { label: "Desactivado", tone: "none" } : (a.startsAt?.toMillis?.() ?? 0) > now ? { label: "Programado", tone: "info" } : { label: "Terminado", tone: "none" };

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Avisos <span className="text-[15px] font-normal text-slate-400">{items.filter((a) => isLive(a)).length}</span></>}
        actions={
          <>
            <Button onClick={() => { setEmailOnly(true); setSubject(""); setDraft({ ...blankDraft(), email: true }); }}><Mail size={14} /> Comunicado por email</Button>
            <Button onClick={() => { setEmailOnly(false); setDraft(blankDraft("changelog")); }}><Sparkles size={14} /> Novedades</Button>
            <Button variant="primary" onClick={() => { setEmailOnly(false); setDraft(blankDraft("banner")); }}><Plus size={14} /> Nuevo aviso</Button>
          </>
        }
      />

      <div className="mt-6">
        <Pills value={tab} onChange={setTab} label="Avisos" options={[
          { value: "live", label: "Publicados", count: items.filter((a) => inTab(a, "live")).length },
          { value: "scheduled", label: "Programados", count: items.filter((a) => inTab(a, "scheduled")).length },
          { value: "past", label: "Terminados", count: items.filter((a) => inTab(a, "past")).length },
          { value: "changelog", label: "Novedades", count: items.filter((a) => a.kind === "changelog").length },
          { value: "emails", label: "Comunicados por email", count: broadcasts.length },
        ]} />
      </div>

      {tab === "emails" ? (
        broadcasts.length === 0 ? <div className="mt-4"><EmptyState title="Todavía no se ha enviado ningún comunicado" /></div> : (
          <table className="tbl mt-4 w-full table-fixed text-[13px]">
            <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Comunicado</th><th className="w-44 px-3">Enviado por</th><th className="w-40 px-3">Cuándo</th></tr></thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}><td className="py-1.5 pl-4 pr-3"><div className="truncate text-slate-900">{b.details}</div></td><td className="px-3 text-slate-600">{b.adminName}</td><td className="px-3 text-slate-500" title={fmtDate(b.createdAt, true)}>{timeAgo(b.createdAt)}</td></tr>
              ))}
            </tbody>
          </table>
        )
      ) : shown.length === 0 ? <div className="mt-4"><EmptyState title="Nada por aquí" /></div> : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Aviso</th><th className="w-56 px-3">Para</th><th className="w-36 px-3">Desde</th><th className="w-36 px-3">Hasta</th><th className="w-32 px-3">Estado</th><th className="w-10" /></tr></thead>
          <tbody>
            {shown.map((a) => {
              const st = stateOf(a);
              return (
                <tr key={a.id} onClick={() => edit(a)} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={a.level === "warning" ? "warn" : a.level === "success" ? "ok" : "info"} /><div className="truncate font-medium text-slate-900">{a.title}</div><div className="truncate text-xs text-slate-500">{a.body}</div></td>
                  <td className="px-3 text-slate-600"><span className="block truncate">{a.audienceAll ? "Todos" : a.audienceLabel || `${a.audienceUserIds.length} usuarios`}</span></td>
                  <td className="px-3 text-slate-600">{fmtDate(a.startsAt)}</td>
                  <td className="px-3 text-slate-600">{a.endsAt ? fmtDate(a.endsAt) : "Sin fin"}</td>
                  <td className={`px-3 ${st.tone === "ok" ? "text-emerald-700" : st.tone === "info" ? "text-blue-700" : "text-slate-500"}`}>{st.label}</td>
                  <td className="px-1" onClick={(e) => e.stopPropagation()}>
                    <Menu trigger={(t) => <IconButton label="Acciones" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                      {(close) => (
                        <>
                          <MenuItem onClick={() => { close(); edit(a); }}>Editar</MenuItem>
                          <MenuItem onClick={async () => { close(); await updateDoc(doc(db, "announcements", a.id), { active: !a.active }); load(); }}>{a.active ? "Desactivar" : "Activar"}</MenuItem>
                          <MenuItem onClick={() => { close(); edit({ ...a, id: "" } as Announcement); setDraft((d) => d && { ...d, id: undefined, startsAt: toLocal(Date.now()) }); }}>Duplicar</MenuItem>
                          <MenuSeparator />
                          <MenuItem danger onClick={async () => { close(); await deleteDoc(doc(db, "announcements", a.id)); load(); }}>Eliminar</MenuItem>
                        </>
                      )}
                    </Menu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Editor */}
      <Modal
        open={!!draft}
        onClose={closeDraft}
        width="max-w-4xl"
        title={emailOnly ? "Comunicado por email" : draft?.id ? "Editar aviso" : draft?.kind === "changelog" ? "Publicar novedades" : "Nuevo aviso"}
        footer={draft && (
          <>
            <span className="mr-auto text-xs text-slate-500">{audience?.all ? `Todos los usuarios (${users.length})` : `${audience?.ids.length || 0} personas`}</span>
            <Button variant="ghost" onClick={closeDraft}>Cancelar</Button>
            <Button variant="primary" onClick={publish} disabled={saving}>
              {saving ? "Publicando…" : confirmCount !== null ? `Confirmar: enviar a ${confirmCount}` : emailOnly ? "Enviar" : draft.id ? "Guardar" : "Publicar"}
            </Button>
          </>
        )}
      >
        {draft && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex flex-col gap-4">
              {!emailOnly && !draft.id && (
                <Segmented value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v, ends: v === "changelog" ? "30" : draft.ends })} options={[{ value: "banner", label: "Aviso" }, { value: "changelog", label: "Novedades" }]} />
              )}
              {emailOnly ? (
                <Field label="Asunto"><Input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus /></Field>
              ) : (
                <div className="grid grid-cols-[1fr_150px] gap-3">
                  <Field label="Título"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus /></Field>
                  {draft.kind === "banner" && (
                    <Field label="Tono">
                      <Select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value as Draft["level"] })}>
                        <option value="info">Información</option><option value="warning">Importante</option><option value="success">Buena noticia</option>
                      </Select>
                    </Field>
                  )}
                </div>
              )}
              <Field label={emailOnly ? "Mensaje" : "Texto"}><Textarea rows={emailOnly ? 7 : 4} value={draft.body} onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setConfirmCount(null); }} /></Field>
              {!emailOnly && (
                <div className="grid grid-cols-[160px_1fr] gap-3">
                  <Field label="Enlace (texto)"><Input value={draft.linkLabel} onChange={(e) => setDraft({ ...draft, linkLabel: e.target.value })} placeholder="Ver más" /></Field>
                  <Field label="Enlace (dirección)"><Input value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} placeholder="/guias/… o https://…" /></Field>
                </div>
              )}

              <Field label="Para">
                <Select value={draft.mode} onChange={(e) => { setDraft({ ...draft, mode: e.target.value as AudMode, ids: [] }); setConfirmCount(null); }}>
                  <option value="all">Todos los usuarios</option>
                  <option value="projects">Equipos de proyectos concretos</option>
                  <option value="accounts">Cuentas (productoras)</option>
                  <option value="users">Usuarios concretos</option>
                  <option value="segment">Un segmento</option>
                </Select>
              </Field>
              {draft.mode === "segment" && (
                <Select value={draft.segment} onChange={(e) => { setDraft({ ...draft, segment: e.target.value }); setConfirmCount(null); }}>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.ids.length})</option>)}
                </Select>
              )}
              {(draft.mode === "projects" || draft.mode === "accounts" || draft.mode === "users") && (
                <div>
                  <Select value={pick} onChange={(e) => { const v = e.target.value; if (v && !draft.ids.includes(v)) setDraft({ ...draft, ids: [...draft.ids, v] }); setPick(""); setConfirmCount(null); }}>
                    <option value="" disabled>Añadir…</option>
                    {(draft.mode === "projects" ? projects.map((p) => ({ id: p.id, label: p.name })) : draft.mode === "accounts" ? producers.map((p) => ({ id: p.id, label: p.name })) : users.map((u) => ({ id: u.id, label: `${u.name} · ${u.email}` })))
                      .filter((o) => !draft.ids.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draft.ids.map((id) => {
                      const label = draft.mode === "projects" ? projects.find((p) => p.id === id)?.name : draft.mode === "accounts" ? producers.find((p) => p.id === id)?.name : users.find((u) => u.id === id)?.name;
                      return <button key={id} onClick={() => setDraft({ ...draft, ids: draft.ids.filter((x) => x !== id) })} className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-red-200 hover:text-red-700">{label || id} ×</button>;
                    })}
                  </div>
                </div>
              )}

              {!emailOnly && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Desde"><Input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
                  <Field label="Hasta">
                    <div className="flex gap-2">
                      <div className="w-32 flex-shrink-0">
                        <Select value={draft.ends} onChange={(e) => setDraft({ ...draft, ends: e.target.value as Draft["ends"] })}>
                          <option value="1">1 día</option><option value="7">7 días</option><option value="30">30 días</option><option value="none">Sin fin</option><option value="custom">Fecha…</option>
                        </Select>
                      </div>
                      {draft.ends === "custom" && <Input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />}
                    </div>
                  </Field>
                </div>
              )}
              {!emailOnly && <Checkbox checked={draft.email} onChange={(v) => { setDraft({ ...draft, email: v }); setConfirmCount(null); }} label="Enviar también por email" hint="Con el título como asunto." />}
              {confirmCount !== null && <p className="rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2 text-xs text-amber-900">Se enviará un email a {confirmCount} persona{confirmCount === 1 ? "" : "s"}. Pulsa otra vez para confirmar.</p>}
            </div>

            {/* Vista previa */}
            <div>
              <p className="mb-2 text-xs text-slate-500">Vista previa</p>
              {emailOnly ? (
                <div className="rounded-lg border border-slate-200 p-4 text-[13px]">
                  <p className="font-semibold text-slate-900">{subject || "Asunto"}</p>
                  <p className="mt-2 whitespace-pre-line text-slate-600">{draft.body || "Mensaje…"}</p>
                </div>
              ) : draft.kind === "changelog" ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Sparkles size={12} /> Novedades</p>
                  <p className="text-sm font-semibold text-slate-900">{draft.title || "Título"}</p>
                  <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{draft.body || "Texto…"}</p>
                  {draft.linkUrl && <p className="mt-1 text-[13px] font-medium text-slate-900">{draft.linkLabel || "Ver más"} →</p>}
                </div>
              ) : (
                <div className={`flex gap-3 rounded-xl border bg-white p-3.5 shadow-lg ${draft.level === "warning" ? "border-amber-200" : draft.level === "success" ? "border-emerald-200" : "border-slate-200"}`}>
                  <span className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${draft.level === "warning" ? "bg-amber-50 text-amber-600" : draft.level === "success" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-600"}`}><Megaphone size={14} /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{draft.title || "Título"}</p>
                    <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{draft.body || "Texto…"}</p>
                    {draft.linkUrl && <p className="mt-1 text-[13px] font-medium text-slate-900">{draft.linkLabel || "Ver más"} →</p>}
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                {emailOnly ? "Cada persona recibe su propio email." : draft.kind === "changelog" ? "Cada usuario lo ve una vez, abajo a la izquierda, hasta que lo cierra." : "Aparece abajo a la izquierda en todas las páginas hasta que lo cierren o termine."}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default function AnnouncementsPage() {
  return <Suspense fallback={<PageLoading />}><AnnouncementsInner /></Suspense>;
}
