// ─── Nóminas: modelo y cálculo ───────────────────────────────────────────────
// Tres piezas separadas:
//  1. Lo que pasó cada día (payrollDays/{YYYY-MM}): marcas por persona y fecha.
//  2. Lo puntual del mes (payrollRuns/{YYYY-MM}.people[id].amounts).
//  3. La nómina del mes: ventanas de fechas por grupo de conceptos. El corte no
//     se rellena, se calcula: cada nómina empieza el día siguiente al final de
//     la anterior, así que ningún día se paga dos veces ni se pierde.
// Los cálculos replican las fórmulas de la plantilla del cuadro de nóminas.

export type Periodicity = "Mensual" | "Semanal" | "Diario" | "Cerrado";
export const PERIODICITIES: Periodicity[] = ["Mensual", "Semanal", "Diario", "Cerrado"];

export const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Departamentos de la plantilla con su nombre en inglés (columna Department). */
export const DEPARTMENTS_EN: Record<string, string> = {
  Producción: "Production", Dirección: "Direction", Guion: "Script", Fotografía: "Camera & Photography", Eléctricos: "Electric",
  Maquinistas: "Grip", Sonido: "Sound", Arte: "Art", Vestuario: "Costume", "Maquillaje y peluquería": "Make-up & Hair",
  Localizaciones: "Locations", Montaje: "Editing", Postproducción: "Post-production", "Efectos especiales": "Special effects",
  Casting: "Casting", Reparto: "Cast", Figuración: "Background", Especialistas: "Stunts", Transporte: "Transport",
  Catering: "Catering", Administración: "Accounting", Comunicación: "Marketing & PR", Música: "Music", Otros: "Other",
};

// ─── Grupos y columnas de la plantilla ──────────────────────────────────────

export type GroupId = "dietas" | "medios" | "pluses" | "complementos" | "especie" | "proyecto" | "it" | "descuentos";

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "dietas", label: "Gastos y dietas" },
  { id: "medios", label: "Medios y material" },
  { id: "pluses", label: "Pluses de jornada" },
  { id: "complementos", label: "Complementos y variables" },
  { id: "especie", label: "Retribución en especie" },
  { id: "proyecto", label: "Conceptos del proyecto" },
  { id: "it", label: "Baja IT" },
  { id: "descuentos", label: "Anticipos y descuentos" },
];

/** Columnas de importe de la plantilla, en orden, con su código. */
export interface AmountColumn { col: string; code: number; label: string; group: GroupId }

export const AMOUNT_COLUMNS: AmountColumn[] = [
  { col: "Z", code: 208, label: "Dietas no exentas", group: "dietas" },
  { col: "AA", code: 602, label: "Dietas exentas", group: "dietas" },
  { col: "AB", code: 217, label: "Comida", group: "dietas" },
  { col: "AC", code: 220, label: "Alojamiento", group: "dietas" },
  { col: "AD", code: 603, label: "Suplidos exentos", group: "dietas" },
  { col: "AE", code: 218, label: "Viaje", group: "dietas" },
  { col: "AF", code: 202, label: "Km sujetos", group: "dietas" },
  { col: "AG", code: 698, label: "Km exentos", group: "dietas" },
  { col: "AH", code: 207, label: "Material", group: "medios" },
  { col: "AI", code: 216, label: "Ordenador", group: "medios" },
  { col: "AJ", code: 219, label: "Teléfono", group: "medios" },
  { col: "AK", code: 206, label: "Coche", group: "medios" },
  { col: "AL", code: 398, label: "Plus transporte", group: "medios" },
  { col: "AM", code: 20, label: "Plus desplazamiento", group: "medios" },
  { col: "AN", code: 436, label: "Horas extras", group: "pluses" },
  { col: "AO", code: 212, label: "Plus compensación", group: "pluses" },
  { col: "AP", code: 12, label: "Plus festivos", group: "pluses" },
  { col: "AQ", code: 137, label: "Comp. fin de semana", group: "pluses" },
  { col: "AR", code: 214, label: "6D", group: "pluses" },
  { col: "AS", code: 215, label: "7D", group: "pluses" },
  { col: "AT", code: 213, label: "Día extra", group: "pluses" },
  { col: "AU", code: 240, label: "Ensayo", group: "pluses" },
  { col: "AV", code: 256, label: "Comp. jornada especial EXT", group: "pluses" },
  { col: "AW", code: 60, label: "Complemento por categoría", group: "complementos" },
  { col: "AX", code: 59, label: "Complemento personal", group: "complementos" },
  { col: "AY", code: 3, label: "Mejora voluntaria", group: "complementos" },
  { col: "AZ", code: 270, label: "Variable 1", group: "complementos" },
  { col: "BA", code: 271, label: "Variable 2", group: "complementos" },
  { col: "BB", code: 272, label: "Variable 3", group: "complementos" },
  { col: "BC", code: 209, label: "Cesión de derechos", group: "complementos" },
  { col: "BD", code: 241, label: "Ayuda de estudio", group: "complementos" },
  { col: "BE", code: 243, label: "Ticket restaurante no exento", group: "especie" },
  { col: "BF", code: 269, label: "Ticket restaurante exento", group: "especie" },
  { col: "BG", code: 261, label: "Ticket transporte exento", group: "especie" },
  { col: "BH", code: 226, label: "Cheque guardería", group: "especie" },
  { col: "BI", code: 262, label: "Retribución flexible formación", group: "especie" },
  { col: "BJ", code: 31, label: "Seguro médico exento", group: "especie" },
  { col: "BR", code: 455, label: "Complemento IT", group: "it" },
  { col: "BU", code: 722, label: "Ant. dietas", group: "descuentos" },
  { col: "BV", code: 720, label: "Ant. comida", group: "descuentos" },
  { col: "BW", code: 707, label: "Anticipo coche", group: "descuentos" },
  { col: "BX", code: 727, label: "Ant. alojamiento", group: "descuentos" },
  { col: "BY", code: 723, label: "Anticipo", group: "descuentos" },
  { col: "BZ", code: 725, label: "Falta preaviso trabajador", group: "descuentos" },
  { col: "CA", code: 733, label: "Devolución préstamo", group: "descuentos" },
];

/** Huecos libres de la plantilla para conceptos y descuentos propios del proyecto. */
export const PROJECT_CONCEPT_COLS = ["BK", "BL", "BM", "BN", "BO", "BP"];
export const PROJECT_DISCOUNT_COLS = ["CB", "CC"];

export interface ProjectConcept { code: number | null; label: string }

/** Columna "virtual" de un concepto del proyecto (p1..p6) o descuento (d1, d2). */
export const projectKey = (kind: "p" | "d", i: number) => `${kind}${i + 1}`;

/** Clave de importe de una columna: el código como texto, o p1..p6 / d1..d2. */
export type AmountKey = string;

// ─── Marcas diarias ─────────────────────────────────────────────────────────

export type DailyUnit = "day" | "km" | "hour";

export interface DailyItem {
  id: string;
  label: string;
  short: string;          // etiqueta corta para la rejilla
  unit: DailyUnit;
  /** Columna del cuadro donde suma (código de la plantilla). */
  code: number;
  rate: number;
  /** Tarifa para régimen de artistas, si es distinta. */
  rateArtistic?: number;
  active: boolean;
}

export const DEFAULT_DAILY_ITEMS: DailyItem[] = [
  { id: "comida", label: "Comida", short: "C", unit: "day", code: 217, rate: 15, active: true },
  { id: "mediaDieta", label: "Media dieta", short: "½D", unit: "day", code: 602, rate: 18.5, active: true },
  { id: "dieta", label: "Dieta", short: "D", unit: "day", code: 602, rate: 37, active: true },
  { id: "mediaDietaInt", label: "Media dieta internacional", short: "½DI", unit: "day", code: 602, rate: 47.5, active: false },
  { id: "dietaInt", label: "Dieta internacional", short: "DI", unit: "day", code: 602, rate: 95, active: false },
  { id: "alojamiento", label: "Alojamiento", short: "A", unit: "day", code: 220, rate: 80, active: true },
  { id: "km", label: "Kilómetros", short: "Km", unit: "km", code: 698, rate: 0.26, active: true },
  { id: "coche", label: "Coche", short: "Co", unit: "day", code: 206, rate: 40, active: false },
  { id: "horasExtra", label: "Horas extra", short: "HE", unit: "hour", code: 436, rate: 0, active: true },
  { id: "6d", label: "6D", short: "6D", unit: "day", code: 214, rate: 0, active: true },
  { id: "7d", label: "7D", short: "7D", unit: "day", code: 215, rate: 0, active: true },
  { id: "festivo", label: "Festivo trabajado", short: "FT", unit: "day", code: 12, rate: 0, active: true },
  { id: "diaExtra", label: "Día extra", short: "DE", unit: "day", code: 213, rate: 0, active: false },
  { id: "ensayo", label: "Ensayo", short: "En", unit: "day", code: 240, rate: 0, active: false },
  { id: "desplazamiento", label: "Plus desplazamiento", short: "PD", unit: "day", code: 20, rate: 0, active: false },
];

/** Estado del día de la persona (no es un importe). */
export type DayState = "w" | "fnt" | "comp" | "it";
/** Marcas que son estados del día (no importes). */
export const STATE_IDS = new Set<string>(["w", "fnt", "comp", "it"]);
export const DAY_STATES: { id: DayState; label: string; short: string }[] = [
  { id: "w", label: "Trabajado", short: "T" },
  { id: "fnt", label: "Festivo no trabajado", short: "FN" },
  { id: "comp", label: "Compensación sin cobro", short: "Cp" },
  { id: "it", label: "Baja IT", short: "IT" },
];

/** Una celda del registro diario: marcas por id → cantidad (1 = el día entero). */
export type DayCell = Record<string, number> & { _r?: never };
/** entries[memberId][dd] = DayCell */
export type MonthDays = Record<string, Record<string, Record<string, number>>>;

// ─── Cortes ─────────────────────────────────────────────────────────────────

/** Grupos con cortes propios: los que se apuntan por días. "dias" son los días trabajados, de compensación y de IT. */
export type CutGroup = "dias" | "dietas" | "medios" | "pluses";
export const CUT_GROUPS: { id: CutGroup; label: string }[] = [
  { id: "dias", label: "Días trabajados, compensación e IT" },
  { id: "dietas", label: "Gastos y dietas" },
  { id: "medios", label: "Medios y material" },
  { id: "pluses", label: "Pluses de jornada" },
];

export interface Cutoff { mode: "natural" | "day"; day: number }

export const groupOfCode = (code: number): GroupId => AMOUNT_COLUMNS.find((c) => c.code === code)?.group || "complementos";
export const cutGroupOfItem = (it: DailyItem): CutGroup => {
  const g = groupOfCode(it.code);
  return g === "dietas" || g === "medios" || g === "pluses" ? g : "pluses";
};

// ─── Configuración ──────────────────────────────────────────────────────────

export interface PayrollSettings {
  company: string;
  baseMonth: number;   // 30
  baseWeek: number;    // 7
  cutoffs: Record<CutGroup, Cutoff>;
  items: DailyItem[];
  projectConcepts: ProjectConcept[];  // 6
  projectDiscounts: ProjectConcept[]; // 2
  /** Columnas que el proyecto usa (código como texto). Vacío = todas. */
  hiddenColumns: string[];
}

export const DEFAULT_SETTINGS: PayrollSettings = {
  company: "",
  baseMonth: 30,
  baseWeek: 7,
  cutoffs: { dias: { mode: "natural", day: 20 }, dietas: { mode: "day", day: 20 }, medios: { mode: "day", day: 20 }, pluses: { mode: "natural", day: 20 } },
  items: DEFAULT_DAILY_ITEMS,
  projectConcepts: Array.from({ length: 6 }, () => ({ code: null, label: "" })),
  projectDiscounts: Array.from({ length: 2 }, () => ({ code: null, label: "" })),
  hiddenColumns: [],
};

/** Lee la configuración guardada (y las tarifas antiguas, si las hay). */
export function readSettings(raw: any): PayrollSettings {
  const r = raw || {};
  const legacy: Record<string, [string, string?]> = {
    comida: ["mealRate"], mediaDieta: ["halfPerDiemRate", "halfPerDiemRateArtistic"], dieta: ["perDiemRate", "perDiemRateArtistic"],
    mediaDietaInt: ["halfIntlPerDiemRate", "halfIntlPerDiemRateArtistic"], dietaInt: ["intlPerDiemRate", "intlPerDiemRateArtistic"],
    alojamiento: ["accommodationRate"], coche: ["carRate"],
  };
  const saved: DailyItem[] = Array.isArray(r.items) ? r.items : [];
  const items = DEFAULT_DAILY_ITEMS.map((d) => {
    const s = saved.find((x) => x.id === d.id);
    if (s && d.id === "festivo" && s.label === "Festivo") return { ...d, ...s, label: d.label, short: s.short === "F" ? d.short : s.short };
    if (s) return { ...d, ...s };
    const l = legacy[d.id];
    if (l && typeof r[l[0]] === "number") {
      const art = l[1] && typeof r[l[1]] === "number" && r[l[1]] !== r[l[0]] ? r[l[1]] : undefined;
      return { ...d, rate: r[l[0]], rateArtistic: art, active: d.active || d.id === "coche" || d.id === "dietaInt" || d.id === "mediaDietaInt" };
    }
    return d;
  });
  for (const s of saved) if (!items.some((i) => i.id === s.id)) items.push(s);
  const pad = (a: any, n: number) => Array.from({ length: n }, (_, i) => ({ code: a?.[i]?.code ?? null, label: a?.[i]?.label || "" }));
  return {
    company: r.company || "",
    baseMonth: Number(r.baseMonth) || 30,
    baseWeek: Number(r.baseWeek) || 7,
    cutoffs: { ...DEFAULT_SETTINGS.cutoffs, ...(r.cutoffs || {}) },
    items,
    projectConcepts: pad(r.projectConcepts, 6),
    projectDiscounts: pad(r.projectDiscounts, 2),
    hiddenColumns: Array.isArray(r.hiddenColumns) ? r.hiddenColumns : [],
  };
}

// ─── Fechas (ISO yyyy-mm-dd, sin horas) ─────────────────────────────────────

export const iso = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const parseIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m0: m - 1, d }; };
export const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
export const addDays = (s: string, n: number) => { const { y, m0, d } = parseIso(s); const t = new Date(Date.UTC(y, m0, d + n)); return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); };
export const dayDiff = (a: string, b: string) => { const p = parseIso(a), q = parseIso(b); return Math.round((Date.UTC(q.y, q.m0, q.d) - Date.UTC(p.y, p.m0, p.d)) / 86400000); };
export const monthKeyOf = (s: string) => s.slice(0, 7);
export const runKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;
export const parseRunKey = (k: string) => { const [y, m] = k.split("-").map(Number); return { y, m0: m - 1 }; };
export const prevRunKey = (k: string) => { const { y, m0 } = parseRunKey(k); return m0 === 0 ? runKey(y - 1, 11) : runKey(y, m0 - 1); };
export const nextRunKey = (k: string) => { const { y, m0 } = parseRunKey(k); return m0 === 11 ? runKey(y + 1, 0) : runKey(y, m0 + 1); };
export const monthStart = (k: string) => `${k}-01`;
export const monthEnd = (k: string) => { const { y, m0 } = parseRunKey(k); return iso(y, m0, daysIn(y, m0)); };
/** Normaliza una fecha guardada en cualquier formato a ISO, o "". */
export function toIso(v: any): string {
  if (!v) return "";
  if (typeof v === "string") { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const d = new Date(v); return isNaN(+d) ? "" : iso(d.getFullYear(), d.getMonth(), d.getDate()); }
  const d: Date = v?.toDate ? v.toDate() : v instanceof Date ? v : new Date(v);
  return isNaN(+d) ? "" : iso(d.getFullYear(), d.getMonth(), d.getDate());
}
export const fmtDay = (s: string) => { if (!s) return ""; const { m0, d } = parseIso(s); return `${d} ${MONTHS_ES[m0].slice(0, 3).toLowerCase()}`; };

// ─── Nóminas (runs) y ventanas ──────────────────────────────────────────────

export interface Window { from: string; to: string }

export interface PersonRun {
  /** Fin de variables propio (p. ej. liquidar hasta su baja). */
  to?: string;
  amounts?: Record<AmountKey, number>;
  salaryOverride?: number | null;
  workedOverride?: number | null;
  compOverride?: number | null;
  itOverride?: number | null;
  breakdown?: string;
  comment?: string;
  excluded?: boolean;
}

export type RunStatus = "draft" | "sent" | "revised";

export interface PayrollRun {
  key: string;
  status: RunStatus;
  sentAt?: string;
  revisedAt?: string;
  notes?: string;
  /** Ventanas personalizadas por grupo (si no, se calculan). */
  windows?: Partial<Record<CutGroup, Partial<Window>>>;
  people?: Record<string, PersonRun>;
}

export function defaultWindow(key: string, c: Cutoff): Window {
  if (c.mode === "natural") return { from: monthStart(key), to: monthEnd(key) };
  const { y, m0 } = parseRunKey(key);
  const p = parseRunKey(prevRunKey(key));
  const day = Math.max(1, Math.min(28, Math.round(c.day || 20)));
  const to = iso(y, m0, Math.min(day, daysIn(y, m0)));
  const pTo = iso(p.y, p.m0, Math.min(day, daysIn(p.y, p.m0)));
  return { from: addDays(pTo, 1), to };
}

/**
 * Ventana efectiva de un grupo en una nómina. Empieza el día siguiente al final
 * de la nómina anterior (si existe), aunque esa terminara a mano.
 */
export function windowFor(key: string, g: CutGroup, runs: Record<string, PayrollRun>, s: PayrollSettings, depth = 0): Window {
  const def = defaultWindow(key, s.cutoffs[g]);
  const own = runs[key]?.windows?.[g] || {};
  let from = own.from || def.from;
  if (!own.from && depth < 24) {
    const prev = prevRunKey(key);
    if (runs[prev]) from = addDays(windowFor(prev, g, runs, s, depth + 1).to, 1);
  }
  const to = own.to || def.to;
  return { from, to };
}

/** Ventana de una persona: la del grupo, recortada por su fin propio y por lo ya liquidado antes. */
export function personWindow(key: string, g: CutGroup, memberId: string, runs: Record<string, PayrollRun>, s: PayrollSettings): Window {
  const w = windowFor(key, g, runs, s);
  if (g === "dias") return w; // los días trabajados siguen el mes de la nómina
  let { from, to } = w;
  const prevTo = runs[prevRunKey(key)]?.people?.[memberId]?.to;
  if (prevTo && dayDiff(from, addDays(prevTo, 1)) > 0) from = addDays(prevTo, 1);
  const own = runs[key]?.people?.[memberId]?.to;
  if (own) to = own;
  return { from, to };
}

/** Avisos de huecos y solapes entre esta nómina y la anterior. */
export function windowWarnings(key: string, runs: Record<string, PayrollRun>, s: PayrollSettings): string[] {
  const out: string[] = [];
  const prev = prevRunKey(key);
  if (!runs[prev]) return out;
  for (const g of CUT_GROUPS) {
    const a = windowFor(prev, g.id, runs, s), b = windowFor(key, g.id, runs, s);
    const gap = dayDiff(a.to, b.from) - 1;
    if (gap > 0) out.push(`${g.label}: ${gap} ${gap === 1 ? "día queda" : "días quedan"} sin liquidar (${fmtDay(addDays(a.to, 1))} a ${fmtDay(addDays(b.from, -1))})`);
    if (gap < 0) out.push(`${g.label}: ${-gap} ${gap === -1 ? "día se liquida" : "días se liquidan"} dos veces`);
    if (dayDiff(b.from, b.to) < 0) out.push(`${g.label}: la ventana termina antes de empezar`);
  }
  return out;
}

// ─── Personas ───────────────────────────────────────────────────────────────

export interface PayrollPerson {
  id: string;
  firstName: string;
  lastNames: string;
  dni: string;
  department: string;
  role: string;
  iban: string;
  startDate: string;        // alta en SS
  endDateApprox: string;    // baja estimada
  irpf: number | null;
  salary: number | null;
  periodicity: Periodicity | "";
  artistic: boolean;
  section: string;
  crewNumber: string;
  // Datos solo de nómina (payrollPeople)
  controlCode: string;
  budgetAccount: string;
  jobTitle: string;
  periodId: string;
  ssEndDate: string;        // baja definitiva
  agreedHours: number | null;
  embargo: boolean;
  fixed: Record<AmountKey, number>;
  rates: Record<string, number>;
}

export function personFromDocs(id: string, c: any, p: any): PayrollPerson {
  c = c || {}; p = p || {};
  const st = c.salaryType;
  const crewPer: Periodicity | "" = st === "weekly" ? "Semanal" : st === "daily" ? "Diario" : st === "closed" ? "Cerrado" : st === "monthly" ? "Mensual" : c.salaryPerSession ? "Diario" : "";
  const salary = p.salary ?? c.salaryAmount ?? c.grossSalary ?? c.salaryPerSession ?? null;
  const reg = String(c.regime || c.ssRegime || "").toLowerCase();
  return {
    id,
    firstName: c.firstName || "",
    lastNames: [c.lastName1, c.lastName2].filter(Boolean).join(" "),
    dni: c.dni || "",
    department: (c.department || "").trim(),
    role: c.role || "",
    iban: (c.bankAccount || c.iban || "").toString(),
    startDate: toIso(p.startDate || c.startDate),
    endDateApprox: toIso(c.endDateApprox),
    irpf: typeof c.irpfRate === "number" ? c.irpfRate : c.irpfRate ? Number(c.irpfRate) : null,
    salary: typeof salary === "number" ? salary : salary ? Number(salary) : null,
    periodicity: (p.periodicity as Periodicity) || crewPer,
    artistic: reg.includes("artista") || c.section === "cast",
    section: c.section || "technical",
    crewNumber: c.crewNumber || "",
    controlCode: p.controlCode || "",
    budgetAccount: p.budgetAccount || "",
    jobTitle: p.jobTitle || "",
    periodId: p.periodId || "",
    ssEndDate: toIso(p.ssEndDate),
    agreedHours: typeof p.agreedHours === "number" ? p.agreedHours : null,
    embargo: !!p.embargo,
    fixed: p.fixed || {},
    rates: p.rates || {},
  };
}

export const fullName = (p: { firstName: string; lastNames: string }) => [p.firstName, p.lastNames].filter(Boolean).join(" ");

/** Fecha en que termina el alta de la persona (definitiva, estimada o nada). */
export const personEnd = (p: PayrollPerson) => p.ssEndDate || p.endDateApprox || "";

/** ¿La persona tiene alta en algún día del mes? */
export function activeInMonth(p: PayrollPerson, key: string): boolean {
  if (!p.startDate) return true; // sin fechas: que aparezca y salte la incidencia
  const end = personEnd(p);
  return p.startDate <= monthEnd(key) && (!end || end >= monthStart(key));
}

// ─── Cálculo ────────────────────────────────────────────────────────────────

export interface Line {
  person: PayrollPerson;
  daysAlta: number | null;
  worked: number;
  /** Festivos no trabajados incluidos en worked. */
  holidaysOff: number;
  comp: number;
  itDays: number;
  salaryDay: number | null;
  /** Salario pactado usado (el de la ficha o el ajustado este mes). */
  salaryUsed: number | null;
  gross: number | null;
  breakdown: string;
  comment: string;
  /** Importe por columna (código como texto, o p1..p6 / d1..d2). */
  amounts: Record<AmountKey, number>;
  /** De dónde sale cada importe calculado desde los días. */
  sources: Record<AmountKey, { item: string; qty: number; rate: number }[]>;
  inKind: number;          // anticipo salario en especie (automático)
  totalGross: number;
  totalDiscounts: number;
  windows: Record<CutGroup, Window>;
  issues: string[];
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Recorre los días de una ventana sobre el registro diario (por mes natural). */
export function eachDay(w: Window, days: Record<string, MonthDays>, memberId: string, fn: (date: string, cell: Record<string, number>) => void) {
  if (!w.from || !w.to || w.from > w.to) return;
  let d = w.from;
  for (let i = 0; i < 400 && d <= w.to; i++) {
    const cell = days[monthKeyOf(d)]?.[memberId]?.[d.slice(8, 10)];
    if (cell) fn(d, cell);
    d = addDays(d, 1);
  }
}

export function itemRate(it: DailyItem, p: PayrollPerson): number {
  if (typeof p.rates[it.id] === "number") return p.rates[it.id];
  if (p.artistic && typeof it.rateArtistic === "number") return it.rateArtistic;
  return it.rate || 0;
}

export function computeLine(key: string, p: PayrollPerson, runs: Record<string, PayrollRun>, days: Record<string, MonthDays>, s: PayrollSettings): Line {
  const pr = runs[key]?.people?.[p.id] || {};
  const windows = Object.fromEntries(CUT_GROUPS.map((g) => [g.id, personWindow(key, g.id, p.id, runs, s)])) as Record<CutGroup, Window>;
  const start = monthStart(key), end = monthEnd(key);

  // Días de alta en el mes (X): de max(inicio de mes, alta) a min(fin de mes, baja).
  let daysAlta: number | null = null;
  if (p.startDate) {
    const last = personEnd(p) && personEnd(p) < end ? personEnd(p) : end;
    const first = p.startDate > start ? p.startDate : start;
    daysAlta = Math.max(0, dayDiff(first, last) + 1);
  }

  // Días trabajados, compensación e IT, en su ventana
  let worked = 0, comp = 0, itDays = 0;
  // Un festivo no trabajado se cobra como día (cuenta en los días trabajados), sin plus.
  let holidaysOff = 0;
  eachDay(windows.dias, days, p.id, (_d, c) => { if (c.w) worked += 1; else if (c.fnt) holidaysOff += 1; if (c.comp) comp += 1; if (c.it) itDays += 1; });
  worked += holidaysOff;
  if (typeof pr.workedOverride === "number") worked = pr.workedOverride;
  if (typeof pr.compOverride === "number") comp = pr.compOverride;
  if (typeof pr.itOverride === "number") itDays = pr.itOverride;

  const S = typeof pr.salaryOverride === "number" ? pr.salaryOverride : p.salary;
  const T = p.periodicity;
  let salaryDay: number | null = null, gross: number | null = null;
  if (S != null && T) {
    salaryDay = T === "Mensual" ? S / s.baseMonth : T === "Semanal" ? S / s.baseWeek : T === "Diario" ? S : null;
    if (T === "Mensual") gross = r2((S / s.baseMonth) * Math.max(0, Math.min(s.baseMonth, (daysAlta || 0) - comp)));
    else if (T === "Cerrado") gross = r2(S);
    else gross = r2((salaryDay || 0) * worked);
  }

  // Importes: días × tarifa + fijos de la persona + puntuales del mes
  const amounts: Record<string, number> = {};
  const sources: Record<string, { item: string; qty: number; rate: number }[]> = {};
  const add = (k: string, v: number) => { if (v) amounts[k] = r2((amounts[k] || 0) + v); };
  for (const it of s.items) {
    let qty = 0;
    eachDay(windows[cutGroupOfItem(it)], days, p.id, (_d, c) => { qty += Number(c[it.id]) || 0; });
    if (!qty) continue;
    const rate = itemRate(it, p);
    const k = String(it.code);
    add(k, qty * rate);
    (sources[k] ||= []).push({ item: it.label, qty, rate });
  }
  for (const [k, v] of Object.entries(p.fixed || {})) add(k, Number(v) || 0);
  for (const [k, v] of Object.entries(pr.amounts || {})) add(k, Number(v) || 0);

  const especie = AMOUNT_COLUMNS.filter((c) => c.group === "especie").reduce((a, c) => a + (amounts[String(c.code)] || 0), 0);
  const earnings = AMOUNT_COLUMNS.filter((c) => c.group !== "descuentos").reduce((a, c) => a + (amounts[String(c.code)] || 0), 0)
    + s.projectConcepts.reduce((a, _c, i) => a + (amounts[projectKey("p", i)] || 0), 0);
  const totalGross = r2((gross || 0) + earnings);
  const discounts = AMOUNT_COLUMNS.filter((c) => c.group === "descuentos").reduce((a, c) => a + (amounts[String(c.code)] || 0), 0)
    + s.projectDiscounts.reduce((a, _c, i) => a + (amounts[projectKey("d", i)] || 0), 0);
  const totalDiscounts = r2(especie + discounts);

  const line: Line = { person: p, daysAlta, worked, holidaysOff, comp, itDays, salaryDay, salaryUsed: S ?? null, gross, breakdown: pr.breakdown || "", comment: pr.comment || "", amounts, sources, inKind: r2(especie), totalGross, totalDiscounts, windows, issues: [], warnings: [] };
  return line;
}

// ─── Incidencias ────────────────────────────────────────────────────────────

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith("ES") && s.length !== 24) return false;
  const re = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

/** Rellena issues (bloquean el cuadro) y warnings (a revisar) de cada línea. */
export function checkLines(key: string, lines: Line[], days: Record<string, MonthDays>, prevLines?: Map<string, Line>, settings?: PayrollSettings) {
  const dnis = new Map<string, number>();
  for (const l of lines) if (l.person.dni) dnis.set(l.person.dni.toUpperCase(), (dnis.get(l.person.dni.toUpperCase()) || 0) + 1);
  const end = monthEnd(key);
  for (const l of lines) {
    const p = l.person, I = l.issues, W = l.warnings;
    if (!p.lastNames) I.push("Falta apellidos");
    if (!p.firstName) I.push("Falta nombre");
    if (!p.dni) I.push("Falta DNI");
    if (!p.startDate) I.push("Falta alta en SS");
    if (p.irpf == null) I.push("Falta % IRPF");
    if (p.salary == null) I.push("Falta salario");
    if (!p.periodicity) I.push("Falta periodicidad");
    if (p.dni && (dnis.get(p.dni.toUpperCase()) || 0) > 1) I.push("DNI duplicado");
    if (p.iban && !ibanValid(p.iban)) I.push("IBAN no válido");
    if (!p.iban) W.push("Sin IBAN");
    if (p.startDate && p.ssEndDate && p.ssEndDate < p.startDate) I.push("Baja anterior al alta");
    if (p.startDate && p.startDate > end) I.push("Alta posterior al mes");
    if (p.periodicity && p.periodicity !== "Mensual" && p.periodicity !== "Cerrado" && !l.worked) I.push("Faltan días trabajados");
    if (p.periodicity === "Mensual" && p.startDate && l.daysAlta === 0) I.push("Sin días de alta en el mes");

    // Avisos que la plantilla no tenía. Cada día una sola vez, y cada marca
    // solo dentro de la ventana de su grupo (lo de fuera va en otra nómina).
    let mealsOff = 0, outside = 0;
    const startAlta = p.startDate, endAlta = personEnd(p);
    const seen = new Set<string>();
    const winOfKey = (k: string): Window => {
      if (STATE_IDS.has(k)) return l.windows.dias;
      const it = settings?.items.find((i) => i.id === k);
      return it ? l.windows[cutGroupOfItem(it)] : l.windows.dietas;
    };
    for (const w of Object.values(l.windows)) {
      eachDay(w, days, p.id, (d, c) => {
        if (seen.has(d)) return;
        seen.add(d);
        const keys = Object.keys(c).filter((k) => c[k] && d >= winOfKey(k).from && d <= winOfKey(k).to);
        if (!keys.length) return;
        const hasMoney = keys.some((k) => !STATE_IDS.has(k));
        if (hasMoney && !c.w && !c.it && p.periodicity !== "Mensual" && p.periodicity !== "Cerrado") mealsOff++;
        if ((startAlta && d < startAlta) || (endAlta && d > endAlta)) outside++;
      });
    }
    if (mealsOff) W.push(`${mealsOff} ${mealsOff === 1 ? "día con gastos sin marcar como trabajado" : "días con gastos sin marcar como trabajados"}`);
    if (outside) W.push(`${outside} ${outside === 1 ? "día apuntado fuera de su alta" : "días apuntados fuera de su alta"}`);
    if (endAlta && endAlta >= monthStart(key) && endAlta <= end) {
      const v = l.windows.dietas;
      if (v.to < endAlta) W.push(`Causa baja el ${fmtDay(endAlta)}: sus variables van hasta el ${fmtDay(v.to)}`);
    }
    const prev = prevLines?.get(p.id);
    if (prev && prev.totalGross > 0 && l.totalGross > 0) {
      const ch = (l.totalGross - prev.totalGross) / prev.totalGross;
      if (Math.abs(ch) >= 0.4) W.push(`Bruto ${ch > 0 ? "+" : ""}${Math.round(ch * 100)} % respecto al mes anterior`);
    }
  }
}

// ─── Migración del formato anterior (payrollMonths) ─────────────────────────

export const LEGACY_MAP: Record<string, string> = {
  meals: "comida", halfPerDiem: "mediaDieta", perDiem: "dieta", halfIntlPerDiem: "mediaDietaInt", intlPerDiem: "dietaInt", accommodation: "alojamiento", car: "coche",
};

/** Convierte entries[memberId][dd] del formato anterior al registro diario. */
export function migrateLegacyMonth(entries: Record<string, Record<string, any>>): MonthDays {
  const out: MonthDays = {};
  for (const [mid, byDay] of Object.entries(entries || {})) {
    for (const [dd, e] of Object.entries(byDay || {})) {
      const cell: Record<string, number> = {};
      for (const [k, id] of Object.entries(LEGACY_MAP)) if (e?.[k]) cell[id] = 1;
      if (e?.workedOverride === true) cell.w = 1;
      if (Object.keys(cell).length) ((out[mid] ||= {})[dd.padStart(2, "0")] = cell);
    }
  }
  return out;
}

/** Vista en el formato anterior (para el enlace público de accesos). */
export function toLegacyMonth(days: MonthDays): Record<string, Record<string, Record<string, boolean>>> {
  const out: Record<string, Record<string, Record<string, boolean>>> = {};
  for (const [mid, byDay] of Object.entries(days || {})) {
    for (const [dd, cell] of Object.entries(byDay || {})) {
      const e: Record<string, boolean> = {};
      for (const [k, id] of Object.entries(LEGACY_MAP)) if (cell?.[id]) e[k] = true;
      ((out[mid] ||= {})[dd] = e);
    }
  }
  return out;
}

/** Registro diario de un documento payrollMonths: el nuevo (days) o el anterior migrado. */
export const daysOfDoc = (data: any): MonthDays => (data?.days ? (data.days as MonthDays) : migrateLegacyMonth(data?.entries || {}));
