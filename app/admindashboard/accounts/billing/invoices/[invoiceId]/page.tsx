"use client";

// ─── Factura ─────────────────────────────────────────────────────────────────
// Borrador editable (se guarda solo) con vista previa en directo. "Emitir"
// le da el siguiente número de la serie y la deja fija. Una vez emitida: PDF,
// enviar por email, marcar cobrada y, si algo está mal, anularla emitiendo su
// factura rectificativa (y duplicarla para hacer la buena).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { ArrowLeft, Ban, Check, Copy, Download, Mail, MoreHorizontal, Send, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Badge, Button, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Page, PageLoading, Select, Textarea, useToast } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { BlockTitle } from "@/components/admin/ui";
import { DocPreview } from "@/components/admin/billing/DocPreview";
import { LinesEditor } from "@/components/admin/billing/LinesEditor";
import { ClientCard, SaveState } from "@/components/admin/billing/DocParts";
import { SendDocModal } from "@/components/admin/billing/SendDocModal";
import { invoiceState, useBillingSettings } from "@/components/admin/billing/useBilling";
import {
  addDaysIso, BillingInvoice, clientFromAccount, fetchUserClient, saveUserClient, docSubject, eur, fmtDay, invoiceMonths, invoiceTotals, issueInvoice, missingForIssue,
  monthsLabel, numberingRule, numberTaken, renderNumber, todayIso, voidWithRectifying, isService, SERVICES, type BillingSubject, type ServiceSubject,
} from "@/lib/billing";
import { downloadDocPdf, invoiceView } from "@/lib/billingPdf";

export default function InvoicePage() {
  const { invoiceId } = useParams() as { invoiceId: string };
  const router = useRouter();
  const { user: me } = useUser();
  const { producerById, projects, users } = useAdminData();
  const settings = useBillingSettings();
  const [toast, showToast] = useToast();
  const [inv, setInv] = useState<BillingInvoice | null>(null);
  const [missing, setMissing] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [act, setAct] = useState<null | "issue" | "delete" | "void" | "paid">(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [customNumber, setCustomNumber] = useState("");
  const dirty = useRef(false);

  useEffect(() => onSnapshot(doc(db, "billingInvoices", invoiceId), (s) => {
    if (!s.exists()) { setMissing(true); return; }
    if (!dirty.current) setInv({ id: s.id, ...s.data() } as BillingInvoice);
  }), [invoiceId]);

  const persist = async (x: BillingInvoice) => {
    const { id: _id, ...data } = x; void _id;
    await updateDoc(doc(db, "billingInvoices", invoiceId), { ...data, ...invoiceTotals(x.lines), updatedAt: serverTimestamp() });
    dirty.current = false;
  };
  useEffect(() => {
    if (!inv || inv.status !== "draft" || !dirty.current) return;
    setSave("saving");
    const t = setTimeout(() => { persist(inv).then(() => setSave("saved")).catch(() => setSave("error")); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv]);

  const edit = (patch: Partial<BillingInvoice>) => { dirty.current = true; setInv((x) => (x ? { ...x, ...patch } : x)); };
  const view = useMemo(() => (inv ? invoiceView(inv, settings) : null), [inv, settings]);

  if (missing) return <Page><p className="text-[13px] text-slate-500">Esta factura no existe. <Link href="/admindashboard/accounts/billing" className="underline">Volver</Link></p></Page>;
  if (!inv || !view) return <PageLoading />;

  const draft = inv.status === "draft";
  const acc = producerById(inv.producerId);
  const usr = inv.billTo === "user" ? users.find((u) => u.id === inv.userId) : undefined;
  const subject = inv.subject || "project";
  const rule = numberingRule(settings, "invoice");
  const ms = invoiceMonths(inv);
  const accProjects = projects.filter((p) => p.producers.includes(inv.producerId) && !p.trashedAt);
  const live = draft ? invoiceTotals(inv.lines) : inv;
  const st = invoiceState(inv);
  const problems = missingForIssue(inv, settings).concat(inv.projectName || isService(subject) ? [] : ["El proyecto o concepto"]);
  const days = Math.max(0, Math.round((new Date(`${inv.dueDate}T12:00:00`).getTime() - new Date(`${inv.issueDate}T12:00:00`).getTime()) / 86_400_000));

  const duplicate = async () => {
    const today = todayIso();
    const ref = await addDoc(collection(db, "billingInvoices"), {
      producerId: inv.producerId, billTo: inv.billTo || "account", userId: inv.userId || null, subject: inv.subject || "project",
      client: inv.billTo === "user" ? inv.client : clientFromAccount(acc), issuer: null, number: null, series: null, year: null,
      status: "draft", kind: "standard", periodType: inv.periodType, periodMonth: inv.periodMonth, periodMonths: inv.periodMonths || null, projectId: inv.projectId, projectName: inv.projectName,
      quoteId: inv.quoteId || null, quoteNumber: inv.quoteNumber || null,
      issueDate: today, dueDate: addDaysIso(today, settings.paymentDays || 30),
      lines: inv.lines.map((l) => ({ ...l, quantity: Math.abs(l.quantity) })), ...invoiceTotals(inv.lines.map((l) => ({ ...l, quantity: Math.abs(l.quantity) }))),
      notes: inv.notes || "", paid: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    router.push(`/admindashboard/accounts/billing/invoices/${ref.id}`);
  };

  const tone = st.tone === "ok" ? "success" : st.tone === "bad" ? "danger" : st.tone === "warn" ? "warning" : st.tone === "info" ? "info" : "neutral";

  return (
    <Page>
      {toast}
      <Link href="/admindashboard/accounts/billing" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Facturación</Link>
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          {inv.number || "Factura"} <span className="truncate text-[15px] font-normal text-slate-400">{usr?.name || acc?.name || inv.client.name} · {docSubject(inv)}</span>
          <Badge tone={tone}>{st.label}</Badge>
        </h1>
        <div className="flex items-center gap-2">
          {draft && <SaveState state={save} />}
          <Button onClick={() => downloadDocPdf(view)}><Download size={14} /> PDF</Button>
          {draft ? (
            <Button variant="primary" onClick={() => setAct("issue")}><Send size={14} /> Emitir factura</Button>
          ) : (
            <>
              <Button onClick={() => setSendOpen(true)}><Mail size={14} /> Enviar</Button>
              {inv.status === "issued" && inv.kind === "standard" && !inv.paid && <Button variant="primary" onClick={() => setAct("paid")}><Check size={14} /> Cobrada</Button>}
            </>
          )}
          <Menu trigger={(t) => <IconButton label="Más" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); duplicate(); }}><Copy size={13} /> Duplicar como nueva</MenuItem>
                {inv.status === "issued" && inv.kind === "standard" && inv.paid && (
                  <MenuItem onClick={async () => { close(); await updateDoc(doc(db, "billingInvoices", invoiceId), { paid: false, paidAt: null, updatedAt: serverTimestamp() }); }}>Marcar como no cobrada</MenuItem>
                )}
                {inv.status === "issued" && inv.kind === "standard" && <><MenuSeparator /><MenuItem danger onClick={() => { close(); setAct("void"); }}><Ban size={13} /> Anular con rectificativa…</MenuItem></>}
                {draft && <><MenuSeparator /><MenuItem danger onClick={() => { close(); setAct("delete"); }}><Trash2 size={13} /> Borrar borrador</MenuItem></>}
              </>
            )}
          </Menu>
        </div>
      </div>

      {(inv.status === "voided" || inv.kind === "rectifying" || inv.quoteNumber || inv.signUsage) && (
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-600">
          {inv.status === "voided" && inv.rectifiedBy && <span>Anulada{inv.voidReason ? ` (${inv.voidReason})` : ""} por la rectificativa <Link className="font-medium text-slate-900 hover:underline" href={`/admindashboard/accounts/billing/invoices/${inv.rectifiedBy.id}`}>{inv.rectifiedBy.number}</Link></span>}
          {inv.kind === "rectifying" && inv.rectifies && <span>Rectifica a <Link className="font-medium text-slate-900 hover:underline" href={`/admindashboard/accounts/billing/invoices/${inv.rectifies.id}`}>{inv.rectifies.number}</Link></span>}
          {inv.quoteNumber && inv.quoteId && <span>Del presupuesto <Link className="font-medium text-slate-900 hover:underline" href={`/admindashboard/accounts/billing/quotes/${inv.quoteId}`}>{inv.quoteNumber}</Link></span>}
          {inv.paid && inv.paidAt && <span>Cobrada el {fmtDay(inv.paidAt)}</span>}
          {inv.signUsage && <span>Filma Sign · {inv.signUsage.signed.length} firmados y {inv.signUsage.expired.length} caducados o rechazados · <Link className="font-medium text-slate-900 hover:underline" href="/admindashboard/sign">ver solicitudes</Link></span>}
          {inv.sentTo && <span>Enviada a {inv.sentTo}</span>}
        </div>
      )}

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_560px]">
        <div className="min-w-0 space-y-8">
          <section className="space-y-4">
            <BlockTitle>Cliente</BlockTitle>
            <ClientCard client={inv.client} source={{ kind: inv.billTo === "user" ? "user" : "account", id: inv.billTo === "user" ? inv.userId || "" : inv.producerId }} editable={draft}
              onChange={(client) => edit({ client })} onRefresh={async () => edit({ client: inv.billTo === "user" ? await fetchUserClient(db, usr) : clientFromAccount(acc) })} />
          </section>

          <section className="space-y-4">
            <BlockTitle>Factura</BlockTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Qué se factura">
                <Select value={subject} disabled={!draft || !!inv.quoteId} onChange={(e) => edit({ subject: e.target.value as BillingInvoice["subject"], ...(isService(e.target.value as BillingSubject) ? { projectName: SERVICES[e.target.value as ServiceSubject].name, projectId: null } : {}) })}>
                  <option value="project">Proyecto</option><option value="budgeting">Budgeting</option><option value="sign">Filma Sign</option><option value="other">Otro concepto</option>
                </Select>
              </Field>
              <Field label={subject === "project" ? "Proyecto" : "Concepto"}>
                <Input value={inv.projectName || ""} disabled={!draft || !!inv.quoteId} list="inv-projects"
                  onChange={(e) => edit({ projectName: e.target.value, projectId: accProjects.find((p) => p.name === e.target.value)?.id || null })} />
                <datalist id="inv-projects">{accProjects.map((p) => <option key={p.id} value={p.name} />)}</datalist>
              </Field>
              <Field label="Periodo">
                <Select value={inv.periodType === "monthly" ? "monthly" : "none"} disabled={!draft || !!inv.quoteId}
                  onChange={(e) => edit(e.target.value === "monthly" ? { periodType: "monthly", periodMonth: inv.periodMonth || inv.issueDate.slice(0, 7) } : { periodType: "project", periodMonth: null })}>
                  <option value="none">Sin periodo (pago del proyecto)</option>
                  <option value="monthly">Mensual</option>
                </Select>
              </Field>
              {inv.periodType === "monthly" && (ms.length > 1
                ? <Field label="Meses facturados"><Input value={monthsLabel(ms)} disabled /></Field>
                : <Field label="Mes facturado"><Input type="month" value={inv.periodMonth || ""} disabled={!draft || !!inv.quoteId} onChange={(e) => edit({ periodMonth: e.target.value, periodMonths: null })} /></Field>)}
              <Field label="Fecha de emisión"><Input type="date" value={inv.issueDate} disabled={!draft} onChange={(e) => edit({ issueDate: e.target.value, dueDate: addDaysIso(e.target.value, days) })} /></Field>
              {inv.kind === "standard" && (
                <Field label="Vencimiento" hint={`${days} días · ${fmtDay(inv.dueDate)}`}>
                  <Select value={String(days)} disabled={!draft} onChange={(e) => edit({ dueDate: addDaysIso(inv.issueDate, Number(e.target.value)) })}>
                    {Array.from(new Set([0, 15, 30, 45, 60, 90, days])).sort((a, b) => a - b).map((d) => <option key={d} value={String(d)}>{d === 0 ? "Al contado" : `${d} días`}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          </section>

          <section>
            <BlockTitle>Líneas</BlockTitle>
            <LinesEditor lines={inv.lines} readOnly={!draft} defaultVat={settings.defaultVat || 21} onChange={(lines) => edit({ lines })} />
            <div className="mt-3 flex justify-end gap-6 text-[13px]">
              <span className="text-slate-500">Base <strong className="font-medium text-slate-900">{eur(live.baseAmount)}</strong></span>
              {live.vatBreakdown.map((b) => <span key={b.rate} className="text-slate-500">IVA {b.rate} % <strong className="font-medium text-slate-900">{eur(b.vat)}</strong></span>)}
              <span className="text-slate-500">Total <strong className="font-semibold text-slate-900">{eur(live.totalAmount)}</strong></span>
            </div>
          </section>

          <Field label="Notas"><Textarea rows={2} value={inv.notes} disabled={!draft} onChange={(e) => edit({ notes: e.target.value })} placeholder="Aparecen al pie de la factura" /></Field>
        </div>

        <aside className="min-w-0">
          <div className="sticky top-[76px]">
            <DocPreview v={view} />
            {!draft && <p className="mt-3 text-center text-[11px] text-slate-400">Una factura emitida no se puede modificar. Si algo está mal, anúlala con una rectificativa y duplícala.</p>}
          </div>
        </aside>
      </div>

      <ConfirmModal open={act === "issue"} onClose={() => setAct(null)} title="Emitir factura" danger={false} password={false}
        confirmLabel={problems.length ? "Faltan datos" : "Emitir"}
        notice={problems.length
          ? <>Antes de emitir completa:<br />{problems.map((p) => <span key={p} className="block">· {p}</span>)}</>
          : <>
            Recibe el siguiente número de la serie <span className="font-mono">{rule.prefix}</span> (o el que escribas) y deja de poder modificarse. Total: <strong>{eur(live.totalAmount)}</strong>{ms.length ? ` · ${monthsLabel(ms)}` : ""}.
            <span className="mt-3 block"><Field label="Número a mano (opcional)"><Input value={customNumber} onChange={(e) => setCustomNumber(e.target.value)} className="font-mono" placeholder={renderNumber(rule, inv.issueDate, 1)} /></Field></span>
          </>}
        onConfirm={async () => {
          if (problems.length) throw new Error("Completa los datos que faltan");
          await persist(inv);
          if (customNumber.trim() && await numberTaken(db, "invoice", customNumber)) throw new Error(`Ya hay una factura con el número ${customNumber.trim()}`);
          const number = await issueInvoice(db, invoiceId, settings, me?.uid || "", customNumber);
          setCustomNumber("");
          // Los datos fiscales de la persona se guardan para la próxima vez.
          if (inv.billTo === "user" && inv.userId) await saveUserClient(db, inv.userId, inv.client).catch(() => {});
          showToast("success", `Factura ${number} emitida`);
        }} />
      <ConfirmModal open={act === "void"} onClose={() => setAct(null)} title={`Anular ${inv.number}`} confirmLabel="Anular y emitir rectificativa"
        notice={<>Se emite una <strong>factura rectificativa</strong> (serie {numberingRule(settings, "rectifying").prefix}) por el importe en negativo, que anula esta. Después puedes duplicarla para emitir la correcta.</>}
        reason={{ label: "Motivo de la rectificación", placeholder: "Error en el importe, datos fiscales del cliente…", required: true }}
        onConfirm={async (reason) => {
          const r = await voidWithRectifying(db, invoiceId, reason, settings, me?.uid || "");
          showToast("success", `Rectificativa ${r.number} emitida`);
          router.push(`/admindashboard/accounts/billing/invoices/${r.id}`);
        }} />
      <ConfirmModal open={act === "paid"} onClose={() => setAct(null)} title="Marcar como cobrada" danger={false} password={false} confirmLabel="Cobrada"
        onConfirm={async () => { await updateDoc(doc(db, "billingInvoices", invoiceId), { paid: true, paidAt: paidOn, updatedAt: serverTimestamp() }); showToast("success", "Factura cobrada"); }}>
        <Field label="Fecha de cobro"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
      </ConfirmModal>
      <ConfirmModal open={act === "delete"} onClose={() => setAct(null)} title="Borrar borrador" password={false} confirmLabel="Borrar"
        onConfirm={async () => { await deleteDoc(doc(db, "billingInvoices", invoiceId)); router.push("/admindashboard/accounts/billing"); }} />

      <SendDocModal open={sendOpen} onClose={() => setSendOpen(false)} type="invoice" id={invoiceId} view={view} defaultTo={inv.client.email || acc?.contactEmail || ""}
        onSent={(to) => showToast("success", `Enviada a ${to}`)} />
    </Page>
  );
}
