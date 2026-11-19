"use client";

// ─── Panel de coordinación ───────────────────────────────────────────────────
// Lo que coordinación necesita ver al empezar el día: qué pasa esta semana
// (incorporaciones, bajas, eventos del calendario), qué queda pendiente
// (altas por aprobar, fichas sin completar, documentación) y cómo va el
// control horario de hoy.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { ClipboardCheck, Plus, Settings } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { Page, PageHeader, PageLoading, buttonClass } from "@/components/ds";

type CrewSection = "technical" | "cast" | "specialists";

interface CrewMember {
  id: string;
  crewNumber: string;
  section: CrewSection;
  name: string;
  role: string;
  department: string;
  status: "active" | "inactive" | "pending";
  approvalStatus?: string;
  startDate?: string;
  endDateApprox?: string;
  docs: number;
  formSent: boolean;
  phone?: string;
}

interface AgendaItem {
  date: string;
  kind: "join" | "leave" | "event";
  label: string;
  detail: string;
  href?: string;
}

const REQUIRED_DOC_COUNT = 6;
const EVENT_LABEL: Record<string, string> = {
  scene: "Escena", location: "Localización", note: "Nota", milestone: "Hito", crew_join: "Incorporación", crew_leave: "Baja",
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDaysISO = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => {
  const t = todayISO();
  if (iso === t) return "Hoy";
  if (iso === addDaysISO(t, 1)) return "Mañana";
  const d = new Date(iso + "T12:00:00");
  const s = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function TeamPanelPage() {
  const { id } = useParams() as { id: string };
  const [loading, setLoading] = useState(true);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [events, setEvents] = useState<{ date: string; endDate?: string; category: string; title: string; location?: string }[]>([]);
  const [timesheet, setTimesheet] = useState<{ sent: boolean; recipients: number; responded: number } | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) return;
      try {
        const today = todayISO();
        const [crewSnap, eventsSnap, daySnap, formsSnap] = await Promise.all([
          getDocs(collection(db, `projects/${id}/crew`)),
          getDocs(query(collection(db, `projects/${id}/calendarEvents`), where("date", ">=", addDaysISO(today, -30)))).catch(() => null),
          getDoc(doc(db, `projects/${id}/horario`, today)).catch(() => null),
          getDocs(query(collection(db, `projects/${id}/horarioForms`), where("date", "==", today))).catch(() => null),
        ]);
        setCrew(crewSnap.docs.map((d) => {
          const v = d.data();
          return {
            id: d.id,
            crewNumber: v.crewNumber || "",
            section: v.section || "technical",
            name: [v.firstName || v.name, v.lastName1, v.lastName2].filter(Boolean).join(" "),
            role: v.role || "",
            department: v.department || "",
            status: v.status || "active",
            approvalStatus: v.approvalStatus,
            startDate: v.startDate || "",
            endDateApprox: v.endDateApprox || "",
            docs: Object.values(v.documents || {}).filter(Boolean).length,
            formSent: !!v.formSentAt,
            phone: v.phone || "",
          };
        }));
        setEvents((eventsSnap?.docs || []).map((d) => d.data() as any));
        if (daySnap?.exists()) {
          const day = daySnap.data();
          const responded = (formsSnap?.docs || []).filter((f) => f.data().submittedAt).length;
          setTimesheet({ sent: day.status === "sent", recipients: (day.recipients || []).length, responded });
        }
      } catch (e) {
        console.error("Error cargando el panel de equipo:", e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [id]);

  const today = todayISO();
  const weekEnd = addDaysISO(today, 6);
  const in14 = addDaysISO(today, 14);
  const live = crew.filter((m) => m.status !== "inactive");

  const agenda = useMemo(() => {
    const items: AgendaItem[] = [];
    for (const m of crew) {
      if (m.startDate && m.startDate >= today && m.startDate <= weekEnd)
        items.push({ date: m.startDate, kind: "join", label: "Incorporación", detail: `${m.name} · ${m.role}${m.department ? ` (${m.department})` : ""}`, href: `/project/${id}/team/crew/${m.id}` });
      if (m.endDateApprox && m.status !== "inactive" && m.endDateApprox >= today && m.endDateApprox <= weekEnd)
        items.push({ date: m.endDateApprox, kind: "leave", label: "Baja", detail: `${m.name} · ${m.role}${m.department ? ` (${m.department})` : ""}`, href: `/project/${id}/team/crew/${m.id}` });
    }
    for (const e of events) {
      if (e.category === "crew_join" || e.category === "crew_leave") continue; // ya salen de las fechas de la ficha
      const end = e.endDate || e.date;
      if (end < today || e.date > weekEnd) continue;
      items.push({ date: e.date < today ? today : e.date, kind: "event", label: EVENT_LABEL[e.category] || "Evento", detail: [e.title, e.location].filter(Boolean).join(" · "), href: `/project/${id}/team/calendar` });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  }, [crew, events, today, weekEnd, id]);

  const pending = [
    { n: crew.filter((m) => m.approvalStatus === "pending_approval").length, label: "Altas por aprobar", href: `/project/${id}/team/approvals` },
    { n: live.filter((m) => m.status === "pending" && !m.formSent).length, label: "Fichas de alta sin enviar", href: `/project/${id}/team/crew?f=pending` },
    { n: live.filter((m) => m.status === "pending" && m.formSent).length, label: "Fichas enviadas sin completar", href: `/project/${id}/team/crew?f=pending` },
    { n: live.filter((m) => m.docs < REQUIRED_DOC_COUNT).length, label: "Con documentación incompleta", href: `/project/${id}/team/crew?f=missing` },
    { n: live.filter((m) => !m.phone).length, label: "Sin teléfono de contacto", href: `/project/${id}/team/crew` },
    { n: live.filter((m) => m.endDateApprox && m.endDateApprox >= today && m.endDateApprox <= in14).length, label: "Terminan en 14 días", href: `/project/${id}/team/crew?f=ending` },
  ];

  const byDept = useMemo(() => {
    const map = new Map<string, { active: number; pending: number; missing: number }>();
    for (const m of live) {
      const k = m.department || (m.section === "cast" ? "Reparto" : m.section === "specialists" ? "Especialistas" : "Sin departamento");
      const v = map.get(k) || { active: 0, pending: 0, missing: 0 };
      if (m.status === "active") v.active++; else v.pending++;
      if (m.docs < REQUIRED_DOC_COUNT) v.missing++;
      map.set(k, v);
    }
    return [...map.entries()].sort((a, b) => b[1].active + b[1].pending - (a[1].active + a[1].pending));
  }, [live]);

  if (loading) return <PageLoading />;

  const iconLink = "flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:text-slate-900";

  return (
    <Page>
      <PageHeader
        title={<>Panel de coordinación <span className="text-base font-normal text-slate-400">{live.length}</span></>}
        actions={
          <>
            <Link href={`/project/${id}/team/approvals`} className={iconLink} title="Aprobaciones de altas" aria-label="Aprobaciones de altas"><ClipboardCheck size={17} /></Link>
            <Link href={`/project/${id}/team/config`} className={iconLink} title="Configuración de equipo" aria-label="Configuración de equipo"><Settings size={17} /></Link>
            <Link href={`/project/${id}/team/crew`} className={buttonClass("primary")}><Plus size={14} /> Añadir miembro</Link>
          </>
        }
      />

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Agenda */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Próximos 7 días</h2>
            <Link href={`/project/${id}/team/calendar`} className="text-xs text-slate-500 hover:text-slate-900">Calendario</Link>
          </div>
          {agenda.length === 0 ? (
            <p className="border-y border-slate-200 py-8 text-center text-[13px] text-slate-500">Sin incorporaciones, bajas ni eventos esta semana</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="tbl w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                    <th scope="col" className="w-32 px-4 py-2 text-left font-medium">Día</th>
                    <th scope="col" className="w-32 px-3 py-2 text-left font-medium">Tipo</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {agenda.map((a, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                      <td className={`px-4 py-1.5 ${a.date === today ? "font-medium text-slate-900" : "text-slate-600"}`}>{dayLabel(a.date)}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                          <span className={`h-1.5 w-1.5 rounded-full ${a.kind === "join" ? "bg-emerald-500" : a.kind === "leave" ? "bg-red-500" : "bg-slate-400"}`} />
                          {a.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">{a.href ? <Link href={a.href} className="text-slate-800 hover:underline">{a.detail}</Link> : a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Equipo por departamento</h2>
            <Link href={`/project/${id}/team/crew`} className="text-xs text-slate-500 hover:text-slate-900">Ver crew</Link>
          </div>
          {byDept.length === 0 ? (
            <p className="border-y border-slate-200 py-8 text-center text-[13px] text-slate-500">Aún no hay nadie en el equipo</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="tbl w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                    <th scope="col" className="px-4 py-2 text-left font-medium">Departamento</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Activos</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Pendientes</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Falta documentación</th>
                  </tr>
                </thead>
                <tbody>
                  {byDept.map(([dept, v]) => (
                    <tr key={dept} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                      <td className="px-4 py-1.5 font-medium text-slate-900">{dept}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{v.active}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${v.pending ? "text-amber-800" : "text-slate-300"}`}>{v.pending}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${v.missing ? "text-amber-800" : "text-slate-300"}`}>{v.missing}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="px-4 py-2 font-medium">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">{byDept.reduce((s, [, v]) => s + v.active, 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">{byDept.reduce((s, [, v]) => s + v.pending, 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">{byDept.reduce((s, [, v]) => s + v.missing, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Lateral */}
        <aside className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-slate-900">Pendiente</h2>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {pending.map((p) => (
                <Link
                  key={p.label}
                  href={p.href}
                  className={`flex items-center justify-between border-b border-slate-100 px-3.5 py-2 text-[13px] last:border-0 hover:bg-[#FAFAFA] ${p.n ? "text-slate-800" : "text-slate-400"}`}
                >
                  {p.label}
                  <span className={`tabular-nums text-xs ${p.n ? "font-semibold text-slate-900" : ""}`}>{p.n}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold text-slate-900">Control horario de hoy</h2>
              <Link href={`/project/${id}/team/timesheet`} className="text-xs text-slate-500 hover:text-slate-900">Abrir</Link>
            </div>
            <div className="rounded-lg border border-slate-200 px-3.5 py-3 text-[13px]">
              {!timesheet ? (
                <p className="text-slate-500">Hoy no hay jornada preparada.</p>
              ) : !timesheet.sent ? (
                <p className="text-slate-600">Jornada preparada para {timesheet.recipients} {timesheet.recipients === 1 ? "persona" : "personas"}, <span className="text-amber-800">sin enviar</span>.</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-600">Han respondido</span>
                    <span className="tabular-nums text-sm font-semibold">{timesheet.responded} / {timesheet.recipients}</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-slate-900" style={{ width: `${timesheet.recipients ? Math.round((timesheet.responded / timesheet.recipients) * 100) : 0}%` }} />
                  </div>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </Page>
  );
}
