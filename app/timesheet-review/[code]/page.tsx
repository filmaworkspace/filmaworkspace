"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { inter } from "@/lib/fonts";
import { db } from "@/lib/firebase";
import {
  doc, getDoc, collection, query, where, getDocs, orderBy,
} from "firebase/firestore";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, LogIn, LogOut } from "lucide-react";
import Image from "next/image";

const G = "#6BA319";

interface AccessDoc {
  projectId:     string;
  projectName:   string;
  recipientUid:  string;
  recipientName: string;
  active:        boolean;
}

interface FormDoc {
  id:            string;
  date:          string;
  jornada:       number;
  submittedAt:   any;
  entrada:       string | null;
  salida:        string | null;
  comida:        number | null;
  observaciones: string;
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const dow = new Date(Number(y), Number(m) - 1, Number(d)).getDay();
  const days = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  return `${days[dow]} ${parseInt(d)} de ${months[parseInt(m) - 1]}`;
}

function formatTs(ts: any): string {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function TimesheetReviewPage() {
  const { code } = useParams() as { code: string };

  const [status,    setStatus]    = useState<"loading" | "notfound" | "ready">("loading");
  const [access,    setAccess]    = useState<AccessDoc | null>(null);
  const [forms,     setForms]     = useState<FormDoc[]>([]);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const accessSnap = await getDoc(doc(db, "horarioAccess", code));
        if (!accessSnap.exists() || !accessSnap.data().active) {
          setStatus("notfound");
          return;
        }
        const accessData = accessSnap.data() as AccessDoc;
        setAccess(accessData);

        // Load all forms for this person + project
        const q = query(
          collection(db, "horarioForms"),
          where("recipientUid", "==", accessData.recipientUid),
          where("projectId",    "==", accessData.projectId),
          orderBy("date", "desc"),
        );
        const snap = await getDocs(q);
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FormDoc));
        setForms(docs);
        setStatus("ready");
      } catch (e) {
        console.error(e);
        setStatus("notfound");
      }
    })();
  }, [code]);

  if (status === "loading") {
    return (
      <div className={`min-h-screen bg-slate-50 flex items-center justify-center ${inter.className}`}>
        <div className="w-9 h-9 border-4 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: G }} />
      </div>
    );
  }

  if (status === "notfound") {
    return (
      <div className={`min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6 ${inter.className}`}>
        <AlertCircle size={40} className="text-slate-300" />
        <p className="text-slate-500 text-sm text-center">Este enlace no existe o ha sido desactivado.</p>
      </div>
    );
  }

  const submitted = forms.filter((f) => f.submittedAt);
  const pending   = forms.filter((f) => !f.submittedAt);

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      <div className="w-full max-w-lg mx-auto px-4 py-6 sm:py-10 space-y-4">

        {/* Header card */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-5" style={{ background: `linear-gradient(135deg, ${G}, #4a7a10)` }}>
            <p className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">
              {access?.projectName}
            </p>
            <h1 className="text-lg font-semibold text-white">Control horario</h1>
            <p className="text-sm text-white/80 mt-1">Hola, {access?.recipientName?.split(" ")[0]}</p>
          </div>
          <div className="px-5 py-4 flex items-center justify-between gap-4 bg-white">
            <div className="text-center flex-1">
              <p className="text-2xl font-bold text-slate-900">{submitted.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">Rellenados</p>
            </div>
            <div className="w-px h-8 bg-slate-100" />
            <div className="text-center flex-1">
              <p className={`text-2xl font-bold ${pending.length > 0 ? "text-amber-500" : "text-slate-300"}`}>
                {pending.length}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Pendientes</p>
            </div>
            <div className="w-px h-8 bg-slate-100" />
            <div className="text-center flex-1">
              <p className="text-2xl font-bold text-slate-900">{forms.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">Total</p>
            </div>
          </div>
        </div>

        {/* Forms list */}
        {forms.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <Clock size={28} className="text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Aún no se han enviado formularios.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden divide-y divide-slate-100">
            {forms.map((form) => {
              const done = !!form.submittedAt;
              const isExp = expanded === form.id;
              return (
                <div key={form.id}>
                  <button
                    onClick={() => setExpanded(isExp ? null : form.id)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                  >
                    {/* Status dot */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      done ? "bg-green-50" : "bg-amber-50"
                    }`}>
                      {done
                        ? <CheckCircle2 size={16} style={{ color: G }} />
                        : <Clock size={16} className="text-amber-500" />
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {formatDateLabel(form.date)}
                      </p>
                      <p className="text-xs text-slate-400">Jornada #{form.jornada}</p>
                    </div>

                    {/* Badge */}
                    {done ? (
                      <span className="text-xs px-2 py-0.5 rounded-lg font-medium flex-shrink-0"
                        style={{ background: "#eaf3de", color: "#3b6d11" }}>
                        Rellenado
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-lg font-medium bg-amber-50 text-amber-600 flex-shrink-0">
                        Pendiente
                      </span>
                    )}
                  </button>

                  {/* Expanded detail */}
                  {isExp && (
                    <div className="px-5 pb-4 bg-slate-50 border-t border-slate-100">
                      {done ? (
                        <div className="pt-3 grid grid-cols-3 gap-3">
                          {[
                            { icon: LogIn,  label: "Entrada", value: form.entrada  ?? "—" },
                            { icon: LogOut, label: "Salida",  value: form.salida   ?? "—" },
                            { icon: Clock,  label: "Pausa",   value: form.comida != null ? `${form.comida} min` : "—" },
                          ].map(({ icon: Icon, label, value }) => (
                            <div key={label} className="bg-white rounded-xl p-3 border border-slate-100">
                              <div className="flex items-center gap-1 mb-1">
                                <Icon size={11} className="text-slate-400" />
                                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</span>
                              </div>
                              <span className="text-sm font-semibold text-slate-900">{value}</span>
                            </div>
                          ))}
                          {form.observaciones ? (
                            <div className="col-span-3 bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-1">Observaciones</p>
                              <p className="text-sm text-slate-700">{form.observaciones}</p>
                            </div>
                          ) : null}
                          <p className="col-span-3 text-[11px] text-slate-400 text-right pt-1">
                            Enviado a las {formatTs(form.submittedAt)}
                          </p>
                        </div>
                      ) : (
                        <div className="pt-3 flex flex-col items-start gap-3">
                          <p className="text-xs text-slate-500">
                            Todavía no has rellenado el control horario de este día.
                          </p>
                          <a
                            href={`/timesheet/${form.id}`}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                            style={{ background: G }}
                          >
                            Rellenar ahora <ExternalLink size={13} />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400 pb-2">
          Filma Workspace · Enlace personal e intransferible
        </p>
      </div>
    </div>
  );
}
