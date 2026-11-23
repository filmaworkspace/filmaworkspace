"use client";

// ─── Presupuesto ─────────────────────────────────────────────────────────────
// Borrador editable (se guarda solo) con vista previa en directo. Al emitirlo
// recibe número (P2026-0001) y queda fijo; luego se marca aceptado o
// rechazado, se descarga en PDF, se envía por email y de él salen las
// facturas: un mes concreto (cuota mensual) o un porcentaje (pago único).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { ArrowLeft, Check, Copy, FileSignature, Download, FileText, Mail, MoreHorizontal, Plus, Send, Trash2, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Badge, Button, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Page, PageLoading, Segmented, Select, Textarea, useToast } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { BlockTitle, RowBar } from "@/components/admin/ui";
import { DocPreview } from "@/components/admin/billing/DocPreview";
import { LinesEditor } from "@/components/admin/billing/LinesEditor";
import { ClientCard, SaveState } from "@/components/admin/billing/DocParts";
import { SendToSignModal } from "@/components/sign/SendToSignModal";
import { NewDocModal } from "@/components/admin/billing/NewDocModal";
import { SendDocModal } from "@/components/admin/billing/SendDocModal";
import { invoiceState, useBilling } from "@/components/admin/billing/useBilling";
import { PhasesEditor, PHASE_COLORS } from "@/components/admin/billing/PhasesEditor";
import {
  addDaysIso, BillingQuote, clientFromAccount, fetchUserClient, saveUserClient, countsAsBilled, DEFAULT_PHASES, docSubject, eur, fmtDay, invoiceMonths, invoiceTotals,
  issueQuote, monthName, newLineId, numberingRule, numberTaken, phaseSchedule, phasesToLines, QUOTE_STATUS, quoteGrandTotal, quoteMonths,
  renderNumber, type BillingMode, type QuotePhase,
} from "@/lib/billing";
import { downloadDocPdf, quoteView } from "@/lib/billingPdf";

export default function QuotePage() {
  const { quoteId } = useParams() as { quoteId: string };
  const router = useRouter();
  const { user: me } = useUser();
  const { producerById, projects, users } = useAdminData();
  const { invoices, quotes, settings } = useBilling();
  const [toast, showToast] = useToast();
  const [q, setQ] = useState<BillingQuote | null>(null);
  const [missing, setMissing] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [act, setAct] = useState<null | "issue" | "delete" | "reject">(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [customNumber, setCustomNumber] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const dirty = useRef(false);

  useEffect(() => onSnapshot(doc(db, "billingQuotes", quoteId), (s) => {
    if (!s.exists()) { setMissing(true); return; }
    if (!dirty.current) setQ({ id: s.id, ...s.data() } as BillingQuote);
  }), [quoteId]);

  // Guardado automático del borrador
  useEffect(() => {
    if (!q || q.status !== "draft" || !dirty.current) return;
    setSave("saving");
    const t = setTimeout(async () => {
      try {
        const { id: _id, ...data } = q; void _id;
        await updateDoc(doc(db, "billingQuotes", quoteId), { ...data, ...invoiceTotals(q.lines), updatedAt: serverTimestamp() });
        dirty.current = false; setSave("saved");
      } catch { setSave("error"); }
    }, 700);
    return () => clearTimeout(t);
  }, [q, quoteId]);

  const edit = (patch: Partial<BillingQuote>) => { dirty.current = true; setQ((x) => (x ? { ...x, ...patch } : x)); };
  // Por fases, las líneas del documento salen de las fases (cuota × meses).
  const editPhases = (phases: QuotePhase[]) => edit({ phases, lines: phasesToLines(phases), months: phases.reduce((t, p) => t + (p.months || 0), 0) });
  const setMode = (mode: BillingMode) => {
    if (!q) return;
    const start = q.startMonth || q.issueDate.slice(0, 7);
    if (mode === "phases") {
      const phases = q.phases?.length ? q.phases : (settings.phaseDefaults?.length ? settings.phaseDefaults : DEFAULT_PHASES.map((d) => ({ ...d, price: settings.monthlyPrice || 0 }))).map((d) => ({
        id: newLineId(), name: d.name, months: d.months,
        lines: (q.lines.length ? q.lines : [{ id: newLineId(), description: "Licencia mensual de Filma Workspace", quantity: 1, unitPrice: 0, vatRate: settings.defaultVat || 21 }]).map((l) => ({ ...l, id: newLineId(), quantity: 1, unitPrice: d.price || l.unitPrice })),
      }));
      edit({ billingMode: mode, startMonth: start, phases, lines: phasesToLines(phases), months: phases.reduce((t, p) => t + p.months, 0) });
    } else {
      // Al salir de fases se queda con las líneas mensuales de la primera fase.
      const lines = q.billingMode === "phases" && q.phases?.length ? q.phases[0].lines.map((l) => ({ ...l, id: newLineId() })) : q.lines;
      edit({ billingMode: mode, lines, phases: null, months: mode === "monthly" ? q.months || 12 : null, startMonth: mode === "monthly" ? start : null });
    }
  };

  const linked = useMemo(() => invoices.filter((i) => i.quoteId === quoteId), [invoices, quoteId]);
  const billed = linked.filter(countsAsBilled);
  const view = useMemo(() => (q ? quoteView(q, settings) : null), [q, settings]);

  if (missing) return <Page><p className="text-[13px] text-slate-500">Este presupuesto no existe. <Link href="/admindashboard/accounts/billing?tab=quotes" className="underline">Volver</Link></p></Page>;
  if (!q || !view) return <PageLoading />;

  const draft = q.status === "draft";
  const acc = producerById(q.producerId);
  const usr = q.billTo === "user" ? users.find((u) => u.id === q.userId) : undefined;
  const subject = q.subject || "project";
  const rule = numberingRule(settings, "quote");
  const accProjects = projects.filter((p) => p.producers.includes(q.producerId) && !p.trashedAt);
  const live = draft ? invoiceTotals(q.lines) : q;
  const grand = quoteGrandTotal({ ...q, ...live });
  const billedBase = billed.reduce((s, i) => s + i.baseAmount, 0);
  const pct = grand.base > 0 ? Math.min(100, Math.round((billedBase / grand.base) * 100)) : 0;
  const months = quoteMonths(q);
  const billedMonths = new Map(billed.flatMap((i) => invoiceMonths(i).map((m) => [m, i] as const)));
  const schedule = q.billingMode === "phases" ? phaseSchedule(q) : [];
  const phaseOf = (m: string) => schedule.find((x) => x.month === m);
  const st = QUOTE_STATUS[q.status];
  const problems = [
    !settings.name || !settings.taxId ? "Tus datos fiscales (Facturación → Datos fiscales)" : "",
    !q.client.name || !q.client.taxId ? "Razón social y NIF del cliente" : "",
    !q.projectName && subject !== "budgeting" ? "Proyecto o concepto" : "",
    !q.lines.length || q.lines.some((l) => !l.description.trim()) ? "Líneas con concepto" : "",
  ].filter(Boolean);

  const setStatus = async (status: "accepted" | "rejected" | "sent", note = "") => {
    await updateDoc(doc(db, "billingQuotes", quoteId), {
      status, decisionNote: note || null, acceptedAt: status === "accepted" ? serverTimestamp() : null,
      rejectedAt: status === "rejected" ? serverTimestamp() : null, updatedAt: serverTimestamp(),
    });
    showToast("success", status === "accepted" ? "Presupuesto aceptado" : status === "rejected" ? "Presupuesto rechazado" : "Vuelve a estar enviado");
  };
  const newVersion = async () => {
    const { id: _id, ...rest } = q; void _id;
    const ref = await addDoc(collection(db, "billingQuotes"), {
      ...rest, status: "draft", number: null, series: null, year: null, issuer: null, decisionNote: null, acceptedAt: null, rejectedAt: null, sentAt: null, sentTo: null,
      issueDate: new Date().toISOString().slice(0, 10), validUntil: addDaysIso(new Date().toISOString().slice(0, 10), settings.quoteValidityDays || 30),
      title: q.title, notes: q.number ? `Sustituye al presupuesto ${q.number}.${q.notes ? `\n${q.notes}` : ""}` : q.notes,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    router.push(`/admindashboard/accounts/billing/quotes/${ref.id}`);
  };

  return (
    <Page>
      {toast}
      <Link href="/admindashboard/accounts/billing?tab=quotes" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Facturación</Link>
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          {q.number || "Presupuesto"} <span className="truncate text-[15px] font-normal text-slate-400">{docSubject(q)} · {usr?.name || acc?.name || q.client.name}</span>
          <Badge tone={st.tone === "ok" ? "success" : st.tone === "bad" ? "danger" : st.tone === "info" ? "info" : "neutral"}>{st.label}</Badge>
        </h1>
        <div className="flex items-center gap-2">
          {draft && <SaveState state={save} />}
          <Button onClick={() => downloadDocPdf(view)}><Download size={14} /> PDF</Button>
          {draft ? (
            <Button variant="primary" onClick={() => setAct("issue")}><Send size={14} /> Emitir presupuesto</Button>
          ) : (
            <>
              <Button onClick={() => setSendOpen(true)}><Mail size={14} /> Enviar</Button>
              {q.status !== "rejected" && q.signStatus !== "signed" && q.signStatus !== "pending" && <Button onClick={() => setSignOpen(true)}><FileSignature size={14} /> Firmar con Filma Sign</Button>}
              {q.status === "sent" && <Button onClick={() => setStatus("accepted")}><Check size={14} /> Aceptado</Button>}
              {q.status !== "rejected" && <Button variant="primary" onClick={() => setInvoiceOpen(true)}><FileText size={14} /> Facturar</Button>}
            </>
          )}
          <Menu trigger={(t) => <IconButton label="Más" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); newVersion(); }}><Copy size={13} /> {draft ? "Duplicar" : "Nueva versión"}</MenuItem>
                {q.status === "sent" && <MenuItem onClick={() => { close(); setAct("reject"); }}><X size={13} /> Marcar rechazado</MenuItem>}
                {(q.status === "accepted" || q.status === "rejected") && <MenuItem onClick={() => { close(); setStatus("sent"); }}>Volver a «Enviado»</MenuItem>}
                {draft && <><MenuSeparator /><MenuItem danger onClick={() => { close(); setAct("delete"); }}><Trash2 size={13} /> Borrar borrador</MenuItem></>}
              </>
            )}
          </Menu>
        </div>
      </div>

      {q.signStatus && (
        <Link href="/admindashboard/sign" className={`mt-6 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] ${q.signStatus === "signed" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : q.signStatus === "pending" ? "border-amber-200 bg-[#FFFBEB] text-amber-900" : "border-slate-200 text-slate-600"}`}>
          <FileSignature size={15} />
          <span className="flex-1">{q.signStatus === "signed" ? "Firmado por las dos partes con Filma Sign" : q.signStatus === "pending" ? "Enviado a firmar con Filma Sign · pendiente del cliente" : q.signStatus === "declined" ? "El cliente rechazó firmarlo" : "Solicitud de firma cancelada"}</span>
          <span className="text-xs opacity-70">Ver en Filma Sign →</span>
        </Link>
      )}

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_560px]">
        <div className="min-w-0 space-y-8">
          {!draft && (
            <section>
              <BlockTitle action={q.status !== "rejected" && <Button size="sm" onClick={() => setInvoiceOpen(true)}><Plus size={13} /> Factura</Button>}>
                Facturado · <span className="text-slate-900">{eur(billedBase)}</span> de {eur(grand.base)} <span className="text-slate-400">+ IVA</span>
              </BlockTitle>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#24406E" }} /></div>
              {q.billingMode !== "single" && months.length > 0 && (
                <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                  {months.map((m) => {
                    const inv = billedMonths.get(m);
                    const ph = phaseOf(m);
                    return (
                      <button key={m} title={`${monthName(m)}${ph ? ` · ${ph.phase.name}` : ""} · ${inv ? inv.number : "pendiente"}`}
                        onClick={() => (inv ? router.push(`/admindashboard/accounts/billing/invoices/${inv.id}`) : setInvoiceOpen(true))}
                        className={`rounded-md border px-1 py-1.5 text-center text-[11px] capitalize transition-colors ${inv ? "border-transparent text-white" : "border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-900"}`}
                        style={inv ? { background: inv.paid ? "#24406E" : "#5B7BB0" } : undefined}>
                        {ph && <span className="mx-auto mb-1 block h-0.5 w-4 rounded-full" style={{ background: inv ? "rgba(255,255,255,.7)" : PHASE_COLORS[ph.index % PHASE_COLORS.length] }} />}
                        {new Date(`${m}-15`).toLocaleDateString("es-ES", { month: "short" })}<span className="block text-[9px] opacity-70">{m.slice(2, 4)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {q.billingMode === "phases" && (q.phases || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                  {(q.phases || []).map((p, i) => <span key={p.id} className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ background: PHASE_COLORS[i % PHASE_COLORS.length] }} />{p.name} · {p.months} m</span>)}
                </div>
              )}
              {linked.length > 0 && (
                <table className="tbl mt-4 w-full table-fixed text-[13px]">
                  <tbody>
                    {linked.map((i) => {
                      const s = invoiceState(i);
                      return (
                        <tr key={i.id} onClick={() => router.push(`/admindashboard/accounts/billing/invoices/${i.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                          <td className="relative w-36 py-1.5 pl-4 pr-3 font-mono text-[12px]"><RowBar tone={s.tone} />{i.number || "Borrador"}</td>
                          <td className="px-3 text-slate-600"><span className="block truncate capitalize">{invoiceMonths(i).length ? invoiceMonths(i).map(monthName).join(", ") : i.lines[0]?.description}</span></td>
                          <td className="w-28 px-3 text-right tabular-nums">{eur(i.status === "draft" ? invoiceTotals(i.lines).totalAmount : i.totalAmount)}</td>
                          <td className="w-40 px-3 text-slate-600">{s.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}

          <section className="space-y-4">
            <BlockTitle>Cliente</BlockTitle>
            <ClientCard client={q.client} source={{ kind: q.billTo === "user" ? "user" : "account", id: q.billTo === "user" ? q.userId || "" : q.producerId }} editable={draft}
              onChange={(client) => edit({ client })} onRefresh={async () => edit({ client: q.billTo === "user" ? await fetchUserClient(db, usr) : clientFromAccount(acc) })} />
          </section>

          <section className="space-y-4">
            <BlockTitle>Presupuesto</BlockTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Qué se factura">
                <Select value={subject} disabled={!draft} onChange={(e) => edit({ subject: e.target.value as BillingQuote["subject"], ...(e.target.value === "budgeting" ? { projectName: "Filma Budgeting", projectId: null } : {}) })}>
                  <option value="project">Proyecto</option><option value="budgeting">Budgeting</option><option value="other">Otro concepto</option>
                </Select>
              </Field>
              <Field label={subject === "project" ? "Proyecto" : "Concepto"}>
                <Input value={q.projectName} disabled={!draft} onChange={(e) => edit({ projectName: e.target.value, projectId: accProjects.find((p) => p.name === e.target.value)?.id || null })} list="acc-projects" />
                <datalist id="acc-projects">{accProjects.map((p) => <option key={p.id} value={p.name} />)}</datalist>
              </Field>
              <Field label="Título (opcional)"><Input value={q.title} disabled={!draft} onChange={(e) => edit({ title: e.target.value })} placeholder="Licencia Filma Workspace para el rodaje" /></Field>
              <Field label="Fecha"><Input type="date" value={q.issueDate} disabled={!draft} onChange={(e) => edit({ issueDate: e.target.value, validUntil: addDaysIso(e.target.value, settings.quoteValidityDays || 30) })} /></Field>
              <Field label="Válido hasta"><Input type="date" value={q.validUntil} disabled={!draft} onChange={(e) => edit({ validUntil: e.target.value })} /></Field>
            </div>
            <Field label="Cómo se cobra">
              {draft
                ? <Segmented value={q.billingMode} onChange={setMode} options={[{ value: "phases", label: "Por fases" }, { value: "monthly", label: "Cuota mensual" }, { value: "single", label: "Pago único" }]} />
                : <p className="text-[13px] text-slate-700">{q.billingMode === "single" ? "Pago único" : `${q.billingMode === "phases" ? "Por fases" : "Cuota mensual"} · ${q.months} meses desde ${monthName(q.startMonth)}`}</p>}
            </Field>
            {draft && q.billingMode !== "single" && (
              <div className="grid grid-cols-2 gap-3">
                {q.billingMode === "monthly"
                  ? <Field label="Meses"><Input type="number" min={1} value={String(q.months || "")} onChange={(e) => edit({ months: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                  : <Field label="Meses en total"><Input value={`${q.months || 0} meses`} disabled /></Field>}
                <Field label="Desde"><Input type="month" value={q.startMonth || ""} onChange={(e) => edit({ startMonth: e.target.value })} /></Field>
              </div>
            )}
          </section>

          <section>
            <BlockTitle>{q.billingMode === "monthly" ? "Cuota mensual" : q.billingMode === "phases" ? "Fases" : "Líneas"}</BlockTitle>
            {q.billingMode === "phases"
              ? <PhasesEditor phases={q.phases || []} startMonth={q.startMonth} readOnly={!draft} defaultVat={settings.defaultVat || 21}
                  defaultPrice={subject === "budgeting" ? settings.budgetingPrice || 0 : settings.monthlyPrice || 0} onChange={editPhases} />
              : <LinesEditor lines={q.lines} readOnly={!draft} defaultVat={settings.defaultVat || 21} onChange={(lines) => edit({ lines })} />}
            <div className="mt-3 flex justify-end gap-6 text-[13px]">
              <span className="text-slate-500">Base <strong className="font-medium text-slate-900">{eur(live.baseAmount)}</strong></span>
              <span className="text-slate-500">IVA <strong className="font-medium text-slate-900">{eur(live.vatAmount)}</strong></span>
              <span className="text-slate-500">Total{q.billingMode === "monthly" ? " al mes" : ""} <strong className="font-semibold text-slate-900">{eur(live.totalAmount)}</strong></span>
            </div>
            {q.billingMode === "monthly" && q.months && <p className="mt-1 text-right text-xs text-slate-500">{q.months} meses: {eur(grand.base)} + IVA = <strong className="font-medium text-slate-900">{eur(grand.total)}</strong></p>}
          </section>

          <section className="space-y-4">
            <Field label="Condiciones"><Textarea rows={3} value={q.conditions} disabled={!draft} onChange={(e) => edit({ conditions: e.target.value })} /></Field>
            <Field label="Notas"><Textarea rows={2} value={q.notes} disabled={!draft} onChange={(e) => edit({ notes: e.target.value })} /></Field>
            {q.decisionNote && <p className="text-xs text-slate-500">Nota de la decisión: {q.decisionNote}</p>}
            {q.sentTo && <p className="text-xs text-slate-500">Enviado a {q.sentTo}</p>}
          </section>
        </div>

        <aside className="min-w-0">
          <div className="sticky top-[76px]">
            <DocPreview v={view} />
            {!draft && <p className="mt-3 text-center text-[11px] text-slate-400">Emitido el {fmtDay(q.issueDate)} · ya no se puede modificar. Para cambiarlo, crea una nueva versión.</p>}
          </div>
        </aside>
      </div>

      <ConfirmModal open={act === "issue"} onClose={() => setAct(null)} title="Emitir presupuesto" danger={false} password={false}
        confirmLabel={problems.length ? "Faltan datos" : "Emitir"}
        notice={problems.length ? <>Antes de emitir completa:<br />{problems.map((p) => <span key={p} className="block">· {p}</span>)}</> : <>
          Recibe el siguiente número de la serie <span className="font-mono">{rule.prefix}</span> (o el que escribas) y queda fijo. Luego podrás descargarlo, enviarlo y facturar a partir de él.
          <span className="mt-3 block"><Field label="Número a mano (opcional)"><Input value={customNumber} onChange={(e) => setCustomNumber(e.target.value)} className="font-mono" placeholder={renderNumber(rule, q.issueDate, 1)} /></Field></span>
        </>}
        onConfirm={async () => {
          if (problems.length) throw new Error("Completa los datos que faltan");
          const { id: _i, ...data } = q; void _i;
          await updateDoc(doc(db, "billingQuotes", quoteId), { ...data, ...invoiceTotals(q.lines), updatedAt: serverTimestamp() });
          dirty.current = false;
          if (customNumber.trim() && await numberTaken(db, "quote", customNumber)) throw new Error(`Ya hay un presupuesto con el número ${customNumber.trim()}`);
          const number = await issueQuote(db, quoteId, settings, me?.uid || "", customNumber);
          setCustomNumber("");
          if (q.billTo === "user" && q.userId) await saveUserClient(db, q.userId, q.client).catch(() => {});
          showToast("success", `Presupuesto ${number} emitido`);
        }} />
      <ConfirmModal open={act === "reject"} onClose={() => setAct(null)} title="Marcar como rechazado" danger={false} password={false} confirmLabel="Rechazado"
        reason={{ label: "Motivo", placeholder: "Opcional" }} onConfirm={async (r) => { await setStatus("rejected", r); }} />
      <ConfirmModal open={act === "delete"} onClose={() => setAct(null)} title="Borrar borrador" password={false} confirmLabel="Borrar"
        onConfirm={async () => { await deleteDoc(doc(db, "billingQuotes", quoteId)); router.push("/admindashboard/accounts/billing?tab=quotes"); }} />

      <NewDocModal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} kind="invoice" settings={settings} quotes={quotes} invoices={invoices} quoteId={quoteId} />
      <SendToSignModal open={signOpen} onClose={() => setSignOpen(false)} kind="quote" quoteId={quoteId}
        defaultSigner={{ name: acc?.contactName || usr?.name || q.client.name, email: q.client.email || acc?.contactEmail || usr?.email || "", role: q.client.name }}
        issuerRole={settings.name || "Filma Workspace"} />
      <SendDocModal open={sendOpen} onClose={() => setSendOpen(false)} type="quote" id={quoteId} view={view} defaultTo={q.client.email || acc?.contactEmail || ""}
        onSent={(to) => showToast("success", `Enviado a ${to}`)} />
    </Page>
  );
}
