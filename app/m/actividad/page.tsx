"use client";

// Actividad: lo que ha pasado con lo tuyo, agrupado por día. Lo nuevo desde
// la última visita lleva un punto.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock, Inbox, Mail, X } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { useMobileData } from "@/components/mobile/MobileData";
import { PullToRefresh } from "@/components/mobile/gestures";
import { Card, Empty, ago, money } from "@/components/mobile/ui";
import { activitySeen, buildActivity, dayGroup, markActivitySeen, type ActivityTone } from "@/lib/mobileActivity";

const ICON: Record<ActivityTone, { icon: React.ElementType; cls: string }> = {
  action: { icon: Inbox, cls: "bg-[#EEF1FD] text-[#2F52E0]" },
  ok: { icon: Check, cls: "bg-emerald-50 text-emerald-600" },
  bad: { icon: X, cls: "bg-red-50 text-red-600" },
  wait: { icon: Clock, cls: "bg-amber-50 text-amber-600" },
  info: { icon: Mail, cls: "bg-slate-100 text-slate-500" },
};

export default function MobileActivity() {
  const { user } = useUser();
  const { data, invitations, loading, reload } = useMobileData();
  const [seen, setSeen] = useState<number | null>(null);
  const items = useMemo(() => buildActivity(data, invitations), [data, invitations]);

  // Lo nuevo se marca con lo que había al entrar; al salir queda visto.
  useEffect(() => {
    if (!user?.uid) return;
    setSeen(activitySeen(user.uid));
    return () => markActivitySeen(user.uid);
  }, [user?.uid]);
  useEffect(() => { if (user?.uid && !loading) markActivitySeen(user.uid); }, [user?.uid, loading]);

  const groups = new Map<string, typeof items>();
  for (const it of items) { const g = dayGroup(it.at); groups.set(g, [...(groups.get(g) || []), it]); }

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="space-y-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Actividad</h1>
        {loading && !data ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : items.length === 0 ? (
          <Empty>Sin actividad por ahora</Empty>
        ) : (
          [...groups.entries()].map(([g, list]) => (
            <section key={g}>
              <h2 className="mb-2 text-[13px] font-medium text-slate-500">{g}</h2>
              <Card>
                {list.map((it) => {
                  const I = ICON[it.tone];
                  const isNew = seen !== null && it.at && it.at.getTime() > seen && it.tone !== "info";
                  return (
                    <Link key={it.id} href={it.href} className="flex items-start gap-3 px-4 py-3 active:bg-slate-50">
                      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${I.cls}`}><I.icon size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[14px] font-medium text-slate-900">
                          <span className="truncate">{it.title}</span>
                          {isNew && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#2F52E0]" aria-label="Nuevo" />}
                        </p>
                        <p className={`line-clamp-2 text-xs ${it.tone === "bad" ? "text-red-600" : "text-slate-500"}`}>{it.detail}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {it.amount !== undefined && <p className="text-[13px] tabular-nums text-slate-900">{money(it.amount)}</p>}
                        <p className="text-[11px] text-slate-400">{ago(it.at)}</p>
                      </div>
                    </Link>
                  );
                })}
              </Card>
            </section>
          ))
        )}
      </div>
    </PullToRefresh>
  );
}
