"use client";

// Crear un presupuesto o una factura (borradores):
// - Presupuesto: cuenta, proyecto (de la cuenta o uno nuevo) y modo de cobro.
// - Factura: desde un presupuesto (un mes concreto o un % del pago único) o
//   suelta, siempre referida a un proyecto.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button, Field, Input, Modal, Segmented, Select } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import {
  addDaysIso, BillingInvoice, BillingLine, BillingQuote, BillingSettings, clientFromAccount, countsAsBilled, eur, monthName, newLineId,
  quoteGrandTotal, quoteMonths, todayIso,
} from "@/lib/billing";
import { round2 } from "@/lib/amounts";

const thisMonth = () => todayIso().slice(0, 7);

export function NewDocModal({ open, onClose, kind, settings, quotes, invoices, producerId: fixedProducer, quoteId: fixedQuote }: {
  open: boolean;
  onClose: () => void;
  kind: "quote" | "invoice";
  settings: BillingSettings;
  quotes: BillingQuote[];
  invoices: BillingInvoice[];
  producerId?: string;
  quoteId?: string;
}) {
  const router = useRouter();
  const { producers, projects, producerById } = useAdminData();
  const [producerId, setProducerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [mode, setMode] = useState<"monthly" | "single">("monthly");
  const [months, setMonths] = useState("12");
  const [quoteId, setQuoteId] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [pct, setPct] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const q = fixedQuote ? quotes.find((x) => x.id === fixedQuote) : null;
    setProducerId(fixedProducer || q?.producerId || ""); setProjectId(""); setProjectName(""); setMode("monthly"); setMonths("12");
    setQuoteId(fixedQuote || ""); setMonth(thisMonth()); setPct("100"); setError("");
  }, [open, fixedProducer, fixedQuote, quotes]);

  const accProjects = useMemo(() => projects.filter((p) => p.producers.includes(producerId) && !p.trashedAt), [projects, producerId]);
  const accQuotes = useMemo(() => quotes.filter((q) => q.producerId === producerId && q.status !== "draft" && q.status !== "rejected"), [quotes, producerId]);
  const quote = quotes.find((q) => q.id === quoteId) || null;
  const qInvoices = useMemo(() => (quote ? invoices.filter((i) => i.quoteId === quote.id && countsAsBilled(i)) : []), [invoices, quote]);
  const billedMonths = new Set(qInvoices.map((i) => i.periodMonth));
  const billedBase = qInvoices.reduce((s, i) => s + i.baseAmount, 0);
  const grand = quote ? quoteGrandTotal(quote) : null;
  const remainingPct = quote && grand && grand.base > 0 ? Math.max(0, Math.round((1 - billedBase / grand.base) * 100)) : 100;

  // Al elegir presupuesto: siguiente mes pendiente o % restante
  useEffect(() => {
    if (!quote) return;
    if (quote.billingMode === "monthly") {
      const next = quoteMonths(quote).find((m) => !billedMonths.has(m));
      if (next) setMonth(next);
    } else setPct(String(remainingPct || 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  const create = async () => {
    setError("");
    const acc = producerById(producerId);
    if (!acc) { setError("Elige una cuenta"); return; }
    const proj = projects.find((p) => p.id === projectId);
    setBusy(true);
    try {
      const base = { producerId, client: clientFromAccount(acc), issuer: null, number: null, series: null, year: null, notes: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      if (kind === "quote") {
        const name = proj?.name || projectName.trim();
        if (!name) throw new Error("Elige un proyecto o escribe su nombre");
        const today = todayIso();
        const line: BillingLine = { id: newLineId(), description: mode === "monthly" ? `Licencia mensual de Filma Workspace · ${name}` : `Filma Workspace · ${name}`, quantity: 1, unitPrice: mode === "monthly" ? settings.monthlyPrice || 0 : 0, vatRate: settings.defaultVat || 21 };
        const ref = await addDoc(collection(db, "billingQuotes"), {
          ...base, status: "draft", projectId: proj?.id || null, projectName: name, title: "",
          issueDate: today, validUntil: addDaysIso(today, settings.quoteValidityDays || 30),
          billingMode: mode, months: mode === "monthly" ? Math.max(1, Number(months) || 1) : null, startMonth: mode === "monthly" ? thisMonth() : null,
          lines: [line], baseAmount: 0, vatAmount: 0, totalAmount: 0, vatBreakdown: [], conditions: settings.quoteConditions || "",
        });
        router.push(`/admindashboard/accounts/billing/quotes/${ref.id}`);
      } else {
        const today = todayIso();
        let lines: BillingLine[]; let extra: Record<string, unknown>;
        if (quote) {
          if (quote.billingMode === "monthly") {
            if (billedMonths.has(month)) throw new Error(`${monthName(month)} ya está facturado`);
            lines = quote.lines.map((l) => ({ ...l, id: newLineId(), description: `${l.description} · ${monthName(month)}` }));
            extra = { periodType: "monthly", periodMonth: month };
          } else {
            const p = Math.min(100, Math.max(1, Number(pct) || 0));
            lines = quote.lines.map((l) => ({ ...l, id: newLineId(), unitPrice: p === 100 ? l.unitPrice : round2((l.unitPrice * p) / 100), description: p === 100 ? l.description : `${l.description} (${p} % del presupuesto)` }));
            extra = { periodType: "project", periodMonth: null };
          }
          extra = { ...extra, quoteId: quote.id, quoteNumber: quote.number, projectId: quote.projectId, projectName: quote.projectName };
        } else {
          const name = proj?.name || projectName.trim();
          if (!name) throw new Error("Elige un proyecto o escribe su nombre");
          lines = [{ id: newLineId(), description: `Filma Workspace · ${name}`, quantity: 1, unitPrice: settings.monthlyPrice || 0, vatRate: settings.defaultVat || 21 }];
          extra = { periodType: "project", periodMonth: null, quoteId: null, quoteNumber: null, projectId: proj?.id || null, projectName: name };
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

  const projectPicker = (
    <>
      <Field label="Proyecto">
        <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); if (e.target.value) setProjectName(""); }}>
          <option value="">{accProjects.length ? "Proyecto nuevo o sin crear…" : "Proyecto nuevo o sin crear"}</option>
          {accProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      {!projectId && <Field label="Nombre del proyecto"><Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Título de la película o serie" /></Field>}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={kind === "quote" ? "Nuevo presupuesto" : "Nueva factura"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={create} disabled={busy || !producerId}>{busy ? "Creando…" : "Crear borrador"}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Cuenta">
          <Select value={producerId} onChange={(e) => { setProducerId(e.target.value); setProjectId(""); setQuoteId(""); }} disabled={!!fixedProducer || !!fixedQuote}>
            <option value="" disabled>Elige una productora</option>
            {producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>

        {kind === "quote" && producerId && (
          <>
            {projectPicker}
            <Field label="Cómo se cobra">
              <Segmented value={mode} onChange={setMode} options={[{ value: "monthly", label: "Cuota mensual" }, { value: "single", label: "Pago único" }]} />
            </Field>
            {mode === "monthly" && <Field label="Duración (meses)" hint="Se puede cambiar en el presupuesto."><Input type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} className="w-28" /></Field>}
          </>
        )}

        {kind === "invoice" && producerId && (
          <>
            <Field label="Presupuesto">
              <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} disabled={!!fixedQuote}>
                <option value="">Sin presupuesto</option>
                {accQuotes.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.projectName} · {q.billingMode === "monthly" ? `${eur(q.baseAmount)}/mes` : eur(q.baseAmount)}</option>)}
              </Select>
            </Field>
            {!quote && projectPicker}
            {quote?.billingMode === "monthly" && (
              <Field label="Mes que se factura" hint={`${billedMonths.size} de ${quote.months || "?"} meses facturados`}>
                <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                  {(quoteMonths(quote).length ? quoteMonths(quote) : [thisMonth()]).map((m) => <option key={m} value={m} disabled={billedMonths.has(m)}>{monthName(m)}{billedMonths.has(m) ? " · facturado" : ""}</option>)}
                </Select>
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
