"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db, auth } from "@/lib/firebase";
import {
  collection,
  doc,
  DocumentData,
  getDocs,
  getDoc,
  query,
  QueryDocumentSnapshot,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Archive,
  ArrowUpDown,
  Check,
  ChevronDown,
  Clock,
  Receipt,
  Search,
  Settings,
  Users,
  X as XIcon,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import ProjectCover from "@/components/ProjectCover";
import { coverGradient } from "@/lib/projectCover";

// ─── Constants ───────────────────────────────────────────────────────────────

const phaseColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  Desarrollo: { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", dot: "bg-sky-500" },
  Preproducción: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" },
  Rodaje: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", dot: "bg-indigo-500" },
  Postproducción: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", dot: "bg-purple-500" },
  Finalizado: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
};

const PHASE_OPTIONS = [
  { value: "all", label: "Todas las fases" },
  { value: "Desarrollo", label: "Desarrollo" },
  { value: "Preproducción", label: "Preproducción" },
  { value: "Rodaje", label: "Rodaje" },
  { value: "Postproducción", label: "Postproducción" },
  { value: "Finalizado", label: "Finalizado" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Recientes" },
  { value: "name", label: "Nombre" },
  { value: "phase", label: "Fase" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  phase: string;
  description?: string;
  producers?: string[];
  producerNames?: string[];
  role: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
  createdAt: Timestamp | null;
  addedAt: Timestamp | null;
  memberCount?: number;
  archived?: boolean;
  closingAt?: Timestamp | null;
  coverUrl?: string | null;
  coverPath?: string | null;
}

interface Invitation {
  id: string;
  projectId: string;
  projectName: string;
  invitedBy: string;
  invitedByName: string;
  roleType: "project" | "department";
  role?: string;
  department?: string;
  position?: string;
  permissions: { config?: boolean; accounting: boolean; team: boolean };
  status: string;
  createdAt: Date | Timestamp;
  expiresAt: Date | Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, isLoading: userLoading } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingInvite, setProcessingInvite] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPhase, setSelectedPhase] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "phase">("recent");
  const [showArchived, setShowArchived] = useState(false);
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const phaseDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  const userId = user?.uid || null;
  const userEmail = user?.email || "";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (phaseDropdownRef.current && !phaseDropdownRef.current.contains(event.target as Node)) {
        setShowPhaseDropdown(false);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Las redirecciones por rol y autenticación las gestiona UserContext.

  useEffect(() => {
    if (!userId) return;
    const loadData = async () => {
      try {
        const userProjectsRef = collection(db, `userProjects/${userId}/projects`);
        const userProjectsSnapshot = await getDocs(userProjectsRef);

        // Fetch all project docs in parallel instead of sequentially
        const projectSnapshots = await Promise.all(
          userProjectsSnapshot.docs.map((d) => getDoc(doc(db, "projects", d.id)))
        );

        const projectsData: Project[] = (
          await Promise.all(
            userProjectsSnapshot.docs.map(async (userProjectDoc, i) => {
              const projectSnapshot = projectSnapshots[i];
              if (!projectSnapshot.exists()) return null;

              const userProjectData = userProjectDoc.data();
              const projectId = userProjectDoc.id;
              const projectData = projectSnapshot.data();

              // Fetch producers and members in parallel
              const [producerDocs, membersSnapshot] = await Promise.all([
                Promise.all(
                  (projectData.producers || []).map((pid: string) =>
                    getDoc(doc(db, "producers", pid))
                  )
                ),
                getDocs(collection(db, `projects/${projectId}/members`)),
              ]);

              const producerNames = producerDocs
                .filter((d) => d.exists())
                .map((d) => d.data().name as string);

              return {
                id: projectSnapshot.id,
                name: projectData.name,
                phase: projectData.phase,
                description: projectData.description || "",
                producers: projectData.producers || [],
                producerNames: producerNames.length > 0 ? producerNames : undefined,
                role: userProjectData.role,
                department: userProjectData.department,
                position: userProjectData.position,
                permissions: userProjectData.permissions || { config: false, accounting: false, team: false },
                createdAt: projectData.createdAt || null,
                addedAt: userProjectData.addedAt || null,
                memberCount: membersSnapshot.size,
                archived: projectData.archived || userProjectData.archived || false,
                closingAt: projectData.closingAt || null,
                coverUrl: projectData.coverUrl || null,
                coverPath: projectData.coverPath || null,
              } as Project;
            })
          )
        ).filter((p): p is Project => p !== null);

        projectsData.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
        setProjects(projectsData);
        setFilteredProjects(projectsData.filter((p) => !p.archived));

        const invitationsRef = collection(db, "invitations");
        const q = query(invitationsRef, where("invitedEmail", "==", userEmail), where("status", "==", "pending"));
        const invitationsSnapshot = await getDocs(q);
        const invitationsData: Invitation[] = invitationsSnapshot.docs.map((invDoc: QueryDocumentSnapshot<DocumentData>) => {
          const data = invDoc.data();
          return {
            id: invDoc.id,
            projectId: data.projectId,
            projectName: data.projectName,
            invitedBy: data.invitedBy,
            invitedByName: data.invitedByName,
            roleType: data.roleType,
            role: data.role,
            department: data.department,
            position: data.position,
            permissions: data.permissions,
            status: data.status,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
          };
        });
        setInvitations(invitationsData);

      } catch (error) {
        console.error("Error al cargar datos:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [userId, userEmail, reloadTrigger]);

  useEffect(() => {
    let filtered = [...projects].filter((p) => !p.archived);
    if (searchTerm) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.producerNames?.some((name) => name.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    if (selectedPhase !== "all") {
      filtered = filtered.filter((p) => p.phase === selectedPhase);
    }
    switch (sortBy) {
      case "name":
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "phase":
        filtered.sort((a, b) => a.phase.localeCompare(b.phase));
        break;
      default:
        filtered.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
    }
    setFilteredProjects(filtered);
  }, [searchTerm, selectedPhase, sortBy, projects]);

  const archivedProjects = projects.filter((p) => p.archived);
  const activeProjectsCount = projects.filter((p) => !p.archived).length;

  const handleAcceptInvitation = async (invitation: Invitation) => {
    if (!userId) return;
    setProcessingInvite(invitation.id);
    try {
      // La aceptación la hace el servidor: copia los permisos de la invitación
      // al proyecto. Las reglas de Firestore no dejan que un usuario se añada
      // a sí mismo a un proyecto.
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/accept-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ invitationId: invitation.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setReloadTrigger((t) => t + 1);
    } catch (error) {
      console.error("Error aceptando invitación:", error);
      alert(error instanceof Error && error.message ? `Error al aceptar la invitación: ${error.message}` : "Error al aceptar la invitación");
      setProcessingInvite(null);
    }
  };

  const handleRejectInvitation = async (invitationId: string) => {
    if (!confirm("¿Estás seguro de que deseas rechazar esta invitación?")) return;
    setProcessingInvite(invitationId);
    try {
      await updateDoc(doc(db, "invitations", invitationId), { status: "rejected", respondedAt: new Date() });
      setInvitations(invitations.filter((i) => i.id !== invitationId));
      setProcessingInvite(null);
    } catch (error) {
      console.error("Error rechazando invitación:", error);
      alert("Error al rechazar la invitación");
      setProcessingInvite(null);
    }
  };

  const getPhaseLabel = () => {
    const opt = PHASE_OPTIONS.find((o) => o.value === selectedPhase);
    return opt?.label || "Todas las fases";
  };

  const getSortLabel = () => {
    const opt = SORT_OPTIONS.find((o) => o.value === sortBy);
    return opt?.label || "Recientes";
  };

  // Helper para calcular días hasta el cierre
  const getDaysUntilClose = (closingAt: Timestamp | null | undefined) => {
    if (!closingAt) return null;
    const now = new Date();
    const closeDate = closingAt.toDate();
    const diffTime = closeDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const updateProjectCover = (projectId: string, cover: { url: string | null; path: string | null }) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, coverUrl: cover.url, coverPath: cover.path } : p)));
  };

  // ── Estilos comunes (mismos que las pantallas de acceso) ──────────────────
  const control = "flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors hover:border-slate-300";
  const softButton = "flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#E4E4E7] bg-[#F1F1F3] px-3 text-[13px] font-medium text-slate-900 transition-colors hover:bg-[#E8E8EB] disabled:opacity-60";
  const iconButton = "relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-[#F1F1F3] hover:text-slate-900";
  const glassPill = "inline-flex h-6 items-center gap-1 rounded-md border border-white/25 bg-black/25 px-2 text-[11px] font-medium text-white backdrop-blur-md";

  const renderProjectCard = (project: Project, archived = false) => {
    const hasConfig = project.permissions.config;
    const hasAccounting = project.permissions.accounting;
    const hasTeam = project.permissions.team;
    const daysUntilClose = archived ? null : getDaysUntilClose(project.closingAt);

    return (
      <div
        key={project.id}
        className={`group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:border-slate-300 hover:shadow-[0_12px_32px_-16px_rgba(15,23,42,0.25)] ${archived ? "opacity-75 hover:opacity-100" : ""}`}
      >
        {/* Portada */}
        <ProjectCover
          projectId={project.id}
          href={`/project/${project.id}`}
          compact
          coverUrl={project.coverUrl}
          coverPath={project.coverPath}
          editable={hasConfig}
          onChange={(cover) => updateProjectCover(project.id, cover)}
          onError={(msg) => alert(msg)}
          className={`aspect-[16/7] ${archived ? "grayscale" : ""}`}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          <div className="absolute left-3 top-3 flex gap-1.5">
            <span className={glassPill}>{archived ? "Archivado" : project.phase}</span>
            {daysUntilClose !== null && (
              <span className={`${glassPill} !border-red-300/40 !bg-red-500/80`}>
                <Clock size={11} /> Cierra en {daysUntilClose} d
              </span>
            )}
          </div>
        </ProjectCover>

        {/* Datos */}
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/project/${project.id}`} className="block truncate text-[15px] font-semibold text-slate-900 hover:underline">
                {project.name}
              </Link>
              {project.producerNames && project.producerNames.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-slate-500">{project.producerNames.join(", ")}</p>
              )}
            </div>
            {hasConfig && (
              <Link href={`/project/${project.id}/config`} className="-mr-1.5 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-[#F1F1F3] hover:text-slate-700" title="Configuración">
                <Settings size={15} />
              </Link>
            )}
          </div>

          {(project.role || project.position) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[project.role, project.position].filter(Boolean).map((label) => (
                <span key={label} className="rounded-md bg-[#F4F4F5] px-2 py-0.5 text-[11px] text-slate-600">{label}</span>
              ))}
            </div>
          )}

          {(hasAccounting || hasTeam) && (
            <div className="mt-auto flex gap-2 pt-4">
              {hasAccounting && (
                <Link href={`/project/${project.id}/accounting`} className={`${softButton} flex-1`}>
                  <Receipt size={14} style={{ color: "#2F52E0" }} /> Contabilidad
                </Link>
              )}
              {hasTeam && (
                <Link href={`/project/${project.id}/team`} className={`${softButton} flex-1`}>
                  <Users size={14} style={{ color: "#6BA319" }} /> Equipo
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  const hasFilters = !!searchTerm || selectedPhase !== "all";

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <main className="px-6 pb-20 pt-[85px] sm:px-10">

        {/* Cabecera de la página */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-slate-900">Proyectos</h1>
          </div>
        </div>

        {/* Invitaciones */}
        {invitations.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-[13px] font-medium text-slate-500">
              {invitations.length === 1 ? "Invitación pendiente" : `${invitations.length} invitaciones pendientes`}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <span className="h-12 w-12 flex-shrink-0 rounded-lg" style={{ background: coverGradient(invitation.projectId) }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{invitation.projectName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {invitation.roleType === "project" ? invitation.role : invitation.position}
                      {invitation.invitedByName ? ` · ${invitation.invitedByName}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleAcceptInvitation(invitation)}
                    disabled={processingInvite === invitation.id}
                    className={softButton}
                  >
                    <Check size={14} /> {processingInvite === invitation.id ? "…" : "Aceptar"}
                  </button>
                  <button
                    onClick={() => handleRejectInvitation(invitation.id)}
                    disabled={processingInvite === invitation.id}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-[#F1F1F3] hover:text-slate-700 disabled:opacity-60"
                    aria-label="Rechazar invitación"
                  >
                    <XIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {projects.length === 0 && invitations.length === 0 ? (
          /* Sin proyectos */
          <div className="relative overflow-hidden rounded-2xl" style={{ background: coverGradient() }}>
            <div className="flex aspect-[16/5] min-h-[220px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-2xl font-semibold tracking-tight text-white">Aún no hay proyectos</p>
              <p className="text-sm text-white/70">Aparecerán aquí cuando te inviten a uno.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Barra de herramientas */}
            {activeProjectsCount > 0 && (
              <div className="relative z-30 mb-6 flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-72">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 transition focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
                  />
                </div>

                {/* Fase */}
                <div className="relative" ref={phaseDropdownRef}>
                  <button
                    onClick={() => { setShowPhaseDropdown(!showPhaseDropdown); setShowSortDropdown(false); }}
                    className={`${control} ${selectedPhase !== "all" ? "!border-slate-900 font-medium text-slate-900" : ""}`}
                  >
                    {getPhaseLabel()}
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${showPhaseDropdown ? "rotate-180" : ""}`} />
                  </button>
                  {showPhaseDropdown && (
                    <div className="absolute left-0 top-full z-40 mt-1.5 min-w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      {PHASE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => { setSelectedPhase(option.value); setShowPhaseDropdown(false); }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[#F7F7F8] ${
                            selectedPhase === option.value ? "font-medium text-slate-900" : "text-slate-600"
                          }`}
                        >
                          {option.label}
                          {selectedPhase === option.value && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Orden */}
                <div className="relative" ref={sortDropdownRef}>
                  <button onClick={() => { setShowSortDropdown(!showSortDropdown); setShowPhaseDropdown(false); }} className={control}>
                    <ArrowUpDown size={14} className="text-slate-400" />
                    {getSortLabel()}
                  </button>
                  {showSortDropdown && (
                    <div className="absolute left-0 top-full z-40 mt-1.5 min-w-[160px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      {SORT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => { setSortBy(option.value as "recent" | "name" | "phase"); setShowSortDropdown(false); }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[#F7F7F8] ${
                            sortBy === option.value ? "font-medium text-slate-900" : "text-slate-600"
                          }`}
                        >
                          {option.label}
                          {sortBy === option.value && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {hasFilters && (
                  <button onClick={() => { setSearchTerm(""); setSelectedPhase("all"); }} className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] text-slate-500 transition-colors hover:bg-[#F1F1F3] hover:text-slate-900">
                    <XIcon size={14} /> Limpiar
                  </button>
                )}

                {archivedProjects.length > 0 && (
                  <button
                    onClick={() => setShowArchived(!showArchived)}
                    className={`${control} sm:ml-auto ${showArchived ? "!border-slate-900 font-medium text-slate-900" : ""}`}
                  >
                    <Archive size={14} className="text-slate-400" />
                    {archivedProjects.length} archivado{archivedProjects.length !== 1 ? "s" : ""}
                  </button>
                )}
              </div>
            )}

            {/* Proyectos activos */}
            {activeProjectsCount > 0 && (
              filteredProjects.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-sm text-slate-500">Ningún proyecto coincide con la búsqueda.</p>
                  <button onClick={() => { setSearchTerm(""); setSelectedPhase("all"); }} className="mt-2 text-sm font-medium text-slate-900 underline-offset-2 hover:underline">
                    Limpiar filtros
                  </button>
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 min-[1280px]:grid-cols-4 min-[1680px]:grid-cols-5">
                  {filteredProjects.map((project) => renderProjectCard(project))}
                </div>
              )
            )}

            {/* Archivados */}
            {archivedProjects.length > 0 && (showArchived || activeProjectsCount === 0) && (
              <section className="mt-12">
                <h2 className="mb-4 text-[13px] font-medium text-slate-500">Archivados</h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 min-[1280px]:grid-cols-4 min-[1680px]:grid-cols-5">
                  {archivedProjects.map((project) => renderProjectCard(project, true))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
