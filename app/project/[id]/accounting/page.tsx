"use client";

// ─── Panel de contabilidad ───────────────────────────────────────────────────
// Lo ve todo el equipo, pero cada perfil ve lo suyo:
//   · Contabilidad (roles de proyecto y niveles contables): circuito de facturas
//     y movimientos de todo el proyecto; con acceso ampliado, además
//     presupuesto y vencimientos.
//   · Jefe de departamento (HOD / coordinador): movimientos y POs abiertas de
//     su departamento.
//   · Usuario: sus propios documentos y sus POs abiertas.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { canApprove } from "@/lib/approvalFlow";
import { ClipboardCheck, FolderDown, Plus, Settings, Upload } from "lucide-react";

import { auth, db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from "firebase/firestore";

import { Page, PageHeader, PageLoading, buttonClass } from "@/components/ds";
import { PROJECT_ROLES } from "@/hooks/useAccountingPermissions";
import { getInvoiceDisplayState, inInvoiceView, type InvoiceView } from "@/lib/invoiceHelpers";
import { getCostSettings } from "@/lib/budgetRules";
import { loadLedger } from "@/lib/ledgerClient";
import { loadBudgetFigures, migrateBudgetFigures } from "@/lib/budgetFigures";
import { canSeeBudget } from "@/hooks/useCanSeeBudget";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Profile = "accounting" | "head" | "user";
type Kind = "po" | "invoice";

interface Row {
  kind: Kind;
  id: string;
  number: string;
  supplier: string;
  concept: string;
  department: string;
  requester: string;
  account: string;
  base: number;
  state: string;
  createdAt: Date | null;
}

interface InvoiceLite {
  id: string;
  supplier: string;
  state: string;
  total: number;
  base: number;
  dueDate: Date | null;
}

interface OpenPO {
  id: string;
  number: string;
  supplier: string;
  base: number;
  invoiced: number;
}

interface BudgetLine {
  code: string;
  name: string;
  budgeted: number;
  executed: number;
}

interface TrackedAccount {
  code: string;
  name: string;
  committed: number;
  actual: number;
}

interface Budget {
  budgeted: number;
  actual: number;
  committed: number;
  lines: BudgetLine[];
}

// ─── Estados ─────────────────────────────────────────────────────────────────

const STATES: Record<string, { label: string; dot: string; text: string }> = {
  draft:          { label: "Borrador",         dot: "bg-slate-300",   text: "text-slate-600" },
  pending:        { label: "Pend. aprobación", dot: "bg-amber-500",   text: "text-amber-800" },
  submitted:      { label: "Pend. aprobación", dot: "bg-amber-500",   text: "text-amber-800" },
  approved:       { label: "Aprobada",         dot: "bg-emerald-500", text: "text-emerald-800" },
  coded:          { label: "Codificada",       dot: "bg-violet-500",  text: "text-violet-800" },
  accounted:      { label: "Contabilizada",    dot: "bg-teal-500",    text: "text-teal-800" },
  paid:           { label: "Pagada",           dot: "bg-[#2F52E0]",   text: "text-blue-800" },
  overdue:        { label: "Vencida",          dot: "bg-red-500",     text: "text-red-700" },
  closed:         { label: "Cerrada",          dot: "bg-slate-400",   text: "text-slate-600" },
  rejected:       { label: "Rechazada",        dot: "bg-red-500",     text: "text-red-700" },
  cancelled:      { label: "Anulada",          dot: "bg-slate-300",   text: "text-slate-500 line-through" },
  void:           { label: "Anulada",          dot: "bg-slate-300",   text: "text-slate-500 line-through" },
  returned:       { label: "Devuelta",         dot: "bg-teal-500",    text: "text-teal-800" },
  partial_return: { label: "Dev. parcial",     dot: "bg-cyan-500",    text: "text-cyan-800" },
};


// ─── Formato ─────────────────────────────────────────────────────────────────

const money = (n: number, decimals = 2) =>
  `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0)} €`;
const shortDate = (d: Date | null) => (d ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "—");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Mapeo de documentos ─────────────────────────────────────────────────────

const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);

function firstAccount(data: any) {
  const item = (data.items || []).find((i: any) => i.subAccountCode);
  if (!item) return "";
  return [item.subAccountCode, item.subAccountDescription].filter(Boolean).join(" ");
}

function poRow(id: string, data: any): Row {
  return {
    kind: "po",
    id,
    number: `PO-${data.number || ""}`,
    supplier: data.supplier || "Sin proveedor",
    concept: data.generalDescription || data.description || "",
    department: data.department || "",
    requester: data.createdByName || "",
    account: firstAccount(data),
    base: data.baseAmount || 0,
    state: data.status || "draft",
    createdAt: toDate(data.createdAt),
  };
}

function invoiceState(data: any) {
  return getInvoiceDisplayState({ ...data, dueDate: toDate(data.dueDate) });
}

function invoiceRow(id: string, data: any): Row {
  const type = data.documentType || "invoice";
  const prefix = type === "proforma" ? "PRF" : type === "budget" ? "PRS" : type === "guarantee" ? "FNZ" : "FRA";
  return {
    kind: "invoice",
    id,
    number: data.displayNumber || `${prefix}-${data.number || ""}`,
    supplier: data.supplier || "Sin proveedor",
    concept: data.description || "",
    department: data.department || "",
    requester: data.createdByName || "",
    account: firstAccount(data),
    base: data.baseAmount || 0,
    state: invoiceState(data),
    createdAt: toDate(data.createdAt),
  };
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function AccountingPanelPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [accessLevel, setAccessLevel] = useState("user");
  const [profile, setProfile] = useState<Profile>("user");
  const [isApprover, setIsApprover] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const [rows, setRows] = useState<Row[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [openPOs, setOpenPOs] = useState<OpenPO[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [tracked, setTracked] = useState<TrackedAccount[]>([]);
  const [tab, setTab] = useState<"all" | Kind>("all");

  const extended = accessLevel === "accounting_extended";

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => { if (u) setUserId(u.uid); });
    return () => unsub();
  }, []);

  // ── Carga ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !id) return;
    const load = async () => {
      try {
        const memberSnap = await getDoc(doc(db, `projects/${id}/members`, userId));
        const m = memberSnap.exists() ? memberSnap.data() : {};
        const mRole: string = m.role || "";
        const mDept: string = m.department || "";
        const mPos: string = m.position || "";
        const mLevel: string = m.accountingAccessLevel || "user";
        setRole(mRole);
        setDepartment(mDept);
        setAccessLevel(mLevel);

        const isProjectRole = PROJECT_ROLES.includes(mRole);
        const p: Profile =
          isProjectRole || mLevel === "accounting" || mLevel === "accounting_extended"
            ? "accounting"
            : mPos === "HOD" || mPos === "Coordinator"
              ? "head"
              : "user";
        setProfile(p);

        // ¿Aprueba algo? (para el acceso directo a aprobaciones)
        const approvalCfg = await getDoc(doc(db, `projects/${id}/config`, "approvals"));
        if (approvalCfg.exists()) {
          const cfg = approvalCfg.data();
          const lower = mPos.toLowerCase();
          const matches = (step: any) => {
            if (!step) return false;
            if (step.approverType === "fixed" && step.approvers?.includes(userId)) return true;
            if (step.approverType === "role" && step.roles?.includes(mRole)) return true;
            const sameDept = !step.department || step.department === mDept;
            if (step.approverType === "hod" && (lower.includes("head") || lower.includes("jefe") || mPos === "HOD" || mRole === "HOD") && sameDept) return true;
            if (step.approverType === "coordinator" && (lower.includes("coordinator") || lower.includes("coordinador") || mPos === "Coordinator" || mRole === "Coordinator") && sameDept) return true;
            return false;
          };
          setIsApprover([...(cfg.poApprovals || []), ...(cfg.invoiceApprovals || [])].some(matches));
        }

        // POs y facturas visibles para este perfil
        const posRef = collection(db, `projects/${id}/pos`);
        const invRef = collection(db, `projects/${id}/invoices`);
        const scope =
          p === "accounting" ? null : p === "head" ? where("department", "==", mDept) : where("createdBy", "==", userId);
        const [posSnap, invSnap] = await Promise.all([
          getDocs(scope ? query(posRef, scope) : posRef),
          getDocs(scope ? query(invRef, scope) : invRef),
        ]);

        const poDocs = posSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
        const invDocs = invSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

        setRows([
          ...poDocs.map((d) => poRow(d.id, d.data)),
          ...invDocs.map((d) => invoiceRow(d.id, d.data)),
        ]);

        setInvoices(
          invDocs.map(({ id: invId, data }) => ({
            id: invId,
            supplier: data.supplier || "Sin proveedor",
            state: invoiceState(data),
            total: data.totalAmount || data.baseAmount || 0,
            base: data.baseAmount || 0,
            dueDate: toDate(data.dueDate),
          })),
        );

        setOpenPOs(
          poDocs
            .filter(({ data }) => data.status === "approved")
            .map(({ id: poId, data }) => ({
              id: poId,
              number: `PO-${data.number || ""}`,
              supplier: data.supplier || "Sin proveedor",
              base: data.baseAmount || 0,
              invoiced: data.invoicedAmount || 0,
            }))
            .sort((a, b) => pct(b.invoiced, b.base) - pct(a.invoiced, a.base)),
        );

        // Seguimiento de cuentas: HOD/coordinación ven comprometido y realizado
        // de las cuentas que contabilidad avanzada ha abierto a su departamento.
        if (p === "head" && mDept) {
          const trackedSnap = await getDocs(
            query(collection(db, `projects/${id}/accounts`), where("trackingDepartments", "array-contains", mDept)),
          );
          if (!trackedSnap.empty) {
            // Libro único calculado en el servidor (el HOD no puede leer todas las POs).
            const ledger = await loadLedger(id);
            const committed = Object.fromEntries(Object.entries(ledger.bySub).map(([k, v]) => [k, v.committed]));
            const actual = Object.fromEntries(Object.entries(ledger.bySub).map(([k, v]) => [k, v.actual]));
            const box = Object.fromEntries(Object.entries(ledger.bySub).map(([k, v]) => [k, v.box]));
            const list = await Promise.all(
              trackedSnap.docs.map(async (acc) => {
                const subs = await getDocs(collection(db, `projects/${id}/accounts/${acc.id}/subaccounts`));
                let c = 0, a = 0;
                subs.docs.forEach((sd) => {
                  const code = sd.data().code || "";
                  c += committed[code] || 0;
                  a += (actual[code] || 0) + (box[code] || 0);
                });
                return { code: acc.data().code || "", name: acc.data().description || "", committed: c, actual: a };
              }),
            );
            setTracked(list.sort((x, y) => x.code.localeCompare(y.code)));
          }
        }

        // Quien puede ver presupuesto traslada las cifras antiguas que aún
        // estén en subcuentas a la colección protegida.
        if (canSeeBudget(m)) await migrateBudgetFigures(id);

        // Presupuesto: solo con acceso ampliado (igual que la pestaña Presupuesto)
        if (p === "accounting" && mLevel === "accounting_extended") {
          const figures = await loadBudgetFigures(id);
          const [ledger, accountsSnap] = await Promise.all([
            loadLedger(id),
            getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc"))),
          ]);
          const committed = Object.fromEntries(Object.entries(ledger.bySub).map(([k, v]) => [k, v.committed]));
          const actual = Object.fromEntries(Object.entries(ledger.bySub).map(([k, v]) => [k, v.actual]));
          const box = Object.fromEntries(Object.entries(ledger.bySub).map(([k, v]) => [k, v.box]));

          const lines: BudgetLine[] = [];
          let tBudgeted = 0, tActual = 0, tCommitted = 0;
          await Promise.all(
            accountsSnap.docs.map(async (acc, i) => {
              const subs = await getDocs(collection(db, `projects/${id}/accounts/${acc.id}/subaccounts`));
              let b = 0, a = 0, c = 0;
              subs.docs.forEach((s) => {
                const code = s.data().code || "";
                b += figures[s.id] ?? s.data().budgeted ?? 0;
                a += (actual[code] || 0) + (box[code] || 0);
                c += committed[code] || 0;
              });
              tBudgeted += b; tActual += a; tCommitted += c;
              lines[i] = { code: acc.data().code || "", name: acc.data().description || "", budgeted: b, executed: a + c };
            }),
          );
          setBudget({ budgeted: tBudgeted, actual: tActual, committed: tCommitted, lines: lines.filter((l) => l && l.budgeted > 0) });
        }
      } catch (err) {
        console.error("Error cargando el panel de contabilidad:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, userId]);

  // ── Aprobaciones pendientes (punto en el acceso directo) ─────────────────
  useEffect(() => {
    if (!id || !userId || !isApprover) return;
    let po = 0, inv = 0;
    const isMine = (d: any) => canApprove(d, userId);
    // Solo los documentos en los que figura como aprobador (las reglas no dejan
    // a todos leer toda la colección).
    const u1 = onSnapshot(query(collection(db, `projects/${id}/pos`), where("approverIds", "array-contains", userId)), (s) => {
      po = s.docs.filter((d) => isMine(d.data())).length;
      setPendingApprovals(po + inv);
    });
    const u2 = onSnapshot(
      query(collection(db, `projects/${id}/invoices`), where("approverIds", "array-contains", userId)),
      (s) => {
        inv = s.docs.filter((d) => !d.data().approvedAt && isMine(d.data())).length;
        setPendingApprovals(po + inv);
      },
    );
    return () => { u1(); u2(); };
  }, [id, userId, isApprover]);

  // ── Derivados ──────────────────────────────────────────────────────────────
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)),
    [rows],
  );
  const visibleRows = sortedRows.filter((r) => tab === "all" || r.kind === tab).slice(0, 10);
  const counts = {
    all: rows.length,
    po: rows.filter((r) => r.kind === "po").length,
    invoice: rows.filter((r) => r.kind === "invoice").length,
  };

  const flow = useMemo(() => {
    const sum = (list: InvoiceLite[], key: "base" | "total") => list.reduce((s, i) => s + i[key], 0);
    const pick = (v: InvoiceView) => invoices.filter((i) => inInvoiceView(v, i.state, i.dueDate));
    const received = pick("recibidas");
    const approved = pick("aprobadas");
    const paid = pick("pagadas");
    const due = pick("semana").sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
    return {
      steps: [
        { label: "Recibidas", view: "recibidas", count: received.length, amount: sum(received, "base"), bar: "bg-slate-200" },
        { label: "Aprobadas", view: "aprobadas", count: approved.length, amount: sum(approved, "base"), bar: "bg-[#AEBDF5]" },
        { label: "Pagadas", view: "pagadas", count: paid.length, amount: sum(paid, "base"), bar: "bg-[#2F52E0]" },
      ],
      due,
      dueTotal: sum(due, "total"),
    };
  }, [invoices]);

  if (loading) return <PageLoading />;

  const showDocsAndConfig = role === "EP" || role === "PM" || role === "Controller";
  const tableTitle =
    profile === "accounting" ? "Movimientos recientes" : profile === "head" ? (department ? `Movimientos · ${department}` : "Movimientos del departamento") : "Mis documentos";
  const thirdColumn = profile === "accounting" ? "Dpto." : profile === "head" ? "Solicitante" : "Cuenta";
  const showBudget = profile === "accounting" && extended;
  const showDue = profile === "accounting" && extended;
  const showOpenPOs = profile !== "accounting";
  const showTracked = profile === "head" && tracked.length > 0;
  const hasAside = showBudget || showDue || showOpenPOs || showTracked;
  const today = startOfToday();

  return (
    <Page>
      <PageHeader
        title="Panel de contabilidad"
        actions={
          <>
            {isApprover && (
              <Link
                href={`/project/${id}/accounting/approvals`}
                title="Aprobaciones"
                aria-label="Aprobaciones"
                className="relative flex h-9 w-8 items-center justify-center text-slate-400 transition-colors hover:text-slate-900"
              >
                <ClipboardCheck size={17} />
                {pendingApprovals > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" />}
              </Link>
            )}
            {showDocsAndConfig && (
              <>
                <Link href={`/project/${id}/accounting/document-center`} title="Centro de documentación" aria-label="Centro de documentación" className="flex h-9 w-8 items-center justify-center text-slate-400 transition-colors hover:text-slate-900">
                  <FolderDown size={17} />
                </Link>
                <Link href={`/project/${id}/accounting/config`} title="Configuración" aria-label="Configuración" className="mr-1 flex h-9 w-8 items-center justify-center text-slate-400 transition-colors hover:text-slate-900">
                  <Settings size={17} />
                </Link>
              </>
            )}
            <Link href={`/project/${id}/accounting/invoices/new`} className={buttonClass("secondary")}>
              <Upload size={14} /> Subir factura
            </Link>
            <Link href={`/project/${id}/accounting/pos/new`} className={buttonClass("primary")}>
              <Plus size={14} /> Nueva PO
            </Link>
          </>
        }
      />

      <div className={`mt-7 grid items-start gap-7 text-[13px] text-slate-900 ${hasAside ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        {/* ── Columna principal ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-7">
          {profile === "accounting" && (
            <section aria-labelledby="flow-title" className="flex flex-col gap-2.5">
              <h2 id="flow-title" className="text-xs font-medium text-slate-500">Circuito de facturas</h2>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 md:grid-cols-4">
                {flow.steps.map((s, i) => (
                  <Link
                    key={s.label}
                    href={`/project/${id}/accounting/invoices?vista=${s.view}`}
                    className="relative flex flex-col gap-1 border-b border-r border-slate-100 px-4 py-3.5 transition-colors hover:bg-[#FAFAFA] md:border-b-0"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
                      <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
                      {s.label}
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-slate-900">{s.count}</span>
                    <span className="tabular-nums text-xs text-slate-600">{money(s.amount)}</span>
                    <span className={`absolute inset-x-0 bottom-0 h-0.5 ${s.bar}`} />
                  </Link>
                ))}
                <Link
                  href={`/project/${id}/accounting/invoices?vista=semana`}
                  className="relative flex flex-col gap-1 bg-[#FEF7F7] px-4 py-3.5 transition-colors hover:bg-[#FDEFEF]"
                >
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-red-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    Vencen esta semana
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-slate-900">{flow.due.length}</span>
                  <span className="tabular-nums text-xs text-slate-600">{money(flow.dueTotal)}</span>
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-red-500" />
                </Link>
              </div>
            </section>
          )}

          <section aria-labelledby="rows-title" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="rows-title" className="text-xs font-medium text-slate-500">{tableTitle}</h2>
              <div role="tablist" aria-label="Filtrar movimientos" className="flex gap-0.5 rounded-md bg-[#F4F4F5] p-0.5">
                {([["all", "Todo"], ["po", "POs"], ["invoice", "Facturas"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors ${
                      tab === key ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {label}
                    <span className="tabular-nums text-slate-500">{counts[key]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              {visibleRows.length === 0 ? (
                <p className="px-4 py-12 text-center text-[13px] text-slate-500">Sin movimientos</p>
              ) : (
                <table className="tbl w-full min-w-[760px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                      <th scope="col" className="w-28 px-4 py-2 text-left font-medium">Nº</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor y concepto</th>
                      <th scope="col" className="w-32 px-3 py-2 text-left font-medium">{thirdColumn}</th>
                      <th scope="col" className="w-32 px-4 py-2 text-right font-medium">Base</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => {
                      const st = STATES[r.state] || STATES.draft;
                      const href = `/project/${id}/accounting/${r.kind === "po" ? "pos" : "invoices"}/${r.id}`;
                      const third = profile === "accounting" ? r.department : profile === "head" ? r.requester : r.account;
                      return (
                        <tr key={`${r.kind}-${r.id}`} onClick={() => router.push(href)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                          <td className="relative whitespace-nowrap px-4 py-1.5 tabular-nums text-xs font-medium" title={st.label}>
                            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${st.dot}`} />
                            <span className="sr-only">{st.label}</span>
                            {r.number}
                          </td>
                          <td className="px-3 py-1.5" title={[r.supplier, r.concept].filter(Boolean).join(" · ")}>
                            <div className="truncate font-medium text-slate-900">{r.supplier}</div>
                            <div className="truncate text-xs text-slate-500">{r.concept || <span className="text-slate-300">Sin concepto</span>}</div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{third || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-xs">{money(r.base)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="flex gap-4 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
                <Link href={`/project/${id}/accounting/pos`} className="hover:text-slate-900">Ver POs →</Link>
                <Link href={`/project/${id}/accounting/invoices`} className="hover:text-slate-900">Ver facturas →</Link>
              </div>
            </div>
          </section>
        </div>

        {/* ── Columna lateral ───────────────────────────────────────────── */}
        {hasAside && (
          <aside className="flex min-w-0 flex-col gap-7">
            {showBudget && (
              <section aria-labelledby="budget-title" className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <h2 id="budget-title" className="text-xs font-medium text-slate-500">Presupuesto</h2>
                  <Link href={`/project/${id}/accounting/budget`} className="text-xs text-slate-600 hover:text-slate-900">Detalle →</Link>
                </div>
                {!budget || budget.budgeted === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-[13px] text-slate-500">Sin presupuesto</p>
                ) : (
                  <div className="flex flex-col gap-3.5 rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xl font-semibold tabular-nums tracking-tight">{money(budget.budgeted, 0)}</span>
                        <span className="text-xs text-slate-500">total</span>
                      </div>
                      <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-[#F1F1F3]">
                        <span className="bg-[#2F52E0]" style={{ width: `${Math.min(100, pct(budget.actual, budget.budgeted))}%` }} />
                        <span className="bg-[#AEBDF5]" style={{ width: `${Math.min(100 - Math.min(100, pct(budget.actual, budget.budgeted)), pct(budget.committed, budget.budgeted))}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm bg-[#2F52E0]" />Realizado
                          <b className="font-medium tabular-nums text-slate-900">{money(budget.actual, 0)}</b>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm bg-[#AEBDF5]" />Comprometido
                          <b className="font-medium tabular-nums text-slate-900">{money(budget.committed, 0)}</b>
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col border-t border-slate-100 pt-1.5">
                      {budget.lines.map((l) => {
                        const p = pct(l.executed, l.budgeted);
                        const tone = p > 100 ? "over" : p >= 90 ? "warn" : "ok";
                        return (
                          <Link
                            key={l.code}
                            href={`/project/${id}/accounting/budget`}
                            className="grid grid-cols-[40px_minmax(0,1fr)_44px] items-center gap-x-2 gap-y-1.5 rounded-md px-1 py-2 hover:bg-[#FAFAFA]"
                          >
                            <span className="font-mono text-[11px] text-slate-500">{l.code}</span>
                            <span className="truncate">{l.name}</span>
                            <span className={`text-right text-xs font-medium tabular-nums ${tone === "over" ? "text-red-700" : tone === "warn" ? "text-amber-800" : "text-slate-900"}`}>{p} %</span>
                            <span />
                            <span aria-hidden="true" className="flex h-[3px] overflow-hidden rounded-full bg-[#F1F1F3]">
                              <span className={tone === "over" ? "bg-red-600" : tone === "warn" ? "bg-amber-600" : "bg-[#2F52E0]"} style={{ width: `${Math.min(100, p)}%` }} />
                            </span>
                            <span />
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}

            {showTracked && (
              <section aria-labelledby="tracked-title" className="flex flex-col gap-2.5">
                <h2 id="tracked-title" className="text-xs font-medium text-slate-500">Seguimiento de cuentas</h2>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="grid grid-cols-[minmax(0,1fr)_96px_96px] gap-2 border-b border-slate-200 bg-[#FAFAFA] px-3.5 py-2 text-[11px] text-slate-500">
                    <span>Cuenta</span>
                    <span className="text-right">Comprometido</span>
                    <span className="text-right">Realizado</span>
                  </div>
                  {tracked.map((t) => (
                    <div key={t.code} className="grid grid-cols-[minmax(0,1fr)_96px_96px] items-baseline gap-2 border-b border-slate-100 px-3.5 py-2.5 last:border-0">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{t.code}</span>
                        <span className="truncate">{t.name}</span>
                      </span>
                      <span className="text-right tabular-nums text-xs">{money(t.committed, 0)}</span>
                      <span className="text-right tabular-nums text-xs">{money(t.actual, 0)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showOpenPOs && (
              <section aria-labelledby="open-title" className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <h2 id="open-title" className="text-xs font-medium text-slate-500">
                    {profile === "head" ? "POs abiertas del departamento" : "Mis POs abiertas"}
                  </h2>
                  <Link href={`/project/${id}/accounting/pos`} className="text-xs text-slate-600 hover:text-slate-900">Ver todas →</Link>
                </div>
                {openPOs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-[13px] text-slate-500">Sin POs abiertas</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    {openPOs.slice(0, 6).map((po) => {
                      const p = pct(po.invoiced, po.base);
                      const warn = p >= 90;
                      return (
                        <Link key={po.id} href={`/project/${id}/accounting/pos/${po.id}`} className="flex flex-col gap-1.5 border-b border-slate-100 px-3.5 py-3 last:border-0 hover:bg-[#FAFAFA]">
                          <span className="flex items-baseline justify-between gap-2.5">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="font-mono text-xs font-medium">{po.number}</span>
                              <span className="truncate">{po.supplier}</span>
                            </span>
                            <span className="whitespace-nowrap tabular-nums text-xs">{money(po.base)}</span>
                          </span>
                          <span aria-hidden="true" className="flex h-[3px] overflow-hidden rounded-full bg-[#F1F1F3]">
                            <span className={warn ? "bg-amber-600" : "bg-[#2F52E0]"} style={{ width: `${Math.min(100, p)}%` }} />
                          </span>
                          <span className="flex justify-between text-xs text-slate-500">
                            <span>Facturado {money(po.invoiced)}</span>
                            <span className={warn ? "text-amber-800" : ""}>Disponible {money(Math.max(0, po.base - po.invoiced))}</span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {showDue && (
              <section aria-labelledby="due-title" className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <h2 id="due-title" className="text-xs font-medium text-slate-500">Próximos vencimientos</h2>
                  <Link href={`/project/${id}/accounting/payments`} className="text-xs text-slate-600 hover:text-slate-900">Pagos →</Link>
                </div>
                {flow.due.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-[13px] text-slate-500">Nada vence esta semana</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    {flow.due.slice(0, 6).map((inv) => {
                      const late = !!inv.dueDate && inv.dueDate < today;
                      return (
                        <Link key={inv.id} href={`/project/${id}/accounting/invoices/${inv.id}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-slate-100 px-3.5 py-2.5 hover:bg-[#FAFAFA]">
                          <span className={`text-xs font-medium tabular-nums ${late ? "text-red-700" : "text-slate-900"}`}>{late ? "Vencida" : shortDate(inv.dueDate)}</span>
                          <span className="truncate">{inv.supplier}</span>
                          <span className="tabular-nums text-xs">{money(inv.total)}</span>
                        </Link>
                      );
                    })}
                    <div className="flex justify-between bg-[#FAFAFA] px-3.5 py-2.5 text-xs text-slate-600">
                      <span>Total esta semana</span>
                      <span className="tabular-nums font-medium text-slate-900">{money(flow.dueTotal)}</span>
                    </div>
                  </div>
                )}
              </section>
            )}
          </aside>
        )}
      </div>
    </Page>
  );
}
