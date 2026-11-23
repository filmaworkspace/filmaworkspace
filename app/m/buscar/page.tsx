"use client";

// Buscar: POs y facturas de todos tus proyectos (solo las que puedes ver),
// por número, proveedor, concepto o importe; y proyectos por nombre. Las
// búsquedas recientes se guardan en el dispositivo.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, type DocumentData } from "firebase/firestore";
import { ChevronRight, Clock, Folder, Search, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { getScopedDocs, scopeFromMember } from "@/lib/accountingScope";
import { docNumber } from "@/lib/myPending";
import { useMobileData } from "@/components/mobile/MobileData";
import { Card, Empty, ago, money } from "@/components/mobile/ui";

interface Hit { kind: "po" | "invoice"; id: string; projectId: string; projectName: string; number: string; supplier: string; text: string; base: number; currency: string; status: string; at: Date | null }

const RECENT = "filma-m:recent-search";
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : null);
const STATUS: Record<string, string> = { draft: "Borrador", pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", closed: "Cerrada", cancelled: "Anulada", paid: "Pagada", submitted: "En curso" };

export default function MobileSearch() {
  const { user } = useUser();
  const { data } = useMobileData();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<Hit[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(RECENT) || "[]")); } catch { /* nada */ } input.current?.focus(); }, []);

  // Índice: se carga una vez al entrar (POs y facturas que te corresponden).
  useEffect(() => {
    if (!user?.uid || !data?.projects.length || index) return;
    let alive = true;
    (async () => {
      const all = await Promise.all(data.projects.map(async (p) => {
        const m = await getDoc(doc(db, `projects/${p.id}/members`, user.uid)).catch(() => null);
        const md = m?.exists() ? m.data() : null;
        if (!md?.permissions?.accounting) return [] as Hit[];
        const scope = scopeFromMember(user.uid, md);
        const [pos, invs] = await Promise.all([
          getScopedDocs(collection(db, `projects/${p.id}/pos`), scope).catch(() => []),
          getScopedDocs(collection(db, `projects/${p.id}/invoices`), scope).catch(() => []),
        ]);
        const map = (kind: "po" | "invoice") => (s: { id: string; data: () => DocumentData }): Hit => {
          const d = s.data();
          const number = docNumber(kind, d);
          return {
            kind, id: s.id, projectId: p.id, projectName: p.name, number, supplier: d.supplier || "—",
            text: norm([number, d.supplier, d.description, d.generalDescription, d.supplierInvoiceNumber, d.department, ...(d.items || []).map((i: DocumentData) => i.description)].filter(Boolean).join(" ")),
            base: Number(d.baseAmount) || 0, currency: d.currency || "EUR",
            status: kind === "invoice" && d.approvalStatus === "pending" && !d.approvedAt ? "Pendiente" : STATUS[d.status] || d.status || "",
            at: toDate(d.updatedAt) || toDate(d.createdAt),
          };
        };
        return [...pos.map(map("po")), ...invs.map(map("invoice"))];
      }));
      if (alive) setIndex(all.flat().sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0)));
    })();
    return () => { alive = false; };
  }, [user?.uid, data?.projects, index]);

  const term = norm(q.trim());
  const amount = Number(q.replace(/\./g, "").replace(",", ".").replace(/[€\s]/g, ""));
  const hits = useMemo(() => {
    if (!index || term.length < 2) return [];
    const words = term.split(/\s+/);
    return index.filter((h) => words.every((w) => h.text.includes(w)) || (amount > 0 && Math.abs(h.base - amount) < 0.5)).slice(0, 50);
  }, [index, term, amount]);
  const projects = (data?.projects || []).filter((p) => term.length >= 2 && norm(p.name).includes(term));

  const remember = (s: string) => {
    const next = [s, ...recent.filter((r) => r !== s)].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch { /* nada */ }
  };

  return (
    <div className="space-y-5">
      <div className="sticky top-12 z-20 -mx-4 bg-white px-4 pb-3 pt-1">
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" placeholder="Número, proveedor, concepto o importe"
            className="h-11 w-full rounded-xl bg-[#F1F1F3] pl-10 pr-10 text-[16px] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
          {q && <button onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Borrar" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400"><X size={16} /></button>}
        </div>
      </div>

      {term.length < 2 ? (
        recent.length > 0 && (
          <section>
            <h2 className="mb-2 text-[13px] font-medium text-slate-500">Recientes</h2>
            <Card>
              {recent.map((r) => (
                <button key={r} onClick={() => setQ(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] active:bg-slate-50">
                  <Clock size={15} className="text-slate-400" /> {r}
                </button>
              ))}
            </Card>
          </section>
        )
      ) : (
        <>
          {projects.length > 0 && (
            <Card>
              {projects.map((p) => (
                <Link key={p.id} href={`/m/p/${p.id}`} onClick={() => remember(q.trim())} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                  <Folder size={16} className="text-slate-400" /><span className="flex-1 truncate text-[15px]">{p.name}</span><ChevronRight size={16} className="text-slate-300" />
                </Link>
              ))}
            </Card>
          )}
          {index === null ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : hits.length === 0 && projects.length === 0 ? (
            <Empty>Sin resultados para «{q.trim()}»</Empty>
          ) : hits.length > 0 && (
            <Card>
              {hits.map((h) => (
                <Link key={`${h.kind}:${h.id}`} href={`/m/aprobaciones/${h.projectId}/${h.kind}/${h.id}?back=/m/buscar`} onClick={() => remember(q.trim())} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{h.number}</span>
                      <span className="truncate text-[11px] text-slate-400">{[h.status, h.projectName].filter(Boolean).join(" · ")}</span>
                    </div>
                    <p className="truncate text-[15px] font-medium text-slate-900">{h.supplier}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] tabular-nums">{money(h.base, h.currency)}</p>
                    <p className="text-[11px] text-slate-400">{ago(h.at)}</p>
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
