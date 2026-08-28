"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Ver como el usuario": no es un login real como esa persona (eso implicaría
// un custom token de Firebase Auth y poder escribir en su nombre — demasiado
// riesgo para un vistazo de soporte). Es una vista de solo lectura de todo lo
// que esa persona tiene: sus proyectos y rol en cada uno, su historial de
// soporte y sus borradores de Budgeting, tal cual los vería ella — sin pedirle
// una captura de pantalla ni tocar Firestore a mano.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertTriangle, ArrowLeft, Briefcase, Calculator, Crown, Download, Eye, FolderOpen, HeadphonesIcon, Loader2, Shield, Trash2,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────

interface ViewedUser {
  name: string; email: string; phone?: string; role: string;
  isDemo?: boolean; budgetingAccess?: boolean; companyId?: string | null;
}
interface ViewedProject { id: string; name: string; role?: string; position?: string; phase?: string }
interface ViewedDraft { id: string; name: string; status: "draft" | "sent"; sentToProjectName: string | null; updatedAt: any }
interface ViewedChat { status: "open" | "resolved"; lastMessage: string; ticketNumber?: number; department?: string | null }

const SPECIALTY_LABEL: Record<string, string> = { sales: "Ventas", technical: "Soporte técnico", both: "Ventas + Soporte" };

export default function ViewAsUserPage() {
  const { userId } = useParams() as { userId: string };
  const router = useRouter();
  const { user: contextUser, isLoading: userLoading } = useUser();
  const isAdmin = contextUser?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [viewedUser, setViewedUser] = useState<ViewedUser | null>(null);
  const [projects, setProjects] = useState<ViewedProject[]>([]);
  const [drafts, setDrafts] = useState<ViewedDraft[]>([]);
  const [chat, setChat] = useState<ViewedChat | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!userLoading && !isAdmin) router.push("/dashboard");
  }, [userLoading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      setLoading(true);
      try {
        const userSnap = await getDoc(doc(db, "users", userId));
        if (!userSnap.exists()) { setNotFound(true); setLoading(false); return; }
        const data = userSnap.data();
        setViewedUser({
          name: data.name || data.email, email: data.email, phone: data.phone || "",
          role: data.role || "user", isDemo: !!data.isDemo, budgetingAccess: !!data.budgetingAccess, companyId: data.companyId || null,
        });

        const userProjectsSnap = await getDocs(collection(db, `userProjects/${userId}/projects`));
        const projectsData = await Promise.all(
          userProjectsSnap.docs.map(async (upDoc) => {
            const upData = upDoc.data();
            const projectDoc = await getDoc(doc(db, "projects", upDoc.id));
            return {
              id: upDoc.id,
              name: projectDoc.exists() ? projectDoc.data().name : "Proyecto eliminado",
              phase: projectDoc.exists() ? projectDoc.data().phase : undefined,
              role: upData.role, position: upData.position,
            };
          })
        );
        setProjects(projectsData);

        if (data.budgetingAccess) {
          const draftsSnap = await getDocs(query(collection(db, `userBudgetingDrafts/${userId}/drafts`), orderBy("updatedAt", "desc")));
          setDrafts(draftsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ViewedDraft)));
        }

        const chatSnap = await getDoc(doc(db, "supportChats", userId));
        if (chatSnap.exists()) {
          const c = chatSnap.data();
          setChat({ status: c.status || "resolved", lastMessage: c.lastMessage || "", ticketNumber: c.ticketNumber, department: c.department || null });
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAdmin, userId]);

  // Todo lo que se ve en esta página, tal cual, en un archivo — para
  // responder a una petición de baja o de acceso a datos sin tener que
  // recopilarlo a mano de varias colecciones.
  const handleExport = () => {
    if (!viewedUser) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      user: { id: userId, ...viewedUser },
      projects,
      budgetingDrafts: drafts,
      supportChat: chat,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${viewedUser.email.replace(/[^\w.@-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid: userId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Error al eliminar");
      router.push("/admindashboard");
    } catch (err: any) {
      setDeleteError(err.message || "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  };

  if (userLoading || loading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAdmin) return null;
  if (notFound || !viewedUser) {
    return (
      <div className={"min-h-screen bg-white flex flex-col items-center justify-center gap-4 " + inter.className}>
        <p className="text-slate-500 text-sm">Usuario no encontrado.</p>
        <Link href="/admindashboard" className="text-sm font-medium text-slate-900 hover:underline">Volver a admindashboard</Link>
      </div>
    );
  }

  return (
    <div className={"min-h-screen bg-slate-50 " + inter.className}>
      {/* Aviso permanente de solo lectura: aunque no haya nada que escribir en
          esta página, deja claro que esto no es la sesión de la persona. */}
      <div className="bg-amber-500 text-amber-950 text-xs font-semibold text-center py-1.5 flex items-center justify-center gap-1.5">
        <Eye size={12} />
        Viendo como {viewedUser.name} · Solo lectura — nada de lo que hay aquí se guarda en su cuenta
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <Link href="/admindashboard" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
            <ArrowLeft size={13} />
            Volver a admindashboard
          </Link>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-white"
          >
            <Download size={12} />
            Exportar datos
          </button>
        </div>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-slate-200 to-slate-300 rounded-2xl flex items-center justify-center text-slate-600 text-xl font-semibold flex-shrink-0">
            {viewedUser.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{viewedUser.name}</h1>
              {viewedUser.role === "admin" && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-lg text-[11px] font-semibold"><Crown size={10} />Admin</span>
              )}
              {viewedUser.isDemo && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">Demo</span>}
            </div>
            <p className="text-sm text-slate-500">{viewedUser.email}{viewedUser.phone ? ` · ${viewedUser.phone}` : ""}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="border border-slate-200 rounded-xl px-4 py-3 bg-white flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#6D5A88" }}>
              <Calculator size={15} className="text-white" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900">{viewedUser.budgetingAccess ? "Tiene acceso" : "Sin acceso"}</p>
              <p className="text-[11px] text-slate-500">Budgeting</p>
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl px-4 py-3 bg-white flex items-center gap-3">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${chat?.status === "open" ? "bg-amber-50" : "bg-slate-100"}`}>
              <HeadphonesIcon size={15} className={chat?.status === "open" ? "text-amber-600" : "text-slate-400"} />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900">{chat ? (chat.status === "open" ? "Ticket abierto" : "Sin tickets abiertos") : "Nunca escribió a soporte"}</p>
              {chat?.lastMessage && <p className="text-[11px] text-slate-500 truncate max-w-[200px]">"{chat.lastMessage}"</p>}
            </div>
          </div>
        </div>

        <section className="mb-8">
          <p className="text-sm font-semibold text-slate-700 mb-3">Proyectos ({projects.length})</p>
          {projects.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl bg-white">
              <FolderOpen size={22} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Sin proyectos asignados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((p) => (
                <Link key={p.id} href={`/admindashboard/project/${p.id}`} className="flex items-center justify-between p-3.5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0"><Briefcase size={13} className="text-blue-600" /></div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{p.name}</p>
                      {p.phase && <p className="text-[11px] text-slate-400">{p.phase}</p>}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium">{p.role || p.position || "—"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {viewedUser.budgetingAccess && (
          <section>
            <p className="text-sm font-semibold text-slate-700 mb-3">Borradores de Budgeting ({drafts.length})</p>
            {drafts.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                <Calculator size={22} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Sin borradores todavía</p>
              </div>
            ) : (
              <div className="space-y-2">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-3.5 bg-white border border-slate-200 rounded-xl">
                    <p className="text-sm font-medium text-slate-900">{d.name}</p>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${d.status === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500 border border-slate-200"}`}>
                      {d.status === "sent" ? `Enviado a ${d.sentToProjectName}` : "Borrador"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Zona de riesgo: al fondo, después de haber visto todo lo que tiene
            la cuenta — con lo de arriba delante, ya no hace falta imaginarse
            qué se va a llevar por delante el borrado. */}
        <section className="mt-10 pt-6 border-t border-slate-200">
          <p className="text-sm font-semibold text-red-700 mb-1">Zona de riesgo</p>
          <p className="text-xs text-slate-500 mb-3">
            Elimina la cuenta de Auth y Firestore, la quita de sus {projects.length} proyecto{projects.length !== 1 ? "s" : ""}, y borra su historial de soporte y sus {drafts.length} borrador{drafts.length !== 1 ? "es" : ""} de Budgeting. No se puede deshacer.
          </p>
          <button
            onClick={() => { setShowDeleteConfirm(true); setDeleteError(""); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700"
          >
            <Trash2 size={14} />
            Eliminar cuenta
          </button>
        </section>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Eliminar a {viewedUser.name}</h3>
            </div>
            <p className="text-sm text-slate-600 mb-5">
              Se borrará de Firebase Auth, sus {projects.length} proyecto{projects.length !== 1 ? "s" : ""}, su historial de soporte y sus {drafts.length} borrador{drafts.length !== 1 ? "es" : ""} de Budgeting. Esta acción no se puede deshacer.
            </p>
            {deleteError && <p className="text-xs text-red-600 mb-3">{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm disabled:opacity-50">
                {deleting && <Loader2 size={14} className="animate-spin" />}
                {deleting ? "Eliminando..." : "Eliminar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
