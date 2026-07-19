"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { inter } from "@/lib/fonts";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { AlertCircle, CheckCircle, LogIn, LogOut, Utensils } from "lucide-react";

const G = "#6BA319";

interface FormData {
  projectName:  string;
  projectLabel: string;
  date: string;
  jornada: number;
  recipientName: string;
  recipientRole: string;
  submittedAt: any;
  entrada: string | null;
  salida: string | null;
  comida: string | null;
  observaciones: string;
}


function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${parseInt(d)} de ${months[parseInt(m) - 1]} de ${y}`;
}

export default function FormHorarioPage() {
  const { formId } = useParams() as { formId: string };

  const [status, setStatus]     = useState<"loading" | "ready" | "submitted" | "not_found" | "error">("loading");
  const [formData, setFormData] = useState<FormData | null>(null);
  const [entrada,  setEntrada]  = useState("07:00");
  const [salida,   setSalida]   = useState("");
  const [comida,   setComida]   = useState("");
  const [obs,      setObs]      = useState("");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadForm();
  }, [formId]);

  const loadForm = async () => {
    try {
      const formSnap = await getDoc(doc(db, "horarioForms", formId));
      if (!formSnap.exists()) { setStatus("not_found"); return; }

      const data = formSnap.data() as FormData;
      setFormData(data);

      if (data.submittedAt) {
        setStatus("submitted");
        setEntrada(data.entrada ?? "");
        setSalida(data.salida ?? "");
        setComida(data.comida ?? "");
        setObs(data.observaciones ?? "");
        return;
      }

      if (data.entrada) setEntrada(data.entrada);
      setStatus("ready");
    } catch (e: any) {
      console.error("loadForm error:", e?.code, e?.message, e);
      setLoadError(e?.code ?? e?.message ?? "unknown");
      setStatus("error");
    }
  };

  const handleSubmit = async () => {
    if (!entrada) { setError("La hora de entrada es obligatoria"); return; }
    if (!salida)  { setError("La hora de salida es obligatoria"); return; }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "horarioForms", formId), {
        entrada,
        salida,
        comida:       comida || null,
        observaciones: obs,
        submittedAt:  serverTimestamp(),
      });
      setStatus("submitted");
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-10 h-10 border-4 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: G }} />
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className={`min-h-screen bg-white flex flex-col items-center justify-center gap-4 ${inter.className}`}>
        <AlertCircle size={40} className="text-slate-300" />
        <p className="text-slate-500 text-sm">Formulario no encontrado o enlace inválido.</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={`min-h-screen bg-white flex flex-col items-center justify-center gap-4 ${inter.className}`}>
        <AlertCircle size={40} className="text-red-400" />
        <p className="text-slate-500 text-sm">Error al cargar el formulario.</p>
        {loadError && <p className="text-xs text-red-400 font-mono">{loadError}</p>}
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      <div className="w-full max-w-lg mx-auto px-4 py-6 sm:py-10">
        {/* Card */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-5 sm:px-6 sm:py-6" style={{ background: `linear-gradient(135deg, ${G}, #4a7a10)` }}>
            <p className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">{formData?.projectName || formData?.projectLabel}</p>
            <h1 className="text-lg sm:text-xl font-semibold text-white leading-snug">
              Control horario · Jornada #{formData?.jornada}
            </h1>
            <p className="text-sm text-white/80 mt-1">{formData ? formatDateLabel(formData.date) : ""}</p>
          </div>

          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <p className="text-sm font-medium text-slate-900">{formData?.recipientName}</p>
            <p className="text-xs text-slate-500">{formData?.recipientRole}</p>
          </div>

          {status === "submitted" ? (
            <div className="px-6 py-8 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#eaf3de" }}>
                <CheckCircle size={24} style={{ color: G }} />
              </div>
              <p className="font-semibold text-slate-900">Formulario enviado</p>
              <p className="text-sm text-slate-500">Gracias, {formData?.recipientName?.split(" ")[0]}. Tu control horario ha sido registrado.</p>
              <div className="w-full mt-4 grid grid-cols-3 gap-3 text-left">
                {[
                  { icon: LogIn,    label: "Entrada", value: entrada  },
                  { icon: LogOut,   label: "Salida",  value: salida || "—" },
                  { icon: Utensils, label: "Comida",  value: comida || "—" },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon size={12} className="text-slate-400" />
                      <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 space-y-5">
              {/* Entrada */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-2">
                  <LogIn size={13} className="text-slate-400" /> Hora de entrada <span className="text-red-400">*</span>
                </label>
                <input
                  type="time"
                  value={entrada}
                  onChange={(e) => setEntrada(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ "--tw-ring-color": G } as React.CSSProperties}
                />
              </div>

              {/* Salida */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-2">
                  <LogOut size={13} className="text-slate-400" /> Hora de salida <span className="text-red-400">*</span>
                </label>
                <input
                  type="time"
                  value={salida}
                  onChange={(e) => setSalida(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ "--tw-ring-color": G } as React.CSSProperties}
                />
              </div>

              {/* Pausa */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-2">
                  <Utensils size={13} className="text-slate-400" /> Pausa para comer <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={comida}
                  onChange={(e) => setComida(e.target.value)}
                  placeholder="Ej: 30 min, 1 hora..."
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                />
              </div>

              {/* Observaciones */}
              <div>
                <label className="text-xs font-medium text-slate-700 mb-2 block">Observaciones <span className="text-slate-400 font-normal">(opcional)</span></label>
                <textarea
                  rows={3}
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Incidencias, horas extra, notas..."
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:border-transparent"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <span className="text-xs text-red-600">{error}</span>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: G }}
              >
                {saving ? "Guardando..." : "Enviar control horario"}
              </button>

              <p className="text-center text-[11px] text-slate-400">
                Enlace personal · No se puede rellenar dos veces
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
