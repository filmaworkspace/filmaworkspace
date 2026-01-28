"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  Settings, BarChart3, Users, Building2, Clock,
  Film, Tv, Briefcase, ChevronRight, Shield, Copy, CheckCircle
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, getDocs, Timestamp } from "firebase/firestore";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];

interface Member {
  userId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
}

interface ProjectData {
  name: string;
  description?: string;
  phase?: string;
  producers?: string[];
  producerNames?: string[];
  departments?: string[];
  createdAt?: Timestamp;
  archived?: boolean;
  closingAt?: Timestamp | null;
}

interface UserPermissions {
  config: boolean;
  accounting: boolean;
  team: boolean;
}

export default function ProjectOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [userPermissions, setUserPermissions] = useState<UserPermissions>({ config: false, accounting: false, team: false });
  const [projectType, setProjectType] = useState<"pelicula" | "serie" | null>(null);
  const [episodes, setEpisodes] = useState<number>(0);
  const [daysUntilClose, setDaysUntilClose] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [currentUserPosition, setCurrentUserPosition] = useState<string>("");
  const [currentUserDepartment, setCurrentUserDepartment] = useState<string>("");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) router.push("/");
      else setUserId(user.uid);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userId && id) loadData();
  }, [userId, id]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Verificar acceso del usuario
      const userProjectRef = doc(db, `userProjects/${userId}/projects/${id}`);
      const userProjectSnap = await getDoc(userProjectRef);
      if (!userProjectSnap.exists()) {
        router.push("/dashboard");
        return;
      }
      const userProjectData = userProjectSnap.data();
      setUserPermissions({
        config: userProjectData.permissions?.config || false,
        accounting: userProjectData.permissions?.accounting || false,
        team: userProjectData.permissions?.team || false,
      });

      // Obtener datos del usuario actual en el proyecto
      const currentMemberRef = doc(db, `projects/${id}/members`, userId!);
      const currentMemberSnap = await getDoc(currentMemberRef);
      if (currentMemberSnap.exists()) {
        const currentMemberData = currentMemberSnap.data();
        setCurrentUserRole(currentMemberData.role || "");
        setCurrentUserPosition(currentMemberData.position || "");
        setCurrentUserDepartment(currentMemberData.department || "");
      }

      // Cargar datos del proyecto
      const projectRef = doc(db, "projects", id);
      const projectSnap = await getDoc(projectRef);
      if (!projectSnap.exists()) {
        router.push("/dashboard");
        return;
      }
      const projectData = projectSnap.data() as ProjectData;
      setProject(projectData);

      // Calcular días hasta cierre
      if (projectData.closingAt) {
        const now = new Date();
        const closeDate = projectData.closingAt.toDate();
        const diffTime = closeDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        setDaysUntilClose(diffDays > 0 ? diffDays : 0);
      }

      // Cargar tipo de proyecto
      try {
        const productionConfigRef = doc(db, `projects/${id}/config/production`);
        const productionConfigSnap = await getDoc(productionConfigRef);
        if (productionConfigSnap.exists()) {
          const configData = productionConfigSnap.data();
          setProjectType(configData.projectType || null);
          setEpisodes(configData.episodes || 0);
        }
      } catch (e) {
        console.error("Error loading production config:", e);
      }

      // Cargar miembros (igual que config-users)
      const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
      const membersData = membersSnap.docs.map((d) => ({
        userId: d.id,
        name: d.data().name,
        email: d.data().email,
        role: d.data().role,
        department: d.data().department,
        position: d.data().position,
        permissions: d.data().permissions || { config: false, accounting: false, team: false }
      }));
      
      // Ordenar: roles de proyecto primero, luego por nombre
      membersData.sort((a, b) => {
        const aIsProjectRole = PROJECT_ROLES.includes(a.role || "");
        const bIsProjectRole = PROJECT_ROLES.includes(b.role || "");
        if (aIsProjectRole && !bIsProjectRole) return -1;
        if (!aIsProjectRole && bIsProjectRole) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
      setMembers(membersData);

    } catch (error) {
      console.error("Error loading project:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: Timestamp | undefined) => {
    if (!timestamp) return "";
    return timestamp.toDate().toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  // Determinar si el usuario actual es rol de proyecto
  const isProjectRole = PROJECT_ROLES.includes(currentUserRole);
  
  // Determinar si puede ver todos los usuarios (roles de proyecto ven todo)
  const canViewAllMembers = isProjectRole;
  
  // Determinar si puede ver su departamento (HOD y Coordinator)
  const canViewOwnDepartment = ["HOD", "Coordinator"].includes(currentUserPosition);

  // Filtrar miembros según permisos
  const getVisibleMembers = () => {
    if (canViewAllMembers) {
      return members;
    }
    if (canViewOwnDepartment && currentUserDepartment) {
      // Solo ver miembros de su departamento
      return members.filter(m => m.department === currentUserDepartment);
    }
    // Crew solo se ve a sí mismo
    return members.filter(m => m.userId === userId);
  };

  const visibleMembers = getVisibleMembers();
  const projectRoleMembers = visibleMembers.filter(m => PROJECT_ROLES.includes(m.role || ""));
  const departmentMembers = visibleMembers.filter(m => !PROJECT_ROLES.includes(m.role || "") && m.department);

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center">
          <p className="text-slate-600">Proyecto no encontrado</p>
          <Link href="/dashboard" className="text-blue-600 hover:underline mt-2 inline-block">
            Volver al dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-24 pb-12">
        
        {/* Header del proyecto */}
        <div className="mb-10">
          {/* Aviso de cierre - inline con título */}
          {daysUntilClose !== null && (
            <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
              <Clock size={14} className="text-red-500" />
              <span className="text-sm font-medium text-red-700">
                Cierra en {daysUntilClose} día{daysUntilClose !== 1 ? "s" : ""} · {project.closingAt ? formatDate(project.closingAt) : ""}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center">
              {projectType === "serie" ? (
                <Tv size={24} className="text-slate-600" />
              ) : (
                <Film size={24} className="text-slate-600" />
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{project.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                {project.phase && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500">
                    {project.phase}
                  </span>
                )}
                {projectType && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-lg bg-violet-100 text-violet-700">
                    {projectType === "serie" ? `Serie · ${episodes} cap.` : "Película"}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {project.producerNames && project.producerNames.length > 0 && (
            <div className="flex items-center gap-2 mt-3 text-sm text-slate-500">
              <Building2 size={14} />
              <span>{project.producerNames.join(", ")}</span>
            </div>
          )}

          {project.description && (
            <p className="mt-4 text-slate-600 max-w-2xl">{project.description}</p>
          )}
        </div>

        {/* Módulos - Estilo Dashboard */}
        <div className="mb-12">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Módulos</h2>
          <div className="flex gap-2">
            {userPermissions.config && (
              <Link href={`/project/${id}/config`}>
                <div className="flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 text-slate-600 text-xs font-medium transition-colors">
                  <Settings size={12} />
                  Config
                </div>
              </Link>
            )}
            {userPermissions.accounting && (
              <Link href={`/project/${id}/accounting`}>
                <div 
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border transition-colors"
                  style={{ 
                    backgroundColor: 'rgba(47, 82, 224, 0.1)',
                    borderColor: 'rgba(47, 82, 224, 0.3)',
                    color: '#2F52E0'
                  }}
                >
                  <BarChart3 size={12} />
                  Accounting
                </div>
              </Link>
            )}
            {userPermissions.team && (
              <Link href={`/project/${id}/team`}>
                <div 
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border transition-colors"
                  style={{ 
                    backgroundColor: 'rgba(137, 211, 34, 0.15)',
                    borderColor: 'rgba(137, 211, 34, 0.4)',
                    color: '#6BA319'
                  }}
                >
                  <Users size={12} />
                  Team
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Equipo del proyecto */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Equipo ({visibleMembers.length}{!canViewAllMembers && members.length > visibleMembers.length ? ` de ${members.length}` : ""})
            </h2>
            {userPermissions.config && (
              <Link 
                href={`/project/${id}/config/users`}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
              >
                Gestionar
                <ChevronRight size={12} />
              </Link>
            )}
          </div>

          <div className="flex flex-col lg:flex-row gap-4 items-start">
            {/* Roles de Proyecto */}
            {projectRoleMembers.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex-1 lg:max-w-[50%] w-full">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                  <Shield size={16} className="text-slate-400" />
                  <h3 className="font-semibold text-slate-900 text-sm">Roles de Proyecto</h3>
                  <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{projectRoleMembers.length}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {projectRoleMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/50 group">
                      <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0">
                        {(member.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900 text-sm">{member.name}</p>
                          <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">
                            {member.role}
                          </span>
                          {member.userId === userId && <span className="text-xs text-slate-400">(tú)</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs text-slate-500 truncate">{member.email}</p>
                          <button
                            onClick={() => copyEmail(member.email)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 rounded transition-all"
                            title="Copiar email"
                          >
                            {copiedEmail === member.email ? (
                              <CheckCircle size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} className="text-slate-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Departamentos */}
            {departmentMembers.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex-1 lg:max-w-[50%] w-full">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                  <Briefcase size={16} className="text-slate-400" />
                  <h3 className="font-semibold text-slate-900 text-sm">Departamentos</h3>
                  <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{departmentMembers.length}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {departmentMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/50 group">
                      <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0">
                        {(member.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900 text-sm">{member.name}</p>
                          {member.position && (
                            <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">
                              {member.position}
                            </span>
                          )}
                          {member.department && (
                            <span className="text-xs text-slate-400">{member.department}</span>
                          )}
                          {member.userId === userId && <span className="text-xs text-slate-400">(tú)</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs text-slate-500 truncate">{member.email}</p>
                          <button
                            onClick={() => copyEmail(member.email)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 rounded transition-all"
                            title="Copiar email"
                          >
                            {copiedEmail === member.email ? (
                              <CheckCircle size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} className="text-slate-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {visibleMembers.length === 0 && (
            <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-200">
              <Users size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                {members.length === 0 ? "No hay miembros en este proyecto" : "No tienes acceso para ver otros miembros"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
