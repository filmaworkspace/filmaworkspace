"use client";

// Admin · Aprobaciones de un proyecto: qué está pendiente, bloqueado o
// rechazado, quién falta, y herramientas para reanudar o cambiar el flujo de
// un documento concreto o de todos a la vez.

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Segmented, Select, useToast } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { Pills, RowBar, timeAgo, fmtDate, type Tone } from "@/components/admin/ui";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { ApprovalSteps, PendingApprovalNotice } from "@/components/accounting/ApprovalFlow";
import { hasAccountingAccess, pendingSummary, stepLabel, type ApprovalStepState, type FlowMember } from "@/lib/approvalFlow";
import {
  FLOW_ACTION_LABEL, forceApprove, isAwaitingApproval, isRejected, loadFlowContext, rebuildDoc, reassignStep, repairDoc,
  replaceApprover, resumeFrom, skipStep, type FlowActor, type FlowDocType, type FlowAction,
} from "@/lib/approvalActions";

type AnyDoc = Record<string, any>;
type State = "pending" | "blocked" | "rejected";
type Ctx = Awaited<ReturnType<typeof loadFlowContext>>;

interface Row {
  type: FlowDocType;
  id: string;
  number: string;
  supplier: string;
  base: number;
  department: string;
  state: State;
  level: string;
  who: string;
  since: unknown;
  d: AnyDoc;
}

const STATE_TONE: Record<State, Tone> = { pending: "warn", blocked: "bad", rejected: "none" };
const STATE_LABEL: Record<State, string> = { pending: "Pendiente", blocked: "Bloqueado", rejected: "Rechazado" };
const eur = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);
const docNumber = (type: FlowDocType, d: AnyDoc) => d.displayNumber || `${type === "po" ? "PO" : "INV"}-${String(d.number ?? "").padStart(4, "0")}`;

const FIELDS: SearchField<"all">[] = [{ value: "all", label: "Buscar", placeholder: "Número, proveedor o aprobador" }];

/** Clasifica un documento y explica qué le pasa. Null si no está en circuito. */
function classify(type: FlowDocType, id: string, d: AnyDoc, members: FlowMember[]): Row | null {
  const base = { type, id, d, number: docNumber(type, d), supplier: d.supplier || d.supplierName || "—", base: d.baseAmount || 0, department: d.department || "" };
  const steps: ApprovalStepState[] = d.approvalSteps || [];
  if (isRejected(type, d)) {
    if (!steps.length) return null;
    return { ...base, state: "rejected", level: "", who: d.rejectionReason ? `${d.rejectedByName || ""}: ${d.rejectionReason}` : d.rejectedByName || "", since: d.rejectedAt || d.updatedAt || d.createdAt };
  }
  if (!isAwaitingApproval(type, d)) return null;
  const since = d.updatedAt || d.createdAt;
  if (!steps.length) return { ...base, state: "blocked", level: "—", who: "Sin flujo de aprobación", since };
  const p = pendingSummary(d);
  const counted = steps.filter((s) => s.status !== "skipped").length;
  const level = p.currentIndex >= 0 ? `${p.currentIndex + 1}/${steps.length}` : `—/${counted}`;
  if (p.state === "blocked") return { ...base, state: "blocked", level, who: p.blockedReason || "Bloqueado", since };
  if (p.state === "approved") return { ...base, state: "blocked", level, who: "Todos los niveles completos pero sin cerrar", since };
  // Aprobadores que ya no pueden aprobar (fuera del proyecto o sin contabilidad).
  const byId = new Map(members.map((m) => [m.userId, m]));
  const gone = p.waitingFor.filter((w) => !byId.get(w.uid) || !hasAccountingAccess(byId.get(w.uid)!));
  if (gone.length && gone.length === p.waitingFor.length) return { ...base, state: "blocked", level, who: `${gone.map((g) => g.name).join(", ")} ya no puede aprobar`, since };
  return { ...base, state: "pending", level, who: p.waitingFor.map((w) => w.name).join(", ") + (gone.length ? ` (${gone.map((g) => g.name).join(", ")} ya no puede)` : ""), since };
}

export function ProjectApprovals({ projectId, onLog }: { projectId: string; onLog?: (type: string, data: Record<string, unknown>) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | State>("open");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toastNode, toast] = useToast();
  // Modales
  const [confirm, setConfirm] = useState<null | { title: string; label: string; notice?: React.ReactNode; password?: boolean; reason?: boolean; danger?: boolean; run: (why: string) => Promise<void> }>(null);
  const [reassign, setReassign] = useState<null | { row: Row; index: number }>(null);
  const [replace, setReplace] = useState(false);

  const actor = (): FlowActor => ({ uid: auth.currentUser?.uid || "", name: auth.currentUser?.displayName || auth.currentUser?.email || "Admin", admin: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, pos, invs] = await Promise.all([
        loadFlowContext(projectId),
        getDocs(collection(db, `projects/${projectId}/pos`)),
        getDocs(collection(db, `projects/${projectId}/invoices`)),
      ]);
      const out: Row[] = [];
      for (const s of pos.docs) { const r = classify("po", s.id, s.data(), c.members); if (r) out.push(r); }
      for (const s of invs.docs) { const r = classify("invoice", s.id, s.data(), c.members); if (r) out.push(r); }
      out.sort((a, b) => (a.state === b.state ? a.number.localeCompare(b.number) : a.state === "blocked" ? -1 : b.state === "blocked" ? 1 : a.state === "pending" ? -1 : 1));
      setCtx(c); setRows(out);
    } catch (e) {
      toast("error", "No se pudieron cargar las aprobaciones");
      console.error(e);
    } finally { setLoading(false); }
  }, [projectId, toast]);

  useEffect(() => { load(); }, [load]);

  const inTab = (r: Row, t: typeof tab) => (t === "open" ? r.state !== "rejected" : r.state === t);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => inTab(r, tab) && (!needle || [r.number, r.supplier, r.who, r.department].join(" ").toLowerCase().includes(needle)));
  }, [rows, tab, q]);
  const current = rows.find((r) => `${r.type}:${r.id}` === openId) || null;

  const log = (action: FlowAction, r: Row | null, meta: string) =>
    onLog?.("approval_admin", { actorName: actor().name, targetName: r ? r.number : "Varios documentos", meta: `${FLOW_ACTION_LABEL[action]}${meta ? ` · ${meta}` : ""}` });

  const after = async (msg: string) => { toast("success", msg); await load(); };
  const fail = (e: unknown) => toast("error", (e as Error).message || "No se pudo completar");

  // ── Acciones de un documento ────────────────────────────────────────────
  const doRepair = async (r: Row) => {
    try { const x = await repairDoc(projectId, r.type, r.id, actor()); log("repair", r, ""); await after(x.changed ? (x.complete ? `${r.number} reparado y aprobado` : `${r.number} reparado`) : "No había nada que reparar"); } catch (e) { fail(e); }
  };
  const doRebuild = async (r: Row) => {
    if (!ctx) return;
    try { const x = await rebuildDoc(projectId, r.type, r.id, actor(), ctx); log("rebuild", r, ""); await after(x.complete ? `${r.number} recalculado: queda aprobado` : `${r.number} recalculado`); } catch (e) { fail(e); }
  };
  const askSkip = (r: Row, i: number) => setConfirm({
    title: `Omitir nivel ${i + 1} de ${r.number}`, label: "Omitir nivel", reason: true, password: false,
    notice: "El documento pasa al siguiente nivel. Si no queda ninguno, queda aprobado (y se compromete o realiza presupuesto).",
    run: async (why) => { const x = await skipStep(projectId, r.type, r.id, i, actor(), why); log("skip", r, `nivel ${i + 1}: ${why}`); await after(x.complete ? `${r.number} aprobado` : "Nivel omitido"); },
  });
  const askResume = (r: Row, i: number) => setConfirm({
    title: `Reanudar ${r.number} desde el nivel ${i + 1}`, label: "Reanudar", reason: true, password: false, danger: false,
    notice: "Se anula el rechazo. Ese nivel y los siguientes vuelven a estar pendientes.",
    run: async (why) => { const x = await resumeFrom(projectId, r.type, r.id, i, actor(), why); log("resume", r, `desde nivel ${i + 1}: ${why}`); await after(x.complete ? `${r.number} aprobado` : `${r.number} reanudado`); },
  });
  const askForce = (r: Row) => setConfirm({
    title: `Forzar aprobación de ${r.number}`, label: "Aprobar", reason: true, password: true,
    notice: "Se aprueban todos los niveles que faltan en tu nombre. Queda registrado con el motivo.",
    run: async (why) => { await forceApprove(projectId, r.type, r.id, actor(), why); log("force_approve", r, why); await after(`${r.number} aprobado`); },
  });

  // ── Acciones en bloque ──────────────────────────────────────────────────
  const openRows = rows.filter((r) => r.state !== "rejected");
  const bulk = async (label: string, action: FlowAction, fn: (r: Row) => Promise<{ changed: boolean; complete: boolean }>) => {
    let changed = 0, approved = 0, errors = 0;
    for (const r of openRows) {
      try { const x = await fn(r); if (x.changed) changed++; if (x.complete) approved++; } catch { errors++; }
    }
    log(action, null, `${changed} cambiados, ${approved} aprobados${errors ? `, ${errors} errores` : ""}`);
    await after(`${label}: ${changed} cambiados${approved ? `, ${approved} aprobados` : ""}${errors ? `, ${errors} con error` : ""}`);
  };
  const askBulkRepair = () => setConfirm({
    title: "Reparar todos los pendientes", label: "Reparar", password: false,
    notice: <>Revisa {openRows.length} documento{openRows.length === 1 ? "" : "s"}: omite niveles sin aprobador o que no aplican por importe. Las firmas hechas se conservan.</>,
    run: () => bulk("Reparados", "repair", (r) => repairDoc(projectId, r.type, r.id, actor())),
  });
  const askBulkRebuild = () => setConfirm({
    title: "Recalcular todos con la configuración actual", label: "Recalcular", password: true,
    notice: <>Vuelve a calcular el flujo de {openRows.length} documento{openRows.length === 1 ? "" : "s"} con los niveles de Ajustes y el equipo actual. Se conservan las firmas de quien siga siendo aprobador del mismo nivel.</>,
    run: () => bulk("Recalculados", "rebuild", (r) => rebuildDoc(projectId, r.type, r.id, actor(), ctx!)),
  });

  const counts = { open: openRows.length, blocked: rows.filter((r) => r.state === "blocked").length, rejected: rows.filter((r) => r.state === "rejected").length };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills value={tab} onChange={setTab} label="Filtro" options={[
          { value: "open", label: "En circuito", count: counts.open },
          { value: "blocked", label: "Bloqueados", count: counts.blocked },
          { value: "rejected", label: "Rechazados", count: counts.rejected },
        ]} />
        <div className="flex items-center gap-2">
          <IconButton label="Actualizar" onClick={load}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></IconButton>
          <Menu trigger={(t) => <Button onClick={t}>Cambiar en todos <MoreHorizontal size={14} /></Button>}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); askBulkRepair(); }}>Reparar bloqueados</MenuItem>
                <MenuItem onClick={() => { close(); askBulkRebuild(); }}>Recalcular con la configuración actual</MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => { close(); setReplace(true); }}>Sustituir a un aprobador…</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
      <div className="mt-3">
        <SearchBar fields={FIELDS} field="all" onField={() => {}} value={q} onChange={setQ} count={shown.length} />
      </div>

      {!loading && shown.length === 0 ? (
        <div className="mt-4"><EmptyState title={tab === "rejected" ? "Sin documentos rechazados" : tab === "blocked" ? "Ningún flujo bloqueado" : "Nada pendiente de aprobación"} /></div>
      ) : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left">
              <th className="w-32 py-2 pl-4 pr-3">Documento</th>
              <th className="px-3">Proveedor</th>
              <th className="w-32 px-3 text-right">Base</th>
              <th className="w-16 px-3">Nivel</th>
              <th className="w-[34%] px-3">Pendiente de</th>
              <th className="w-24 px-3">Espera</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.type}:${r.id}`} onClick={() => setOpenId(`${r.type}:${r.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]" title={STATE_LABEL[r.state]}>
                <td className="relative py-1.5 pl-4 pr-3 font-mono text-slate-900"><RowBar tone={STATE_TONE[r.state]} />{r.number}</td>
                <td className="truncate px-3 text-slate-700">{r.supplier}{r.department && <span className="text-slate-400"> · {r.department}</span>}</td>
                <td className="px-3 text-right font-mono tabular-nums">{eur(r.base)}</td>
                <td className="px-3 font-mono text-slate-500">{r.level}</td>
                <td className={`truncate px-3 ${r.state === "blocked" ? "text-red-600" : r.state === "rejected" ? "text-slate-500" : "text-slate-700"}`} title={r.who}>{r.who}</td>
                <td className="px-3 text-slate-500" title={fmtDate(r.since as never, true)}>{r.since ? timeAgo(r.since as never) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Detalle de un documento */}
      <Modal open={!!current} onClose={() => setOpenId(null)} title={current ? `${current.number} · ${current.supplier}` : ""} width="max-w-2xl"
        footer={current && (
          <>
            {current.state !== "rejected" && <Button onClick={() => doRepair(current)}>Reparar</Button>}
            {current.state !== "rejected" && <Button onClick={() => doRebuild(current)}>Recalcular</Button>}
            <Button variant="danger" onClick={() => askForce(current)}>Forzar aprobación</Button>
          </>
        )}>
        {current && (
          <div className="space-y-5">
            <p className="text-[13px] text-slate-500">
              {current.type === "po" ? "Orden de compra" : "Factura"} · Base <span className="font-mono text-slate-900">{eur(current.base)} €</span>
              {current.department && <> · {current.department}</>}
            </p>
            {current.state === "rejected" ? (
              <div className="rounded-lg border border-slate-200 bg-[#FAFAFA] px-3 py-2 text-[13px] text-slate-700">Rechazado{current.who ? ` · ${current.who}` : ""}</div>
            ) : current.d.approvalSteps?.length ? (
              <PendingApprovalNotice doc={current.d} />
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">Sin flujo de aprobación. Usa “Recalcular” para crearlo con la configuración actual.</div>
            )}
            <ApprovalSteps steps={current.d.approvalSteps || []} current={current.d.currentApprovalStep} department={current.department}
              action={(s, i) => s.status === "approved" ? null : (
                <Menu trigger={(t) => <IconButton label="Acciones del nivel" onClick={t}><MoreHorizontal size={14} /></IconButton>}>
                  {(close) => (
                    <>
                      {current.state !== "rejected" && <MenuItem onClick={() => { close(); setReassign({ row: current, index: i }); }}>Cambiar aprobadores</MenuItem>}
                      {current.state !== "rejected" && s.status !== "skipped" && <MenuItem onClick={() => { close(); askSkip(current, i); }}>Omitir nivel</MenuItem>}
                      {current.state === "rejected" && <MenuItem onClick={() => { close(); askResume(current, i); }}>Reanudar desde aquí</MenuItem>}
                    </>
                  )}
                </Menu>
              )} />
            {(current.d.approvalLog || []).length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-slate-500">Historial de cambios del flujo</p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[12px]">
                  {[...(current.d.approvalLog as AnyDoc[])].reverse().map((l, k) => (
                    <li key={k} className="flex gap-3 px-3 py-1.5">
                      <span className="w-28 shrink-0 text-slate-400">{fmtDate(l.at, true)}</span>
                      <span className="min-w-0 flex-1 text-slate-700">
                        {FLOW_ACTION_LABEL[l.action as FlowAction] || l.action}{l.detail ? ` · ${l.detail}` : ""}{l.note ? <span className="text-slate-500"> — {l.note}</span> : null}
                      </span>
                      <span className="shrink-0 text-slate-500">{l.byName}{l.admin ? " (admin)" : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {reassign && ctx && (
        <ReassignModal
          row={reassign.row} index={reassign.index} members={ctx.members}
          onClose={() => setReassign(null)}
          onSave={async (people, requireAll, note) => {
            const r = reassign.row;
            const x = await reassignStep(projectId, r.type, r.id, reassign.index, people, requireAll, actor(), note);
            log("reassign", r, `nivel ${reassign.index + 1}: ${people.map((p) => p.name).join(", ")}`);
            setReassign(null);
            await after(x.complete ? `${r.number} aprobado` : "Aprobadores cambiados");
          }}
        />
      )}

      {replace && ctx && (
        <ReplaceModal
          rows={openRows} members={ctx.members}
          onClose={() => setReplace(false)}
          onSave={async (from, to, note) => {
            let n = 0, errors = 0;
            for (const r of openRows) {
              try { const x = await replaceApprover(projectId, r.type, r.id, from, to, actor(), note); if (x.changed) n++; } catch { errors++; }
            }
            log("reassign", null, `sustituye ${ctx.members.find((m) => m.userId === from)?.name || from}${to ? ` por ${to.name}` : ""} en ${n} documentos`);
            setReplace(false);
            await after(`${n} documento${n === 1 ? "" : "s"} actualizado${n === 1 ? "" : "s"}${errors ? ` · ${errors} con error` : ""}`);
          }}
        />
      )}

      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title || ""}
        confirmLabel={confirm?.label || ""}
        notice={confirm?.notice}
        password={!!confirm?.password}
        danger={confirm?.danger !== false}
        reason={confirm?.reason ? { label: "Motivo", placeholder: "Queda en el historial del documento", required: true } : undefined}
        onConfirm={async (why) => { await confirm!.run(why); }}
      />
      {toastNode}
    </div>
  );
}

// ── Cambiar aprobadores de un nivel ─────────────────────────────────────────
function ReassignModal({ row, index, members, onClose, onSave }: {
  row: Row; index: number; members: FlowMember[]; onClose: () => void;
  onSave: (people: FlowMember[], requireAll: boolean, note: string) => Promise<void>;
}) {
  const step: ApprovalStepState = row.d.approvalSteps[index];
  const eligible = members.filter(hasAccountingAccess).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const [sel, setSel] = useState<string[]>((step.approvers || []).filter((u) => eligible.some((m) => m.userId === u)));
  const [all, setAll] = useState<"one" | "all">(step.requireAll ? "all" : "one");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (u: string, on: boolean) => setSel((s) => (on ? [...s, u] : s.filter((x) => x !== u)));
  return (
    <Modal open onClose={onClose} title={`Nivel ${index + 1} · ${stepLabel(step, row.department)}`} width="max-w-lg"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={!sel.length || busy} onClick={async () => {
          setBusy(true); setError("");
          try { await onSave(eligible.filter((m) => sel.includes(m.userId)), all === "all", note.trim()); } catch (e) { setError((e as Error).message); setBusy(false); }
        }}>{busy ? "Guardando…" : "Guardar"}</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-[13px] text-slate-500">Solo para {row.number}. Las firmas ya hechas por quien siga en la lista se conservan.</p>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 px-3 py-1">
          {eligible.map((m) => (
            <Checkbox key={m.userId} checked={sel.includes(m.userId)} onChange={(v) => toggle(m.userId, v)} label={m.name || m.email || m.userId}
              hint={[m.role, m.position, m.department].filter(Boolean).join(" · ") || undefined} />
          ))}
        </div>
        <Field label="Quién tiene que aprobar">
          <Segmented value={all} onChange={setAll} options={[{ value: "one", label: "Basta uno" }, { value: "all", label: "Todos" }]} />
        </Field>
        <Field label="Motivo (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Queda en el historial" /></Field>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}

// ── Sustituir a una persona en todos los documentos pendientes ──────────────
function ReplaceModal({ rows, members, onClose, onSave }: {
  rows: Row[]; members: FlowMember[]; onClose: () => void;
  onSave: (from: string, to: FlowMember | null, note: string) => Promise<void>;
}) {
  // Personas que figuran como pendientes en algún documento.
  const pendingPeople = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of rows) for (const s of (r.d.approvalSteps || []) as ApprovalStepState[]) {
      if (s.status !== "pending") continue;
      (s.approvers || []).forEach((u, k) => { if ((s.approvedBy || []).includes(u)) return; const e = m.get(u) || { name: s.approverNames?.[k] || u, n: 0 }; e.n++; m.set(u, e); });
    }
    return [...m.entries()].map(([uid, v]) => ({ uid, ...v })).sort((a, b) => b.n - a.n);
  }, [rows]);
  const eligible = members.filter(hasAccountingAccess);
  const [from, setFrom] = useState(pendingPeople[0]?.uid || "");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const affected = pendingPeople.find((p) => p.uid === from)?.n || 0;
  return (
    <Modal open onClose={onClose} title="Sustituir a un aprobador" width="max-w-md"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={!from || busy || from === to} onClick={async () => {
          setBusy(true); setError("");
          try { await onSave(from, eligible.find((m) => m.userId === to) || null, note.trim()); } catch (e) { setError((e as Error).message); setBusy(false); }
        }}>{busy ? "Aplicando…" : "Aplicar"}</Button>
      </>}>
      {pendingPeople.length === 0 ? <p className="text-[13px] text-slate-500">Nadie tiene aprobaciones pendientes.</p> : (
        <div className="space-y-4">
          <Field label="Quitar a">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {pendingPeople.map((p) => <option key={p.uid} value={p.uid}>{`${p.name} · ${p.n} nivel${p.n === 1 ? "" : "es"}`}</option>)}
            </Select>
          </Field>
          <Field label="Poner en su lugar" hint="Sin nadie, el nivel se omite si se queda vacío">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Nadie</option>
              {eligible.filter((m) => m.userId !== from).map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email || m.userId}</option>)}
            </Select>
          </Field>
          <Field label="Motivo (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Queda en el historial" /></Field>
          <p className="text-xs text-slate-500">Afecta a {affected} nivel{affected === 1 ? "" : "es"} pendiente{affected === 1 ? "" : "s"}. Solo cambia niveles aún sin firmar por esa persona.</p>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
