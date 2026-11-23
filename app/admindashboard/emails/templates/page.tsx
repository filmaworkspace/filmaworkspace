"use client";

// ─── Admin · Emails › Plantillas ─────────────────────────────────────────────
// Textos de cada email: asunto, título, texto, botón y pie, con variables
// ({nombre}, {proyecto}…) y vista previa en directo. Se guarda solo lo que
// cambia respecto al texto por defecto; «Restaurar» vuelve al original.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { doc, getDoc, serverTimestamp, setDoc, deleteField } from "firebase/firestore";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { db } from "@/lib/firebase";
import { Button, Field, Input, Page, PageHeader, PageLoading, Textarea } from "@/components/ds";
import { EMAIL_SAMPLES, previewHtml } from "@/components/admin/emailSamples";
import { EMAIL_TEXT_DEFS, FIELD_LABEL, fieldsOf, fillText, textOf, type EmailTexts, type EmailTextsDoc, type TextField, type TextTemplateId } from "@/lib/emails/texts";
import { toast } from "@/lib/toast";

export default function EmailTemplatesPage() {
  const [saved, setSaved] = useState<EmailTextsDoc | null>(null);
  const [sel, setSel] = useState(EMAIL_SAMPLES[0].id);
  const [draft, setDraft] = useState<EmailTexts>({});
  const [busy, setBusy] = useState(false);
  const focused = useRef<{ field: TextField; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  useEffect(() => {
    getDoc(doc(db, "adminConfig", "emailTemplates")).then((s) => setSaved((s.data() || {}) as EmailTextsDoc)).catch(() => setSaved({}));
  }, []);

  const sample = EMAIL_SAMPLES.find((s) => s.id === sel)!;
  const tid = sample.texts as TextTemplateId | undefined;
  // Al cambiar de plantilla, el borrador es el texto efectivo (personalizado o por defecto).
  useEffect(() => {
    if (!saved || !tid) { setDraft({}); return; }
    setDraft(Object.fromEntries(fieldsOf(tid).map((f) => [f, textOf(tid, f, saved[tid])])) as EmailTexts);
  }, [sel, saved, tid]);

  const html = useMemo(() => previewHtml(sample.html(tid ? draft : undefined)), [sample, tid, draft]);
  const subject = tid ? fillText(textOf(tid, "subject", draft), sample.vars || {}) : "";
  const isCustom = (id: string) => !!saved?.[id as TextTemplateId] && Object.keys(saved[id as TextTemplateId] || {}).length > 0;
  const changed = tid && saved ? fieldsOf(tid).some((f) => (draft[f] || "") !== textOf(tid, f, saved[tid])) : false;

  const insert = (v: string) => {
    const f = focused.current;
    if (!f || !tid) return;
    const el = f.el, start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + `{${v}}` + el.value.slice(end);
    setDraft((d) => ({ ...d, [f.field]: next }));
    requestAnimationFrame(() => { el.focus(); const pos = start + v.length + 2; el.setSelectionRange(pos, pos); });
  };

  const save = async (reset = false) => {
    if (!tid) return;
    setBusy(true);
    try {
      const defaults = EMAIL_TEXT_DEFS[tid].defaults as EmailTexts;
      // Solo lo que difiere del texto por defecto.
      const diff = reset ? {} : Object.fromEntries(fieldsOf(tid).filter((f) => (draft[f] || "").trim() && draft[f] !== defaults[f]).map((f) => [f, draft[f]!.trim()]));
      await setDoc(doc(db, "adminConfig", "emailTemplates"), { [tid]: Object.keys(diff).length ? diff : deleteField(), updatedAt: serverTimestamp() }, { merge: true });
      setSaved((s) => { const n = { ...(s || {}) }; if (Object.keys(diff).length) n[tid] = diff; else delete n[tid]; return n; });
      toast.success(reset ? "Plantilla restaurada" : "Plantilla guardada");
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  if (!saved) return <PageLoading />;

  return (
    <Page>
      <Link href="/admindashboard/emails" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Emails</Link>
      <PageHeader title="Plantillas" actions={tid ? (
        <>
          {isCustom(tid) && <Button variant="ghost" disabled={busy} onClick={() => save(true)}><RotateCcw size={14} /> Restaurar</Button>}
          <Button variant="primary" disabled={busy || !changed} onClick={() => save()}>{busy ? "Guardando…" : "Guardar"}</Button>
        </>
      ) : undefined} />

      <div className="mt-6 grid gap-6" style={{ gridTemplateColumns: "220px minmax(0,1fr) minmax(0,1.1fr)" }}>
        <nav className="min-w-0 space-y-0.5" aria-label="Plantillas">
          {EMAIL_SAMPLES.map((s) => (
            <button key={s.id} onClick={() => setSel(s.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${sel === s.id ? "bg-[#F1F1F3] font-medium text-slate-900" : "text-slate-600 hover:bg-[#F7F7F8] hover:text-slate-900"}`}>
              <span className="flex-1 truncate">{s.label}</span>
              {s.texts && isCustom(s.texts) && <span className="h-1.5 w-1.5 rounded-full bg-[#2F52E0]" title="Personalizada" />}
              {!s.texts && <span className="text-[10.5px] text-slate-400">fija</span>}
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {!tid ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] text-slate-500">
              {sel === "broadcast" ? "El texto de cada comunicado se escribe al enviarlo, en Avisos." : "Plantilla interna, sin textos editables."}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(EMAIL_TEXT_DEFS[tid].vars).map(([k, label]) => (
                  <button key={k} type="button" title={label} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k)}
                    className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-900">{`{${k}}`}</button>
                ))}
              </div>
              {fieldsOf(tid).map((f) => {
                const common = {
                  value: draft[f] || "",
                  onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [f]: e.target.value })),
                  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { focused.current = { field: f, el: e.target }; },
                };
                const def = (EMAIL_TEXT_DEFS[tid].defaults as EmailTexts)[f];
                return (
                  <Field key={f} label={FIELD_LABEL[f]}>
                    <div className="relative">
                      {f === "intro" ? <Textarea rows={6} {...common} /> : <Input {...common} />}
                      {draft[f] !== def && (
                        <button type="button" title="Texto por defecto" onClick={() => setDraft((d) => ({ ...d, [f]: def }))} className="absolute right-1.5 top-1.5 rounded p-1 text-slate-400 hover:bg-[#F1F1F3] hover:text-slate-700">
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  </Field>
                );
              })}
              <p className="text-[11px] text-slate-400">{"[ … ]"}: solo aparece si sus variables tienen valor. Línea en blanco: nuevo párrafo.</p>
            </div>
          )}
        </section>

        <aside className="min-w-0">
          <div className="sticky top-[64px] space-y-2">
            {subject && (
              <div className="rounded-md border border-slate-200 px-3 py-2 text-[13px]">
                <span className="text-slate-500">Asunto · </span><span className="text-slate-900">{subject}</span>
              </div>
            )}
            <iframe title="Vista previa" srcDoc={html} className="h-[640px] w-full rounded-md border border-slate-200 bg-[#F4F4F5]" sandbox="" />
          </div>
        </aside>
      </div>
    </Page>
  );
}
