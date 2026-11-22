"use client";

// Proyecto en el móvil: tu papel, lo que te espera aquí, el presupuesto (si
// puedes verlo) y las POs y facturas recientes que te corresponden. Solo
// consulta; crear y editar sigue en el ordenador.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, type DocumentData } from "firebase/firestore";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { getScopedDocs, scopeFromMember } from "@/lib/accountingScope";
import { loadLedger } from "@/lib/ledgerClient";
import { docNumber, type PendingKind } from "@/lib/myPending";
import { useMobileData } from "@/components/mobile/MobileData";
import { ApprovalRow, Card, DocRow, Empty, SectionTitle, ago, money } from "@/components/mobile/ui";

interface Budget { budgeted: number; committed: number; actual: number; available: number; tight: { code: string; used: number; budgeted: number }[] }
interface RecentDoc { kind: "po" | "invoice"; id: string; number: string; supplier: string; base: number; currency: string; status: string; tone: string; at: Date | null }

const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : null);

const PO_STATUS: Record<string, [string, string]> = {
  draft: ["Borrador", "text-slate-500"], pending: ["Pendiente", "text-amber-700"], approved: ["Aprobada", "text-emerald-700"],
  rejected: ["Rechazada", "text-red-600"], closed: ["Cerrada", "text-slate-500"], cancelled: ["Anulada", "text-slate-400"],
};
function invoiceStatus(d: DocumentData): [string, string] {
  if (d.status === "cancelled" || d.status === "void") return ["Anulada", "text-slate-400"];
  if (d.status === "rejected" || d.approvalStatus === "rejected") return ["Rechazada", "text-red-600"];
  if (d.status === "paid") return ["Pagada", "text-emerald-700"];
  if (!d.approvedAt && (d.approvalStatus === "pending" || d.status === "pending_approval" || (d.approvalSteps || []).some((x: DocumentData) => x.status === "pending"))) return ["Pendiente", "text-amber-700"];
  if (d.status === "draft") return ["Borrador", "text-slate-500"];
  return ["Aprobada", "text-slate-700"];
}

const ROLE_LABEL: Record<string, string> = { EP: "Productor ejecutivo", PM: "Jefe de producción", Controller: "Controller", PC: "Coordinador de producción" };

export default function MobileProject() {
  const { projectId } = useParams() as { projectId: string };
  const { user } = useUser();
  const { data } = useMobileData();
  const [project, setProject] = useState<DocumentData | null | undefined>(undefined);
  const [member, setMember] = useState<DocumentData | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [recent, setRecent] = useState<RecentDoc[] | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      const [p, m] = await Promise.all([
        getDoc(doc(db, "projects", projectId)).catch(() => null),
        getDoc(doc(db, `projects/${projectId}/members`, user.uid)).catch(() => null),
      ]);
      if (!alive) return;
      if (!p?.exists() || !m?.exists()) { setProject(null); return; }
      const md = m.data();
      setProject(p.data()); setMember(md);

      // Documentos recientes (los que las reglas te dejan ver).
      if (md.permissions?.accounting) {
        const scope = scopeFromMember(user.uid, md);
        const [pos, invs] = await Promise.all([
          getScopedDocs(collection(db, `projects/${projectId}/pos`), scope).catch(() => []),
          getScopedDocs(collection(db, `projects/${projectId}/invoices`), scope).catch(() => []),
        ]);
        const rows: RecentDoc[] = [
          ...pos.map((s) => { const d = s.data(); const [status, tone] = PO_STATUS[d.status] || [d.status || "—", "text-slate-500"]; return { kind: "po" as const, id: s.id, number: docNumber("po", d), supplier: d.supplier || "—", base: d.baseAmount || 0, currency: d.currency || "EUR", status, tone, at: toDate(d.updatedAt) || toDate(d.createdAt) }; }),
          ...invs.map((s) => { const d = s.data(); const [status, tone] = invoiceStatus(d); return { kind: "invoice" as const, id: s.id, number: docNumber("invoice", d), supplier: d.supplier || "—", base: d.baseAmount || 0, currency: d.currency || "EUR", status, tone, at: toDate(d.updatedAt) || toDate(d.createdAt) }; }),
        ].sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
        if (alive) setRecent(rows);
      } else setRecent([]);

      // Presupuesto: solo si las reglas dejan leer las cifras.
      try {
        const lines = await getDocs(collection(db, `projects/${projectId}/budgetLines`));
        if (lines.empty) return;
        const ledger = await loadLedger(projectId);
        let budgeted = 0;
        const tight: Budget["tight"] = [];
        lines.forEach((l) => {
          const d = l.data();
          const b = Number(d.budgeted) || 0;
          budgeted += b;
          const t = ledger.bySubId?.[l.id] || (d.code ? ledger.bySub[d.code] : null);
          const used = t ? t.committed + t.actual + t.box : 0;
          if (b > 0 && used > 0) tight.push({ code: d.code || ledger.bySubId?.[l.id]?.code || "—", used, budgeted: b });
        });
        const committed = ledger.totals.committed, actual = ledger.totals.actual + ledger.totals.box;
        tight.sort((a, b) => b.used / b.budgeted - a.used / a.budgeted);
        if (alive) setBudget({ budgeted, committed, actual, available: budgeted - committed - actual, tight: tight.slice(0, 5) });
      } catch { /* sin acceso a las cifras */ }
    })();
    return () => { alive = false; };
  }, [projectId, user?.uid]);

  const approvals = useMemo(() => (data?.approvals || []).filter((a) => a.projectId === projectId), [data, projectId]);
  const myDocs = useMemo(() => (data?.myDocs || []).filter((d) => d.projectId === projectId), [data, projectId]);

  if (project === undefined) return <div className="space-y-3 pt-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>;
  if (project === null) return (
    <div className="space-y-4 pt-6 text-center">
      <p className="text-[15px]">No tienes acceso a este proyecto.</p>
      <Link href="/m" className="text-[13px] font-medium text-slate-700">Volver al inicio</Link>
    </div>
  );

  const roleLine = [ROLE_LABEL[member?.role] || member?.role || member?.position, member?.department, project.phase].filter(Boolean).join(" · ");
  const pct = (n: number) => (budget && budget.budgeted > 0 ? Math.min(100, Math.max(0, (n / budget.budgeted) * 100)) : 0);
  const back = `?back=${encodeURIComponent(`/m/p/${projectId}`)}`;

  return (
    <div className="space-y-7">
      <div>
        <Link href="/m" className="-ml-1 inline-flex h-9 items-center gap-1 text-[13px] text-slate-500"><ArrowLeft size={16} /> Inicio</Link>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{project.name}</h1>
        {roleLine && <p className="mt-1 text-[13px] text-slate-500">{roleLine}</p>}
      </div>

      {approvals.length > 0 && (
        <section>
          <SectionTitle count={approvals.length}>Pendiente de ti</SectionTitle>
          <Card>{approvals.map((a) => <ApprovalRow key={`${a.kind}:${a.id}`} a={a} showProject={false} />)}</Card>
        </section>
      )}

      {budget && (
        <section>
          <SectionTitle>Presupuesto</SectionTitle>
          <Card>
            <div className="px-4 py-4">
              <p className="text-xs text-slate-500">Disponible</p>
              <p className={`text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${budget.available < 0 ? "text-red-600" : "text-slate-900"}`}>{money(budget.available)}</p>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
                <span className="bg-slate-900" style={{ width: `${pct(budget.actual)}%` }} />
                <span className="bg-slate-400" style={{ width: `${pct(budget.committed)}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div><dt className="text-slate-500">Presupuesto</dt><dd className="font-medium tabular-nums">{money(budget.budgeted)}</dd></div>
                <div><dt className="flex items-center gap-1 text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Comprometido</dt><dd className="font-medium tabular-nums">{money(budget.committed)}</dd></div>
                <div><dt className="flex items-center gap-1 text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-900" />Realizado</dt><dd className="font-medium tabular-nums">{money(budget.actual)}</dd></div>
              </dl>
            </div>
            {budget.tight.map((t) => {
              const p = (t.used / t.budgeted) * 100;
              return (
                <div key={t.code} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-16 shrink-0 font-mono text-[12px] text-slate-600">{t.code}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full ${p > 100 ? "bg-red-500" : p > 85 ? "bg-amber-500" : "bg-slate-700"}`} style={{ width: `${Math.min(100, p)}%` }} />
                  </div>
                  <span className={`w-12 text-right text-[12px] tabular-nums ${p > 100 ? "font-medium text-red-600" : "text-slate-600"}`}>{Math.round(p)} %</span>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {myDocs.length > 0 && (
        <section>
          <SectionTitle count={myDocs.length}>Tus documentos</SectionTitle>
          <Card>{myDocs.map((d) => <DocRow key={`${d.kind}:${d.id}`} d={d} showProject={false} />)}</Card>
        </section>
      )}

      {recent !== null && recent.length > 0 && (
        <section>
          <SectionTitle count={recent.length}>POs y facturas</SectionTitle>
          <Card>
            {recent.slice(0, 15).map((r) => (
              <Link key={`${r.kind}:${r.id}`} href={`/m/aprobaciones/${projectId}/${r.kind as PendingKind}/${r.id}${back}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-slate-500">{r.number}</span>
                    <span className={`text-[11px] ${r.tone}`}>{r.status}</span>
                  </div>
                  <p className="truncate text-[14px] font-medium text-slate-900">{r.supplier}</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] tabular-nums text-slate-900">{money(r.base, r.currency)}</p>
                  <p className="text-[11px] text-slate-400">{ago(r.at)}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-slate-300" />
              </Link>
            ))}
          </Card>
        </section>
      )}

      {!approvals.length && !budget && !myDocs.length && recent !== null && !recent.length && <Empty>Nada que ver aquí desde el móvil todavía</Empty>}
    </div>
  );
}
