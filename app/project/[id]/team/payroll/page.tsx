"use client";

// ─── Equipo · Nóminas ────────────────────────────────────────────────────────
// Todo lo necesario para sacar el cuadro de nóminas del mes listo para la
// gestoría. Lo que pasa cada día se apunta en su fecha; cada nómina decide qué
// días entran con un corte por grupo de conceptos, encadenado con la anterior.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  collection, deleteField, doc, FieldPath, getDoc, getDocs, setDoc, Timestamp, updateDoc,
} from "firebase/firestore";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, MoreHorizontal, Search, Settings2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { toast } from "@/lib/toast";
import {
  Button, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, NoAccess, Page, PageHeader, PageLoading, Segmented, Select, Textarea,
} from "@/components/ds";
import {
  AMOUNT_COLUMNS, CUT_GROUPS, DAY_STATES, DEFAULT_SETTINGS, GROUPS, MONTHS_ES,
  activeInMonth, addDays, checkLines, computeLine, cutGroupOfItem, dayDiff, daysOfDoc, fmtDay, fullName, iso, monthEnd, monthStart,
  nextRunKey, parseRunKey, personFromDocs, prevRunKey, projectKey, readSettings, runKey, windowFor, windowWarnings,
  type CutGroup, type GroupId, type Line, type MonthDays, type PayrollRun, type PayrollSettings, type PersonRun, type Window,
} from "@/lib/payroll/model";
import { downloadCuadro } from "@/lib/payroll/exportXlsx";
import { DaysGrid, cellOf, type Brush, type CellChange } from "@/components/payroll/DaysGrid";
import { PersonPanel, eur, labelOf } from "@/components/payroll/PersonPanel";
import { PayrollSettingsForm } from "@/components/payroll/PayrollSettingsForm";

type View = "cuadro" | "dias" | "incidencias";
const todayIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  if (!from || !to || from > to) return out;
  let k = from.slice(0, 7);
  for (let i = 0; i < 24 && k <= to.slice(0, 7); i++) { out.push(k); k = nextRunKey(k); }
  return out;
};
const STATUS: Record<PayrollRun["status"], { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "bg-slate-100 text-slate-600" },
  sent: { label: "Enviada", cls: "bg-slate-900 text-white" },
  revised: { label: "Revisada tras el envío", cls: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" },
};

/** Columnas de un grupo en el cuadro: clave de importe y nombre. */
function columnsOf(g: GroupId, s: PayrollSettings): { key: string; label: string; code?: string }[] {
  if (g === "proyecto") return s.projectConcepts.map((c, i) => ({ key: projectKey("p", i), label: c.label || (c.code ? String(c.code) : ""), code: c.code ? String(c.code) : undefined })).filter((c) => c.label);
  const base = AMOUNT_COLUMNS.filter((c) => c.group === g && !s.hiddenColumns.includes(String(c.code))).map((c) => ({ key: String(c.code), label: c.label, code: String(c.code) }));
  if (g === "descuentos") return [...base, ...s.projectDiscounts.map((c, i) => ({ key: projectKey("d", i), label: c.label || (c.code ? String(c.code) : ""), code: c.code ? String(c.code) : undefined })).filter((c) => c.label)];
  return base;
}

export default function PayrollPage() {
  const { id } = useParams();
  const projectId = id as string;
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [deptOrder, setDeptOrder] = useState<string[]>([]);
  const [crewDocs, setCrewDocs] = useState<Record<string, any>>({});
  const [peopleDocs, setPeopleDocs] = useState<Record<string, any>>({});
  const [settings, setSettings] = useState<PayrollSettings>(DEFAULT_SETTINGS);
  const [runs, setRuns] = useState<Record<string, PayrollRun>>({});
  const [days, setDays] = useState<Record<string, MonthDays>>({});
  const runsRef = useRef(runs); runsRef.current = runs;
  const daysRef = useRef(days); daysRef.current = days;
  const hasNew = useRef<Set<string>>(new Set());
  const loaded = useRef<Set<string>>(new Set());

  const now = new Date();
  const [key, setKey] = useState(runKey(now.getFullYear(), now.getMonth()));
  const [view, setView] = useState<View>("cuadro");
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<GroupId>>(new Set(["dietas"]));
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<PayrollSettings>(DEFAULT_SETTINGS);
  const [notesOpen, setNotesOpen] = useState(false);
  const [brushId, setBrushId] = useState("w");
  const [qty, setQty] = useState(1);

  // ── Carga ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid || !projectId) return;
    (async () => {
      try {
        const [crewSnap, peopleSnap, runsSnap, cfg, proj, order] = await Promise.all([
          getDocs(collection(db, `projects/${projectId}/crew`)),
          getDocs(collection(db, `projects/${projectId}/payrollPeople`)),
          getDocs(collection(db, `projects/${projectId}/payrollRuns`)),
          getDoc(doc(db, `projects/${projectId}/teamConfig`, "payrollConfig")),
          getDoc(doc(db, "projects", projectId)),
          getDoc(doc(db, `projects/${projectId}/teamConfig`, "departmentOrder")),
        ]);
        setCrewDocs(Object.fromEntries(crewSnap.docs.map((d) => [d.id, d.data()])));
        setPeopleDocs(Object.fromEntries(peopleSnap.docs.map((d) => [d.id, d.data()])));
        setRuns(Object.fromEntries(runsSnap.docs.map((d) => [d.id, { ...(d.data() as PayrollRun), key: d.id }])));
        setSettings(readSettings(cfg.data()));
        setProjectName(proj.data()?.name || "");
        setDeptOrder(order.data()?.order || []);
      } catch (e: any) {
        if (String(e?.code || e).includes("permission")) setDenied(true); else toast.error(e);
      } finally { setLoading(false); }
    })();
  }, [user?.uid, projectId]);

  // Meses del registro diario que necesitan esta nómina y la anterior
  const neededMonths = useMemo(() => {
    const set = new Set<string>();
    for (const k of [prevRunKey(key), key]) {
      set.add(k);
      for (const g of CUT_GROUPS) { const w = windowFor(k, g.id, runs, settings); monthsBetween(w.from, w.to).forEach((m) => set.add(m)); }
      for (const pr of Object.values(runs[k]?.people || {})) if (pr.to) monthsBetween(pr.to, pr.to).forEach((m) => set.add(m));
    }
    return [...set].sort();
  }, [key, runs, settings]);

  useEffect(() => {
    if (loading || denied) return;
    const missing = neededMonths.filter((m) => !loaded.current.has(m));
    if (!missing.length) return;
    missing.forEach((m) => loaded.current.add(m));
    Promise.all(missing.map((m) => getDoc(doc(db, `projects/${projectId}/payrollMonths`, m)).then((s) => [m, s.data()] as const)))
      .then((res) => {
        setDays((d) => {
          const n = { ...d };
          for (const [m, data] of res) { n[m] = daysOfDoc(data); if (data?.days) hasNew.current.add(m); }
          return n;
        });
      })
      .catch((e) => { missing.forEach((m) => loaded.current.delete(m)); toast.error(e); });
  }, [neededMonths, loading, denied, projectId]);

  // ── Cálculo ──────────────────────────────────────────────────────────────
  const people = useMemo(() => Object.entries(crewDocs)
    .filter(([, c]) => (c.status || "active") !== "inactive")
    .map(([pid, c]) => personFromDocs(pid, c, peopleDocs[pid])), [crewDocs, peopleDocs]);

  const deptIndex = useCallback((d: string) => { const i = deptOrder.indexOf(d); return i < 0 ? 999 : i; }, [deptOrder]);

  const buildLines = useCallback((k: string) => {
    const ls = people
      .map((p) => computeLine(k, p, runs, days, settings))
      .filter((l) => !runs[k]?.people?.[l.person.id]?.excluded && (activeInMonth(l.person, k) || l.totalGross > 0 || l.totalDiscounts > 0));
    ls.sort((a, b) => deptIndex(a.person.department) - deptIndex(b.person.department) || a.person.department.localeCompare(b.person.department, "es") || a.person.lastNames.localeCompare(b.person.lastNames, "es"));
    return ls;
  }, [people, runs, days, settings, deptIndex]);

  const lines = useMemo(() => {
    const ls = buildLines(key);
    const prev = runs[prevRunKey(key)] ? new Map(buildLines(prevRunKey(key)).map((l) => [l.person.id, l])) : undefined;
    checkLines(key, ls, days, prev, settings);
    return ls;
  }, [buildLines, key, runs, days, settings]);

  const run: PayrollRun = runs[key] || { key, status: "draft" };
  const warnings = useMemo(() => windowWarnings(key, runs, settings), [key, runs, settings]);
  const depts = useMemo(() => [...new Set(lines.map((l) => l.person.department))].sort((a, b) => deptIndex(a) - deptIndex(b) || a.localeCompare(b, "es")), [lines, deptIndex]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lines.filter((l) => (!dept || l.person.department === dept) && (!t || `${fullName(l.person)} ${l.person.dni} ${l.person.role}`.toLowerCase().includes(t)));
  }, [lines, dept, q]);
  const issuesCount = lines.filter((l) => l.issues.length).length;
  const warnCount = lines.filter((l) => l.warnings.length).length;
  const totals = useMemo(() => ({
    gross: shown.reduce((a, l) => a + l.totalGross, 0),
    disc: shown.reduce((a, l) => a + l.totalDiscounts, 0),
  }), [shown]);

  // ── Escritura ────────────────────────────────────────────────────────────
  const persistRun = useCallback(async (k: string, next: PayrollRun) => {
    setRuns((r) => ({ ...r, [k]: next }));
    try {
      await setDoc(doc(db, `projects/${projectId}/payrollRuns`, k), { ...clean(next), updatedAt: Timestamp.now(), updatedBy: user?.uid || "" });
    } catch (e) { toast.error(e); }
  }, [projectId, user?.uid]);

  /** Cambia una nómina. Si ya estaba enviada, queda como revisada. */
  const editRun = useCallback((k: string, fn: (r: PayrollRun) => PayrollRun) => {
    const cur = runsRef.current[k] || { key: k, status: "draft" as const };
    let next = fn(cur);
    if (cur.status === "sent") next = { ...next, status: "revised", revisedAt: todayIso() };
    runsRef.current = { ...runsRef.current, [k]: next };
    void persistRun(k, next);
  }, [persistRun]);

  const setPersonRun = useCallback((mid: string, patch: Partial<PersonRun>) => {
    editRun(key, (r) => ({ ...r, people: { ...(r.people || {}), [mid]: { ...(r.people?.[mid] || {}), ...patch } } }));
  }, [editRun, key]);

  const commitCells = useCallback(async (changes: CellChange[]) => {
    const next = { ...daysRef.current };
    const byMonth = new Map<string, CellChange[]>();
    for (const c of changes) {
      const mk = c.date.slice(0, 7), dd = c.date.slice(8, 10);
      next[mk] = { ...(next[mk] || {}) };
      next[mk][c.memberId] = { ...(next[mk][c.memberId] || {}) };
      if (Object.keys(c.cell).length) next[mk][c.memberId][dd] = c.cell; else delete next[mk][c.memberId][dd];
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk)!.push(c);
    }
    daysRef.current = next;
    setDays(next);
    try {
      for (const [mk, cs] of byMonth) {
        const ref = doc(db, `projects/${projectId}/payrollMonths`, mk);
        if (!hasNew.current.has(mk)) {
          await setDoc(ref, { days: next[mk] || {}, updatedAt: Timestamp.now(), updatedBy: user?.uid || "" }, { mergeFields: ["days", "updatedAt", "updatedBy"] });
          hasNew.current.add(mk);
        } else {
          const args: unknown[] = [];
          for (const c of cs) args.push(new FieldPath("days", c.memberId, c.date.slice(8, 10)), Object.keys(c.cell).length ? c.cell : deleteField());
          args.push("updatedAt", Timestamp.now());
          await (updateDoc as any)(ref, ...args);
        }
      }
    } catch (e) { toast.error(e); }
    // Una nómina enviada cuyos días cambian queda como revisada
    for (const k of [prevRunKey(key), key, nextRunKey(key)]) {
      if (runsRef.current[k]?.status !== "sent") continue;
      const touched = changes.some((c) => CUT_GROUPS.some((g) => { const w = windowFor(k, g.id, runsRef.current, settings); return c.date >= w.from && c.date <= w.to; }));
      if (touched) editRun(k, (r) => r);
    }
  }, [projectId, user?.uid, key, settings, editRun]);

  const savePeople = useCallback(async (mid: string, patch: Record<string, unknown>) => {
    setPeopleDocs((p) => ({ ...p, [mid]: { ...(p[mid] || {}), ...patch } }));
    try { await setDoc(doc(db, `projects/${projectId}/payrollPeople`, mid), clean(patch), { mergeFields: Object.keys(patch) }); } catch (e) { toast.error(e); }
  }, [projectId]);

  const saveCrew = useCallback(async (mid: string, patch: Record<string, unknown>) => {
    setCrewDocs((p) => ({ ...p, [mid]: { ...(p[mid] || {}), ...patch } }));
    try { await updateDoc(doc(db, `projects/${projectId}/crew`, mid), patch); } catch (e) { toast.error(e); }
  }, [projectId]);

  const saveSettings = async () => {
    try {
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "payrollConfig"), { ...clean(settingsDraft), updatedAt: Timestamp.now(), updatedBy: user?.uid || "", updatedByName: user?.name || "" }, { merge: true });
      setSettings(settingsDraft);
      setShowSettings(false);
      toast.success("Ajustes de nóminas guardados");
    } catch (e) { toast.error(e); }
  };

  const exportCuadro = async () => {
    try {
      const skipped = await downloadCuadro({ key, projectName, notes: run.notes, sentDate: run.sentAt || todayIso(), settings, lines });
      if (skipped) toast.error(`La plantilla admite 150 personas: ${skipped} no caben`);
    } catch (e) { toast.error(e); }
  };

  const setWindow = (g: CutGroup, w: Partial<Window> | null) =>
    editRun(key, (r) => {
      const ws = { ...(r.windows || {}) };
      if (w) ws[g] = { ...(ws[g] || {}), ...w }; else delete ws[g];
      return { ...r, windows: ws };
    });

  // ── Días ─────────────────────────────────────────────────────────────────
  const brushes: Brush[] = useMemo(() => [
    ...DAY_STATES.map((s) => ({ id: s.id, label: s.label, short: s.short, unit: "day" as const, state: true })),
    ...settings.items.filter((i) => i.active).map((i) => ({ id: i.id, label: i.label, short: i.short, unit: i.unit })),
  ], [settings.items]);
  const brush = brushes.find((b) => b.id === brushId) || brushes[0];
  const brushGroup: CutGroup = brush.state ? "dias" : cutGroupOfItem(settings.items.find((i) => i.id === brush.id)!);
  const groupWin = windowFor(key, brushGroup, runs, settings);
  const range = useMemo(() => {
    const ws = CUT_GROUPS.map((g) => windowFor(key, g.id, runs, settings));
    return { from: ws.reduce((a, w) => (w.from < a ? w.from : a), monthStart(key)), to: ws.reduce((a, w) => (w.to > a ? w.to : a), monthEnd(key)) };
  }, [key, runs, settings]);

  const bulk = (mode: "fill" | "clear") => {
    const changes: CellChange[] = [];
    for (const l of shown) {
      const p = l.person, end = p.ssEndDate || p.endDateApprox;
      const w = brush.state ? groupWin : l.windows[brushGroup];
      for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
        if (dayDiff(w.from, d) > 120) break;
        const c = cellOf(daysRef.current, p.id, d);
        if (mode === "clear") { if (c[brush.id]) { const n = { ...c }; delete n[brush.id]; changes.push({ memberId: p.id, date: d, cell: n }); } continue; }
        if ((p.startDate && d < p.startDate) || (end && d > end) || c[brush.id]) continue;
        const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
        const ok = brush.id === "w" ? dow !== 0 && dow !== 6 : !!c.w;
        if (ok) changes.push({ memberId: p.id, date: d, cell: { ...c, [brush.id]: brush.unit === "day" ? 1 : qty || 1 } });
      }
    }
    if (!changes.length) { toast.info(mode === "fill" ? "No hay días que rellenar" : "No hay nada que borrar"); return; }
    void commitCells(changes);
    toast.success(`${changes.length} ${changes.length === 1 ? "día actualizado" : "días actualizados"}`);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return <PageLoading />;
  if (denied) return <NoAccess backHref={`/project/${projectId}`} />;

  const { y, m0 } = parseRunKey(key);
  const openLine = openId ? lines.find((l) => l.person.id === openId) : null;
  const tableGroups: GroupId[] = ["dietas", "medios", "pluses", "complementos", "especie", "proyecto", "it"];

  return (
    <Page>
      <PageHeader
        title={<>
          Nóminas
          <span className="ml-3 flex items-center gap-1 text-[15px] font-medium text-slate-700">
            <IconButton label="Mes anterior" onClick={() => setKey(prevRunKey(key))}><ChevronLeft size={16} /></IconButton>
            <span className="w-[128px] text-center tabular-nums">{MONTHS_ES[m0]} {y}</span>
            <IconButton label="Mes siguiente" onClick={() => setKey(nextRunKey(key))}><ChevronRight size={16} /></IconButton>
          </span>
          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS[run.status].cls}`}>{STATUS[run.status].label}</span>
        </>}
        actions={<>
          <IconButton label="Ajustes de nóminas" onClick={() => { setSettingsDraft(settings); setShowSettings(true); }}><Settings2 size={16} /></IconButton>
          <Menu trigger={(t) => <IconButton label="Más acciones" onClick={t}><MoreHorizontal size={16} /></IconButton>}>
            {(close) => <>
              {run.status !== "sent" && <MenuItem onClick={() => { close(); void persistRun(key, { ...run, status: "sent", sentAt: todayIso(), revisedAt: undefined }); }}>Marcar como enviada</MenuItem>}
              {run.status !== "draft" && <MenuItem onClick={() => { close(); void persistRun(key, { ...run, status: "draft", sentAt: undefined, revisedAt: undefined }); }}>Volver a borrador</MenuItem>}
              <MenuItem onClick={() => { close(); setNotesOpen(true); }}>Notas del cuadro</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => { close(); editRun(key, (r) => ({ ...r, windows: Object.fromEntries(CUT_GROUPS.map((g) => [g.id, { ...(r.windows?.[g.id] || {}), to: monthEnd(key) }])) })); }}>Liquidar todo hasta fin de mes</MenuItem>
              {run.windows && Object.keys(run.windows).length > 0 && <MenuItem onClick={() => { close(); editRun(key, (r) => ({ ...r, windows: {} })); }}>Volver a los cortes</MenuItem>}
            </>}
          </Menu>
          <Button variant="primary" onClick={exportCuadro}><Download size={15} /> Exportar cuadro</Button>
        </>}
      />

      {/* Períodos */}
      <Periods k={key} runs={runs} settings={settings} warnings={warnings} onSet={setWindow} />

      {/* Barra de vista */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={setView} options={[
          { value: "cuadro", label: "Cuadro" },
          { value: "dias", label: "Días" },
          { value: "incidencias", label: issuesCount + warnCount ? `Incidencias · ${issuesCount + warnCount}` : "Incidencias" },
        ]} />
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input aria-label="Buscar persona" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-52 pl-8" />
        </div>
        <div className="w-52">
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {depts.map((d) => <option key={d} value={d}>{d || "Sin departamento"}</option>)}
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-5 text-[13px] text-slate-500">
          <span><span className="tabular-nums text-slate-900">{shown.length}</span> personas</span>
          <span>Bruto <span className="tabular-nums font-medium text-slate-900">{eur(totals.gross)} €</span></span>
          {totals.disc > 0 && <span>Descuentos <span className="tabular-nums text-slate-900">{eur(totals.disc)} €</span></span>}
        </div>
      </div>

      <div className="mt-4">
        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-6 py-14 text-center text-[13px] text-slate-500">
            {lines.length === 0 ? "Nadie de alta este mes. Las altas se hacen desde Crew." : "Nadie coincide con el filtro"}
          </div>
        ) : view === "cuadro" ? (
          <Cuadro lines={shown} groups={tableGroups} settings={settings} expanded={expanded}
            onToggle={(g) => setExpanded((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })}
            onOpen={setOpenId}
            onEdit={(l, k, total) => {
              const manual = run.people?.[l.person.id]?.amounts?.[k] || 0;
              const computed = (l.amounts[k] || 0) - manual;
              const amounts = { ...(run.people?.[l.person.id]?.amounts || {}) };
              const v = Math.round((total - computed) * 100) / 100;
              if (v) amounts[k] = v; else delete amounts[k];
              setPersonRun(l.person.id, { amounts });
            }} />
        ) : view === "dias" ? (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {brushes.map((b) => (
                <button key={b.id} onClick={() => setBrushId(b.id)} aria-pressed={b.id === brush.id}
                  className={`h-8 rounded-md border px-2.5 text-xs font-medium transition-colors ${b.id === brush.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                  {b.short !== b.label && <span className="mr-1 opacity-60">{b.short}</span>}{b.label}
                </button>
              ))}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px] text-slate-500">
              <span>{brush.label}: del <span className="text-slate-900">{fmtDay(groupWin.from)}</span> al <span className="text-slate-900">{fmtDay(groupWin.to)}</span> en esta nómina</span>
              {brush.unit !== "day" && (
                <label className="flex items-center gap-2">{brush.unit === "km" ? "Km por día" : "Horas por día"}
                  <Input aria-label="Cantidad" inputMode="decimal" value={String(qty)} onChange={(e) => setQty(parseFloat(e.target.value.replace(",", ".")) || 0)} className="h-8 w-20 text-right tabular-nums" />
                </label>
              )}
              <span className="ml-auto flex gap-2">
                {(brush.id === "w" || !brush.state) && <Button size="sm" onClick={() => bulk("fill")}>{brush.id === "w" ? "Marcar laborables" : "Aplicar a días trabajados"}</Button>}
                <Button size="sm" variant="ghost" onClick={() => bulk("clear")}>Borrar en la ventana</Button>
              </span>
            </div>
            <DaysGrid people={shown.map((l) => l.person)} days={days} range={range} active={groupWin} brush={brush} qty={qty} brushes={brushes}
              onCommit={(c) => void commitCells(c)} onOpenPerson={setOpenId} />
            <p className="mt-2 text-xs text-slate-500">Clic para poner o quitar, arrastra para varias celdas. Lo atenuado va en otra nómina; lo rayado queda fuera del alta.</p>
          </div>
        ) : (
          <Incidencias lines={shown} windowWarnings={warnings} onOpen={setOpenId} />
        )}
      </div>

      {openLine && (
        <PersonPanel line={openLine} runKey={key} run={run.people?.[openLine.person.id] || {}} settings={settings}
          onClose={() => setOpenId(null)}
          onRun={(patch) => setPersonRun(openLine.person.id, patch)}
          onPerson={(patch) => void savePeople(openLine.person.id, patch)}
          onCrew={(patch) => void saveCrew(openLine.person.id, patch)} />
      )}

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Ajustes de nóminas" width="max-w-4xl"
        footer={<><Button variant="ghost" onClick={() => setShowSettings(false)}>Cancelar</Button><Button variant="primary" onClick={saveSettings}>Guardar</Button></>}>
        <PayrollSettingsForm value={settingsDraft} onChange={setSettingsDraft} />
      </Modal>

      <Modal open={notesOpen} onClose={() => setNotesOpen(false)} title={`Notas · ${MONTHS_ES[m0]} ${y}`}
        footer={<Button variant="primary" onClick={() => setNotesOpen(false)}>Hecho</Button>}>
        <Textarea rows={4} defaultValue={run.notes || ""} placeholder="Van en la cabecera del cuadro" onBlur={(e) => { if (e.target.value !== (run.notes || "")) editRun(key, (r) => ({ ...r, notes: e.target.value })); }} />
      </Modal>
    </Page>
  );
}

// ─── Períodos de la nómina ──────────────────────────────────────────────────

function Periods({ k, runs, settings, warnings, onSet }: {
  k: string; runs: Record<string, PayrollRun>; settings: PayrollSettings; warnings: string[];
  onSet: (g: CutGroup, w: Partial<Window> | null) => void;
}) {
  const ws = CUT_GROUPS.map((g) => ({ g, w: windowFor(k, g.id, runs, settings), custom: !!runs[k]?.windows?.[g.id] }));
  const from = ws.reduce((a, x) => (x.w.from < a ? x.w.from : a), monthStart(k));
  const to = ws.reduce((a, x) => (x.w.to > a ? x.w.to : a), monthEnd(k));
  const span = Math.max(1, dayDiff(from, to) + 1);
  const pct = (d: string) => (dayDiff(from, d) / span) * 100;
  const monthLine = pct(monthStart(k));
  return (
    <section className="mt-6">
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {ws.map(({ g, w, custom }) => {
          const c = settings.cutoffs[g.id];
          return (
            <div key={g.id} className="grid grid-cols-[minmax(0,15rem)_9.5rem_minmax(0,1fr)_2rem] items-center gap-4 border-b border-slate-100 px-4 py-2 last:border-0">
              <span className="truncate text-[13px] text-slate-900">{g.label}</span>
              <span className="text-[13px] tabular-nums text-slate-700">{fmtDay(w.from)} a {fmtDay(w.to)}</span>
              <div className="relative h-5" aria-hidden>
                <div className="absolute inset-y-[8px] left-0 right-0 rounded-full bg-slate-100" />
                {monthLine > 0 && <div className="absolute inset-y-0 w-px bg-slate-300" style={{ left: `${monthLine}%` }} />}
                <div className={`absolute inset-y-[8px] rounded-full ${custom ? "bg-amber-400" : "bg-slate-700"}`} style={{ left: `${pct(w.from)}%`, width: `${Math.max(1, ((dayDiff(w.from, w.to) + 1) / span) * 100)}%` }} />
              </div>
              <Menu trigger={(t) => <IconButton label={`Cambiar período · ${g.label}`} onClick={t}><ChevronDown size={14} /></IconButton>}>
                {(close) => <>
                  <p className="px-3 pb-1 pt-1.5 text-xs text-slate-500">{custom ? "Personalizado" : c.mode === "natural" ? "Mes natural" : `Corte el día ${c.day}`}</p>
                  {custom && <MenuItem onClick={() => { close(); onSet(g.id, null); }}>Según el corte</MenuItem>}
                  <MenuItem onClick={() => { close(); onSet(g.id, { to: monthEnd(k) }); }}>Hasta fin de mes</MenuItem>
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-8">Del</span><Input type="date" aria-label="Desde" defaultValue={w.from} onBlur={(e) => e.target.value && e.target.value !== w.from && onSet(g.id, { from: e.target.value })} className="h-8" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-8">Al</span><Input type="date" aria-label="Hasta" defaultValue={w.to} onBlur={(e) => e.target.value && e.target.value !== w.to && onSet(g.id, { to: e.target.value })} className="h-8" />
                    </div>
                  </div>
                </>}
              </Menu>
            </div>
          );
        })}
      </div>
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[13px] text-amber-800">
          {warnings.map((w) => <li key={w} className="flex items-center gap-2"><AlertTriangle size={13} />{w}</li>)}
        </ul>
      )}
    </section>
  );
}

// ─── Cuadro ─────────────────────────────────────────────────────────────────

function AmountCell({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState("");
  if (edit) {
    return (
      <input autoFocus aria-label={label} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEdit(false); const n = parseFloat(v.replace(/\./g, "").replace(",", ".")); const nv = Number.isFinite(n) ? n : 0; if (nv !== value) onSave(nv); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(false); }}
        className="h-7 w-full rounded border border-slate-300 px-1.5 text-right text-[13px] tabular-nums outline-none focus:border-slate-900" />
    );
  }
  return (
    <button aria-label={`${label}: ${value ? eur(value) : "vacío"}`} onClick={() => { setV(value ? String(value).replace(".", ",") : ""); setEdit(true); }}
      className="h-7 w-full rounded px-1.5 text-right tabular-nums text-slate-900 hover:bg-slate-100">
      {value ? eur(value) : <span className="text-slate-300">·</span>}
    </button>
  );
}

function Cuadro({ lines, groups, settings, expanded, onToggle, onOpen, onEdit }: {
  lines: Line[]; groups: GroupId[]; settings: PayrollSettings; expanded: Set<GroupId>;
  onToggle: (g: GroupId) => void; onOpen: (id: string) => void; onEdit: (l: Line, key: string, total: number) => void;
}) {
  const desc = columnsOf("descuentos", settings);
  const cols = groups.map((g) => ({ g, label: GROUPS.find((x) => x.id === g)!.label, cols: columnsOf(g, settings) })).filter((x) => x.cols.length);
  const sum = (l: Line, keys: { key: string }[]) => keys.reduce((a, c) => a + (l.amounts[c.key] || 0), 0);
  const byDept: [string, Line[]][] = [];
  for (const l of lines) { const last = byDept[byDept.length - 1]; if (last && last[0] === l.person.department) last[1].push(l); else byDept.push([l.person.department, [l]]); }
  const groupCols = (x: { g: GroupId; cols: { key: string; label: string; code?: string }[] }) => (expanded.has(x.g) ? x.cols : null);
  const TH = "border-b border-slate-200 px-2 py-1.5 text-right text-xs font-medium text-slate-500";
  const total = (keys: { key: string }[]) => lines.reduce((a, l) => a + sum(l, keys), 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-[#FAFAFA]">
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 min-w-[230px] border-b border-slate-200 bg-[#FAFAFA] px-3 py-1.5 text-left text-xs font-medium text-slate-500">Persona</th>
            <th rowSpan={2} className={`${TH} min-w-[96px]`}>Salario</th>
            {cols.map((x) => {
              const open = groupCols(x);
              return (
                <th key={x.g} colSpan={open ? open.length : 1} className="border-b border-l border-slate-200 px-2 py-1 text-left">
                  <button onClick={() => onToggle(x.g)} aria-expanded={!!open} className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-700 hover:text-slate-900">
                    <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />{x.label}
                  </button>
                </th>
              );
            })}
            <th rowSpan={2} className={`${TH} min-w-[110px] border-l text-slate-900`}>Total bruto</th>
            <th colSpan={expanded.has("descuentos") ? desc.length : 1} className="border-b border-l border-slate-200 px-2 py-1 text-left">
              <button onClick={() => onToggle("descuentos")} aria-expanded={expanded.has("descuentos")} className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-700 hover:text-slate-900">
                <ChevronRight size={12} className={`transition-transform ${expanded.has("descuentos") ? "rotate-90" : ""}`} />Anticipos y descuentos
              </button>
            </th>
          </tr>
          <tr>
            {cols.map((x) => {
              const open = groupCols(x);
              return open
                ? open.map((c, i) => <th key={c.key} className={`${TH} min-w-[92px] whitespace-nowrap ${i === 0 ? "border-l" : ""}`} title={c.label}>{c.code && <span className="mr-1 font-mono text-[10px] text-slate-400">{c.code}</span>}<span className="inline-block max-w-[110px] truncate align-bottom">{c.label}</span></th>)
                : <th key={x.g} className={`${TH} min-w-[92px] border-l`}>Total</th>;
            })}
            {expanded.has("descuentos")
              ? desc.map((c, i) => <th key={c.key} className={`${TH} min-w-[92px] whitespace-nowrap ${i === 0 ? "border-l" : ""}`} title={c.label}>{c.code && <span className="mr-1 font-mono text-[10px] text-slate-400">{c.code}</span>}<span className="inline-block max-w-[110px] truncate align-bottom">{c.label}</span></th>)
              : <th className={`${TH} min-w-[92px] border-l`}>Total</th>}
          </tr>
        </thead>
        <tbody>
          {byDept.map(([d, ls]) => (
            <Fragment key={d || "_"}>
              <tr className="bg-white">
                <td className="sticky left-0 z-10 bg-white px-3 pb-1 pt-3 text-xs font-medium text-slate-500">{d || "Sin departamento"} <span className="text-slate-400">· {ls.length}</span></td>
                <td colSpan={99} />
              </tr>
              {ls.map((l) => (
                <tr key={l.person.id} className="group border-t border-slate-100 hover:bg-[#FAFAFA]">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1 group-hover:bg-[#FAFAFA]">
                    <button onClick={() => onOpen(l.person.id)} className="flex w-full items-center gap-2 text-left">
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${l.issues.length ? "bg-rose-500" : l.warnings.length ? "bg-amber-400" : "bg-transparent"}`} aria-label={l.issues.length ? "Con incidencias" : undefined} />
                      <span className="min-w-0">
                        <span className="block truncate text-slate-900 hover:underline">{fullName(l.person) || "Sin nombre"}</span>
                        <span className="block truncate text-[11px] text-slate-500">{[l.person.role, l.person.periodicity].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-900">{l.gross == null ? <span className="text-slate-300">·</span> : eur(l.gross)}</td>
                  {cols.map((x) => {
                    const open = groupCols(x);
                    if (!open) { const v = sum(l, x.cols); return <td key={x.g} className="border-l border-slate-100 px-2 py-1 text-right tabular-nums text-slate-700">{v ? eur(v) : <span className="text-slate-300">·</span>}</td>; }
                    return open.map((c, i) => (
                      <td key={c.key} className={`px-1 py-0.5 ${i === 0 ? "border-l border-slate-100" : ""}`} title={(l.sources[c.key] || []).map((s) => `${s.item} ${s.qty} × ${eur(s.rate)}`).join(" · ") || undefined}>
                        <AmountCell value={l.amounts[c.key] || 0} label={`${fullName(l.person)} · ${labelOf(c.key, settings)}`} onSave={(v) => onEdit(l, c.key, v)} />
                      </td>
                    ));
                  })}
                  <td className="border-l border-slate-100 px-2 py-1 text-right font-medium tabular-nums text-slate-900">{eur(l.totalGross)}</td>
                  {expanded.has("descuentos")
                    ? desc.map((c, i) => (
                      <td key={c.key} className={`px-1 py-0.5 ${i === 0 ? "border-l border-slate-100" : ""}`}>
                        <AmountCell value={l.amounts[c.key] || 0} label={`${fullName(l.person)} · ${labelOf(c.key, settings)}`} onSave={(v) => onEdit(l, c.key, v)} />
                      </td>
                    ))
                    : <td className="border-l border-slate-100 px-2 py-1 text-right tabular-nums text-slate-700">{l.totalDiscounts ? eur(l.totalDiscounts) : <span className="text-slate-300">·</span>}</td>}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-[#FAFAFA] font-medium text-slate-900">
            <td className="sticky left-0 z-10 bg-[#FAFAFA] px-3 py-2">Total</td>
            <td className="px-2 py-2 text-right tabular-nums">{eur(lines.reduce((a, l) => a + (l.gross || 0), 0))}</td>
            {cols.map((x) => {
              const open = groupCols(x);
              return open
                ? open.map((c, i) => <td key={c.key} className={`px-2 py-2 text-right tabular-nums ${i === 0 ? "border-l border-slate-200" : ""}`}>{total([c]) ? eur(total([c])) : ""}</td>)
                : <td key={x.g} className="border-l border-slate-200 px-2 py-2 text-right tabular-nums">{total(x.cols) ? eur(total(x.cols)) : ""}</td>;
            })}
            <td className="border-l border-slate-200 px-2 py-2 text-right tabular-nums">{eur(lines.reduce((a, l) => a + l.totalGross, 0))}</td>
            {expanded.has("descuentos")
              ? desc.map((c, i) => <td key={c.key} className={`px-2 py-2 text-right tabular-nums ${i === 0 ? "border-l border-slate-200" : ""}`}>{total([c]) ? eur(total([c])) : ""}</td>)
              : <td className="border-l border-slate-200 px-2 py-2 text-right tabular-nums">{eur(lines.reduce((a, l) => a + l.totalDiscounts, 0))}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Incidencias ────────────────────────────────────────────────────────────

function Incidencias({ lines, windowWarnings, onOpen }: { lines: Line[]; windowWarnings: string[]; onOpen: (id: string) => void }) {
  const withIssues = lines.filter((l) => l.issues.length || l.warnings.length);
  if (!withIssues.length && !windowWarnings.length) {
    return <div className="rounded-lg border border-dashed border-slate-200 px-6 py-14 text-center text-[13px] text-slate-500">Todo en orden</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      {withIssues.map((l) => (
        <button key={l.person.id} onClick={() => onOpen(l.person.id)} className="flex w-full items-start gap-4 border-b border-slate-100 px-4 py-2.5 text-left last:border-0 hover:bg-[#FAFAFA]">
          <span className="w-56 flex-shrink-0">
            <span className="block truncate text-[13px] text-slate-900">{fullName(l.person) || "Sin nombre"}</span>
            <span className="block truncate text-xs text-slate-500">{l.person.department || "Sin departamento"}</span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {l.issues.map((t) => <span key={t} className="rounded-md bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{t}</span>)}
            {l.warnings.map((t) => <span key={t} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{t}</span>)}
          </span>
        </button>
      ))}
    </div>
  );
}
