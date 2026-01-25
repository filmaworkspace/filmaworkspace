"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { Plus, Trash2, AlertCircle, CheckCircle, ArrowLeft, ChevronDown, MoreHorizontal, Users, Briefcase, X } from "lucide-react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc, collection, getDocs, arrayUnion, arrayRemove } from "firebase/firestore";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface Member { userId: string; name: string; email: string; department?: string; position?: string; }
interface DepartmentData { name: string; members: Member[]; }

export default function ConfigDepartments() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasConfigAccess, setHasConfigAccess] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [departmentsData, setDepartmentsData] = useState<DepartmentData[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDepartment, setNewDepartment] = useState("");
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/");
      else setUserId(u.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!userId || !id) return;
    const loadData = async () => {
      try {
        const userProjectSnap = await getDoc(doc(db, `userProjects/${userId}/projects/${id}`));
        if (!userProjectSnap.exists()) { setLoading(false); return; }
        const hasConfig = userProjectSnap.data().permissions?.config || false;
        setHasConfigAccess(hasConfig);
        if (!hasConfig) { setLoading(false); return; }
        const projectSnap = await getDoc(doc(db, "projects", id as string));
        if (projectSnap.exists()) {
          setProjectName(projectSnap.data().name);
          setDepartments(projectSnap.data().departments || []);
        }
        const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
        setMembers(membersSnap.docs.map((d) => ({ userId: d.id, name: d.data().name, email: d.data().email, department: d.data().department, position: d.data().position })));
        setLoading(false);
      } catch { showToast("error", "Error al cargar"); setLoading(false); }
    };
    loadData();
  }, [userId, id, router]);

  useEffect(() => {
    const data: DepartmentData[] = departments.map((d) => ({ name: d, members: members.filter((m) => m.department === d) })).sort((a, b) => a.name.localeCompare(b.name));
    setDepartmentsData(data);
  }, [departments, members]);

  const handleAddDepartment = async () => {
    if (!id || !newDepartment.trim()) return;
    if (departments.includes(newDepartment.trim())) { showToast("error", "Ya existe este departamento"); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", id as string), { departments: arrayUnion(newDepartment.trim()) });
      setDepartments([...departments, newDepartment.trim()]);
      setNewDepartment("");
      setShowAddForm(false);
      showToast("success", "Departamento creado");
    } catch { showToast("error", "Error al crear"); } finally { setSaving(false); }
  };

  const handleRemoveDepartment = async (dept: string) => {
    const usersIn = members.filter((m) => m.department === dept);
    if (usersIn.length > 0) { showToast("error", `No se puede eliminar: tiene ${usersIn.length} miembro${usersIn.length !== 1 ? "s" : ""}`); setConfirmDelete(null); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", id as string), { departments: arrayRemove(dept) });
      setDepartments(departments.filter((d) => d !== dept));
      showToast("success", "Departamento eliminado");
    } catch { showToast("error", "Error"); } finally { setSaving(false); setConfirmDelete(null); setActiveMenu(null); }
  };

  if (loading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (!hasConfigAccess) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={28} className="text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6">No tienes acceso a esta configuración</p>
        <Link href="/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
          <ArrowLeft size={16} />
          Volver a Proyectos
        </Link>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-2xl text-sm font-medium shadow-lg flex items-center gap-2 ${toast.type === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Delete Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">¿Eliminar departamento?</h3>
              <button onClick={() => setConfirmDelete(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-6">Se eliminará "<span className="font-medium text-slate-700">{confirmDelete}</span>" del proyecto.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
                  Cancelar
                </button>
                <button onClick={() => handleRemoveDepartment(confirmDelete)} disabled={saving} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Briefcase size={24} style={{ color: '#2F52E0' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Departamentos del proyecto</h1>
            </div>
      
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#2F52E0' }}
            >
              <Plus size={16} strokeWidth={2.5} />
              Nuevo
            </button>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8 space-y-6">
        {/* Add Form */}
        {showAddForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex gap-3">
              <input
                type="text"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddDepartment()}
                placeholder="Nombre del departamento (ej: Producción, Arte, Sonido...)"
                autoFocus
                className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
              />
              <button onClick={handleAddDepartment} disabled={saving || !newDepartment.trim()} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50">
                Crear
              </button>
              <button onClick={() => { setShowAddForm(false); setNewDepartment(""); }} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-200">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Departments Grid */}
        {departmentsData.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {departmentsData.map((dept) => {
              const isExpanded = expandedDept === dept.name;
              return (
                <div key={dept.name} className="bg-white rounded-2xl border border-slate-200 overflow-visible">
                  <div 
                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors cursor-pointer group" 
                    onClick={() => setExpandedDept(isExpanded ? null : dept.name)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                        <Briefcase size={18} className="text-slate-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{dept.name}</p>
                        <p className="text-sm text-slate-500">{dept.members.length} miembro{dept.members.length !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === dept.name ? null : dept.name); }} 
                          className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {activeMenu === dept.name && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setActiveMenu(null)} />
                            <div className="absolute right-0 top-full mt-2 w-40 bg-white border border-slate-200 rounded-2xl shadow-xl py-1.5 z-20">
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setActiveMenu(null); 
                                  if (dept.members.length > 0) showToast("error", "Tiene miembros asignados"); 
                                  else setConfirmDelete(dept.name); 
                                }} 
                                className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              >
                                <Trash2 size={14} />
                                Eliminar
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      <ChevronDown size={18} className={`text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="px-6 pb-5 pt-2 border-t border-slate-100 bg-slate-50/30">
                      {dept.members.length > 0 ? (
                        <div className="space-y-2">
                          {dept.members.map((m) => (
                            <div key={m.userId} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100">
                              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-sm">
                                {m.name?.[0]?.toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-slate-900 text-sm truncate">{m.name}</p>
                                {m.position && <p className="text-xs text-slate-500">{m.position}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 bg-white rounded-xl border border-dashed border-slate-200">
                          <Users size={18} className="text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-400">Sin miembros</p>
                          <Link href={`/project/${id}/config/users`} className="text-xs text-slate-600 hover:text-slate-900 underline mt-1 inline-block">
                            Asignar desde Usuarios
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Briefcase size={28} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Sin departamentos</h3>
            <p className="text-slate-500 text-sm mb-6">Crea el primer departamento para organizar tu equipo</p>
            <button onClick={() => setShowAddForm(true)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
              <Plus size={16} />
              Crear departamento
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
