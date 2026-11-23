"use client";

// Ajustes de facturación: datos fiscales de Filma (emisor), numeración de
// cada tipo de documento (serie, formato, dígitos, reinicio y próximo número)
// y precios que se proponen en los presupuestos.

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { Button, Field, IconButton, Input, Modal, Segmented, Select, Textarea } from "@/components/ds";
import {
  BillingSettings, counterKey, DEFAULT_FORMAT, DEFAULT_PHASES, NUMBERING_LABEL, numberingRule, renderNumber, todayIso,
  type NumberingKind, type NumberingRule,
} from "@/lib/billing";

type Tab = "fiscal" | "numbering" | "prices";
const KINDS: NumberingKind[] = ["invoice", "quote", "rectifying"];
const TOKENS = ["{SERIE}", "{AAAA}", "{AA}", "{MM}", "{N}"];
const PRESETS = [
  { label: "F2026-0001", format: "{SERIE}{AAAA}-{N}" },
  { label: "F-26/001", format: "{SERIE}-{AA}/{N}" },
  { label: "2026/F/0001", format: "{AAAA}/{SERIE}/{N}" },
  { label: "F202611-01", format: "{SERIE}{AAAA}{MM}-{N}" },
  { label: "F0001", format: "{SERIE}{N}" },
];

const num = (v: string) => Number(v.replace(",", ".")) || 0;

export function BillingSettingsModal({ open, onClose, settings, onSaved }: { open: boolean; onClose: () => void; settings: BillingSettings; onSaved: (s: BillingSettings) => void }) {
  const [tab, setTab] = useState<Tab>("fiscal");
  const [f, setF] = useState(settings);
  const [rules, setRules] = useState<Record<NumberingKind, NumberingRule>>(() => Object.fromEntries(KINDS.map((k) => [k, numberingRule(settings, k)])) as Record<NumberingKind, NumberingRule>);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [next, setNext] = useState<Record<NumberingKind, string>>({ invoice: "", quote: "", rectifying: "" });
  const [phases, setPhases] = useState(settings.phaseDefaults?.length ? settings.phaseDefaults : DEFAULT_PHASES.map((p) => ({ ...p, price: settings.monthlyPrice || 0 })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = todayIso();
  const year = Number(today.slice(0, 4));

  useEffect(() => {
    if (!open) return;
    setF(settings); setError("");
    const r = Object.fromEntries(KINDS.map((k) => [k, numberingRule(settings, k)])) as Record<NumberingKind, NumberingRule>;
    setRules(r);
    setPhases(settings.phaseDefaults?.length ? settings.phaseDefaults : DEFAULT_PHASES.map((p) => ({ ...p, price: settings.monthlyPrice || 0 })));
    getDoc(doc(db, "adminConfig", "billingCounters")).then((s) => {
      const c = (s.data() || {}) as Record<string, number>;
      setCounters(c);
      setNext(Object.fromEntries(KINDS.map((k) => [k, String((c[counterKey(r[k], year)] || 0) + 1)])) as Record<NumberingKind, string>);
    }).catch(() => {});
  }, [open, settings, year]);

  const t = (k: keyof BillingSettings) => ({ value: String(f[k] ?? ""), onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const n = (k: keyof BillingSettings) => ({ value: String(f[k] ?? ""), inputMode: "decimal" as const, onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: num(e.target.value) }) });
  const setRule = (k: NumberingKind, patch: Partial<NumberingRule>) => {
    const r = { ...rules[k], ...patch };
    setRules({ ...rules, [k]: r });
    // Al cambiar serie o reinicio cambia el contador: se propone su siguiente.
    if (patch.prefix !== undefined || patch.reset !== undefined) setNext({ ...next, [k]: String((counters[counterKey(r, year)] || 0) + 1) });
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      const clean: Record<NumberingKind, NumberingRule> = Object.fromEntries(KINDS.map((k) => {
        const r = rules[k];
        const format = r.format.trim() || DEFAULT_FORMAT;
        if (!format.includes("{N}")) throw new Error(`${NUMBERING_LABEL[k]}: el formato necesita {N}`);
        return [k, { prefix: r.prefix.trim(), format, digits: Math.min(8, Math.max(1, r.digits || 4)), reset: r.reset }];
      })) as Record<NumberingKind, NumberingRule>;
      const samples = KINDS.map((k) => renderNumber(clean[k], today, 1));
      if (new Set(samples).size < 3) throw new Error("Facturas, presupuestos y rectificativas tienen que numerarse distinto (cambia la serie o el formato)");
      const data: BillingSettings = {
        ...f, taxId: f.taxId.trim().toUpperCase(), iban: f.iban.replace(/\s+/g, "").toUpperCase(),
        invoicePrefix: clean.invoice.prefix, rectifyingPrefix: clean.rectifying.prefix, quotePrefix: clean.quote.prefix,
        numbering: clean,
        phaseDefaults: phases.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), price: p.price || 0, months: Math.max(1, Math.round(p.months || 1)) })),
      };
      await setDoc(doc(db, "adminConfig", "billing"), { ...data, updatedAt: serverTimestamp() });
      // Próximo número: solo se guarda si se ha cambiado.
      const counterPatch: Record<string, number> = {};
      for (const k of KINDS) {
        const key = counterKey(clean[k], year);
        const want = Math.max(1, Math.round(num(next[k]) || 1));
        if (want !== (counters[key] || 0) + 1) counterPatch[key] = want - 1;
      }
      if (Object.keys(counterPatch).length) await setDoc(doc(db, "adminConfig", "billingCounters"), counterPatch, { merge: true });
      onSaved(data);
      onClose();
    } catch (e) { setError((e as Error).message || "No se pudo guardar"); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ajustes de facturación" width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button></>}>
      <div className="flex flex-col gap-5">
        <Segmented value={tab} onChange={setTab} options={[{ value: "fiscal", label: "Datos fiscales" }, { value: "numbering", label: "Numeración" }, { value: "prices", label: "Precios y condiciones" }]} />

        {tab === "fiscal" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Razón social" className="col-span-2"><Input {...t("name")} placeholder="Filma Workspace S.L." /></Field>
              <Field label="NIF / CIF"><Input {...t("taxId")} className="font-mono" /></Field>
              <Field label="Email de facturación"><Input {...t("email")} /></Field>
              <Field label="Dirección fiscal" className="col-span-2"><Input {...t("address")} /></Field>
              <div className="col-span-2 grid grid-cols-[110px_1fr_1fr_1fr] gap-3">
                <Field label="C. P."><Input {...t("postalCode")} /></Field>
                <Field label="Ciudad"><Input {...t("city")} /></Field>
                <Field label="Provincia"><Input {...t("province")} /></Field>
                <Field label="País"><Input {...t("country")} /></Field>
              </div>
              <Field label="Teléfono"><Input {...t("phone")} /></Field>
            </div>
            <div className="grid grid-cols-[1fr_200px] gap-3 border-t border-slate-100 pt-4">
              <Field label="IBAN para los cobros"><Input {...t("iban")} className="font-mono" placeholder="ES00 0000 0000 0000 0000 0000" /></Field>
              <Field label="Banco"><Input {...t("bank")} /></Field>
            </div>
            <Field label="Pie de página" hint="Si lo dejas vacío: razón social, NIF y dirección."><Input {...t("footer")} placeholder="Inscrita en el Registro Mercantil de…" /></Field>
          </>
        )}

        {tab === "numbering" && (
          <div className="flex flex-col gap-5">
            {KINDS.map((k) => {
              const r = rules[k];
              const preview = renderNumber(r, today, Math.max(1, Math.round(num(next[k]) || 1)));
              return (
                <div key={k} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-semibold text-slate-900">{NUMBERING_LABEL[k]}</p>
                    <p className="text-xs text-slate-500">Siguiente: <span className="font-mono text-[13px] text-slate-900">{preview}</span></p>
                  </div>
                  <div className="grid grid-cols-[110px_minmax(0,1fr)_80px_130px_110px] gap-3">
                    <Field label="Serie"><Input value={r.prefix} onChange={(e) => setRule(k, { prefix: e.target.value })} className="font-mono" /></Field>
                    <Field label="Formato">
                      <Input value={r.format} onChange={(e) => setRule(k, { format: e.target.value })} className="font-mono" list={`fmt-${k}`} />
                      <datalist id={`fmt-${k}`}>{PRESETS.map((p) => <option key={p.format} value={p.format}>{p.label}</option>)}</datalist>
                    </Field>
                    <Field label="Dígitos"><Input value={String(r.digits)} inputMode="numeric" onChange={(e) => setRule(k, { digits: Math.round(num(e.target.value)) })} /></Field>
                    <Field label="Reinicio">
                      <Select value={r.reset} onChange={(e) => setRule(k, { reset: e.target.value as NumberingRule["reset"] })}>
                        <option value="yearly">Cada año</option>
                        <option value="never">Nunca</option>
                      </Select>
                    </Field>
                    <Field label="Próximo nº"><Input value={next[k]} inputMode="numeric" onChange={(e) => setNext({ ...next, [k]: e.target.value })} className="tabular-nums" /></Field>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {TOKENS.map((tk) => (
                      <button key={tk} type="button" onClick={() => setRule(k, { format: r.format + tk })} className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-500 hover:border-slate-300 hover:text-slate-900">{tk}</button>
                    ))}
                    {PRESETS.map((p) => (
                      <button key={p.format} type="button" onClick={() => setRule(k, { format: p.format })} className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${r.format === p.format ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-900"}`}>{renderNumber({ ...r, format: p.format }, today, 1)}</button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-slate-400">{"{SERIE}"} serie · {"{AAAA}"} año · {"{AA}"} año corto · {"{MM}"} mes de la fecha · {"{N}"} correlativo. Lo ya emitido no cambia. Al emitir también puedes escribir un número a mano.</p>
          </div>
        )}

        {tab === "prices" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="IVA por defecto (%)"><Input {...n("defaultVat")} /></Field>
              <Field label="Pago a (días)"><Input {...n("paymentDays")} /></Field>
              <Field label="Validez presupuesto (días)"><Input {...n("quoteValidityDays")} /></Field>
              <Field label="Cuota mensual (€)" hint="Presupuestos de cuota fija"><Input {...n("monthlyPrice")} /></Field>
              <Field label="Budgeting al mes (€)" hint="Por persona"><Input {...n("budgetingPrice")} /></Field>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-medium text-slate-600">Fases propuestas en los presupuestos por fases</p>
              <div className="grid grid-cols-[minmax(0,1fr)_120px_80px_32px] gap-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-slate-500">
                <span>Fase</span><span className="text-right">€ / mes</span><span className="text-right">Meses</span><span />
              </div>
              {phases.map((p, i) => (
                <div key={i} className="mt-1.5 grid grid-cols-[minmax(0,1fr)_120px_80px_32px] items-center gap-2">
                  <Input value={p.name} onChange={(e) => setPhases(phases.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  <Input value={String(p.price)} inputMode="decimal" className="text-right tabular-nums" onChange={(e) => setPhases(phases.map((x, k) => (k === i ? { ...x, price: num(e.target.value) } : x)))} />
                  <Input value={String(p.months)} inputMode="numeric" className="text-right tabular-nums" onChange={(e) => setPhases(phases.map((x, k) => (k === i ? { ...x, months: num(e.target.value) } : x)))} />
                  <IconButton label="Quitar" onClick={() => setPhases(phases.filter((_, k) => k !== i))}><Trash2 size={13} /></IconButton>
                </div>
              ))}
              <Button variant="ghost" className="mt-2" onClick={() => setPhases([...phases, { name: "", price: settings.monthlyPrice || 0, months: 1 }])}><Plus size={14} /> Añadir fase</Button>
            </div>
            <Field label="Condiciones de los presupuestos"><Textarea rows={3} {...t("quoteConditions")} /></Field>
          </>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
