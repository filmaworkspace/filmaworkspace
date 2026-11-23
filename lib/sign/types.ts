// ─── Filma Sign: modelo ──────────────────────────────────────────────────────
// Una solicitud de firma (signRequests/{id}) guarda una copia congelada del
// documento (payload) y su huella SHA-256, quién firma por cada parte, y un
// registro de auditoría con cada paso (creación, envío, apertura, firma…).
// Solo el servidor escribe: la página pública entra con un enlace personal
// cuyo token se guarda cifrado (hash).
//
// Plantillas (SIGN_TEMPLATES): "quote" firma un presupuesto de facturación;
// "document" es un documento de texto libre (acuerdos, autorizaciones…). Para
// añadir otra: un kind aquí, cómo se pinta (lib/sign/render) y, si hace falta,
// qué pasa al completarse (lib/server/sign).

export type SignKind = "quote" | "document";
export type SignStatus = "pending" | "completed" | "declined" | "cancelled" | "expired";

export const SIGN_TEMPLATES: Record<SignKind, { label: string; noun: string; description: string }> = {
  quote: { label: "Presupuesto", noun: "el presupuesto", description: "Aceptación y firma de un presupuesto de Filma." },
  document: { label: "Documento", noun: "el documento", description: "Texto libre: acuerdos, autorizaciones, condiciones…" },
};

export interface SignSignature {
  /** Imagen PNG de la firma (data URL), dibujada o generada a partir del nombre. */
  image: string;
  method: "draw" | "type";
  typedName: string;
  signedAt: number;
  ip: string;
  userAgent: string;
}

export interface SignParty {
  id: string;
  /** "issuer" = Filma (firma al crear), "signer" = el cliente. */
  side: "issuer" | "signer";
  name: string;
  email: string;
  /** Cargo o empresa que aparece bajo la firma. */
  role: string;
  taxId?: string;
  status: "pending" | "signed" | "declined";
  signature?: SignSignature | null;
  declineReason?: string | null;
  viewedAt?: number | null;
}

export type SignEventType = "created" | "sent" | "viewed" | "signed" | "declined" | "completed" | "copy_sent" | "reminded" | "cancelled";
export interface SignEvent { at: number; type: SignEventType; party?: string | null; by?: string | null; ip?: string | null; userAgent?: string | null; detail?: string | null }

export interface SignRequest {
  id: string;
  kind: SignKind;
  status: SignStatus;
  title: string;
  /** Número del documento (P2026-0004) si lo tiene. */
  reference: string | null;
  /** Documento de origen (p. ej. billingQuotes/{id}). */
  refPath: string | null;
  /** Copia congelada de lo que se firma (lo necesario para pintarlo). */
  payload: SignPayload;
  /** SHA-256 del payload: la huella de lo firmado. */
  docHash: string;
  parties: SignParty[];
  message: string;
  events: SignEvent[];
  createdAt: number;
  createdBy: string;
  expiresAt: number;
  completedAt?: number | null;
}

export type SignPayload =
  | { kind: "quote"; quote: Record<string, unknown>; settings: Record<string, unknown> }
  | { kind: "document"; title: string; body: string; issuerName: string; reference?: string | null };

export const SIGN_STATUS: Record<SignStatus, { label: string; tone: "warn" | "ok" | "bad" | "none" }> = {
  pending: { label: "Pendiente de firma", tone: "warn" },
  completed: { label: "Firmado", tone: "ok" },
  declined: { label: "Rechazado", tone: "bad" },
  cancelled: { label: "Cancelado", tone: "none" },
  expired: { label: "Caducado", tone: "none" },
};

export const EVENT_LABEL: Record<SignEventType, string> = {
  created: "Solicitud creada", sent: "Envío para firmar", viewed: "Documento abierto", signed: "Firmado",
  declined: "Rechazado", completed: "Firmado por todas las partes", copy_sent: "Envío de la copia firmada", reminded: "Recordatorio enviado", cancelled: "Cancelada",
};

/** Vista pública: sin tokens. */
export type PublicSignRequest = Omit<SignRequest, "createdBy"> & { you: string };

export const fmtDateTime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) : "—";
