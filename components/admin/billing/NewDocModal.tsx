"use client";

// Crear un presupuesto o una factura (borradores):
// - A quién: una cuenta (productora) o una persona (usuario).
// - Qué: un proyecto, el acceso a Budgeting u otro concepto.
// - Presupuesto: cuota mensual, por fases (preproducción, rodaje…) o pago único.
// - Factura: desde un presupuesto (uno o varios meses, con el precio de la
//   fase de cada mes, o un % del pago único) o suelta.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button, Field, Input, Modal, Segmented, Select } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import {
  addDaysIso, BillingInvoice, BillingLine, BillingMode, BillingQuote, BillingSettings, BillingSubject, BillTo, clientFromAccount, fetchUserClient,
  countsAsBilled, DEFAULT_PHASES, docSubject, eur, invoiceMonths, monthName, newLineId, phaseMonthlyBase, phaseSchedule, phasesToLines,
  quoteGrandTotal, quoteMonths, todayIso, type QuotePhase,
} from "@/lib/billing";
import { round2 } from "@/lib/amounts";

const thisMonth = () => todayIso().slice(0, 7);

export function NewDocModal({ open, onClose, kind, settings, quotes, invoices, producerId: fixedProducer, userId: fixedUser, quoteId: fixedQuote }: {
  open: boolean;
  onClose: () => void;
  kind: "quote" | "invoice";
  settings: BillingSettings;
  quotes: BillingQuote[];
  invoices: BillingInvoice[];
  producerId?: string;
  userId?: string;
  quoteId?: string;
}) {
  const router = useRouter();
  const { producers, projects, users, producerById } = useAdminData();
  const [billTo, setBillTo] = useState<BillTo>("account");
  const [producerId, setProducerId] = useState("");
  const [userId, setUserId] = useState("");
  const [subject, setSubject] = useState<BillingSubject>("project");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [mode, setMode] = useState<BillingMode>("phases");
  const [months, setMonths] = useState("12");
  const [quoteId, setQuoteId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pct, setPct] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const q = fixedQuote ? quotes.find((x) => x.id === fixedQuote) : null;
    const to: BillTo = fixedUser || q?.billTo === "user" ? "user" : "account";
    setBillTo(to);
    setProducerId(fixedProducer || q?.producerId || ""); setUserId(fixedUser || q?.userId || "");
    setSubject(to === "user" ? "budgeting" : "project");
    setProjectId(""); setProjectName(""); setMode(to === "user" ? "monthly" : "phases"); setMonths("12");
    setQuoteId(fixedQuote || ""); setPicked([]); setPct("100"); setError("");
  }, [open, fixedProducer, fixedUser, fixedQuote, quotes]);

  const target = billTo === "account" ? producerId : userId;
  const accProjects = useMemo(() => projects.filter((p) => p.producers.includes(producerId) && !p.trashedAt), [projects, producerId]);
  const userList = useMemo(() => [...users].filter((u) => !u.isDemo).sort((a, b) => Number(b.budgetingAccess) - Number(a.budgetingAccess) || (a.name || a.email).localeCompare(b.name || b.email)), [users]);
  const clientQuotes = useMemo(() => quotes.filter((q) => q.status !== "draft" && q.status !== "rejected" &&
    (billTo === "user" ? q.billTo === "user" && q.userId === userId : q.billTo !== "user" && q.producerId === producerId)), [quotes, billTo, userId, producerId]);
  const quote = quotes.find((q) => q.id === quoteId) || null;
  const qInvoices = useMemo(() => (quote ? invoices.filter((i) => i.quoteId === quote.id && countsAsBilled(i)) : []), [invoices, quote]);
  const billedMonths = useMemo(() => new Set(qInvoices.flatMap(invoiceMonths)), [qInvoices]);
  const billedBase = qInvoices.reduce((s, i) => s + i.baseAmount, 0);
  const grand = quote ? quoteGrandTotal(quote) : null;
  const remainingPct = quote && grand && grand.base > 0 ? Math.max(0, Math.round((1 - billedBase / grand.base) * 100)) : 100;
  const schedule = quote?.billingMode === "phases" ? phaseSchedule(quote) : [];
  const allMonths = quote ? quoteMonths(quote) : [];
  const monthPrice = (m: string) => quote?.billingMode === "phases" ? phaseMonthlyBase(schedule.find((s) => s.month === m)?.phase || { id: "", name: "", months: 0, lines: [] }) : quote?.baseAmount || 0;

  // Al elegir presupuesto: siguiente mes pendiente o % restante.
  useEffect(() => {
    if (!quote) return;
    if (quote.billingMode === "single") setPct(String(remainingPct || 100));
    else { const next = allMonths.find((m) => !billedMonths.has(m)); setPicked(next ? [next] : []); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  const subjectName = () => {
    if (subject === "budgeting") return "Filma Budgeting";
    const proj = projects.find((p) => p.id === projectId);
    return proj?.name || projectName.trim();
  };

  const create = async () => {
    setError("");
    const acc = billTo === "account" ? producerById(producerId) : null;
    const usr = billTo === "user" ? users.find((u) => u.id === userId) : null;
    if (!acc && !usr) { setError(billTo === "account" ? "Elige una cuenta" : "Elige una persona"); return; }
    const proj = subject === "project" ? projects.find((p) => p.id === projectId) : null;
    setBusy(true);
    try {
      const base = {
        billTo, producerId: acc ? producerId : "", userId: usr ? userId : null,
        client: acc ? clientFromAccount(acc) : await fetchUserClient(db, usr), issuer: null, number: null, series: null, year: null, notes: "",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      const vat = settings.defaultVat || 21;
      if (kind === "quote") {
        const name = subjectName();
        if (!name) throw new Error(subject === "project" ? "Elige un proyecto o escribe su nombre" : "Escribe el concepto");
        const today = todayIso();
        const price = subject === "budgeting" ? settings.budgetingPrice || 0 : settings.monthlyPrice || 0;
        const desc = subject === "budgeting" ? "Acceso a Filma Budgeting" : mode === "single" ? `Filma Workspace · ${name}` : "Licencia mensual de Filma Workspace";
        let phases: QuotePhase[] | null = null;
        let lines: BillingLine[] = [{ id: newLineId(), description: mode === "monthly" && subject !== "budgeting" ? `${desc} · ${name}` : desc, quantity: 1, unitPrice: mode === "single" ? 0 : price, vatRate: vat }];
        if (mode === "phases") {
          const defs = settings.phaseDefaults?.length ? settings.phaseDefaults : DEFAULT_PHASES.map((p) => ({ ...p, price }));
          phases = defs.map((d) => ({ id: newLineId(), name: d.name, months: d.months, lines: [{ id: newLineId(), description: desc, quantity: 1, unitPrice: d.price || price, vatRate: vat }] }));
          lines = phasesToLines(phases);
        }
        const ref = await addDoc(collection(db, "billingQuotes"), {
          ...base, subject, status: "draft", projectId: proj?.id || null, projectName: name, title: "",
          issueDate: today, validUntil: addDaysIso(today, settings.quoteValidityDays || 30),
          billingMode: mode, phases,
          months: mode === "monthly" ? Math.max(1, Number(months) || 1) : mode === "phases" ? phases!.reduce((t, p) => t + p.months, 0) : null,
          startMonth: mode === "single" ? null : thisMonth(),
          lines, baseAmount: 0, vatAmount: 0, totalAmount: 0, vatBreakdown: [], conditions: settings.quoteConditions || "",
        });
        router.push(`/admindashboard/accounts/billing/quotes/${ref.id}`);
      } else {
        const today = todayIso();
        let lines: BillingLine[]; let extra: Record<string, unknown>;
        if (quote) {
          if (quote.billingMode === "single") {
            const p = Math.min(100, Math.max(1, Number(pct) || 0));
            lines = quote.lines.map((l) => ({ ...l, id: newLineId(), unitPrice: p === 100 ? l.unitPrice : round2((l.unitPrice * p) / 100), description: p === 100 ? l.description : `${l.description} (${p} % del presupuesto)` }));
            extra = { periodType: "project", periodMonth: null, periodMonths: null };
          } else {
            const ms = [...picked].sort();
            if (!ms.length) throw new Error("Elige al menos un mes");
            const dup = ms.find((m) => billedMonths.has(m));
            if (dup) throw new Error(`${monthName(dup)} ya está facturado`);
            lines = ms.flatMap((m) => {
              const ph = quote.billingMode === "phases" ? schedule.find((s) => s.month === m)?.phase : null;
              const src = ph ? ph.lines : quote.lines;
              return src.map((l) => ({ ...l, id: newLineId(), description: `${ph ? `${ph.name} · ` : ""}${l.description} · ${monthName(m)}` }));
            });
            extra = { periodType: "monthly", periodMonth: ms[0], periodMonths: ms };
          }
          extra = { ...extra, quoteId: quote.id, quoteNumber: quote.number, projectId: quote.projectId, projectName: quote.projectName, subject: quote.subject || "project" };
        } else {
          const name = subjectName();
          if (!name) throw new Error(subject === "project" ? "Elige un proyecto o escribe su nombre" : "Escribe el concepto");
          const desc = subject === "budgeting" ? `Acceso a Filma Budgeting · ${monthName(thisMonth())}` : `Filma Workspace · ${name}`;
          lines = [{ id: newLineId(), description: desc, quantity: 1, unitPrice: subject === "budgeting" ? settings.budgetingPrice || 0 : settings.monthlyPrice || 0, vatRate: vat }];
          extra = {
            periodType: subject === "budgeting" ? "monthly" : "project", periodMonth: subject === "budgeting" ? thisMonth() : null, periodMonths: null,
            quoteId: null, quoteNumber: null, projectId: proj?.id || null, projectName: name, subject,
          };
        }
        const ref = await addDoc(collection(db, "billingInvoices"), {
          ...base, ...extra, status: "draft", kind: "standard", issueDate: today, dueDate: addDaysIso(today, settings.paymentDays || 30),
          lines, baseAmount: 0, vatAmount: 0, totalAmount: 0, vatBreakdown: [], paid: false,
        });
        router.push(`/admindashboard/accounts/billing/invoices/${ref.id}`);
      }
      onClose();
    } catch (e) { setError((e as Error).message || "No se pudo crear"); } finally { setBusy(false); }
  };

  const subjectPicker = (
    <>
      <Field label="Qué se factura">
        <Segmented value={subject} onChange={(v) => { setSubject(v); if (v === "budgeting") setMode("monthly"); }} options={[{ value: "project", label: "Proyecto" }, { value: "budgeting", label: "Budgeting" }, { value: "other", label: "Otro" }]} />
      </Field>
      {subject === "project" && billTo === "account" && (
        <Field label="Proyecto">
          <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); if (e.target.value) setProjectName(""); }}>
            <option value="">Proyecto nuevo o sin crear…</option>
            {accProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      )}
      {((subject === "project" && !projectId) || subject === "other") && (
        <Field label={subject === "other" ? "Concepto" : "Nombre del proyecto"}>
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={subject === "other" ? "Formación, migración de datos…" : "Título de la película o serie"} />
        </Field>
      )}
    </>
  );

  const toggleMonth = (m: string) => setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));
  const pickedBase = picked.reduce((t, m) => t + monthPrice(m), 0);

  return (
    <Modal open={open} onClose={onClose} title={kind === "quote" ? "Nuevo presupuesto" : "Nueva factura"} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={create} disabled={busy || !target}>{busy ? "Creando…" : "Crear borrador"}</Button></>}>
      <div className="flex flex-col gap-4">
        {!fixedProducer && !fixedUser && !fixedQuote && (
          <Field label="A quién">
            <Segmented value={billTo} onChange={(v) => { setBillTo(v); setQuoteId(""); setSubject(v === "user" ? "budgeting" : "project"); if (v === "user") setMode("monthly"); }}
              options={[{ value: "account", label: "Cuenta" }, { value: "user", label: "Persona" }]} />
          </Field>
        )}
        {billTo === "account" ? (
          <Field label="Cuenta">
            <Select value={producerId} onChange={(e) => { setProducerId(e.target.value); setProjectId(""); setQuoteId(""); }} disabled={!!fixedProducer || !!fixedQuote}>
              <option value="" disabled>Elige una productora</option>
              {producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Persona">
            <Select value={userId} onChange={(e) => { setUserId(e.target.value); setQuoteId(""); }} disabled={!!fixedUser || !!fixedQuote}>
              <option value="" disabled>Elige un usuario</option>
              {userList.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}{u.budgetingAccess ? " · Budgeting" : ""}</option>)}
            </Select>
          </Field>
        )}

        {kind === "quote" && target && (
          <>
            {subjectPicker}
            <Field label="Cómo se cobra">
              <Segmented value={mode} onChange={setMode} options={[{ value: "phases", label: "Por fases" }, { value: "monthly", label: "Cuota mensual" }, { value: "single", label: "Pago único" }]} />
            </Field>
            {mode === "monthly" && <Field label="Duración (meses)"><Input type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} className="w-28" /></Field>}
          </>
        )}

        {kind === "invoice" && target && (
          <>
            <Field label="Presupuesto">
              <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} disabled={!!fixedQuote}>
                <option value="">Sin presupuesto (manual)</option>
                {clientQuotes.map((q) => <option key={q.id} value={q.id}>{q.number} · {docSubject(q)} · {q.billingMode === "monthly" ? `${eur(q.baseAmount)}/mes` : eur(quoteGrandTotal(q).base)}</option>)}
              </Select>
            </Field>
            {!quote && subjectPicker}
            {quote && quote.billingMode !== "single" && (
              <Field label="Meses que se facturan">
                <div className="max-h-60 overflow-y-auto rounded-md border border-slate-200">
                  {(allMonths.length ? allMonths : [thisMonth()]).map((m) => {
                    const done = billedMonths.has(m);
                    const ph = schedule.find((s) => s.month === m)?.phase;
                    return (
                      <label key={m} className={`flex items-center gap-2.5 border-b border-slate-100 px-3 py-1.5 text-[13px] last:border-0 ${done ? "text-slate-400" : "cursor-pointer hover:bg-[#FAFAFA]"}`}>
                        <input type="checkbox" disabled={done} checked={done || picked.includes(m)} onChange={() => toggleMonth(m)} className="accent-slate-900" />
                        <span className="flex-1 capitalize">{monthName(m)}</span>
                        {ph && <span className="text-xs text-slate-500">{ph.name}</span>}
                        <span className="w-24 text-right tabular-nums">{done ? "facturado" : eur(monthPrice(m))}</span>
                      </label>
                    );
                  })}
                </div>
                <span className="mt-1 block text-[11px] text-slate-500">{billedMonths.size} de {allMonths.length} facturados · Seleccionado: {eur(pickedBase)} + IVA</span>
              </Field>
            )}
            {quote?.billingMode === "single" && (
              <Field label="Porcentaje que se factura" hint={`Queda por facturar el ${remainingPct} % (${eur(Math.max(0, (grand?.base || 0) - billedBase))} + IVA)`}>
                <div className="flex items-center gap-2"><Input type="number" min={1} max={100} value={pct} onChange={(e) => setPct(e.target.value)} className="w-24" /><span className="text-[13px] text-slate-500">%</span></div>
              </Field>
            )}
            {quote && quote.status === "sent" && <p className="rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2 text-xs text-amber-900">El presupuesto aún no está marcado como aceptado.</p>}
          </>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
