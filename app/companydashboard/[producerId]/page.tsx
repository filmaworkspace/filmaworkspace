"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  Timestamp,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Building2,
  Clock,
  ClipboardList,
  ExternalLink,
  Eye,
  FolderOpen,
  Users,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

const phaseConfig: Record<string, { bg: string; text: string; dot: string }> = {
  Desarrollo: { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" },
  Preproducción: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  Rodaje: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  Postproducción: { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  Finalizado: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  phase: string;
  description?: string;
  memberCount: number;
  createdAt: Timestamp;
}

interface Producer {
  id: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CompanyDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const producerId = params?.producerId as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [producer, setProducer] = useState<Producer | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  const isAdmin = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess = isAdmin || isCompanyUser;

  useEffect(() => {
    if (!userLoading && !hasAccess) {
      router.push("/dashboard");
    }
  }, [contextUser, userLoading, router, hasAccess]);

  useEffect(() => {
    if (producerId && hasAccess) loadData();
  }, [producerId, hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Get producer info
      const producerDoc = await getDoc(doc(db, "producers", producerId));
      if (!producerDoc.exists()) {
        router.push(isAdmin ? "/admindashboard" : "/");
        return;
      }
      setProducer({
        id: producerDoc.id,
        name: producerDoc.data().name,
      });

      // Get projects from companyProjects collection (seguridad estricta)
      const companyProjectsSnap = await getDocs(collection(db, `companyProjects/${producerId}/projects`));
      const producerProjects: Project[] = [];

      for (const cpDoc of companyProjectsSnap.docs) {
        const projectId = cpDoc.id;
        
        // Get full project data
        const projectDoc = await getDoc(doc(db, "projects", projectId));
        if (!projectDoc.exists()) continue;
        
        const data = projectDoc.data();
        
        // Get member count
        const membersSnap = await getDocs(collection(db, `projects/${projectId}/members`));
        
        producerProjects.push({
          id: projectId,
          name: data.name,
          phase: data.phase || "Desarrollo",
          description: data.description,
          memberCount: membersSnap.size,
          createdAt: data.createdAt,
        });
      }

      // Sort by createdAt desc
      producerProjects.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return b.createdAt.toMillis() - a.createdAt.toMillis();
      });

      setProjects(producerProjects);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Stats
  const activeProjects = projects.filter((p) => p.phase !== "Finalizado").length;
  const finishedProjects = projects.filter((p) => p.phase === "Finalizado").length;
  const totalMembers = projects.reduce((acc, p) => acc + p.memberCount, 0);

  // Group by phase
  const projectsByPhase = PHASES.reduce((acc, phase) => {
    acc[phase] = projects.filter((p) => p.phase === phase);
    return acc;
  }, {} as Record<string, Project[]>);

  if (loading || userLoading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!producer) return null;

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-24 pt-10 pb-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center">{producer.name}</h1>
        </div>
      </div>

      <main className="px-24 py-6">
        {/* Stats row - minimal */}
        <div className="flex flex-wrap items-center justify-center gap-6 mb-8 text-sm">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-slate-400" />
            <span className="text-slate-600">{projects.length} proyectos</span>
            <span className="text-slate-400">·</span>
            <span className="text-blue-600">{activeProjects} activos</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            <span className="text-emerald-600">{finishedProjects} finalizados</span>
          </div>
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <span className="text-slate-600">{totalMembers} miembros</span>
          </div>
        </div>

        {/* Projects */}
        {projects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FolderOpen size={28} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Sin proyectos</h3>
            <p className="text-slate-500 text-sm">Esta productora no tiene proyectos asignados</p>
          </div>
        ) : (
          <div className="space-y-6">
            {PHASES.map((phase) => {
              const phaseProjects = projectsByPhase[phase];
              if (phaseProjects.length === 0) return null;

              const config = phaseConfig[phase];

              return (
                <div key={phase}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`w-2 h-2 rounded-full ${config.dot}`} />
                    <h2 className="text-sm font-semibold text-slate-900">{phase}</h2>
                    <span className="text-xs text-slate-400">({phaseProjects.length})</span>
                  </div>

                  <div className="grid gap-4 grid-cols-4">
                    {phaseProjects.map((project) => (
                      <div
                        key={project.id}
                        className="group bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-slate-300 transition-all"
                      >
                        {/* Phase badge */}
                        <div className="flex items-center justify-between mb-3">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-lg ${config.bg} ${config.text}`}>
                            {phase}
                          </span>
                        </div>

                        {/* Name */}
                        <h3 className="font-semibold text-slate-900 mb-2 line-clamp-1">{project.name}</h3>

                        {/* Info */}
                        <div className="space-y-1.5 text-xs text-slate-500 mb-4">
                          {project.description && (
                            <p className="line-clamp-2">{project.description}</p>
                          )}
                          <div className="flex items-center gap-1.5">
                            <Users size={12} className="text-slate-400" />
                            <span>{project.memberCount} miembros</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-3 border-t border-slate-100">
                          <Link
                            href={`/project/${project.id}`}
                            className="flex-1 flex items-center justify-center gap-1.5 p-2 bg-slate-900 text-white rounded-xl text-xs font-medium hover:bg-slate-800"
                          >
                            <Eye size={12} />
                            Ver proyecto
                          </Link>
                          <Link
                            href={`/companydashboard/${producerId}/accounts/${project.id}`}
                            className="p-2 border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50"
                            title="Contabilidad"
                          >
                            <ClipboardList size={12} />
                          </Link>
                          {isAdmin && (
                            <Link
                              href={`/admindashboard/project/${project.id}`}
                              className="p-2 border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50"
                              title="Gestionar"
                            >
                              <ExternalLink size={12} />
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
