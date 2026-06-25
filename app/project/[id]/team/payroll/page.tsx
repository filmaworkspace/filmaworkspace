"use client";

import { useState, useEffect, useMemo, Fragment, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc,
  Timestamp, query, orderBy, where,
} from "firebase/firestore";
import {
  Banknote, CalendarRange, Car, ChevronLeft, ChevronRight, Copy, Download, Globe,
  Home, Lock, Plane, Plus, Printer, Send, TrendingUp, Unlock, Utensils,
  Users, X, Check, ChevronDown, AlertTriangle, Calendar, Link as LinkIcon, Zap,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAM_COLOR = "#6BA319";

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const DAY_SHORT = ["L","M","X","J","V","S","D"];

const SECTION_LABELS: Record<string, string> = {
  technical: "Equipo técnico", cast: "Cast", specialists: "Especialistas",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  firstName: string; lastName1: string; lastName2?: string;
  role: string; department: string; section: string; status: string;
  salaryType?: string; salaryAmount?: number; grossSalary?: number;
  salaryPerSession?: number; irpfRate?: number;
  regime?: string; ssRegime?: string;
  startDate?: string; endDateApprox?: string;
}

interface DayEntry {
  meals: boolean; halfPerDiem: boolean; perDiem: boolean;
  halfIntlPerDiem: boolean; intlPerDiem: boolean;
  accommodation: boolean; car: boolean; other: boolean;
  otherAmount: number; otherLabel: string;
  mealRateOverride?: number; halfPerDiemRateOverride?: number;
  perDiemRateOverride?: number; halfIntlPerDiemRateOverride?: number;
  intlPerDiemRateOverride?: number; accommodationRateOverride?: number;
  carRateOverride?: number;
  workedOverride?: boolean; // explicit override of the inRange default
}

const EMPTY_DAY: DayEntry = {
  meals: false, halfPerDiem: false, perDiem: false,
  halfIntlPerDiem: false, intlPerDiem: false,
  accommodation: false, car: false, other: false,
  otherAmount: 0, otherLabel: "",
};

type MonthData = Record<string, Record<string, DayEntry>>;
// salaryOverrides: per-member override of the base rate (monthly or weekly amount) for this month
type SalaryOverrides = Record<string, number>;

interface PayrollConfig {
  mealRate: number;
  halfPerDiemRate: number;     halfPerDiemRateArtistic: number;
  perDiemRate: number;         perDiemRateArtistic: number;
  halfIntlPerDiemRate: number; halfIntlPerDiemRateArtistic: number;
  intlPerDiemRate: number;     intlPerDiemRateArtistic: number;
  accommodationRate: number; carRate: number;
}

const DEFAULT_CONFIG: PayrollConfig = {
  mealRate: 15,
  halfPerDiemRate: 18.5,    halfPerDiemRateArtistic: 18.5,
  perDiemRate: 37,           perDiemRateArtistic: 37,
  halfIntlPerDiemRate: 47.5, halfIntlPerDiemRateArtistic: 47.5,
  intlPerDiemRate: 95,       intlPerDiemRateArtistic: 95,
  accommodationRate: 80, carRate: 40,
};

interface AllowanceDef {
  key:              keyof Pick<DayEntry,"meals"|"halfPerDiem"|"perDiem"|"halfIntlPerDiem"|"intlPerDiem"|"accommodation"|"car">;
  overrideKey:      keyof Pick<DayEntry,"mealRateOverride"|"halfPerDiemRateOverride"|"perDiemRateOverride"|"halfIntlPerDiemRateOverride"|"intlPerDiemRateOverride"|"accommodationRateOverride"|"carRateOverride">;
  rateKey:          keyof PayrollConfig;
  artisticRateKey?: keyof PayrollConfig;
  label:            string;
  dot:              string;
  Icon:             React.FC<{ size?: number; style?: React.CSSProperties; className?: string }>;
}

const ALLOWANCES: AllowanceDef[] = [
  { key:"meals",           overrideKey:"mealRateOverride",            rateKey:"mealRate",            label:"Comidas",              dot:"#f97316", Icon:Utensils },
  { key:"halfPerDiem",     overrideKey:"halfPerDiemRateOverride",     rateKey:"halfPerDiemRate",     artisticRateKey:"halfPerDiemRateArtistic",     label:"Media dieta nac.",     dot:"#7dd3fc", Icon:Plane    },
  { key:"perDiem",         overrideKey:"perDiemRateOverride",         rateKey:"perDiemRate",         artisticRateKey:"perDiemRateArtistic",         label:"Dieta nacional",       dot:"#0ea5e9", Icon:Plane    },
  { key:"halfIntlPerDiem", overrideKey:"halfIntlPerDiemRateOverride", rateKey:"halfIntlPerDiemRate", artisticRateKey:"halfIntlPerDiemRateArtistic", label:"Media dieta inter.",   dot:"#a5b4fc", Icon:Globe    },
  { key:"intlPerDiem",     overrideKey:"intlPerDiemRateOverride",     rateKey:"intlPerDiemRate",     artisticRateKey:"intlPerDiemRateArtistic",     label:"Dieta inter.",         dot:"#6366f1", Icon:Globe    },
  { key:"accommodation",   overrideKey:"accommodationRateOverride",   rateKey:"accommodationRate",   label:"Alojamiento",          dot:"#a855f7", Icon:Home     },
  { key:"car",             overrideKey:"carRateOverride",             rateKey:"carRate",             label:"Vehículo",             dot:"#10b981", Icon:Car      },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const dow = (y: number, m: number, d: number) => { const x = new Date(y, m, d).getDay(); return x === 0 ? 6 : x - 1; };
const isWknd = (y: number, m: number, d: number) => { const w = dow(y, m, d); return w === 5 || w === 6; };
const dk = (d: number) => String(d).padStart(2, "0");
const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";

function inRange(m: CrewMember, y: number, mo: number, d: number): boolean {
  if (!m.startDate && !m.endDateApprox) return false;
  const date = new Date(y, mo, d);
  if (m.startDate && date < new Date(m.startDate)) return false;
  if (m.endDateApprox && date > new Date(m.endDateApprox)) return false;
  return true;
}

function baseDailySalary(m: CrewMember): number {
  if ((m.salaryType === "monthly") && m.grossSalary) return m.grossSalary / 30;
  if ((m.salaryType === "weekly")  && m.salaryAmount) return m.salaryAmount / 5;
  if (m.salaryPerSession) return m.salaryPerSession;
  return 0;
}

function regimeBadge(r?: string): { label: string; color: string } {
  if (!r) return { label: "—", color: "text-slate-400" };
  const low = r.toLowerCase();
  if (low.includes("artista"))  return { label: "R.Art",  color: "text-violet-600" };
  if (low.includes("autónomo") || low.includes("reta")) return { label: "RETA", color: "text-amber-600" };
  if (low.includes("extranjero")) return { label: "Extr.", color: "text-rose-500" };
  return { label: "R.Gral", color: "text-blue-600" };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { id } = useParams();
  const router  = useRouter();
  const projectId = id as string;
  const { user, isLoading: userLoading } = useUser();

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [crew,          setCrew]          = useState<CrewMember[]>([]);
  const [monthData,     setMonthData]     = useState<MonthData>({});
  const [salaryOverrides, setSalaryOverrides] = useState<SalaryOverrides>({});
  const [cfg,           setCfg]           = useState<PayrollConfig>(DEFAULT_CONFIG);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [viewMode,      setViewMode]      = useState<"grid"|"summary">("grid");
  const [filterSection, setFilterSection] = useState("all");
  const [showExport,    setShowExport]    = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<{ memberId: string; day: number } | null>(null);
  const [editData,   setEditData]   = useState<DayEntry>(EMPTY_DAY);
  const [editingOverride, setEditingOverride] = useState<string | null>(null);

  // Solicitar dietas modal
  const [showSolicitar, setShowSolicitar]     = useState(false);
  const [solStep,       setSolStep]           = useState(1);
  const [solDateFrom,   setSolDateFrom]       = useState("");
  const [solDateTo,     setSolDateTo]         = useState("");
  const [solTypes,      setSolTypes]          = useState<Record<string,boolean>>({
    meals: true, halfPerDiem: false, perDiem: true, halfIntlPerDiem: false,
    intlPerDiem: false, accommodation: false, car: false,
  });
  const [solPeople,     setSolPeople]         = useState<Set<string>>(new Set());
  const [solMode,       setSolMode]           = useState<"individual"|"group">("individual");
  const [generatedForms,setGeneratedForms]    = useState<Array<{id:string;url:string;pin:string;names:string[]}>>([]);
  const [generating,    setGenerating]        = useState(false);
  const [copiedKey,     setCopiedKey]         = useState<string|null>(null);
  const [projectName,   setProjectName]       = useState("");

  // Period config (per allowance type)
  const [periods,       setPeriods]           = useState<Record<string,{from:string;to:string}>>({});
  const [showPeriodCfg, setShowPeriodCfg]     = useState(false);
  const [periodsDraft,  setPeriodsDraft]      = useState<Record<string,{from:string;to:string}>>({});

  // Range fill
  const [rfTarget,      setRfTarget]          = useState<string|null>(null);
  const [rfDay1,        setRfDay1]            = useState(1);
  const [rfDay2,        setRfDay2]            = useState(1);
  const [rfMode,        setRfMode]            = useState<"mark"|"clear">("mark");
  const [rfTypes,       setRfTypes]           = useState<Record<string,boolean>>({});
  const [rfWorked,      setRfWorked]          = useState(false);

  // Person detail modal
  const [detailId,      setDetailId]          = useState<string|null>(null);
  const [editingSalary, setEditingSalary]      = useState(false);
  const [salaryDraft,   setSalaryDraft]        = useState("");
  const [notes,         setNotes]             = useState<Record<string,string>>({});
  const [noteDraft,     setNoteDraft]         = useState<string|null>(null);

  // Department order
  const [deptOrder,     setDeptOrder]         = useState<string[]>([]);

  // Pending dietas imports
  const [pendingForms,  setPendingForms]      = useState<Array<{
    formId:string; dateFrom:string; dateTo:string; peopleNames:string[]; status:string;
  }>>([]);
  const [importingId,   setImportingId]       = useState<string|null>(null);

  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const numDays  = daysInMonth(year, month);
  const days     = Array.from({ length: numDays }, (_, i) => i + 1);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadMonth = useCallback(async () => {
    const snap = await getDoc(doc(db, `projects/${projectId}/payrollMonths`, monthKey));
    if (snap.exists()) {
      setMonthData(snap.data().entries || {});
      setPeriods(snap.data().periods || {});
      setSalaryOverrides(snap.data().salaryOverrides || {});
      setNotes(snap.data().notes || {});
    } else {
      setMonthData({});
      setPeriods({});
      setSalaryOverrides({});
      setNotes({});
    }
  }, [projectId, monthKey]);

  const loadBase = useCallback(async () => {
    const [crewSnap, cfgSnap, projSnap, pendingSnap, orderSnap] = await Promise.all([
      getDocs(query(collection(db, `projects/${projectId}/crew`), orderBy("createdAt"))),
      getDoc(doc(db, `projects/${projectId}/teamConfig`, "payrollConfig")),
      getDoc(doc(db, "projects", projectId)),
      getDocs(query(collection(db, `projects/${projectId}/dietasForms`), where("status", "!=", "imported"))),
      getDoc(doc(db, `projects/${projectId}/teamConfig`, "departmentOrder")),
    ]);
    setCrew(
      crewSnap.docs
        .filter(d => (d.data().status || "active") !== "inactive")
        .map(d => ({
          id: d.id, firstName: d.data().firstName || "", lastName1: d.data().lastName1 || "",
          lastName2: d.data().lastName2 || "", role: d.data().role || "",
          department: (d.data().department || "").trim(), section: d.data().section || "technical",
          status: d.data().status || "active", salaryType: d.data().salaryType,
          salaryAmount: d.data().salaryAmount, grossSalary: d.data().grossSalary,
          salaryPerSession: d.data().salaryPerSession, irpfRate: d.data().irpfRate,
          regime: d.data().regime || d.data().ssRegime || "",
          startDate: d.data().startDate || "", endDateApprox: d.data().endDateApprox || "",
        }))
    );
    if (cfgSnap.exists()) setCfg({ ...DEFAULT_CONFIG, ...cfgSnap.data() });
    if (projSnap.exists()) setProjectName(projSnap.data().name || "");
    if (orderSnap.exists()) setDeptOrder(orderSnap.data().order || []);
    setPendingForms(pendingSnap.docs.map(d => ({
      formId: d.data().formId || d.id,
      dateFrom: d.data().dateFrom || "",
      dateTo: d.data().dateTo || "",
      peopleNames: d.data().peopleNames || [],
      status: d.data().status || "pending",
    })));
    await loadMonth();
  }, [projectId, loadMonth]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/"); return; }
      await loadBase();
      setLoading(false);
    });
    return () => unsub();
  }, [projectId, router, loadBase]);

  useEffect(() => { if (!loading) loadMonth(); }, [monthKey, loading, loadMonth]);

  const saveData = async (data: MonthData, overrides?: SalaryOverrides, notesMap?: Record<string,string>) => {
    setSaving(true);
    try {
      await setDoc(doc(db, `projects/${projectId}/payrollMonths`, monthKey), {
        entries: data,
        periods,
        salaryOverrides: overrides ?? salaryOverrides,
        notes: notesMap ?? notes,
        updatedAt: Timestamp.now(), updatedBy: user?.uid || "",
      });
    } finally { setSaving(false); }
  };

  const saveNote = async (memberId: string, text: string) => {
    const next = { ...notes };
    if (text.trim()) next[memberId] = text.trim(); else delete next[memberId];
    setNotes(next);
    await saveData(monthData, undefined, next);
  };

  const saveSalaryOverride = async (memberId: string, value: number | null) => {
    const next = { ...salaryOverrides };
    if (value === null) delete next[memberId]; else next[memberId] = value;
    setSalaryOverrides(next);
    await saveData(monthData, next);
  };

  // ── Data helpers ────────────────────────────────────────────────────────────

  // Override base rate with month-specific value if set
  const dailySalary = (m: CrewMember): number => {
    const ov = salaryOverrides[m.id];
    if (ov !== undefined) {
      if (m.salaryType === "monthly") return ov / 30;
      if (m.salaryType === "weekly")  return ov / 5;
      return ov; // session
    }
    return baseDailySalary(m);
  };

  const getEntry = (mId: string, d: number): DayEntry =>
    monthData[mId]?.[dk(d)] || EMPTY_DAY;

  const updateEntry = (mId: string, d: number, entry: DayEntry) => {
    const next = { ...monthData, [mId]: { ...monthData[mId], [dk(d)]: entry } };
    setMonthData(next);
    saveData(next);
  };

  const getRate = (entry: DayEntry, a: AllowanceDef, member?: CrewMember): number => {
    const override = entry[a.overrideKey] as number | undefined;
    if (override !== undefined) return override;
    const isArtistic = member?.section === "cast";
    if (isArtistic && a.artisticRateKey) return cfg[a.artisticRateKey];
    return cfg[a.rateKey];
  };

  const cellTotal = (mId: string, d: number): number => {
    const e = getEntry(mId, d);
    const member = crew.find(m => m.id === mId);
    return ALLOWANCES.reduce((s, a) => s + (e[a.key] ? getRate(e, a, member) : 0), 0)
      + (e.other ? (e.otherAmount || 0) : 0);
  };

  const memberMonthAllowances = (mId: string) =>
    days.reduce((s, d) => s + cellTotal(mId, d), 0);

  const isWorked = (m: CrewMember, d: number): boolean => {
    const entry = getEntry(m.id, d);
    if (entry.workedOverride !== undefined) return entry.workedOverride;
    return inRange(m, year, month, d);
  };

  const toggleWorked = (m: CrewMember, d: number) => {
    const current = isWorked(m, d);
    const entry = getEntry(m.id, d);
    updateEntry(m.id, d, { ...entry, workedOverride: !current });
  };

  // For weekly salary: only weekdays (Mon–Fri) count toward pay
  const salaryDays = (m: CrewMember): number => {
    if (m.salaryType === "weekly") {
      return days.filter(d => isWorked(m, d) && !isWknd(year, month, d)).length;
    }
    return days.filter(d => isWorked(m, d)).length;
  };

  const workingDays = (mId: string) => {
    const m = crew.find(x => x.id === mId);
    if (!m) return 0;
    return salaryDays(m);
  };

  // Salary total for the month with the correct formula per type:
  //   monthly  → salario − díasNoTrabajados × (salario/30)   [always full if no absences]
  //   weekly   → (salario/5) × díasLaborablesWorked
  //   session  → tarifaSesión × sesionesWorked
  const memberSalaryTotal = (m: CrewMember): number => {
    const ds = dailySalary(m);
    if (m.salaryType === "monthly") {
      const monthly   = salaryOverrides[m.id] ?? m.grossSalary ?? 0;
      const notWorked = days.filter(d => !isWorked(m, d)).length;
      return monthly - notWorked * (monthly / 30);
    }
    return ds * salaryDays(m);
  };

  const dots = (mId: string, d: number): string[] => {
    const e = getEntry(mId, d);
    return [
      ...ALLOWANCES.filter(a => e[a.key]).map(a => a.dot),
      ...(e.other ? ["#64748b"] : []),
    ];
  };

  // ── Filtered & grouped crew ─────────────────────────────────────────────────

  const filtered = useMemo(() =>
    crew.filter(m => filterSection === "all" || m.section === filterSection),
    [crew, filterSection]
  );

  const byDept = useMemo(() => {
    const g: Record<string, CrewMember[]> = {};
    for (const m of filtered) {
      const k = m.department || SECTION_LABELS[m.section] || "Sin departamento";
      (g[k] ||= []).push(m);
    }
    if (deptOrder.length === 0) return g;
    const ordered: Record<string, CrewMember[]> = {};
    for (const d of deptOrder) if (g[d]) ordered[d] = g[d];
    for (const d of Object.keys(g)) if (!ordered[d]) ordered[d] = g[d];
    return ordered;
  }, [filtered, deptOrder]);

  const grandTotal = filtered.reduce((s, m) => s + memberMonthAllowances(m.id) + memberSalaryTotal(m), 0);

  // ── Month nav ────────────────────────────────────────────────────────────────

  const prevM = () => { if (month === 0) { setYear(y => y-1); setMonth(11); } else setMonth(m => m-1); };
  const nextM = () => { if (month === 11){ setYear(y => y+1); setMonth(0);  } else setMonth(m => m+1); };

  // ── Export CSV ───────────────────────────────────────────────────────────────

  const exportCSV = () => {
    const header = ["Nombre","Departamento","Sección","Régimen","Salario/día","Días","Complementos totales","Total bruto",
      ...days.map(d => `${d}/${month+1}`)];
    const rows = filtered.map(m => {
      const ds = dailySalary(m);
      const wd = workingDays(m.id);
      const all = memberMonthAllowances(m.id);
      const sal = memberSalaryTotal(m);
      return [
        `${m.firstName} ${m.lastName1}`,
        m.department || SECTION_LABELS[m.section] || "—",
        SECTION_LABELS[m.section] || m.section,
        m.regime || "—",
        ds.toFixed(2), String(wd), all.toFixed(2),
        (all + sal).toFixed(2),
        ...days.map(d => cellTotal(m.id, d).toFixed(2)),
      ];
    });
    const csv = [header, ...rows].map(r => r.join(";")).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })),
      download: `nominas-${monthKey}.csv`,
    });
    a.click(); setShowExport(false);
  };

  // ── Solicitar dietas helpers ─────────────────────────────────────────────────

  const genPin = () => String(Math.floor(1000 + Math.random() * 9000));

  const resetSolicitar = () => {
    setSolStep(1); setSolDateFrom(""); setSolDateTo("");
    setSolTypes({ meals:true, halfPerDiem:false, perDiem:true, halfIntlPerDiem:false, intlPerDiem:false, accommodation:false, car:false });
    setSolPeople(new Set()); setSolMode("individual"); setGeneratedForms([]);
  };

  const generateDietasForms = async () => {
    if (!solDateFrom || !solDateTo || solPeople.size === 0) return;
    setGenerating(true);
    try {
      const selected = crew.filter(m => solPeople.has(m.id));
      const allowTypes = Object.entries(solTypes).filter(([,v])=>v).map(([k])=>k);
      const results: typeof generatedForms = [];

      const createForm = async (people: CrewMember[]) => {
        const pin = genPin();
        const ref = await addDoc(collection(db, "forms"), {
          type: "dietas_request", pin, status: "pending",
          projectId, projectName, createdBy: user?.uid || "",
          createdByName: user?.name || user?.email || "",
          dateFrom: solDateFrom, dateTo: solDateTo,
          people: people.map(m => ({
            memberId: m.id, firstName: m.firstName, lastName1: m.lastName1,
            department: m.department, section: m.section,
          })),
          allowanceTypes: allowTypes,
          createdAt: Timestamp.now(),
        });
        const names = people.map(m => `${m.firstName} ${m.lastName1}`);
        await setDoc(doc(db, `projects/${projectId}/dietasForms`, ref.id), {
          formId: ref.id, dateFrom: solDateFrom, dateTo: solDateTo,
          people: people.map(m=>m.id), peopleNames: names,
          status: "pending", createdAt: Timestamp.now(),
        });
        results.push({ id: ref.id, url: `${window.location.origin}/form/${ref.id}`, pin, names });
      };

      if (solMode === "individual") {
        for (const m of selected) await createForm([m]);
      } else {
        await createForm(selected);
      }

      setGeneratedForms(results);
      setSolStep(4);
      // update pending list
      setPendingForms(p => [...p, ...results.map(r => ({
        formId: r.id, dateFrom: solDateFrom, dateTo: solDateTo, peopleNames: r.names, status: "pending",
      }))]);
    } finally { setGenerating(false); }
  };

  const importDietasForm = async (formId: string) => {
    setImportingId(formId);
    try {
      const formSnap = await getDoc(doc(db, "forms", formId));
      if (!formSnap.exists() || formSnap.data().status !== "submitted") {
        alert("Este formulario todavía no ha sido completado.");
        return;
      }
      const entries = (formSnap.data().response?.entries || {}) as Record<string, Record<string, Record<string,boolean>>>;

      // Group by month
      const byMonth: Record<string, Record<string, Record<string,DayEntry>>> = {};
      for (const [mId, dayData] of Object.entries(entries)) {
        for (const [dateStr, types] of Object.entries(dayData)) {
          const parts = dateStr.split("-");
          const mKey = `${parts[0]}-${parts[1]}`;
          const dKey = parts[2];
          if (!byMonth[mKey]) byMonth[mKey] = {};
          if (!byMonth[mKey][mId]) byMonth[mKey][mId] = {};
          byMonth[mKey][mId][dKey] = { ...EMPTY_DAY, ...Object.fromEntries(Object.entries(types).map(([k,v])=>[k,Boolean(v)])) } as DayEntry;
        }
      }

      for (const [mKey, members] of Object.entries(byMonth)) {
        const monthRef = doc(db, `projects/${projectId}/payrollMonths`, mKey);
        const existing = await getDoc(monthRef);
        const current: MonthData = existing.exists() ? (existing.data().entries || {}) : {};
        const merged: MonthData = { ...current };
        for (const [mId, days] of Object.entries(members)) {
          merged[mId] = { ...(merged[mId] || {}), ...days };
        }
        await setDoc(monthRef, { entries: merged, updatedAt: Timestamp.now(), updatedBy: user?.uid || "" });
      }

      await updateDoc(doc(db, `projects/${projectId}/dietasForms`, formId), { status: "imported" });
      setPendingForms(f => f.filter(pf => pf.formId !== formId));
      await loadMonth();
    } finally { setImportingId(null); }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // ── Period helpers (per allowance type) ─────────────────────────────────────

  const allowanceOutsidePeriod = (d: number, key: string): boolean => {
    const p = periods[key];
    if (!p) return false;
    const dt = new Date(year, month, d);
    if (p.from) { const from = new Date(p.from); from.setHours(0,0,0,0); if (dt < from) return true; }
    if (p.to)   { const to   = new Date(p.to);   to.setHours(23,59,59,999); if (dt > to) return true; }
    return false;
  };

  const dayOutsidePeriod = (d: number): boolean =>
    ALLOWANCES.some(a => allowanceOutsidePeriod(d, a.key));

  const savePeriods = async (p: Record<string,{from:string;to:string}>) => {
    await setDoc(doc(db, `projects/${projectId}/payrollMonths`, monthKey), {
      entries: monthData, periods: p, updatedAt: Timestamp.now(), updatedBy: user?.uid || "",
    });
    setPeriods(p);
  };

  // ── Range fill ────────────────────────────────────────────────────────────────

  const openRangeFill = (memberId: string) => {
    setRfTarget(memberId);
    setRfDay1(1); setRfDay2(numDays); setRfMode("mark");
    setRfTypes(Object.fromEntries(ALLOWANCES.map(a => [a.key, false])));
    setRfWorked(false);
  };

  const applyRangeFill = () => {
    if (!rfTarget) return;
    const d1 = Math.min(rfDay1, rfDay2);
    const d2 = Math.max(rfDay1, rfDay2);
    const next = { ...monthData, [rfTarget]: { ...(monthData[rfTarget] || {}) } };
    for (let d = d1; d <= d2; d++) {
      const existing = next[rfTarget][dk(d)] || { ...EMPTY_DAY };
      if (rfMode === "clear") {
        const cleared = { ...existing };
        Object.keys(rfTypes).forEach(k => { if (rfTypes[k]) (cleared as any)[k] = false; });
        if (rfWorked) cleared.workedOverride = false;
        next[rfTarget][dk(d)] = cleared;
      } else {
        const patch: Partial<DayEntry> = Object.fromEntries(Object.entries(rfTypes).filter(([,v])=>v));
        if (rfWorked) patch.workedOverride = true;
        next[rfTarget][dk(d)] = { ...existing, ...patch };
      }
    }
    setMonthData(next);
    saveData(next);
    setRfTarget(null);
  };

  // ── Modal helpers ────────────────────────────────────────────────────────────

  const openEdit = (mId: string, d: number) => {
    setEditTarget({ memberId: mId, day: d });
    setEditData(getEntry(mId, d));
    setEditingOverride(null);
  };
  const confirmEdit = () => {
    if (!editTarget) return;
    updateEntry(editTarget.memberId, editTarget.day, editData);
    setEditTarget(null);
  };
  const editModalMember = editTarget ? crew.find(m => m.id === editTarget.memberId) : undefined;
  const editModalTotal =
    ALLOWANCES.reduce((s, a) => s + (editData[a.key] ? getRate(editData, a, editModalMember) : 0), 0)
    + (editData.other ? (editData.otherAmount || 0) : 0);

  const editMember = crew.find(m => m.id === editTarget?.memberId);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <Banknote size={24} style={{ color: TEAM_COLOR }} />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Confección de nóminas</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {saving && <span className="text-xs text-slate-400 animate-pulse mr-1">Guardando…</span>}
              <div className="relative">
                <button onClick={() => setShowExport(v => !v)}
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  <Download size={15} /><span className="inline">Exportar</span>
                  <ChevronDown size={13} className="text-slate-400" />
                </button>
                {showExport && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
                    <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 min-w-[160px]">
                      <button onClick={exportCSV}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                        <TrendingUp size={14} className="text-slate-400" />CSV completo
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="px-24 pb-4 flex flex-wrap items-center gap-3">
        {/* Month nav */}
        <div className="flex items-center border border-slate-200 rounded-xl p-0.5">
          <button onClick={prevM} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"><ChevronLeft size={15} /></button>
          <span className="px-3 text-sm font-semibold text-slate-900 min-w-[130px] text-center">{MONTH_NAMES[month]} {year}</span>
          <button onClick={nextM} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"><ChevronRight size={15} /></button>
        </div>

        {/* View */}
        <div className="flex items-center gap-0.5 border border-slate-200 rounded-xl p-0.5">
          {(["grid","summary"] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${viewMode===v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {v === "grid" ? "Tabla" : "Resumen"}
            </button>
          ))}
        </div>

        {/* Period config */}
        <button
          onClick={() => { setPeriodsDraft({...periods}); setShowPeriodCfg(true); }}
          className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-xs font-medium transition-colors ${Object.keys(periods).length > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          <CalendarRange size={13} />
          {Object.keys(periods).length > 0 ? `${Object.keys(periods).length} período${Object.keys(periods).length !== 1 ? "s" : ""}` : "Períodos"}
        </button>

      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="px-24 pb-5 flex flex-wrap items-center gap-4">
        {ALLOWANCES.map(a => (
          <div key={a.key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.dot }} />
            <span className="text-xs text-slate-500">{a.label} · {fmt(cfg[a.rateKey])}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-400 flex-shrink-0" />
          <span className="text-xs text-slate-500">Otros</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-6 h-[5px] rounded-full flex-shrink-0" style={{ backgroundColor: TEAM_COLOR }} />
          <span className="text-xs text-slate-400">Día trabajado · click para marcar/desmarcar</span>
        </div>
      </div>


      {/* ── Main content ─────────────────────────────────────────────────── */}
      {viewMode === "grid" ? <GridView /> : <SummaryView />}

      {/* ── Period config modal ──────────────────────────────────────────── */}
      {showPeriodCfg && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarRange size={16} className="text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Períodos de complementos</p>
                  <p className="text-xs text-slate-400 mt-0.5">El salario siempre cubre el mes completo</p>
                </div>
              </div>
              <button onClick={() => setShowPeriodCfg(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={15} /></button>
            </div>
            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {ALLOWANCES.map(a => {
                const Icon = a.Icon;
                const draft = periodsDraft[a.key] || { from: "", to: "" };
                const hasRange = draft.from || draft.to;
                return (
                  <div key={a.key} className={`border rounded-xl p-3 transition-colors ${hasRange ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.dot + "22" }}>
                        <Icon size={12} style={{ color: a.dot }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-700">{a.label}</span>
                      {hasRange && (
                        <button
                          onClick={() => setPeriodsDraft(p => { const n = {...p}; delete n[a.key]; return n; })}
                          className="ml-auto text-[10px] text-slate-400 hover:text-red-500 transition-colors underline">
                          Quitar
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Desde</label>
                        <input type="date" value={draft.from}
                          onChange={e => setPeriodsDraft(p => ({ ...p, [a.key]: { ...draft, from: e.target.value } }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Hasta</label>
                        <input type="date" value={draft.to} min={draft.from}
                          onChange={e => setPeriodsDraft(p => ({ ...p, [a.key]: { ...draft, to: e.target.value } }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
              <button onClick={() => setShowPeriodCfg(false)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const clean: Record<string,{from:string;to:string}> = {};
                  for (const [k, v] of Object.entries(periodsDraft)) {
                    if (v.from || v.to) clean[k] = v;
                  }
                  savePeriods(clean);
                  setShowPeriodCfg(false);
                }}
                className="flex-1 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#d97706" }}>
                Guardar períodos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Range fill modal ─────────────────────────────────────────────── */}
      {rfTarget && (() => {
        const rfMember = crew.find(m => m.id === rfTarget);
        if (!rfMember) return null;
        const anyType = Object.values(rfTypes).some(Boolean) || rfWorked;
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={15} className="text-amber-500" />
                  <p className="text-sm font-semibold text-slate-900">{rfMember.firstName} {rfMember.lastName1}</p>
                </div>
                <button onClick={() => setRfTarget(null)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={15} /></button>
              </div>
              <div className="p-6 space-y-5">
                {/* Day range */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Rango de días</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] text-slate-400 mb-1">Día inicio</label>
                      <input type="number" min={1} max={numDays} value={rfDay1}
                        onChange={e => setRfDay1(Math.max(1, Math.min(numDays, parseInt(e.target.value)||1)))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                    <span className="text-slate-400 text-sm mt-4">→</span>
                    <div className="flex-1">
                      <label className="block text-[10px] text-slate-400 mb-1">Día fin</label>
                      <input type="number" min={rfDay1} max={numDays} value={rfDay2}
                        onChange={e => setRfDay2(Math.max(rfDay1, Math.min(numDays, parseInt(e.target.value)||numDays)))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 text-center">
                    {Math.max(0, rfDay2 - rfDay1 + 1)} días · {MONTH_NAMES[month]} {year}
                  </p>
                </div>

                {/* Action */}
                <div className="flex items-center gap-2">
                  {(["mark","clear"] as const).map(m => (
                    <button key={m} onClick={() => setRfMode(m)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${rfMode===m ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {m === "mark" ? "✓ Marcar" : "✕ Borrar"}
                    </button>
                  ))}
                </div>

                {/* Worked days toggle */}
                <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${rfWorked ? "border-slate-300 bg-slate-50" : "border-slate-100"}`}>
                  <input type="checkbox" checked={rfWorked} onChange={() => setRfWorked(v => !v)} className="sr-only" />
                  <div className="w-5 h-[5px] rounded-full flex-shrink-0" style={{ backgroundColor: rfWorked ? TEAM_COLOR : "#cbd5e1" }} />
                  <span className="text-xs font-medium text-slate-700 flex-1">Días trabajados (salario)</span>
                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0 transition-all ${rfWorked ? "border-slate-900 bg-slate-900" : "border-slate-300"}`}>
                    {rfWorked && <Check size={8} className="text-white" />}
                  </div>
                </label>

                {/* Types */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-700">Complementos</label>
                    <div className="flex gap-2">
                      <button onClick={() => setRfTypes(Object.fromEntries(ALLOWANCES.map(a=>[a.key,true])))} className="text-[10px] text-slate-500 hover:text-slate-800 underline">Todos</button>
                      <button onClick={() => setRfTypes(Object.fromEntries(ALLOWANCES.map(a=>[a.key,false])))} className="text-[10px] text-slate-400 hover:text-slate-600 underline">Ninguno</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ALLOWANCES.map(a => {
                      const Icon = a.Icon;
                      return (
                        <label key={a.key} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all text-xs ${rfTypes[a.key] ? "border-slate-300 bg-slate-50" : "border-slate-100"}`}>
                          <input type="checkbox" checked={!!rfTypes[a.key]} onChange={() => setRfTypes(t=>({...t,[a.key]:!t[a.key]}))} className="sr-only" />
                          <Icon size={11} style={{ color: a.dot }} />
                          <span className="text-slate-700 truncate flex-1">{a.label}</span>
                          <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0 transition-all ${rfTypes[a.key] ? "border-slate-900 bg-slate-900" : "border-slate-300"}`}>
                            {rfTypes[a.key] && <Check size={8} className="text-white" />}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
                <button onClick={() => setRfTarget(null)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
                <button onClick={applyRangeFill} disabled={!anyType}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: TEAM_COLOR }}>
                  <Zap size={13} />
                  {rfMode === "mark" ? "Aplicar" : "Borrar"} días {rfDay1}–{rfDay2}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Person detail modal ───────────────────────────────────────────── */}
      {detailId && (() => {
        const m = crew.find(x => x.id === detailId);
        if (!m) return null;
        const ds       = dailySalary(m);
        const regime   = regimeBadge(m.regime || m.ssRegime);
        const allDays  = days.map(d => ({
          d, entry: getEntry(m.id, d), outside: dayOutsidePeriod(d),
          total: cellTotal(m.id, d),
        }));
        const activeDays = allDays.filter(x => x.total > 0 || ALLOWANCES.some(a => x.entry[a.key]) || x.entry.other);
        const wd       = workingDays(m.id);
        const allw     = memberMonthAllowances(m.id);
        const sal      = memberSalaryTotal(m);
        const bruto    = allw + sal;

        const byType = ALLOWANCES.map(a => ({
          ...a,
          count: allDays.filter(x => x.entry[a.key]).length,
          total: allDays.reduce((s,x) => s + (x.entry[a.key] ? getRate(x.entry, a, m) : 0), 0),
        })).filter(a => a.total > 0);

        const otherTotal = allDays.reduce((s,x) => s + (x.entry.other ? (x.entry.otherAmount||0) : 0), 0);

        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-end">
            <div className="bg-white h-full w-full max-w-xl shadow-2xl flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: TEAM_COLOR + "cc" }}>
                    {m.firstName[0]}{m.lastName1[0]}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-900">{m.firstName} {m.lastName1}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {m.role && <span className="text-xs text-slate-400">{m.role}</span>}
                      {m.department && <span className="text-xs text-slate-400">· {m.department}</span>}
                      <span className={`text-xs font-semibold ${regime.color}`}>{regime.label}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => window.print()}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Imprimir">
                    <Printer size={15} />
                  </button>
                  <button onClick={() => { setDetailId(null); setEditingSalary(false); setNoteDraft(null); }} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Periods */}
              {Object.keys(periods).length > 0 && (
                <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                  <CalendarRange size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    {Object.keys(periods).length} complemento{Object.keys(periods).length !== 1 ? "s" : ""} con período definido
                  </p>
                </div>
              )}

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Salary */}
                {(ds > 0 || m.salaryType) && (() => {
                  const hasOverride = salaryOverrides[m.id] !== undefined;
                  const baseRate = m.salaryType === "monthly" ? (m.grossSalary || 0)
                    : m.salaryType === "weekly" ? (m.salaryAmount || 0)
                    : (m.salaryPerSession || 0);
                  const currentRate = hasOverride ? salaryOverrides[m.id] : baseRate;
                  const rateLabel = m.salaryType === "monthly" ? "€/mes" : m.salaryType === "weekly" ? "€/semana" : "€/sesión";
                  return (
                    <div className={`border rounded-xl p-4 ${hasOverride ? "border-amber-200 bg-amber-50" : "bg-slate-50 border-slate-200"}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <Banknote size={14} className={hasOverride ? "text-amber-500" : "text-slate-400"} />
                        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex-1">Salario</p>
                        {hasOverride ? (
                          <button
                            onClick={() => saveSalaryOverride(m.id, null)}
                            className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-red-500 transition-colors"
                            title="Importe personalizado este mes — click para volver al base">
                            <Unlock size={10} /><span>Personalizado este mes</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => { setSalaryDraft(String(baseRate)); setEditingSalary(true); }}
                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-700 transition-colors"
                            title="Cambiar salario solo para este mes">
                            <Lock size={10} /><span>Cambiar este mes</span>
                          </button>
                        )}
                      </div>

                      {editingSalary && !hasOverride ? (
                        <div className="flex items-center gap-2 mb-3">
                          <input
                            type="number" autoFocus min="0" step="0.01"
                            value={salaryDraft}
                            onChange={e => setSalaryDraft(e.target.value)}
                            className="flex-1 border border-amber-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                            placeholder={`Importe ${rateLabel}`}
                          />
                          <span className="text-xs text-slate-500">{rateLabel}</span>
                          <button
                            onClick={() => {
                              const v = parseFloat(salaryDraft);
                              if (!isNaN(v) && v >= 0) saveSalaryOverride(m.id, v);
                              setEditingSalary(false);
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-white rounded-lg"
                            style={{ backgroundColor: TEAM_COLOR }}>
                            OK
                          </button>
                          <button onClick={() => setEditingSalary(false)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-700">✕</button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Tarifa {m.salaryType === "monthly" ? "mensual" : m.salaryType === "weekly" ? "semanal" : "por sesión"}</span>
                            <span className={`font-medium ${hasOverride ? "text-amber-700" : "text-slate-700"}`}>
                              {new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(currentRate)} {rateLabel}
                              {hasOverride && (
                                <button onClick={() => { setSalaryDraft(String(currentRate)); setEditingSalary(true); }}
                                  className="ml-1.5 text-amber-500 hover:text-amber-700">
                                  <Lock size={9} style={{display:"inline"}} />
                                </button>
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Tarifa diaria</span>
                            <span className="text-slate-700 font-medium">{fmt(ds)}</span>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between text-xs pt-1.5 mt-1.5 border-t border-slate-200">
                        <span className="text-slate-500">Días trabajados</span>
                        <span className="text-slate-700 font-medium">{wd} días</span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold pt-1.5 mt-1 border-t border-slate-200">
                        <span className="text-slate-700">Salario estimado</span>
                        <span className="text-slate-900">{fmt(sal)}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Allowances by type */}
                {byType.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                      <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Complementos</p>
                      <span className="text-xs text-slate-400">{byType.reduce((s,a)=>s+a.count,0)} días totales</span>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {byType.map(a => {
                        const Icon = a.Icon;
                        return (
                          <div key={a.key} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.dot + "22" }}>
                              <Icon size={11} style={{ color: a.dot }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-700">{a.label}</p>
                              <p className="text-[10px] text-slate-400">{a.count} día{a.count!==1?"s":""} × {fmt(cfg[a.rateKey])}</p>
                            </div>
                            <span className="text-sm font-semibold text-slate-900">{fmt(a.total)}</span>
                          </div>
                        );
                      })}
                      {otherTotal > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-slate-100">
                            <Plus size={11} className="text-slate-400" />
                          </div>
                          <p className="text-xs font-medium text-slate-700 flex-1">Otros</p>
                          <span className="text-sm font-semibold text-slate-900">{fmt(otherTotal)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Day-by-day table */}
                {activeDays.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Detalle por día</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="text-left px-4 py-2 font-medium text-slate-500">Día</th>
                            {ALLOWANCES.filter(a => byType.some(x=>x.key===a.key)).map(a => (
                              <th key={a.key} className="text-center px-2 py-2 font-medium text-slate-500" style={{ color: a.dot }}>
                                {a.label.split(" ")[0]}
                              </th>
                            ))}
                            {otherTotal > 0 && <th className="text-center px-2 py-2 font-medium text-slate-500">Otros</th>}
                            <th className="text-right px-4 py-2 font-medium text-slate-500">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {activeDays.map(({ d, entry, outside, total }) => (
                            <tr key={d} className={outside ? "bg-amber-50/50" : ""}>
                              <td className="px-4 py-2 font-medium text-slate-700 whitespace-nowrap">
                                {DAY_SHORT[dow(year, month, d)]} {d}
                                {outside && <span className="ml-1 text-[9px] text-amber-400">◆</span>}
                              </td>
                              {ALLOWANCES.filter(a => byType.some(x=>x.key===a.key)).map(a => (
                                <td key={a.key} className="text-center px-2 py-2">
                                  {entry[a.key]
                                    ? <div className="w-2 h-2 rounded-full mx-auto" style={{ backgroundColor: a.dot }} />
                                    : <span className="text-slate-200">—</span>}
                                </td>
                              ))}
                              {otherTotal > 0 && (
                                <td className="text-center px-2 py-2 text-slate-600">
                                  {entry.other ? fmt(entry.otherAmount || 0) : <span className="text-slate-200">—</span>}
                                </td>
                              )}
                              <td className="text-right px-4 py-2 font-semibold text-slate-900">{fmt(total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeDays.length === 0 && (
                  <div className="py-12 text-center text-slate-400 text-sm">Sin complementos registrados este mes</div>
                )}
              </div>

              {/* Footer totals */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Total complementos</span><span className="font-medium text-slate-700">{fmt(allw)}</span>
                </div>
                {ds > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Salario estimado ({wd} días)</span><span className="font-medium text-slate-700">{fmt(sal)}</span>
                  </div>
                )}
                {bruto > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total bruto</span><span>{fmt(bruto)}</span>
                  </div>
                )}

                {/* Note */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex-1">Nota de nómina</p>
                    {notes[m.id] && noteDraft === null && (
                      <button onClick={() => setNoteDraft(notes[m.id])}
                        className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors underline">
                        Editar
                      </button>
                    )}
                  </div>
                  {noteDraft !== null ? (
                    <div className="space-y-2">
                      <textarea
                        autoFocus rows={3}
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        placeholder="Añade una nota visible en el informe de esta persona…"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none bg-white"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { saveNote(m.id, noteDraft); setNoteDraft(null); }}
                          className="flex-1 py-1.5 text-xs font-medium text-white rounded-lg"
                          style={{ backgroundColor: TEAM_COLOR }}>
                          Guardar
                        </button>
                        {notes[m.id] && (
                          <button
                            onClick={() => { saveNote(m.id, ""); setNoteDraft(null); }}
                            className="px-3 py-1.5 text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-lg transition-colors">
                            Quitar
                          </button>
                        )}
                        <button onClick={() => setNoteDraft(null)}
                          className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : notes[m.id] ? (
                    <p className="text-xs text-slate-600 leading-relaxed">{notes[m.id]}</p>
                  ) : (
                    <button
                      onClick={() => setNoteDraft("")}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                      + Añadir nota…
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── (solicitar modal removed) ────────────────────────────────────── */}
      {false && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: "92vh" }}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <p className="text-base font-semibold text-slate-900">Solicitar complementos</p>
                <button onClick={() => setShowSolicitar(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={16} /></button>
              </div>
              <div className="flex items-center gap-1.5">
                {[1,2,3,4].map(s => (
                  <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${solStep >= s ? "bg-slate-900" : "bg-slate-200"}`} />
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {solStep===1 && "Paso 1 de 3 — Rango y tipos"}
                {solStep===2 && "Paso 2 de 3 — Seleccionar personas"}
                {solStep===3 && "Paso 3 de 3 — Tipo de formulario"}
                {solStep===4 && "Formulario generado"}
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {solStep === 1 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Fecha inicio</label>
                      <input type="date" value={solDateFrom} onChange={e => setSolDateFrom(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Fecha fin</label>
                      <input type="date" value={solDateTo} min={solDateFrom} onChange={e => setSolDateTo(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-2">Incluir en el formulario</label>
                    <div className="space-y-2">
                      {ALLOWANCES.map(a => {
                        const Icon = a.Icon;
                        return (
                          <label key={a.key} className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-all ${solTypes[a.key] ? "border-slate-300 bg-slate-50" : "border-slate-100"}`}>
                            <input type="checkbox" checked={!!solTypes[a.key]} onChange={() => setSolTypes(t => ({ ...t, [a.key]: !t[a.key] }))} className="sr-only" />
                            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.dot + "22" }}>
                              <Icon size={12} style={{ color: a.dot }} />
                            </div>
                            <span className="text-sm text-slate-700 flex-1">{a.label}</span>
                            <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${solTypes[a.key] ? "border-slate-900 bg-slate-900" : "border-slate-300"}`}>
                              {solTypes[a.key] && <Check size={10} className="text-white" />}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {solStep === 2 && (() => {
                const byDeptSol: Record<string, CrewMember[]> = {};
                for (const m of crew) {
                  const k = m.department || SECTION_LABELS[m.section] || "Sin departamento";
                  (byDeptSol[k] ||= []).push(m);
                }
                return (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-slate-500">{solPeople.size} persona{solPeople.size!==1?"s":""} seleccionada{solPeople.size!==1?"s":""}</p>
                      <div className="flex gap-2">
                        <button onClick={() => setSolPeople(new Set(crew.map(m=>m.id)))} className="text-xs text-slate-600 hover:text-slate-900 underline">Todas</button>
                        <button onClick={() => setSolPeople(new Set())} className="text-xs text-slate-400 hover:text-slate-600 underline">Ninguna</button>
                      </div>
                    </div>
                    {Object.entries(byDeptSol).map(([dept, members]) => (
                      <div key={dept} className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">{dept}</span>
                          <button
                            onClick={() => {
                              const allIn = members.every(m => solPeople.has(m.id));
                              setSolPeople(prev => {
                                const next = new Set(prev);
                                members.forEach(m => allIn ? next.delete(m.id) : next.add(m.id));
                                return next;
                              });
                            }}
                            className="text-xs text-slate-500 hover:text-slate-800 transition-colors">
                            {members.every(m => solPeople.has(m.id)) ? "Quitar todos" : "Seleccionar todos"}
                          </button>
                        </div>
                        <div className="divide-y divide-slate-50">
                          {members.map(m => (
                            <label key={m.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors">
                              <input type="checkbox" checked={solPeople.has(m.id)} onChange={() => setSolPeople(prev => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} className="sr-only" />
                              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${solPeople.has(m.id) ? "border-slate-900 bg-slate-900" : "border-slate-300"}`}>
                                {solPeople.has(m.id) && <Check size={10} className="text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-800">{m.firstName} {m.lastName1}</p>
                                <p className="text-xs text-slate-400">{m.role || "—"}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}

              {solStep === 3 && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">¿Cómo quieres enviar el formulario?</p>
                  {([
                    { v:"individual" as const, label:"Un formulario por persona", desc:"Cada persona recibe su propio enlace y solo rellena sus días." },
                    { v:"group" as const, label:"Un formulario para todas", desc:"Un enlace único para que un coordinador rellene los datos de todos los seleccionados." },
                  ] as const).map(({ v, label, desc }) => (
                    <label key={v} className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-all ${solMode===v ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                      <input type="radio" name="solMode" value={v} checked={solMode===v} onChange={() => setSolMode(v)} className="sr-only" />
                      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${solMode===v ? "border-slate-900" : "border-slate-300"}`}>
                        {solMode===v && <div className="w-2 h-2 rounded-full bg-slate-900" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                      </div>
                    </label>
                  ))}
                  <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
                    <strong className="text-slate-700">{solPeople.size} persona{solPeople.size!==1?"s":""}</strong> · {solDateFrom} → {solDateTo} · {Object.entries(solTypes).filter(([,v])=>v).length} tipo{Object.entries(solTypes).filter(([,v])=>v).length!==1?"s":""} de dieta
                  </div>
                </div>
              )}

              {solStep === 4 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Check size={11} className="text-green-600" />
                    </div>
                    {generatedForms.length} formulario{generatedForms.length!==1?"s":""} creado{generatedForms.length!==1?"s":""}
                  </div>
                  {generatedForms.map((f, i) => (
                    <div key={f.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                        <p className="text-xs font-semibold text-slate-700">{f.names.join(", ")}</p>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            <p className="text-xs text-slate-500 truncate">{f.url}</p>
                          </div>
                          <button onClick={() => copyToClipboard(f.url, `url-${i}`)}
                            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors flex-shrink-0">
                            {copiedKey===`url-${i}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                            URL
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            <p className="text-sm font-bold text-slate-900 tracking-widest">{f.pin}</p>
                          </div>
                          <button onClick={() => copyToClipboard(f.pin, `pin-${i}`)}
                            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors flex-shrink-0">
                            {copiedKey===`pin-${i}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                            PIN
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer nav */}
            {solStep < 4 && (
              <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0 flex gap-3">
                {solStep > 1 && (
                  <button onClick={() => setSolStep(s => s-1)}
                    className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                    Atrás
                  </button>
                )}
                <button
                  disabled={
                    (solStep===1 && (!solDateFrom || !solDateTo)) ||
                    (solStep===2 && solPeople.size===0) ||
                    generating
                  }
                  onClick={() => {
                    if (solStep < 3) setSolStep(s => s+1);
                    else generateDietasForms();
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: TEAM_COLOR }}>
                  {generating ? "Creando…" : solStep===3 ? <><Send size={14} /> Crear formulario{solMode==="individual"&&solPeople.size>1?"s":""}</> : "Siguiente"}
                </button>
              </div>
            )}
            {solStep === 4 && (
              <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0">
                <button onClick={() => setShowSolicitar(false)}
                  className="w-full py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Day editor modal ─────────────────────────────────────────────── */}
      {editTarget && editMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" style={{ maxHeight: "92vh" }}>
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {editMember.firstName} {editMember.lastName1}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {DAY_SHORT[dow(year, month, editTarget.day)]} {editTarget.day} de {MONTH_NAMES[month]}
                  {editMember.role ? ` · ${editMember.role}` : ""}
                </p>
              </div>
              <button onClick={() => setEditTarget(null)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Salary indicator */}
            {dailySalary(editMember) > 0 && (
              <div className="mx-6 mt-4 flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Banknote size={13} className="text-slate-400" />
                  Salario del día ({editMember.salaryType === "weekly" ? "sem./5" : "mes/30"})
                </div>
                <span className="text-sm font-semibold text-slate-900">{fmt(dailySalary(editMember))}</span>
              </div>
            )}

            {/* Allowance rows */}
            <div className="p-4 space-y-2.5 overflow-y-auto flex-1">
              {ALLOWANCES.map(a => {
                const active = editData[a.key];
                const override = editData[a.overrideKey] as number | undefined;
                const rate = override ?? cfg[a.rateKey];
                const isOverride = override !== undefined;
                const editingThis = editingOverride === a.key;
                const Icon = a.Icon;
                return (
                  <div key={a.key} className={`border rounded-xl transition-all ${active ? "border-slate-200 bg-white shadow-sm" : "border-slate-100 bg-slate-50"}`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: active ? a.dot + "22" : "#f1f5f9" }}>
                        <Icon size={14} style={{ color: active ? a.dot : "#94a3b8" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${active ? "text-slate-900" : "text-slate-400"}`}>{a.label}</p>
                        {active && (
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {editingThis ? (
                              <input type="number" autoFocus defaultValue={rate} step="0.01"
                                onBlur={e => {
                                  const v = parseFloat(e.target.value);
                                  if (!isNaN(v)) setEditData(d => ({ ...d, [a.overrideKey]: v }));
                                  setEditingOverride(null);
                                }}
                                className="w-20 text-xs border border-slate-300 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-slate-300"
                              />
                            ) : (
                              <>
                                <span className="text-xs text-slate-600 font-medium">{fmt(rate)}</span>
                                {isOverride ? (
                                  <button
                                    onClick={() => setEditData(d => { const c = {...d}; delete c[a.overrideKey]; return c; })}
                                    className="flex items-center gap-0.5 text-xs text-amber-600 hover:text-amber-700 transition-colors"
                                    title="Importe personalizado — click para volver al global">
                                    <Unlock size={10} /><span>Personalizado</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setEditingOverride(a.key)}
                                    className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                                    title="Usando tarifa global de configuración — click para personalizar este día">
                                    <Lock size={10} /><span>Global</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setEditData(d => ({ ...d, [a.key]: !active }))}
                        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${active ? "" : "bg-slate-200"}`}
                        style={active ? { backgroundColor: TEAM_COLOR } : {}}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${active ? "translate-x-5" : ""}`} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Otros */}
              <div className={`border rounded-xl transition-all ${editData.other ? "border-slate-200 bg-white shadow-sm" : "border-slate-100 bg-slate-50"}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100">
                    <Plus size={14} className={editData.other ? "text-slate-600" : "text-slate-400"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${editData.other ? "text-slate-900" : "text-slate-400"}`}>Otros</p>
                    {editData.other && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <input type="text" placeholder="Concepto"
                          value={editData.otherLabel}
                          onChange={e => setEditData(d => ({ ...d, otherLabel: e.target.value }))}
                          className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        />
                        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                          <input type="number" placeholder="0" step="0.01"
                            value={editData.otherAmount || ""}
                            onChange={e => setEditData(d => ({ ...d, otherAmount: parseFloat(e.target.value) || 0 }))}
                            className="w-16 text-xs px-2 py-1.5 focus:outline-none text-right"
                          />
                          <span className="text-xs text-slate-400 px-1.5 bg-slate-50 border-l border-slate-200">€</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setEditData(d => ({ ...d, other: !d.other }))}
                    className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${editData.other ? "" : "bg-slate-200"}`}
                    style={editData.other ? { backgroundColor: TEAM_COLOR } : {}}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${editData.other ? "translate-x-5" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Override warning */}
              {ALLOWANCES.some(a => editData[a.overrideKey] !== undefined) && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    Este día tiene importes personalizados. El resto del crew seguirá usando las tarifas globales de configuración.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-slate-600">Total complementos del día</span>
                <span className="text-lg font-bold text-slate-900">{fmt(editModalTotal)}</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditTarget(null)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-white transition-colors">
                  Cancelar
                </button>
                <button onClick={confirmEdit}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: TEAM_COLOR }}>
                  <Check size={15} />Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Grid view ─────────────────────────────────────────────────────────────────

  function GridView() {
    if (filtered.length === 0) {
      return (
        <div className="px-24 py-24 text-center">
          <Users size={40} className="text-slate-200 mx-auto mb-4" />
          <p className="text-slate-500">No hay miembros de crew{filterSection !== "all" ? " en esta sección" : ""}</p>
        </div>
      );
    }

    return (
      <div className="px-24 pb-16">
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse" style={{ minWidth: `${224 + numDays * 36 + 100}px`, width: "100%" }}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 z-20 bg-slate-50 border-r border-slate-200 w-56 min-w-[224px] px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Miembro
                  </th>
                  {days.map(d => {
                    const w = isWknd(year, month, d);
                    const isM = dow(year, month, d) === 0;
                    const outside = dayOutsidePeriod(d);
                    return (
                      <th key={d}
                        className={`w-9 min-w-[36px] text-center py-3 text-xs font-medium select-none
                          ${w ? "text-slate-300" : outside ? "text-amber-400" : "text-slate-500"}
                          ${isM && d > 1 ? "border-l border-slate-300" : ""}
                        `}
                        style={outside ? { backgroundColor: "#fef3c720" } : {}}>
                        <div className="leading-tight">{DAY_SHORT[dow(year, month, d)]}</div>
                        <div className="font-bold leading-tight">{d}</div>
                        {outside && <div className="w-1 h-1 rounded-full bg-amber-300 mx-auto mt-0.5" />}
                      </th>
                    );
                  })}
                  <th className="min-w-[110px] text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-l border-slate-200">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {Object.entries(byDept).map(([dept, members]) => (
                  <Fragment key={dept}>
                    {/* Department row */}
                    <tr>
                      <td colSpan={numDays + 2}
                        className="px-4 py-2 text-xs font-semibold text-white uppercase tracking-wider bg-slate-800">
                        {dept}
                        <span className="ml-2 font-normal normal-case text-slate-400">
                          {members.length} persona{members.length !== 1 ? "s" : ""}
                        </span>
                      </td>
                    </tr>

                    {/* Member rows */}
                    {members.map(m => {
                      const ds = dailySalary(m);
                      const regime = regimeBadge(m.regime || m.ssRegime);
                      const allowTotal = memberMonthAllowances(m.id);
                      const salTotal = memberSalaryTotal(m);
                      const grandTotal = salTotal + allowTotal;
                      return (
                        <tr key={m.id} className="border-b border-slate-100 group hover:bg-slate-50/60 transition-colors">
                          {/* Sticky info cell */}
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/60 border-r border-slate-100 px-3 py-2 w-56 min-w-[224px] transition-colors">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold text-white select-none"
                                style={{ backgroundColor: TEAM_COLOR + "cc" }}>
                                {m.firstName[0]}{m.lastName1[0]}
                              </div>
                              <div className="min-w-0 flex-1">
                                <button
                                  onClick={() => setDetailId(m.id)}
                                  className="text-sm font-medium text-slate-900 truncate leading-tight hover:text-slate-600 transition-colors text-left w-full">
                                  {m.firstName} {m.lastName1}
                                </button>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  {m.role && <span className="text-xs text-slate-400 truncate max-w-[60px]" title={m.role}>{m.role}</span>}
                                  {ds > 0 && <span className="text-xs text-slate-600 font-medium whitespace-nowrap">{fmt(ds)}/d</span>}
                                  <span className={`text-xs font-semibold ${regime.color}`}>{regime.label}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => openRangeFill(m.id)}
                                title="Relleno rápido por rango"
                                className="flex-shrink-0 p-1 rounded-md text-slate-300 hover:text-amber-500 hover:bg-amber-50 transition-colors opacity-0 group-hover:opacity-100">
                                <Zap size={12} />
                              </button>
                            </div>
                          </td>

                          {/* Day cells */}
                          {days.map(d => {
                            const w        = isWknd(year, month, d);
                            const ds2      = dots(m.id, d);
                            const isM      = dow(year, month, d) === 0;
                            const hasData  = ds2.length > 0;
                            const outside  = dayOutsidePeriod(d);
                            const worked   = isWorked(m, d);
                            const prevWork = d > 1 && isWorked(m, d - 1);
                            const nextWork = d < numDays && isWorked(m, d + 1);
                            return (
                              <td key={d}
                                title={`${m.firstName} ${m.lastName1} · ${d} ${MONTH_NAMES[month]}${worked ? " · día trabajado" : ""}${outside ? " (fuera de período)" : ""}`}
                                className={`w-9 min-w-[36px] text-center align-top transition-colors
                                  ${isM && d > 1 ? "border-l border-slate-200" : ""}
                                  ${w && !outside ? "bg-slate-50" : ""}
                                `}
                                style={outside ? { backgroundColor: "#fef9c320" } : {}}>
                                {/* Worked-day bar */}
                                <div
                                  onClick={() => toggleWorked(m, d)}
                                  className="h-[5px] cursor-pointer transition-colors"
                                  style={{
                                    backgroundColor: worked ? TEAM_COLOR : "transparent",
                                    marginLeft:  prevWork ? 0 : 2,
                                    marginRight: nextWork ? 0 : 2,
                                    borderRadius: `${prevWork ? 0 : 3}px ${nextWork ? 0 : 3}px ${nextWork ? 0 : 3}px ${prevWork ? 0 : 3}px`,
                                    opacity: outside ? 0.4 : 1,
                                  }}
                                />
                                {/* Complement dots */}
                                <div
                                  onClick={() => openEdit(m.id, d)}
                                  className="flex flex-wrap justify-center gap-[3px] py-2 px-1 cursor-pointer hover:bg-[#6BA31918] transition-colors">
                                  {hasData ? ds2.slice(0, 6).map((c, i) => (
                                    <div key={i} className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                                      style={{ backgroundColor: c, opacity: outside ? 0.5 : 1 }} />
                                  )) : <div className="w-[7px] h-[7px]" />}
                                </div>
                              </td>
                            );
                          })}

                          {/* Month total */}
                          <td className="min-w-[110px] text-right px-4 py-2 border-l border-slate-100">
                            {salTotal > 0 && (
                              <div className="text-[10px] text-slate-400 leading-tight">
                                <span>Sal. </span><span className="font-medium text-slate-500">{fmt(salTotal)}</span>
                              </div>
                            )}
                            {allowTotal > 0 && (
                              <div className="text-[10px] text-slate-400 leading-tight">
                                <span>Comp. </span><span className="font-medium text-slate-500">{fmt(allowTotal)}</span>
                              </div>
                            )}
                            <div className={`text-sm font-semibold mt-0.5 ${grandTotal > 0 ? "text-slate-900" : "text-slate-200"}`}>
                              {grandTotal > 0 ? fmt(grandTotal) : "—"}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}

                {/* Grand total row */}
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-4 py-3">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Total mes</p>
                  </td>
                  {days.map(d => {
                    const comp = filtered.reduce((s, m) => s + cellTotal(m.id, d), 0);
                    const sal  = filtered.reduce((s, m) => s + (isWorked(m, d) ? dailySalary(m) : 0), 0);
                    const t    = comp + sal;
                    return (
                      <td key={d} className={`min-w-[36px] text-center py-2.5 ${dow(year,month,d)===0&&d>1?"border-l border-slate-200":""}`}>
                        {t > 0 && (
                          <span className="font-bold text-slate-600" style={{ fontSize: "9px" }}>
                            {Math.round(t)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="min-w-[110px] text-right px-4 py-3 border-l border-slate-200">
                    <div className="text-[10px] text-slate-400">
                      Sal. <span className="font-medium text-slate-500">
                        {fmt(filtered.reduce((s,m) => s + memberSalaryTotal(m), 0))}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Comp. <span className="font-medium text-slate-500">
                        {fmt(filtered.reduce((s,m) => s + memberMonthAllowances(m.id), 0))}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-slate-900">{fmt(grandTotal)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Summary view ──────────────────────────────────────────────────────────────

  function SummaryView() {
    if (filtered.length === 0) {
      return (
        <div className="px-24 py-24 text-center">
          <Users size={40} className="text-slate-200 mx-auto mb-4" />
          <p className="text-slate-500">No hay miembros de crew{filterSection !== "all" ? " en esta sección" : ""}</p>
        </div>
      );
    }

    return (
      <div className="px-24 pb-16">
        <div className="grid grid-cols-3 gap-4">
          {filtered.map(m => {
            const ds      = dailySalary(m);
            const wd      = workingDays(m.id);
            const allw    = memberMonthAllowances(m.id);
            const sal     = memberSalaryTotal(m);
            const bruto   = allw + sal;
            const regime  = regimeBadge(m.regime || m.ssRegime);

            const breakdown = ALLOWANCES.map(a => ({
              ...a,
              total: days.reduce((s, d) => {
                const e = getEntry(m.id, d);
                return s + (e[a.key] ? ((e[a.overrideKey] as number|undefined) ?? cfg[a.rateKey]) : 0);
              }, 0),
              days: days.filter(d => getEntry(m.id, d)[a.key] as boolean).length,
            })).filter(a => a.total > 0);

            const otherTotal = days.reduce((s, d) => {
              const e = getEntry(m.id, d);
              return s + (e.other ? (e.otherAmount || 0) : 0);
            }, 0);

            return (
              <div key={m.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold text-white select-none"
                    style={{ backgroundColor: TEAM_COLOR + "cc" }}>
                    {m.firstName[0]}{m.lastName1[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{m.firstName} {m.lastName1}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {m.role && <span className="text-xs text-slate-400 truncate">{m.role}</span>}
                      <span className={`text-xs font-semibold ${regime.color}`}>{regime.label}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">{wd} días</p>
                    <p className="text-sm font-bold text-slate-900">{fmt(bruto)}</p>
                  </div>
                </div>

                <div className="p-5 space-y-1.5">
                  {/* Salary */}
                  {ds > 0 && (
                    <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <Banknote size={13} className="text-slate-400" />
                        <span className="text-xs text-slate-600">Salario ({wd} días × {fmt(ds)})</span>
                      </div>
                      <span className="text-xs font-semibold text-slate-900">{fmt(sal)}</span>
                    </div>
                  )}

                  {/* Allowances */}
                  {breakdown.map(a => {
                    const Icon = a.Icon;
                    return (
                      <div key={a.key} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2">
                          <Icon size={13} style={{ color: a.dot }} />
                          <span className="text-xs text-slate-600">{a.label} · {a.days} día{a.days!==1?"s":""}</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-900">{fmt(a.total)}</span>
                      </div>
                    );
                  })}
                  {otherTotal > 0 && (
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <Plus size={13} className="text-slate-400" />
                        <span className="text-xs text-slate-600">Otros</span>
                      </div>
                      <span className="text-xs font-semibold text-slate-900">{fmt(otherTotal)}</span>
                    </div>
                  )}

                  {/* Totals */}
                  <div className="pt-2 border-t-2 border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900">Total bruto</span>
                      <span className="text-sm font-bold text-slate-900">{fmt(bruto)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Grand total */}
        {filtered.length > 0 && (
          <div className="mt-6 bg-slate-900 rounded-2xl px-8 py-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Total nómina · {MONTH_NAMES[month]} {year}</p>
              <p className="text-xs text-slate-500 mt-0.5">{filtered.length} personas · {
                filtered.reduce((s, m) => s + workingDays(m.id), 0)
              } días con dietas</p>
            </div>
            <p className="text-2xl font-bold text-white">{fmt(grandTotal)}</p>
          </div>
        )}
      </div>
    );
  }
}
