"use client";

// ─── Justificar un anticipo de caja desde el móvil ───────────────────────────
// Enlace público (id secreto + PIN) que el cajero-pagador envía a quien recibió
// un anticipo en efectivo. La persona hace foto a cada ticket, indica importe y
// concepto, y lo envía. El cajero lo revisa en Cajas › Efectivo.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { doc, getDoc, Timestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { Camera, Check, Plus, X } from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { inter } from "@/lib/fonts";
import { Button, Input, Spinner } from "@/components/ds";

interface Ticket {
  localId: string;
  supplier: string;
  date: string;
  amount: string;
  description: string;
  fileUrl?: string;
  fileName?: string;
  progress?: number;
  error?: string;
}

const money = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);
const today = () => new Date().toISOString().slice(0, 10);
const newTicket = (): Ticket => ({ localId: Math.random().toString(36).slice(2), supplier: "", date: today(), amount: "", description: "" });

export default function CashSettlementForm() {
  const { formId } = useParams() as { formId: string };
  const [form, setForm] = useState<any>(null);
  const [state, setState] = useState<"loading" | "notfound" | "pin" | "ready" | "sent">("loading");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([newTicket()]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    getDoc(doc(db, "forms", formId))
      .then((snap) => {
        const d = snap.data();
        if (!snap.exists() || d?.type !== "cash_settlement") return setState("notfound");
        if (d.expiresAt?.toDate && d.expiresAt.toDate() < new Date()) return setState("notfound");
        setForm(d);
        setState(d.status === "submitted" ? "sent" : "pin");
      })
      .catch(() => setState("notfound"));
  }, [formId]);

  const total = tickets.reduce((s, t) => s + (parseFloat(t.amount.replace(",", ".")) || 0), 0);
  const advance = form?.amount || 0;
  const diff = Math.round((advance - total) * 100) / 100;

  const update = (id: string, patch: Partial<Ticket>) => setTickets((prev) => prev.map((t) => (t.localId === id ? { ...t, ...patch } : t)));

  const upload = (t: Ticket, file: File) => {
    const task = uploadBytesResumable(ref(storage, `forms/${formId}/expenses/${t.localId}_${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`), file);
    update(t.localId, { progress: 0, error: undefined, fileName: file.name });
    task.on(
      "state_changed",
      (s) => update(t.localId, { progress: Math.round((s.bytesTransferred / s.totalBytes) * 100) }),
      () => update(t.localId, { progress: undefined, error: "No se pudo subir la foto" }),
      async () => update(t.localId, { progress: undefined, fileUrl: await getDownloadURL(task.snapshot.ref) }),
    );
  };

  const submit = async () => {
    setError("");
    const valid = tickets.filter((t) => parseFloat(t.amount.replace(",", ".")) > 0);
    if (!valid.length) return setError("Añade al menos un ticket con importe");
    if (valid.some((t) => !t.fileUrl)) return setError("Falta la foto de algún ticket");
    if (tickets.some((t) => t.progress !== undefined)) return setError("Espera a que terminen de subirse las fotos");
    setSending(true);
    try {
      await updateDoc(doc(db, "forms", formId), {
        status: "submitted",
        submittedAt: Timestamp.now(),
        responseData: {
          tickets: valid.map((t) => ({
            supplier: t.supplier.trim(), date: t.date, amount: Math.round(parseFloat(t.amount.replace(",", ".")) * 100) / 100,
            description: t.description.trim(), fileUrl: t.fileUrl, fileName: t.fileName,
          })),
          total: Math.round(total * 100) / 100,
        },
      });
      setState("sent");
    } catch {
      setError("No se pudo enviar. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-8">
        <Image src="/logodark.svg" alt="Filma Workspace" width={96} height={20} className="h-auto w-[88px]" />
        {children}
      </div>
    </div>
  );

  if (state === "loading") return shell(<div className="flex justify-center py-20"><Spinner className="h-6 w-6" /></div>);
  if (state === "notfound") return shell(<p className="py-16 text-center text-[13px] text-slate-500">Este enlace no existe o ha caducado. Pide uno nuevo al cajero.</p>);

  if (state === "sent") {
    return shell(
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F1F3]"><Check size={18} /></span>
        <p className="text-[15px] font-semibold text-slate-900">Tickets enviados</p>
        <p className="text-[13px] text-slate-500">El cajero los revisará. Si te sobró dinero, devuélveselo en efectivo.</p>
      </div>,
    );
  }

  if (state === "pin") {
    return shell(
      <form
        className="flex flex-col gap-4 py-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.trim() === String(form.pin)) { setState("ready"); setPinError(""); } else setPinError("PIN incorrecto");
        }}
      >
        <div>
          <p className="text-[15px] font-semibold text-slate-900">Justificar anticipo</p>
          <p className="mt-1 text-[13px] text-slate-500">{form.projectName} · {form.personName}</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600">PIN</span>
          <Input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoFocus className="h-11 text-center tabular-nums text-lg tracking-[0.4em]" maxLength={6} />
        </label>
        {pinError && <p className="text-xs text-red-700">{pinError}</p>}
        <Button variant="primary" type="submit">Entrar</Button>
      </form>,
    );
  }

  return shell(
    <>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-slate-900">Justificar anticipo {form.advanceNumber}</p>
        <p className="text-[13px] text-slate-500">{form.projectName} · {form.personName}</p>
        <p className="mt-2 flex items-baseline justify-between rounded-md border border-slate-200 px-3 py-2 text-[13px]">
          <span className="text-slate-600">Recibiste</span>
          <span className="tabular-nums font-semibold">{money(advance)} €</span>
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {tickets.map((t, i) => (
          <div key={t.localId} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Ticket {i + 1}</span>
              {tickets.length > 1 && (
                <button onClick={() => setTickets(tickets.filter((x) => x.localId !== t.localId))} aria-label="Quitar ticket" className="text-slate-400 hover:text-slate-900"><X size={15} /></button>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRefs.current[t.localId]?.click()}
              className={`flex h-24 items-center justify-center gap-2 rounded-md border border-dashed text-[13px] ${t.fileUrl ? "border-slate-300 text-slate-900" : "border-slate-300 text-slate-500"}`}
            >
              {t.progress !== undefined ? <><Spinner className="h-4 w-4" /> {t.progress} %</> : t.fileUrl ? <><Check size={15} /> {t.fileName}</> : <><Camera size={16} /> Hacer foto del ticket</>}
            </button>
            <input
              ref={(el) => { fileRefs.current[t.localId] = el; }}
              type="file" accept="image/*,.pdf" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(t, f); }}
            />
            {t.error && <p className="text-xs text-red-700">{t.error}</p>}
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <Input value={t.supplier} onChange={(e) => update(t.localId, { supplier: e.target.value })} placeholder="Establecimiento" className="h-10" />
              <Input value={t.amount} onChange={(e) => update(t.localId, { amount: e.target.value })} placeholder="Importe €" inputMode="decimal" className="h-10 text-right tabular-nums" />
            </div>
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <Input value={t.description} onChange={(e) => update(t.localId, { description: e.target.value })} placeholder="¿Qué compraste?" className="h-10" />
              <Input type="date" value={t.date} onChange={(e) => update(t.localId, { date: e.target.value })} className="h-10" />
            </div>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setTickets([...tickets, newTicket()])}><Plus size={14} /> Otro ticket</Button>
      </div>

      <div className="flex flex-col gap-2 rounded-md bg-[#F7F7F8] px-3.5 py-3 text-[13px]">
        <div className="flex justify-between"><span className="text-slate-600">Total tickets</span><span className="tabular-nums font-semibold">{money(total)} €</span></div>
        {total > 0 && (
          <p className={`text-xs ${diff < 0 ? "text-amber-900" : "text-slate-600"}`}>
            {Math.abs(diff) < 0.005 ? "Justificas exactamente el anticipo." : diff > 0 ? `Te sobran ${money(diff)} €: devuélveselos al cajero.` : `Has gastado ${money(-diff)} € más: el cajero te los reembolsará.`}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      <Button variant="primary" onClick={submit} disabled={sending}>{sending ? "Enviando…" : "Enviar tickets"}</Button>
    </>,
  );
}
