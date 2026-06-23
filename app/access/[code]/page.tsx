"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { inter } from "@/lib/fonts";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import Image from "next/image";
import {
  AlertCircle, Car, Check, ChevronLeft, ChevronRight,
  Eye, EyeOff, Globe, Home, Lock, Plane, Utensils, X,
} from "lucide-react";

// ─── Brand (matching form page) ──────────────────────────────────────────────

const BD = "#342A21";

function AccessLogo() {
  return (
    <Image src="/logo-forms.svg" alt="Filma" width={110} height={36} priority
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const DAY_FULL  = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const DAY_SHORT = ["L","M","X","J","V","S","D"];

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const dow = (y: number, m: number, d: number) => { const x = new Date(y,m,d).getDay(); return x===0?6:x-1; };
const isWknd = (y: number, m: number, d: number) => { const w = dow(y,m,d); return w===5||w===6; };
const dk = (d: number) => String(d).padStart(2,"0");
const padM = (m: number) => String(m+1).padStart(2,"0");

// ─── Types ────────────────────────────────────────────────────────────────────

type AKey = "meals"|"halfPerDiem"|"perDiem"|"halfIntlPerDiem"|"intlPerDiem"|"accommodation"|"car";

interface ADef {
  key: AKey;
  label: string;
  dot: string;
  Icon: React.FC<{ size?: number; style?: React.CSSProperties; className?: string }>;
}

const ALL_ALLOWANCES: ADef[] = [
  { key:"meals",           label:"Comidas",              dot:"#f97316", Icon:Utensils },
  { key:"halfPerDiem",     label:"½ Dieta nacional",     dot:"#7dd3fc", Icon:Plane    },
  { key:"perDiem",         label:"Dieta nacional",       dot:"#0ea5e9", Icon:Plane    },
  { key:"halfIntlPerDiem", label:"½ Dieta internacional",dot:"#a5b4fc", Icon:Globe    },
  { key:"intlPerDiem",     label:"Dieta internacional",  dot:"#6366f1", Icon:Globe    },
  { key:"accommodation",   label:"Alojamiento",          dot:"#a855f7", Icon:Home     },
  { key:"car",             label:"Vehículo",             dot:"#10b981", Icon:Car      },
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
  active: boolean;
}

type MonthEntries = Record<string, Record<string, Record<string, boolean>>>;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AccessPage() {
  const params = useParams();
  const code   = params.code as string;

  // Auth / load state
  const [access,    setAccess]    = useState<AccessDoc | null>(null);
  const [status,    setStatus]    = useState<"loading"|"notfound"|"pin"|"ready">("loading");
  const [pinDigits, setPinDigits] = useState(["","","","",""]);
  const [pinError,  setPinError]  = useState("");
  const [showPin,   setShowPin]   = useState(false);
  const pinRefs = [
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Grid month
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  // Grid entries (current grid month)
  const [entries, setEntries] = useState<MonthEntries>({});

  // Sheet (per-person month view)
  const [sheetId,      setSheetId]      = useState<string|null>(null);
  const [sheetYear,    setSheetYear]    = useState(now.getFullYear());
  const [sheetMonth,   setSheetMonth]   = useState(now.getMonth());
  const [sheetEntries, setSheetEntries] = useState<MonthEntries>({});
  const [sheetLoading, setSheetLoading] = useState(false);
  const [expandedDay,  setExpandedDay]  = useState<number|null>(null);
  const [saving,       setSaving]       = useState(false);
  const [savedFlash,   setSavedFlash]   = useState(false);

  const monthKey      = `${year}-${padM(month)}`;
  const sheetMonthKey = `${sheetYear}-${padM(sheetMonth)}`;
  const numDays       = daysInMonth(year, month);
  const days          = Array.from({length: numDays}, (_,i) => i+1);
  const sheetDays     = daysInMonth(sheetYear, sheetMonth);

  // ── Load access doc ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "access", code));
        if (!snap.exists() || !snap.data().active) { setStatus("notfound"); return; }
        const data = snap.data() as AccessDoc;
        setAccess(data);
        const pinLen = data.pin ? data.pin.length : 4;
        setPinDigits(Array(Math.max(4, pinLen)).fill("").slice(0, pinLen <= 4 ? 4 : pinLen));
        setStatus(data.pin ? "pin" : "ready");
      } catch { setStatus("notfound"); }
    })();
  }, [code]);

  // ── Load grid month entries ────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready" || !access) return;
    (async () => {
      const snap = await getDoc(doc(db, `projects/${access.projectId}/payrollMonths`, monthKey));
      setEntries(snap.exists() ? (snap.data().entries || {}) : {});
    })();
  }, [status, access, monthKey]);

  // ── Load sheet entries when sheet month changes ────────────────────────────
  useEffect(() => {
    if (!sheetId || !access) return;
    (async () => {
      setSheetLoading(true);
      const snap = await getDoc(doc(db, `projects/${access.projectId}/payrollMonths`, sheetMonthKey));
      setSheetEntries(snap.exists() ? (snap.data().entries || {}) : {});
      setExpandedDay(null);
      setSheetLoading(false);
    })();
  }, [sheetId, access, sheetMonthKey]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getEntry  = (mId: string, d: number, ent: MonthEntries = entries) =>
    ent[mId]?.[dk(d)] || {} as Record<string, boolean>;

const allowances = access
    ? ALL_ALLOWANCES.filter(a => access.allowedTypes.includes(a.key))
    : ALL_ALLOWANCES;

  const color = access?.color || "#6BA319";

  // ── PIN handling ──────────────────────────────────────────────────────────
  const pinLen = access?.pin?.length || 4;

  const handlePinChange = (i: number, v: string) => {
    const digit = v.replace(/\D/g,"").slice(-1);
    const next = [...pinDigits]; next[i] = digit; setPinDigits(next); setPinError("");
    if (digit && i < pinLen - 1) pinRefs[i+1].current?.focus();
    if (digit && i === pinLen - 1) {
      // Auto-verify when last digit filled
      const entered = [...next].join("");
      if (entered === access?.pin) { setStatus("ready"); }
      else { setPinError("Código incorrecto"); setPinDigits(Array(pinLen).fill("")); pinRefs[0].current?.focus(); }
    }
  };

  const handlePinKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pinDigits[i] && i > 0) pinRefs[i-1].current?.focus();
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g,"").slice(0, pinLen);
    if (text.length === pinLen) { setPinDigits(text.split("")); pinRefs[pinLen-1].current?.focus(); }
  };

  const verifyPin = () => {
    if (pinDigits.join("") === access?.pin) setStatus("ready");
    else { setPinError("Código incorrecto"); setPinDigits(Array(pinLen).fill("")); pinRefs[0].current?.focus(); }
  };

  // ── Toggle complement ─────────────────────────────────────────────────────
  const toggleComplement = async (memberId: string, d: number, key: AKey) => {
    if (!access) return;
    setSaving(true);
    try {
      const monthRef  = doc(db, `projects/${access.projectId}/payrollMonths`, sheetMonthKey);
      const current   = await getDoc(monthRef);
      const cData     = current.exists() ? current.data() : {};
      const cEntries  = (cData.entries || {}) as MonthEntries;
      const cDay      = cEntries[memberId]?.[dk(d)] || {};
      const newVal    = !cDay[key];
      const newEntries: MonthEntries = {
        ...cEntries,
        [memberId]: {
          ...(cEntries[memberId]||{}),
          [dk(d)]: { ...cDay, [key]: newVal },
        },
      };
      await setDoc(monthRef, {
        ...cData,
        entries: newEntries,
        accessCode: code,
        updatedAt: Timestamp.now(),
      });
      setSheetEntries(newEntries);
      // Also update grid entries if same month
      if (sheetMonthKey === monthKey) setEntries(newEntries);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } finally { setSaving(false); }
  };

  // ── Sheet navigation ──────────────────────────────────────────────────────
  const openSheet = (memberId: string) => {
    setSheetId(memberId);
    setSheetYear(year);
    setSheetMonth(month);
    setExpandedDay(null);
  };

  const sheetPrevM = () => {
    if (sheetMonth === 0) { setSheetYear(y=>y-1); setSheetMonth(11); }
    else setSheetMonth(m=>m-1);
  };
  const sheetNextM = () => {
    if (sheetMonth===11) { setSheetYear(y=>y+1); setSheetMonth(0); }
    else setSheetMonth(m=>m+1);
  };

  // Grid month navigation
  const prevM = () => { if (month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1); };
  const nextM = () => { if (month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1); };

  const sheetPerson = access?.people.find(p => p.memberId === sheetId);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === "loading") return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor:"#FAF8F5" }}>
      <div className="w-8 h-8 border-3 border-stone-200 border-t-stone-500 rounded-full animate-spin" style={{ borderWidth:3 }} />
    </div>
  );

  if (status === "notfound") return (
    <div className={`min-h-screen flex flex-col items-center justify-center px-6 py-12 ${inter.className}`}
      style={{ backgroundColor:"#FAF8F5" }}>
      <div className="mb-10"><AccessLogo /></div>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-stone-100 p-8 text-center">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor:"rgba(52,42,33,0.07)" }}>
          <AlertCircle size={18} style={{ color:BD }} />
        </div>
        <h1 className="text-base font-bold mb-1" style={{ color:BD }}>Acceso no disponible</h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          Este enlace no existe o ha sido desactivado por el equipo de producción.
        </p>
      </div>
    </div>
  );

  // ── PIN screen ─────────────────────────────────────────────────────────────
  if (status === "pin") return (
    <div className={`min-h-screen flex flex-col ${inter.className}`} style={{ backgroundColor:"#FAF8F5" }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="mb-10 text-center"><AccessLogo /></div>
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
          <div className="text-center mb-8">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor:"rgba(52,42,33,0.07)" }}>
              <Lock size={18} style={{ color:BD }} />
            </div>
            <h1 className="text-lg font-bold mb-1" style={{ color:BD }}>Código de acceso</h1>
            <p className="text-sm text-stone-500">
              {access?.name && <><strong className="text-stone-700">{access.name}</strong> · </>}
              Introduce el código de {pinLen} dígitos
            </p>
          </div>

          {/* PIN boxes */}
          <div className="flex gap-3 justify-center mb-5">
            {pinDigits.map((d, i) => (
              <input key={i} ref={pinRefs[i]}
                type={showPin ? "text" : "password"}
                inputMode="numeric" maxLength={1} value={d}
                onChange={e => handlePinChange(i, e.target.value)}
                onKeyDown={e => handlePinKeyDown(i, e)}
                onPaste={i===0 ? handlePinPaste : undefined}
                className="w-14 h-16 text-center text-2xl font-bold border-2 rounded-xl focus:outline-none transition-all"
                style={{
                  borderColor: pinError ? "#fca5a5" : d ? BD : "#e7e5e4",
                  backgroundColor: pinError ? "#fff1f2" : d ? "rgba(52,42,33,0.04)" : "#fff",
                  color: pinError ? "#dc2626" : BD,
                }}
              />
            ))}
          </div>

          <div className="flex justify-center mb-4">
            <button type="button" onClick={() => setShowPin(v=>!v)}
              className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors">
              {showPin ? <EyeOff size={12}/> : <Eye size={12}/>}
              {showPin ? "Ocultar" : "Mostrar"} código
            </button>
          </div>

          {pinError && (
            <p className="text-sm text-red-500 text-center mb-4 flex items-center justify-center gap-1.5">
              <AlertCircle size={13}/> {pinError}
            </p>
          )}

          <button onClick={verifyPin} disabled={pinDigits.join("").length < pinLen}
            className="w-full py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: BD }}>
            Acceder
          </button>
        </div>
        <p className="text-xs text-stone-400 mt-8 text-center max-w-xs">
          Este acceso es personal. No compartas este enlace.
        </p>
      </div>
    </div>
  );

  // ── Main view ──────────────────────────────────────────────────────────────
  const todayD = now.getDate();
  const isToday = (y: number, m: number, d: number) =>
    d === todayD && m === now.getMonth() && y === now.getFullYear();

  return (
    <div className={`min-h-screen ${inter.className}`} style={{ backgroundColor:"#FAF8F5" }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-stone-100 shadow-sm">
        <div className="px-4 py-3 flex items-center gap-3 max-w-screen-2xl mx-auto">
          <div className="flex-shrink-0"><AccessLogo /></div>
          <div className="w-px h-5 bg-stone-200 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest leading-none truncate">
              {access?.projectName}
            </p>
            <p className="text-sm font-bold leading-tight mt-0.5 truncate" style={{ color:BD }}>
              {access?.name}
            </p>
          </div>
          <div className="flex-1" />

          {/* Save indicator */}
          <div className={`flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${savedFlash?"opacity-100":"opacity-0"}`}
            style={{ color }}>
            <Check size={12} strokeWidth={2.5}/><span>Guardado</span>
          </div>
          {saving && <div className="w-4 h-4 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin"/>}

          {/* Month nav */}
          <div className="flex items-center gap-0.5">
            <button onClick={prevM} className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors text-stone-400">
              <ChevronLeft size={16}/>
            </button>
            <span className="text-sm font-semibold min-w-[118px] text-center" style={{ color:BD }}>
              {MONTH_NAMES[month]} {year}
            </span>
            <button onClick={nextM} className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors text-stone-400">
              <ChevronRight size={16}/>
            </button>
          </div>
        </div>
        <div className="h-0.5" style={{ backgroundColor:color }} />
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="border-collapse w-full" style={{ minWidth:`${220 + numDays * 42}px` }}>
          <thead>
            <tr className="bg-white border-b border-stone-200">
              <th className="sticky left-0 z-10 bg-white border-r border-stone-100 px-4 py-3 text-left" style={{ minWidth:200 }}>
                <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Persona</span>
              </th>
              {days.map(d => {
                const wknd   = isWknd(year, month, d);
                const newW   = dow(year,month,d)===0 && d>1;
                const tod    = isToday(year, month, d);
                return (
                  <th key={d} className={`w-[42px] min-w-[42px] text-center py-2.5 ${newW?"border-l border-stone-200":""} ${wknd?"bg-stone-50":""}`}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-medium text-stone-400">{DAY_SHORT[dow(year,month,d)]}</span>
                      <span className="text-xs font-bold leading-none w-6 h-6 flex items-center justify-center rounded-full"
                        style={tod ? { backgroundColor:color, color:"#fff" } : { color:BD }}>
                        {d}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(access?.people||[]).length === 0 ? (
              <tr><td colSpan={numDays+1} className="py-16 text-center text-sm text-stone-400">
                No hay personas asignadas a este acceso
              </td></tr>
            ) : (access?.people||[]).map((person, idx) => (
              <tr key={person.memberId} className={`border-b border-stone-100 ${idx%2===0?"bg-white":"bg-stone-50/40"}`}>
                {/* Name cell → opens sheet */}
                <td className={`sticky left-0 z-10 border-r border-stone-100 px-3 py-2.5 cursor-pointer hover:bg-stone-100 transition-colors ${idx%2===0?"bg-white":"bg-stone-50/40"}`}
                  onClick={() => openSheet(person.memberId)}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
                      style={{ backgroundColor: color+"cc" }}>
                      {(person.firstName[0]||"").toUpperCase()}{(person.lastName1[0]||"").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate leading-tight" style={{ color:BD }}>
                        {person.firstName} {person.lastName1}
                      </p>
                      {person.department && (
                        <p className="text-[10px] text-stone-400 truncate leading-tight">{person.department}</p>
                      )}
                    </div>
                    <ChevronRight size={13} className="text-stone-300 flex-shrink-0 ml-auto"/>
                  </div>
                </td>

                {/* Day cells (read-only indicators) */}
                {days.map(d => {
                  const wknd   = isWknd(year,month,d);
                  const newW   = dow(year,month,d)===0 && d>1;
                  const entry  = getEntry(person.memberId, d);
                  const dots   = allowances.filter(a => entry[a.key]);
                  return (
                    <td key={d}
                      onClick={() => { openSheet(person.memberId); setExpandedDay(d); }}
                      className={`w-[42px] min-w-[42px] text-center align-middle cursor-pointer transition-colors
                        ${newW?"border-l border-stone-200":""}
                        ${wknd?"bg-stone-50 hover:bg-stone-100":"hover:bg-stone-50"}`}>
                      <div className="flex flex-wrap justify-center gap-[3px] py-3 px-1">
                        {dots.length>0 ? dots.map(a=>(
                          <div key={a.key} className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor:a.dot }}/>
                        )) : <div className="w-2 h-2"/>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="px-4 py-4 flex flex-wrap gap-x-4 gap-y-2 max-w-screen-2xl mx-auto">
        {allowances.map(a => (
          <div key={a.key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor:a.dot }}/>
            <span className="text-xs text-stone-500">{a.label}</span>
          </div>
        ))}
      </div>

      {/* ── Person sheet ─────────────────────────────────────────────────── */}
      {sheetId && (
        <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm" onClick={() => setSheetId(null)}/>
      )}
      <div className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out ${sheetId?"translate-y-0":"translate-y-full"}`}>
        <div className="bg-white rounded-t-3xl shadow-2xl max-w-lg mx-auto flex flex-col"
          style={{ maxHeight:"88vh" }}>

          {/* Sheet header */}
          <div className="flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-stone-200 rounded-full"/>
            </div>

            {/* Person info + close */}
            <div className="px-5 pt-2 pb-3 flex items-center justify-between border-b border-stone-100">
              <div className="flex items-center gap-3">
                {sheetPerson && (
                  <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor:color+"cc" }}>
                    {sheetPerson.firstName[0]}{sheetPerson.lastName1[0]}
                  </div>
                )}
                <div>
                  <p className="text-base font-bold" style={{ color:BD }}>
                    {sheetPerson?.firstName} {sheetPerson?.lastName1}
                  </p>
                  {sheetPerson?.department && (
                    <p className="text-xs text-stone-400">{sheetPerson.department}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setSheetId(null)}
                className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition-colors">
                <X size={18}/>
              </button>
            </div>

            {/* Month navigation inside sheet */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-stone-50">
              <button onClick={sheetPrevM} className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors text-stone-400">
                <ChevronLeft size={16}/>
              </button>
              <span className="text-sm font-bold" style={{ color:BD }}>
                {MONTH_NAMES[sheetMonth]} {sheetYear}
              </span>
              <button onClick={sheetNextM} className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors text-stone-400">
                <ChevronRight size={16}/>
              </button>
            </div>
          </div>

          {/* Days list */}
          <div className="overflow-y-auto flex-1 px-4 py-2">
            {sheetLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin"/>
              </div>
            ) : (
              Array.from({length:sheetDays}, (_,i) => i+1).map(d => {
                const wknd   = isWknd(sheetYear, sheetMonth, d);
                const tod    = isToday(sheetYear, sheetMonth, d);
                const entry  = sheetId ? getEntry(sheetId, d, sheetEntries) : {};
                const active = allowances.filter(a => entry[a.key]);
                const isExp  = expandedDay === d;

                return (
                  <div key={d} className="mb-1">
                    {/* Day row */}
                    <button
                      onClick={() => setExpandedDay(isExp ? null : d)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left hover:bg-stone-50 cursor-pointer
                        ${isExp?"bg-stone-50":""}`}>

                      {/* Day number */}
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex flex-col items-center justify-center"
                        style={ tod
                          ? { backgroundColor:color, color:"#fff" }
                          : { backgroundColor:wknd?"#f5f5f4":"#fafaf9", color:BD }
                        }>
                        <span className="text-[9px] font-medium leading-none" style={{ color: tod?"rgba(255,255,255,0.8)": "inherit", opacity: tod?1:0.6 }}>
                          {DAY_SHORT[dow(sheetYear,sheetMonth,d)]}
                        </span>
                        <span className="text-sm font-bold leading-none">{d}</span>
                      </div>

                      {/* Date label */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-700">
                          {DAY_FULL[dow(sheetYear,sheetMonth,d)]} {d}
                        </p>
                      </div>

                      {/* Active dots */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {active.length > 0 ? (
                          active.map(a => (
                            <div key={a.key} className="w-2 h-2 rounded-full" style={{ backgroundColor:a.dot }}/>
                          ))
                        ) : (
                          <span className="text-xs text-stone-300">—</span>
                        )}
                      </div>

                      <ChevronRight size={14} className={`text-stone-300 flex-shrink-0 transition-transform ${isExp?"rotate-90":""}`}/>
                    </button>

                    {/* Expanded complement toggles */}
                    {isExp && sheetId && (
                      <div className="mx-1 mb-2 rounded-xl border border-stone-100 bg-white overflow-hidden">
                        {allowances.map(a => {
                          const Icon  = a.Icon;
                          const on    = !!entry[a.key];
                          return (
                            <button key={a.key}
                              onClick={() => sheetId && toggleComplement(sheetId, d, a.key)}
                              disabled={saving}
                              className={`w-full flex items-center gap-3 px-4 py-3 border-b border-stone-50 last:border-0 transition-colors
                                ${on?"bg-opacity-5":"hover:bg-stone-50"}`}
                              style={on ? { backgroundColor:a.dot+"12" } : {}}>
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor:on?a.dot+"25":"#f5f5f4" }}>
                                <Icon size={15} style={{ color:on?a.dot:"#a8a29e" }}/>
                              </div>
                              <span className={`text-sm font-medium flex-1 text-left ${on?"text-stone-900":"text-stone-400"}`}>
                                {a.label}
                              </span>
                              <div className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${!on?"bg-stone-200":""}`}
                                style={on?{backgroundColor:a.dot}:{}}>
                                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${on?"left-0.5 translate-x-5":"left-0.5"}`}/>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Sheet footer */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-stone-100 flex items-center justify-between bg-white rounded-b-3xl">
            <div className={`flex items-center gap-1.5 text-xs font-medium transition-all ${savedFlash?"opacity-100":"opacity-0"}`}
              style={{ color }}>
              <Check size={12} strokeWidth={2.5}/> Guardado
            </div>
            {saving && <div className="w-4 h-4 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin"/>}
            <button onClick={() => setSheetId(null)}
              className="text-sm font-semibold px-4 py-2 rounded-xl transition-colors hover:bg-stone-100"
              style={{ color:BD }}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
