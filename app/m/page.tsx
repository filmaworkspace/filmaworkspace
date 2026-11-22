"use client";

// Inicio móvil: lo que te espera (aprobaciones e invitaciones) y el estado de
// tus documentos.

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { toast, errorText } from "@/lib/toast";
import { useMobileData } from "@/components/mobile/MobileData";
import { ApprovalRow, Card, DocRow, Empty, SectionTitle, money } from "@/components/mobile/ui";

export default function MobileHome() {
  const { user } = useUser();
  const { data, invitations, loading, reload } = useMobileData();
  const [busy, setBusy] = useState<string | null>(null);
  const approvals = data?.approvals || [];
  const docs = data?.myDocs || [];
  const totalBase = approvals.reduce((t, a) => t + (a.currency === "EUR" ? a.base : 0), 0);

  const answerInvitation = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      if (accept) {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/accept-invitation", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ invitationId: id }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se ha podido aceptar la invitación");
        toast.success("Invitación aceptada");
      } else {
        const { doc, updateDoc, Timestamp } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        await updateDoc(doc(db, "invitations", id), { status: "rejected", respondedAt: Timestamp.now() });
        toast.info("Invitación rechazada");
      }
      await reload();
    } catch (e) { toast.error(errorText(e, "No se ha podido responder")); } finally { setBusy(null); }
  };

  const first = (user?.name || "").split(" ")[0];

  return (
    <div className="space-y-7">
      <h1 className="text-[22px] font-semibold tracking-tight">{first ? `Hola, ${first}` : "Hola"}</h1>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : (
        <>
          <section>
            <SectionTitle count={approvals.length} action={approvals.length > 3 ? <Link href="/m/aprobaciones" className="text-[13px] font-medium text-slate-700">Ver todas</Link> : undefined}>
              Pendiente de ti
            </SectionTitle>
            {approvals.length === 0 ? <Empty>Nada pendiente de aprobar</Empty> : (
              <>
                {approvals.length > 1 && <p className="mb-2 text-xs text-slate-500">{money(totalBase)} en base imponible</p>}
                <Card>{approvals.slice(0, 3).map((a) => <ApprovalRow key={`${a.kind}:${a.id}`} a={a} />)}</Card>
              </>
            )}
          </section>

          {invitations.length > 0 && (
            <section>
              <SectionTitle count={invitations.length}>Invitaciones</SectionTitle>
              <Card>
                {invitations.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{i.projectName}</p>
                      <p className="truncate text-xs text-slate-500">{[i.role || i.position, i.department, i.invitedByName && `de ${i.invitedByName}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    <button disabled={busy === i.id} onClick={() => answerInvitation(i.id, false)} className="h-9 rounded-lg px-3 text-[13px] text-slate-500 disabled:opacity-50">Rechazar</button>
                    <button disabled={busy === i.id} onClick={() => answerInvitation(i.id, true)} className="h-9 rounded-lg border border-[#E4E4E7] bg-[#F1F1F3] px-3 text-[13px] font-medium disabled:opacity-50">Aceptar</button>
                  </div>
                ))}
              </Card>
            </section>
          )}

          <section>
            <SectionTitle count={docs.length}>Tus documentos</SectionTitle>
            {docs.length === 0 ? <Empty>No tienes documentos en curso</Empty> : <Card>{docs.slice(0, 8).map((d) => <DocRow key={`${d.kind}:${d.id}`} d={d} />)}</Card>}
          </section>

          {(data?.projects.length || 0) > 0 && (
            <section>
              <SectionTitle count={data!.projects.length}>Proyectos</SectionTitle>
              <Card>
                {data!.projects.map((p) => {
                  const n = approvals.filter((a) => a.projectId === p.id).length;
                  return (
                    <Link key={p.id} href={`/m/p/${p.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                      <span className="min-w-0 flex-1 truncate text-[15px]">{p.name}</span>
                      {n > 0 && <span className="rounded-full bg-[#EEF1FD] px-2 py-0.5 text-[11px] font-medium text-[#2F52E0]">{n} pendiente{n === 1 ? "" : "s"}</span>}
                      <ChevronRight size={16} className="shrink-0 text-slate-300" />
                    </Link>
                  );
                })}
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
