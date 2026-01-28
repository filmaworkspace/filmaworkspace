"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  Settings, BarChart3, Users, Building2, Clock,
  Film, Tv, Briefcase, Crown, ChevronRight, Mail, Shield
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
          <div className="flex gap-3 flex-wrap">
            {userPermissions.config && (
              <Link href={`/project/${id}/config`}>
                <div className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer">
                  <Settings size={16} className="text-slate-600" />
                  <span className="text-sm font-medium text-slate-700">Config</span>
                </div>
              </Link>
            )}
            {userPermissions.accounting && (
              <Link href={`/project/${id}/accounting`}>
                <div 
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border transition-colors cursor-pointer"
                  style={{ 
                    backgroundColor: 'rgba(47, 82, 224, 0.1)',
                    borderColor: 'rgba(47, 82, 224, 0.3)',
                  }}
                >
                  <BarChart3 size={16} style={{ color: '#2F52E0' }} />
                  <span className="text-sm font-medium" style={{ color: '#2F52E0' }}>Accounting</span>
                </div>
              </Link>
            )}
            {userPermissions.team && (
              <Link href={`/project/${id}/team`}>
                <div 
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border transition-colors cursor-pointer"
                  style={{ 
                    backgroundColor: 'rgba(137, 211, 34, 0.15)',
                    borderColor: 'rgba(137, 211, 34, 0.4)',
                  }}
                >
                  <Users size={16} style={{ color: '#6BA319' }} />
                  <span className="text-sm font-medium" style={{ color: '#6BA319' }}>Team</span>
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Equipo del proyecto */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Equipo ({members.length})
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

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* Dirección de Producción */}
            {projectRoleMembers.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                  <Crown size={14} className="text-amber-600" />
                  <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Producción</span>
                </div>
                <div className="p-2">
                  {projectRoleMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50">
                      <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-slate-600">
                          {(member.name || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{member.name}</p>
                        <p className="text-xs text-slate-500">{ROLE_LABELS[member.role || ""] || member.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Departamentos */}
            {Object.entries(membersByDepartment).map(([dept, deptMembers]) => (
              <div key={dept} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{dept}</span>
                  </div>
                  <span className="text-xs text-slate-400">{deptMembers.length}</span>
                </div>
                <div className="p-2">
                  {deptMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50">
                      <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-slate-600">
                          {(member.name || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{member.name}</p>
                        {member.position && (
                          <p className="text-xs text-slate-500">{ROLE_LABELS[member.position] || member.position}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {members.length === 0 && (
            <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-200">
              <Users size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No hay miembros en este proyecto</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
