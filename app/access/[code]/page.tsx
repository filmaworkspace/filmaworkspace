"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { inter } from "@/lib/fonts";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import {
  AlertTriangle, Car, Check, ChevronLeft, ChevronRight,
  Globe, Home, Lock, Plane, Utensils, X,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const DAY_SHORT = ["L","M","X","J","V","S","D"];

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const dow = (y: number, m: number, d: number) => { const x = new Date(y, m, d).getDay(); return x === 0 ? 6 : x - 1; };
const isWknd = (y: number, m: number, d: number) => { const w = dow(y, m, d); return w === 5 || w === 6; };
const dk = (d: number) => String(d).padStart(2, "0");
const padM = (m: number) => String(m + 1).padStart(2, "0");

// ─── Types ────────────────────────────────────────────────────────────────────

type AKey = "meals"|"halfPerDiem"|"perDiem"|"halfIntlPerDiem"|"intlPerDiem"|"accommodation"|"car";

interface ADef {
  key: AKey;
  label: string;
  dot: string;
  Icon: React.FC<{ size?: number; style?: React.CSSProperties; className?: string }>;
}

const ALL_ALLOWANCES: ADef[] = [
  { key: "meals",           label: "Comidas",              dot: "#f97316", Icon: Utensils },
  { key: "halfPerDiem",     label: "½ Dieta nacional",     dot: "#7dd3fc", Icon: Plane    },
  { key: "perDiem",         label: "Dieta nacional",       dot: "#0ea5e9", Icon: Plane    },
  { key: "halfIntlPerDiem", label: "½ Dieta internacional",dot: "#a5b4fc", Icon: Globe    },
  { key: "intlPerDiem",     label: "Dieta internacional",  dot: "#6366f1", Icon: Globe    },
  { key: "accommodation",   label: "Alojamiento",          dot: "#a855f7", Icon: Home     },
  { key: "car",             label: "Vehículo",             dot: "#10b981", Icon: Car      },
];

interface PersonData {
  memberId: string;
  firstName: string;
  lastName1: string;
  department?: string;
  section?: string;
}

interface AccessDoc {
  code: string;
  name: string;
  projectId: string;
  projectName: string;
  color: string;
  people: PersonData[];
  pin: string | null;
  allowedTypes: AKey[];
  lockedDays: string[];
  active: boolean;
}

type MonthEntries = Record<string, Record<string, Record<string, boolean>>>;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AccessPage() {
  const params = useParams();
  const code   = params.code as string;

  const [access,      setAccess]      = useState<AccessDoc | null>(null);
  const [status,      setStatus]      = useState<"loading"|"notfound"|"pin"|"ready">("loading");
  const [pinInput,    setPinInput]    = useState("");
  const [pinError,    setPinError]    = useState(false);

  const now = new Date();
  const [year,      setYear]      = useState(now.getFullYear());
  const [month,     setMonth]     = useState(now.getMonth());
  const [entries,   setEntries]   = useState<MonthEntries>({});
  const [saving,    setSaving]    = useState(false);
  const [savedFlash,setSavedFlash]= useState(false);
  const [editTarget,setEditTarget]= useState<{ memberId: string; day: number } | null>(null);

  const monthKey = `${year}-${padM(month)}`;
  const numDays  = daysInMonth(year, month);
  const days     = Array.from({ length: numDays }, (_, i) => i + 1);

  // Load access document
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "access", code));
        if (!snap.exists() || !snap.data().active) { setStatus("notfound"); return; }
        const data = snap.data() as AccessDoc;
        setAccess(data);
        setStatus(data.pin ? "pin" : "ready");
      } catch { setStatus("notfound"); }
    })();
  }, [code]);

  // Load month data when ready
  useEffect(() => {
    if (status !== "ready" || !access) return;
    (async () => {
      const snap = await getDoc(doc(db, `projects/${access.projectId}/payrollMonths`, monthKey));
      setEntries(snap.exists() ? (snap.data().entries || {}) : {});
    })();
  }, [status, access, monthKey]);

  const getEntry = (memberId: string, d: number): Record<string, boolean> =>
    entries[memberId]?.[dk(d)] || {};

  const isLocked = (d: number) => {
    if (!access) return false;
    return access.lockedDays.includes(`${year}-${padM(month)}-${dk(d)}`);
  };

  const checkPin = () => {
    if (pinInput === access?.pin) { setPinError(false); setStatus("ready"); }
    else { setPinError(true); setPinInput(""); }
  };

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const toggleComplement = async (memberId: string, d: number, key: AKey) => {
    if (!access || isLocked(d)) return;
    setSaving(true);
    try {
      const monthRef = doc(db, `projects/${access.projectId}/payrollMonths`, monthKey);
      const current  = await getDoc(monthRef);
      const cData    = current.exists() ? current.data() : {};
      const cEntries = (cData.entries || {}) as MonthEntries;
      const cDay     = cEntries[memberId]?.[dk(d)] || {};
      const newVal   = !cDay[key];
      const newEntries: MonthEntries = {
        ...cEntries,
        [memberId]: {
          ...(cEntries[memberId] || {}),
          [dk(d)]: { ...cDay, [key]: newVal },
        },
      };
      await setDoc(monthRef, {
        ...cData,
        entries: newEntries,
        accessCode: code,
        updatedAt: Timestamp.now(),
      });
      setEntries(newEntries);
      flashSaved();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const prevM = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextM = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const allowances = access
    ? ALL_ALLOWANCES.filter(a => access.allowedTypes.includes(a.key))
    : ALL_ALLOWANCES;
  const color = access?.color || "#6BA319";

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === "loading") return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
    </div>
  );

  // ── Not found ─────────────────────────────────────────────────────────────
  if (status === "notfound") return (
    <div className={`min-h-screen bg-slate-50 flex items-center justify-center p-6 ${inter.className}`}>
      <div className="text-center max-w-xs">
        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <AlertTriangle size={28} className="text-slate-400" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Acceso no disponible</h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          Este enlace no existe o ha sido desactivado por el administrador de la producción.
        </p>
      </div>
    </div>
  );

  // ── PIN screen ────────────────────────────────────────────────────────────
  if (status === "pin") return (
    <div className={`min-h-screen bg-slate-900 flex items-center justify-center p-6 ${inter.className}`}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: color + "18" }}>
              <Lock size={24} style={{ color }} />
            </div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
              {access?.projectName}
            </p>
            <h1 className="text-xl font-bold text-slate-900 mb-1">{access?.name}</h1>
            <p className="text-sm text-slate-500">Introduce el PIN para acceder</p>
          </div>
          <div className="space-y-3">
            <input
              type="number" inputMode="numeric"
              value={pinInput}
              onChange={e => { setPinInput(e.target.value); setPinError(false); }}
              onKeyDown={e => e.key === "Enter" && checkPin()}
              placeholder="• • • •"
              className={`w-full text-center text-3xl font-bold tracking-[0.5em] border-2 rounded-2xl px-4 py-4 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                pinError
                  ? "border-red-300 text-red-500 bg-red-50"
                  : "border-slate-200 text-slate-900 focus:border-slate-400"
              }`}
            />
            {pinError && (
              <p className="text-sm text-red-500 text-center font-medium">PIN incorrecto, inténtalo de nuevo</p>
            )}
            <button
              onClick={checkPin}
              className="w-full py-3.5 font-semibold rounded-2xl text-white transition-opacity hover:opacity-90 active:opacity-80"
              style={{ backgroundColor: color }}>
              Entrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Main view ─────────────────────────────────────────────────────────────
  const editPerson = access?.people.find(p => p.memberId === editTarget?.memberId);
  const today      = now.getDate();
  const isToday    = (d: number) => d === today && month === now.getMonth() && year === now.getFullYear();

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-sm">
        <div className="px-4 py-3 flex items-center gap-3 max-w-screen-2xl mx-auto">
          {/* Identity */}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none truncate">
              {access?.projectName}
            </p>
            <p className="text-sm font-bold text-slate-900 leading-tight mt-0.5 truncate">{access?.name}</p>
          </div>

          <div className="flex-1" />

          {/* Save indicator */}
          <div className={`flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${savedFlash ? "opacity-100" : "opacity-0"}`}
            style={{ color }}>
            <Check size={12} strokeWidth={2.5} />
            <span>Guardado</span>
          </div>
          {saving && (
            <div className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
          )}

          {/* Month nav */}
          <div className="flex items-center gap-0.5">
            <button onClick={prevM} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-slate-700 min-w-[118px] text-center">
              {MONTH_NAMES[month]} {year}
            </span>
            <button onClick={nextM} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="h-0.5" style={{ backgroundColor: color }} />
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="border-collapse w-full" style={{ minWidth: `${220 + numDays * 42}px` }}>
          {/* Header */}
          <thead>
            <tr className="bg-white border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-white border-r border-slate-100 px-4 py-3 text-left"
                style={{ minWidth: 200 }}>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Persona</span>
              </th>
              {days.map(d => {
                const wknd   = isWknd(year, month, d);
                const locked = isLocked(d);
                const newWeek = dow(year, month, d) === 0 && d > 1;
                const tod    = isToday(d);
                return (
                  <th key={d}
                    className={`w-[42px] min-w-[42px] text-center py-2.5 text-xs ${newWeek ? "border-l border-slate-200" : ""} ${locked ? "bg-amber-50" : wknd ? "bg-slate-50" : ""}`}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-medium text-slate-400">{DAY_SHORT[dow(year, month, d)]}</span>
                      <span
                        className="text-xs font-bold leading-none w-6 h-6 flex items-center justify-center rounded-full"
                        style={tod ? { backgroundColor: color, color: "#fff" } : locked ? { color: "#d97706" } : { color: "#334155" }}>
                        {d}
                      </span>
                      {locked && <Lock size={8} className="text-amber-400" />}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {(access?.people || []).length === 0 ? (
              <tr>
                <td colSpan={numDays + 1} className="py-16 text-center text-sm text-slate-400">
                  No hay personas asignadas a este acceso
                </td>
              </tr>
            ) : (access?.people || []).map((person, idx) => (
              <tr key={person.memberId} className={`border-b border-slate-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                {/* Name sticky cell */}
                <td className={`sticky left-0 z-10 border-r border-slate-100 px-3 py-2.5 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
                      style={{ backgroundColor: color + "cc" }}>
                      {(person.firstName[0] || "").toUpperCase()}{(person.lastName1[0] || "").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate leading-tight">
                        {person.firstName} {person.lastName1}
                      </p>
                      {person.department && (
                        <p className="text-[10px] text-slate-400 truncate leading-tight">{person.department}</p>
                      )}
                    </div>
                  </div>
                </td>

                {/* Day cells */}
                {days.map(d => {
                  const wknd    = isWknd(year, month, d);
                  const locked  = isLocked(d);
                  const newWeek = dow(year, month, d) === 0 && d > 1;
                  const entry   = getEntry(person.memberId, d);
                  const dots    = allowances.filter(a => entry[a.key]);

                  return (
                    <td key={d}
                      onClick={() => !locked && setEditTarget({ memberId: person.memberId, day: d })}
                      className={`w-[42px] min-w-[42px] text-center align-middle transition-colors
                        ${newWeek ? "border-l border-slate-200" : ""}
                        ${locked
                          ? "bg-amber-50/60 cursor-not-allowed"
                          : wknd
                            ? "bg-slate-50 hover:bg-slate-100 cursor-pointer"
                            : "hover:bg-slate-50 cursor-pointer"
                        }`}>
                      <div className="flex flex-wrap justify-center gap-[3px] py-3 px-1">
                        {dots.length > 0
                          ? dots.map(a => (
                              <div key={a.key} className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: a.dot }} />
                            ))
                          : <div className="w-2 h-2" />
                        }
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-4 flex flex-wrap gap-x-4 gap-y-2 max-w-screen-2xl mx-auto">
        {allowances.map(a => (
          <div key={a.key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.dot }} />
            <span className="text-xs text-slate-500">{a.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-200 flex-shrink-0" />
          <span className="text-xs text-slate-400">Día bloqueado</span>
        </div>
      </div>

      {/* ── Edit bottom sheet ────────────────────────────────────────────── */}
      {/* Backdrop */}
      {editTarget && (
        <div
          className="fixed inset-0 bg-black/25 backdrop-blur-sm z-40"
          onClick={() => setEditTarget(null)}
        />
      )}

      {/* Sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out ${editTarget ? "translate-y-0" : "translate-y-full"}`}>
        <div className="bg-white rounded-t-3xl shadow-2xl max-w-lg mx-auto">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>

          {/* Sheet header */}
          <div className="px-5 py-3 flex items-start justify-between">
            <div>
              {editPerson && (
                <p className="text-base font-bold text-slate-900">
                  {editPerson.firstName} {editPerson.lastName1}
                </p>
              )}
              {editTarget && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {DAY_SHORT[dow(year, month, editTarget.day)]} {editTarget.day} de {MONTH_NAMES[month]} · {year}
                </p>
              )}
            </div>
            <button
              onClick={() => setEditTarget(null)}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Complement toggles */}
          <div className="px-4 pb-8 pt-1 space-y-2">
            {allowances.map(a => {
              const Icon   = a.Icon;
              const active = editTarget ? !!getEntry(editTarget.memberId, editTarget.day)[a.key] : false;
              return (
                <button
                  key={a.key}
                  onClick={() => editTarget && toggleComplement(editTarget.memberId, editTarget.day, a.key)}
                  disabled={saving}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border-2 transition-all active:scale-[0.98] disabled:opacity-60
                    ${active ? "border-transparent shadow-sm" : "border-slate-100 bg-slate-50 hover:bg-slate-100"}`}
                  style={active ? { backgroundColor: a.dot + "15", borderColor: a.dot + "40" } : {}}>

                  {/* Icon */}
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: active ? a.dot + "25" : "#f1f5f9" }}>
                    <Icon size={16} style={{ color: active ? a.dot : "#94a3b8" }} />
                  </div>

                  {/* Label */}
                  <span className={`text-sm font-semibold flex-1 text-left ${active ? "text-slate-900" : "text-slate-400"}`}>
                    {a.label}
                  </span>

                  {/* Toggle switch */}
                  <div
                    className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${!active ? "bg-slate-200" : ""}`}
                    style={active ? { backgroundColor: a.dot } : {}}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${active ? "left-0.5 translate-x-6" : "left-0.5"}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
