"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  Timestamp,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Receipt,
  Settings,
  Users,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import ProjectCover from "@/components/ProjectCover";
import { MODULE_COLORS, ui } from "@/lib/ui";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];

// ─── Types ───────────────────────────────────────────────────────────────────

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
  coverUrl?: string | null;
  coverPath?: string | null;
  /** Módulos del plan de la cuenta (los fija el admin); false = no incluido. */
  modules?: { accounting?: boolean; team?: boolean };
  frozen?: boolean;
}

interface UserPermissions {
  config: boolean;
  accounting: boolean;
  team: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

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
      // Nombres de las productoras (el proyecto solo guarda sus ids)
      const producerIds = projectData.producers || [];
      if (producerIds.length && !projectData.producerNames?.length) {
        const producerSnaps = await Promise.all(
          producerIds.map((pid) => getDoc(doc(db, "producers", pid)).catch(() => null))
        );
        projectData.producerNames = producerSnaps
          .filter((d): d is NonNullable<typeof d> => !!d && d.exists())
          .map((d) => (d.data()?.name as string) || "")
          .filter(Boolean);
      }
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

  const MemberRow = ({ member, badge, detail }: { member: Member; badge?: string; detail?: string }) => (
    <div className="group flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#E4E4E7] bg-[#F1F1F3] text-[13px] font-semibold text-slate-700">
        {(member.name || "?").charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium text-slate-900">{member.name}</p>
          {member.userId === userId && <span className="text-[11px] text-slate-400">Tú</span>}
        </div>
        <div className="flex items-center gap-1">
          <p className="truncate text-xs text-slate-500">{detail || member.email}</p>
          {!detail && member.email && (
            <button
              onClick={() => copyEmail(member.email)}
              className="rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-700 group-hover:opacity-100"
              title="Copiar email"
            >
              {copiedEmail === member.email ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
          )}
        </div>
      </div>
      {badge && <span className={ui.chip}>{badge}</span>}
    </div>
  );

  if (loading) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white ${inter.className}`}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white ${inter.className}`}>
        <div className="text-center">
          <p className="text-sm text-slate-500">Proyecto no encontrado</p>
          <Link href="/dashboard" className="mt-2 inline-block text-sm font-medium text-slate-900 hover:underline">
            Volver a proyectos
          </Link>
        </div>
      </div>
    );
  }

  const typeLabel = projectType === "serie" ? `Serie${episodes ? ` · ${episodes} cap.` : ""}` : projectType === "pelicula" ? "Película" : null;

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <main className={ui.page}>

        {/* Portada con el nombre del proyecto */}
        <ProjectCover
          projectId={id}
          coverUrl={project.coverUrl}
          coverPath={project.coverPath}
          editable={userPermissions.config}
          onChange={(cover) => setProject((prev) => (prev ? { ...prev, coverUrl: cover.url, coverPath: cover.path } : prev))}
          onError={(msg) => alert(msg)}
          className="h-[clamp(220px,24vw,340px)] rounded-2xl"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {project.phase && <span className={ui.glassPill}>{project.phase}</span>}
              {typeLabel && <span className={ui.glassPill}>{typeLabel}</span>}
              {daysUntilClose !== null && (
                <span className={`${ui.glassPill} !border-red-300/40 !bg-red-500/80`}>
                  <Clock size={11} /> Cierra en {daysUntilClose} día{daysUntilClose !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{project.name}</h1>
          </div>
        </ProjectCover>

        {/* Productoras + accesos */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            {project.producerNames && project.producerNames.length > 0 && (
              <p className="text-sm text-slate-500">{project.producerNames.join(", ")}</p>
            )}
            {project.closingAt && daysUntilClose !== null && (
              <p className="mt-0.5 text-xs text-slate-400">Cierre el {formatDate(project.closingAt)}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {project.frozen && <span className="mr-1 text-xs text-sky-700">Proyecto congelado · solo lectura</span>}
            {userPermissions.accounting && project.modules?.accounting !== false && (
              <Link href={`/project/${id}/accounting`} className={ui.softButton}>
                <Receipt size={14} style={{ color: MODULE_COLORS.accounting }} /> Contabilidad
              </Link>
            )}
            {userPermissions.team && project.modules?.team !== false && (
              <Link href={`/project/${id}/team`} className={ui.softButton}>
                <Users size={14} style={{ color: MODULE_COLORS.team }} /> Equipo
              </Link>
            )}
            {userPermissions.config && (
              <Link href={`/project/${id}/config`} className={ui.iconButton} title="Configuración">
                <Settings size={16} />
              </Link>
            )}
          </div>
        </div>

        {project.description && (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">{project.description}</p>
        )}

        {/* Equipo del proyecto */}
        <section className="mt-12">
          <div className="mb-3 flex items-center justify-between">
            <h2 className={ui.sectionTitle}>
              Equipo · {visibleMembers.length}
              {!canViewAllMembers && members.length > visibleMembers.length ? ` de ${members.length}` : ""}
            </h2>
            {userPermissions.config && (
              <Link href={`/project/${id}/config/users`} className="flex items-center gap-0.5 text-[13px] text-slate-500 hover:text-slate-900">
                Gestionar <ChevronRight size={14} />
              </Link>
            )}
          </div>

          {visibleMembers.length === 0 ? (
            <div className={`${ui.card} px-4 py-12 text-center`}>
              <p className="text-sm text-slate-500">
                {members.length === 0 ? "Aún no hay nadie en este proyecto" : "No tienes acceso para ver otros miembros"}
              </p>
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {projectRoleMembers.length > 0 && (
                <div className={ui.card}>
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-[13px] font-medium text-slate-900">Producción</h3>
                    <span className="text-xs text-slate-400">{projectRoleMembers.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {projectRoleMembers.map((m) => <MemberRow key={m.userId} member={m} badge={m.role} />)}
                  </div>
                </div>
              )}
              {departmentMembers.length > 0 && (
                <div className={ui.card}>
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-[13px] font-medium text-slate-900">Departamentos</h3>
                    <span className="text-xs text-slate-400">{departmentMembers.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {departmentMembers.map((m) => (
                      <MemberRow key={m.userId} member={m} badge={[m.position, m.department].filter(Boolean).join(" · ") || undefined} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
