"use client";

// Bandeja de aprobaciones móvil: todo lo que espera a la persona, por proyecto.

import { useMobileData } from "@/components/mobile/MobileData";
import { ApprovalRow, Card, Empty, SectionTitle, money } from "@/components/mobile/ui";

export default function MobileApprovals() {
  const { data, loading } = useMobileData();
  const approvals = data?.approvals || [];
  const byProject = new Map<string, { name: string; items: typeof approvals }>();
  for (const a of approvals) {
    const g = byProject.get(a.projectId) || { name: a.projectName, items: [] };
    g.items.push(a);
    byProject.set(a.projectId, g);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold tracking-tight">
        Aprobaciones{approvals.length > 0 && <span className="ml-2 text-base font-normal tabular-nums text-slate-400">{approvals.length}</span>}
      </h1>
      {loading ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : approvals.length === 0 ? (
        <Empty>Nada pendiente de aprobar</Empty>
      ) : (
        [...byProject.entries()].map(([pid, g]) => (
          <section key={pid}>
            <SectionTitle count={g.items.length} action={<span className="text-xs tabular-nums text-slate-400">{money(g.items.reduce((t, a) => t + a.base, 0))}</span>}>{g.name}</SectionTitle>
            <Card>{g.items.map((a) => <ApprovalRow key={`${a.kind}:${a.id}`} a={a} showProject={false} />)}</Card>
          </section>
        ))
      )}
    </div>
  );
}
