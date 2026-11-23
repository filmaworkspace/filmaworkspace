// ─── Centro de documentación de Equipo ───────────────────────────────────────
// Mismo formato que el de Contabilidad (carpetas, PDF con la carátula del
// proyecto, ZIP con manifiesto):
//   · Crew / <departamento> / CRW-0001 · Nombre — ficha documental de cada
//     persona: carátula con sus datos y la lista de documentos, seguida de los
//     documentos reales (DNI, carné, certificado bancario…).
//   · Filma Sign / <tipo> / SGN-0001 · Título — el documento con las firmas y
//     su certificado de auditoría (tal cual se firmó).

import { collection, getDocs, type Firestore } from "firebase/firestore";
import { buildProjectDoc, contentFingerprint, DOC_TYPES, type DocTypeKey } from "./projectPdf";
import { appendOriginals, type Original } from "./attach";
import { hubDocProject, loadHubProject, type HubProject } from "./hub";
import { buildSignedPdf } from "@/lib/sign/render";
import { docTypeLabel, EVENT_LABEL, fmtDateTime, SIGN_STATUS, type SignRequest } from "@/lib/sign/types";

export const CREW_DOCS = [
  { key: "photoAccreditation", label: "Foto acreditación" },
  { key: "dniFront", label: "DNI anverso" },
  { key: "dniBack", label: "DNI reverso" },
  { key: "drivingFront", label: "Carné de conducir anverso" },
  { key: "drivingBack", label: "Carné de conducir reverso" },
  { key: "bankCertificate", label: "Certificado titularidad bancaria" },
] as const;

export interface TeamHubItem {
  id: string;
  type: DocTypeKey;
  typeLabel: string;
  path: string[];
  number: string;
  title: string;
  fileName: string;
  status: string;
  date: Date | null;
  warnings: string[];
  originals: Original[];
  /** Cantidad que se enseña en la columna de la derecha (documentos o firmas). */
  detail: string;
  source: { kind: "crew" | "sign"; id: string };
  crew?: Record<string, any>;
  sign?: SignRequest;
}

const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : typeof v === "number" ? new Date(v) : null);
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
const fullName = (m: Record<string, any>) => [m.firstName, m.lastName1, m.lastName2].filter(Boolean).join(" ") || m.artisticName || "Sin nombre";

export async function loadTeamHub(db: Firestore, projectId: string, signRows: SignRequest[] | null) {
  const project = await loadHubProject(db, projectId);
  const items: TeamHubItem[] = [];

  const crew = await getDocs(collection(db, `projects/${projectId}/crew`)).catch(() => null);
  for (const d of crew?.docs || []) {
    const m = d.data();
    const docs = (m.documents || {}) as Record<string, string>;
    const originals = CREW_DOCS.filter((x) => docs[x.key]).map((x) => ({ url: docs[x.key], label: x.label }));
    const missing = CREW_DOCS.filter((x) => !docs[x.key]).map((x) => x.label);
    const number = `CRW-${String(m.crewNumber || "").padStart(4, "0")}`;
    const name = fullName(m);
    items.push({
      id: `crew:${d.id}`, type: "crew", typeLabel: DOC_TYPES.crew.label,
      path: ["Crew", m.department || "Sin departamento"], number, title: name,
      fileName: `${number} · ${safe(name)}.pdf`,
      status: m.status === "inactive" ? "Baja" : m.status === "pending" ? "Pendiente de alta" : "Activo",
      date: toDate(m.updatedAt) || toDate(m.createdAt),
      warnings: missing.length ? [`Falta: ${missing.join(", ")}`] : [],
      originals, detail: `${originals.length}/${CREW_DOCS.length}`,
      source: { kind: "crew", id: d.id }, crew: m,
    });
  }

  if (signRows) {
    const ordered = [...signRows].sort((a, b) => a.createdAt - b.createdAt);
    ordered.forEach((r, i) => {
      const number = `SGN-${String(i + 1).padStart(4, "0")}`;
      const status = r.status === "pending" && r.expiresAt < Date.now() ? "expired" : r.status;
      const signed = r.parties.filter((p) => p.status === "signed").length;
      items.push({
        id: `sign:${r.id}`, type: "sign", typeLabel: docTypeLabel(r.docType) || "Documento",
        path: ["Filma Sign", docTypeLabel(r.docType) || "Otros"], number, title: r.title,
        fileName: `${number} · ${safe(r.title)}${status === "completed" ? "" : ` (${SIGN_STATUS[status].label.toLowerCase()})`}.pdf`,
        status: SIGN_STATUS[status].label,
        date: new Date(r.completedAt || r.createdAt),
        warnings: status === "pending" ? ["Pendiente de firma"] : status === "expired" ? ["Caducado sin firmar"] : status === "declined" ? ["Rechazado"] : [],
        originals: [], detail: `${signed}/${r.parties.length}`,
        source: { kind: "sign", id: r.id }, sign: r,
      });
    });
  }
  return { project, items };
}

/** PDF de un elemento: ficha documental del crew o documento firmado. */
export async function renderTeamItem(item: TeamHubItem, project: HubProject, projectId: string, user: string): Promise<{ bytes: Uint8Array; missing: string[]; fingerprint: string }> {
  if (item.sign) {
    const r = item.sign;
    const pdf = await buildSignedPdf(r);
    return { bytes: new Uint8Array(pdf.output("arraybuffer")), missing: [], fingerprint: r.docHash.toUpperCase() };
  }
  const m = item.crew || {};
  const docs = (m.documents || {}) as Record<string, string>;
  const fingerprint = await contentFingerprint({ id: item.id, crew: { n: m.crewNumber, name: item.title, role: m.role, dept: m.department }, docs });
  const cover = buildProjectDoc({
    project: await hubDocProject(project, projectId),
    docLabel: DOC_TYPES.crew.label, docType: "crew", number: item.number,
    status: { label: item.status, tone: item.status === "Activo" ? "ok" : item.status === "Baja" ? "none" : "warn" },
    meta: [["Puesto", m.role || "—"], ["Departamento", m.department || "—"], ["Inicio", m.startDate || "—"], ["Fin aprox.", m.endDateApprox || "—"]],
    party: { title: "Persona", name: item.title, lines: [m.artisticName && m.artisticName !== item.title ? `«${m.artisticName}»` : "", m.email || "", m.phone || "", m.company || ""].filter(Boolean) },
    table: {
      columns: [{ label: "Documento", width: 120 }, { label: "Estado", width: 54, align: "right" }],
      rows: CREW_DOCS.map((d) => [d.label, docs[d.key] ? "Adjunto" : "Falta"]),
    },
    versions: [{ version: "V01", at: item.date || new Date(), by: m.createdByName || "—", change: "Ficha y documentos del crew" }],
    generatedAt: new Date(), generatedBy: user, fingerprint,
  }).output("arraybuffer");
  const { bytes, missing } = await appendOriginals(cover, item.originals, `${item.number} · ${project.name}`);
  return { bytes, missing, fingerprint };
}

/** Línea de auditoría breve para la ficha lateral. */
export const lastSignEvent = (r: SignRequest) => {
  const e = [...r.events].sort((a, b) => b.at - a.at)[0];
  return e ? `${EVENT_LABEL[e.type]} · ${fmtDateTime(e.at)}` : "—";
};
