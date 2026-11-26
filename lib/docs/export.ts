// ─── Exportar un PDF suelto con el diseño del Centro de documentación ────────
// Ficha de crew, crew list, calendario, libro mayor, resguardos de
// formularios… Todos con la cabecera del proyecto (su degradado o su portada),
// la franja del tipo de documento, el pie con la huella y Filma al pie.

import type { Firestore } from "firebase/firestore";
import { buildProjectDoc, contentFingerprint, renderProjectBand, type DocProject, type ProjectDocSpec } from "./projectPdf";
import { loadHubProject, type HubProject } from "./hub";

export type ExportSpec = Omit<ProjectDocSpec, "project" | "generatedAt" | "generatedBy" | "fingerprint">;

const bands = new Map<string, string>();

/** Datos del proyecto para la cabecera. Si no se pueden leer (enlace público), usa lo que se sepa. */
export async function exportProject(db: Firestore | null, projectId: string, orientation: "p" | "l" = "p", fallback: Partial<HubProject> = {}): Promise<DocProject> {
  let hp: HubProject = { name: fallback.name || "Proyecto", code: (fallback.code || "").toUpperCase(), producer: fallback.producer || "", phase: fallback.phase || "", legal: fallback.legal || "", coverUrl: fallback.coverUrl || null };
  if (db) { try { hp = await loadHubProject(db, projectId); } catch { /* sin permiso: datos mínimos */ } }
  const key = `${projectId}:${hp.coverUrl || ""}:${orientation}`;
  // Misma proporción que la banda en la página (34 mm de alto)
  if (!bands.has(key)) bands.set(key, await renderProjectBand(projectId, hp.coverUrl, orientation === "l" ? 3508 : 2480, 402));
  return { name: hp.name, code: hp.code, producer: hp.producer, phase: hp.phase, seed: projectId, band: bands.get(key)!, legal: hp.legal };
}

/** Genera el PDF y lo descarga. */
export async function downloadProjectDoc(opts: { db: Firestore | null; projectId: string; user: string; fileName: string; spec: ExportSpec; fallback?: Partial<HubProject> }) {
  const project = await exportProject(opts.db, opts.projectId, opts.spec.orientation || "p", opts.fallback);
  const fingerprint = await contentFingerprint({ projectId: opts.projectId, spec: opts.spec });
  const pdf = buildProjectDoc({ ...opts.spec, project, generatedAt: new Date(), generatedBy: opts.user || "—", fingerprint });
  const url = URL.createObjectURL(pdf.output("blob"));
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFile(opts.fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
