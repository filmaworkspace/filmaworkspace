"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  Settings, BarChart3, Users, Building2, Calendar, Clock, AlertTriangle,
  ChevronRight, User, Mail, Briefcase, Shield, Crown, Film, Tv,
  FolderOpen, ArrowLeft
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, getDocs, Timestamp } from "firebase/firestore";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];

const ROLE_LABELS: Record<string, string> = {
  EP: "Executive Producer",
  PM: "Production Manager",
  Controller: "Controller",
  PC: "Production Coordinator",
  HOD: "Head of Department",
  Coordinator: "Coordinator",
  Crew: "Crew",
};

interface Member {
  odMemberId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
  status: "active" | "inactive";
  joinedAt?: Timestamp;
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
  const [userRole, setUserRole] = useState<string>("");
  const [projectType, setProjectType] = useState<"pelicula" | "serie" | null>(null);
  const [episodes, setEpisodes] = useState<number>(0);
  const [daysUntilClose, setDaysUntilClose] = useState<number | null>(null);

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
      setUserRole(userProjectData.role || userProjectData.position || "");

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

      // Cargar miembros
      const membersRef = collection(db, `projects/${id}/members`);
      const membersSnap = await getDocs(membersRef);
      const membersData = membersSnap.docs
        .map(docSnap => ({
          odMemberId: docSnap.id,
          ...docSnap.data(),
        } as Member))
        .filter(m => m.status === "active")
        .sort((a, b) => {
          // Ordenar: roles de proyecto primero, luego por departamento
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

  const projectRoleMembers = members.filter(m => PROJECT_ROLES.includes(m.role || ""));
  const departmentMembers = members.filter(m => !PROJECT_ROLES.includes(m.role || ""));

  // Agrupar por departamento
  const membersByDepartment = departmentMembers.reduce((acc, member) => {
    const dept = member.department || "Sin departamento";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(member);
    return acc;
  }, {} as Record<string, Member[]>);

  if (loading) {
    return (
      <div className={`min-h-screen bg-slate-50 flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className={`min-h-screen bg-slate-50 flex items-center justify-center ${inter.className}`}>
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
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-20 pb-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
            <Link href="/dashboard" className="hover:text-slate-700 flex items-center gap-1">
              <ArrowLeft size={14} />
              Mis proyectos
            </Link>
            <ChevronRight size={14} />
            <span className="text-slate-900 font-medium">{project.name}</span>
          </div>

          {/* Aviso de cierre */}
          {daysUntilClose !== null && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-red-800">
                  Este proyecto cierra en {daysUntilClose} día{daysUntilClose !== 1 ? "s" : ""}
                </p>
                <p className="text-sm text-red-600">
                  Fecha de cierre: {project.closingAt ? formatDate(project.closingAt) : ""}
                </p>
              </div>
            </div>
          )}

          {/* Título y metadata */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                {projectType === "serie" ? (
                  <Tv size={28} className="text-slate-400" />
                ) : (
                  <Film size={28} className="text-slate-400" />
                )}
                <h1 className="text-3xl font-bold text-slate-900">{project.name}</h1>
              </div>
              
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {project.phase && (
                  <span className="text-sm font-medium px-3 py-1 rounded-lg bg-slate-100 text-slate-600">
                    {project.phase}
                  </span>
                )}
                {projectType && (
                  <span className="text-sm font-medium px-3 py-1 rounded-lg bg-violet-100 text-violet-700">
                    {projectType === "serie" ? `Serie · ${episodes} capítulos` : "Película"}
                  </span>
                )}
                {project.producerNames && project.producerNames.length > 0 && (
                  <span className="text-sm text-slate-500 flex items-center gap-1.5">
                    <Building2 size={14} />
                    {project.producerNames.join(", ")}
                  </span>
                )}
              </div>

              {project.description && (
                <p className="mt-4 text-slate-600 max-w-2xl">{project.description}</p>
              )}
            </div>

            {/* Stats rápidos */}
            <div className="flex items-center gap-6 text-sm text-slate-500">
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900">{members.length}</p>
                <p>Miembros</p>
              </div>
              {project.departments && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-900">{project.departments.length}</p>
                  <p>Departamentos</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Columna izquierda - Módulos */}
          <div className="lg:col-span-1 space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Módulos</h2>
              <div className="space-y-3">
                {userPermissions.accounting && (
                  <Link href={`/project/${id}/accounting`}>
                    <div className="p-4 bg-white border-2 border-slate-200 rounded-xl hover:border-blue-400 hover:shadow-md transition-all group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div 
                          className="w-12 h-12 rounded-xl flex items-center justify-center"
                          style={{ backgroundColor: 'rgba(47, 82, 224, 0.1)' }}
                        >
                          <BarChart3 size={24} style={{ color: '#2F52E0' }} />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                            Accounting
                          </h3>
                          <p className="text-sm text-slate-500">Gestión financiera y presupuesto</p>
                        </div>
                        <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                      </div>
                    </div>
                  </Link>
                )}

                {userPermissions.team && (
                  <Link href={`/project/${id}/team`}>
                    <div className="p-4 bg-white border-2 border-slate-200 rounded-xl hover:border-green-400 hover:shadow-md transition-all group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div 
                          className="w-12 h-12 rounded-xl flex items-center justify-center"
                          style={{ backgroundColor: 'rgba(137, 211, 34, 0.15)' }}
                        >
                          <Users size={24} style={{ color: '#6BA319' }} />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900 group-hover:text-green-600 transition-colors">
                            Team
                          </h3>
                          <p className="text-sm text-slate-500">Gestión del equipo de rodaje</p>
                        </div>
                        <ChevronRight size={20} className="text-slate-300 group-hover:text-green-500 transition-colors" />
                      </div>
                    </div>
                  </Link>
                )}

                {userPermissions.config && (
                  <Link href={`/project/${id}/config`}>
                    <div className="p-4 bg-white border-2 border-slate-200 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-slate-100">
                          <Settings size={24} className="text-slate-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900 group-hover:text-slate-700 transition-colors">
                            Configuración
                          </h3>
                          <p className="text-sm text-slate-500">Ajustes del proyecto</p>
                        </div>
                        <ChevronRight size={20} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                      </div>
                    </div>
                  </Link>
                )}

                {!userPermissions.accounting && !userPermissions.team && !userPermissions.config && (
                  <div className="p-6 bg-slate-100 border border-slate-200 rounded-xl text-center">
                    <Shield size={32} className="text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-600">No tienes acceso a ningún módulo</p>
                  </div>
                )}
              </div>
            </div>

            {/* Info del proyecto */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Información</h3>
              <div className="space-y-3">
                {project.createdAt && (
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar size={16} className="text-slate-400" />
                    <span className="text-slate-600">Creado el {formatDate(project.createdAt)}</span>
                  </div>
                )}
                {userRole && (
                  <div className="flex items-center gap-3 text-sm">
                    <User size={16} className="text-slate-400" />
                    <span className="text-slate-600">Tu rol: <span className="font-medium text-slate-900">{ROLE_LABELS[userRole] || userRole}</span></span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Columna derecha - Equipo */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
              Equipo del proyecto
            </h2>

            {/* Roles de proyecto */}
            {projectRoleMembers.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Crown size={14} className="text-amber-500" />
                    Dirección de Producción
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {projectRoleMembers.map((member) => (
                    <div key={member.odMemberId} className="px-5 py-3 flex items-center gap-4">
                      <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-slate-600">
                          {(member.name || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{member.name}</p>
                        <p className="text-sm text-slate-500 truncate">{member.email}</p>
                      </div>
                      <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700">
                        {ROLE_LABELS[member.role || ""] || member.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Miembros por departamento */}
            {Object.keys(membersByDepartment).length > 0 && (
              <div className="space-y-4">
                {Object.entries(membersByDepartment).map(([dept, deptMembers]) => (
                  <div key={dept} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <Briefcase size={14} className="text-slate-400" />
                        {dept}
                      </h3>
                      <span className="text-xs text-slate-500">{deptMembers.length} miembro{deptMembers.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {deptMembers.map((member) => (
                        <div key={member.odMemberId} className="px-5 py-3 flex items-center gap-4">
                          <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-semibold text-slate-600">
                              {(member.name || "?").charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-900 truncate">{member.name}</p>
                            <p className="text-sm text-slate-500 truncate">{member.email}</p>
                          </div>
                          {member.position && (
                            <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600">
                              {ROLE_LABELS[member.position] || member.position}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {members.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <Users size={40} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No hay miembros en este proyecto</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
