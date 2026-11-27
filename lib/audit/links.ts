// ─── Enlace seguro para auditores (lado de quien comparte) ───────────────────
// Genera el paquete congelado (los PDF tal y como están hoy, con sus huellas)
// en el almacenamiento del proyecto, y deja el enlace en auditLinks/{sha256}.
// El token solo existe en el enlace: en la base de datos se guarda su huella.

import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
import { ref as sref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { renderHubItem, type HubItem, type HubProject } from "@/lib/docs/hub";

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async (s: string | Uint8Array) =>
  hex(await crypto.subtle.digest("SHA-256", (typeof s === "string" ? new TextEncoder().encode(s) : s) as BufferSource));
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface AuditLink {
  id: string;
  auditorName: string; auditorCompany?: string; auditorEmail?: string; note?: string;
  expiresAt: Date; createdAt: Date | null; createdByName: string;
  revoked?: boolean; revokedAt?: Date | null; hasPin: boolean;
  files: { path: string; name: string; folder: string; number: string }[];
  opens?: number; downloads?: number; lastAccessAt?: Date | null; ready?: boolean;
}

const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : null);

export async function listAuditLinks(projectId: string): Promise<AuditLink[]> {
  // Sin orderBy en la consulta (evita un índice compuesto): se ordena aquí.
  const s = await getDocs(query(collection(db, "auditLinks"), where("projectId", "==", projectId)));
  return s.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id, auditorName: x.auditorName, auditorCompany: x.auditorCompany, auditorEmail: x.auditorEmail, note: x.note,
      expiresAt: toDate(x.expiresAt) || new Date(), createdAt: toDate(x.createdAt), createdByName: x.createdByName,
      revoked: !!x.revoked, revokedAt: toDate(x.revokedAt), hasPin: !!x.pinHash, files: x.files || [],
      opens: x.opens || 0, downloads: x.downloads || 0, lastAccessAt: toDate(x.lastAccessAt), ready: !!x.ready,
    } as AuditLink;
  }).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

export async function auditAccessLog(linkId: string) {
  const s = await getDocs(query(collection(db, `auditLinks/${linkId}/access`), orderBy("at", "desc")));
  return s.docs.map((d) => ({ id: d.id, type: d.data().type as string, at: toDate(d.data().at), number: d.data().number as string | undefined, ua: d.data().ua as string | undefined }));
}

export async function revokeAuditLink(linkId: string, by: string) {
  await updateDoc(doc(db, "auditLinks", linkId), { revoked: true, revokedAt: serverTimestamp(), revokedByName: by });
}

/** Crea el enlace: genera los PDF, los sube y devuelve la URL y el PIN. */
export async function createAuditLink(opts: {
  projectId: string; project: HubProject; items: HubItem[];
  auditorName: string; auditorCompany?: string; auditorEmail?: string; note?: string;
  days: number; withPin: boolean; user: { uid: string; name: string };
  onProgress?: (done: number, total: number) => void;
}): Promise<{ url: string; pin: string | null; id: string; missing: string[] }> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const id = await sha256Hex(token);
  const pin = opts.withPin ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0") : null;
  const linkRef = doc(db, "auditLinks", id);
  const base = {
    projectId: opts.projectId, projectName: opts.project.name, projectCode: opts.project.code,
    auditorName: opts.auditorName.trim(), auditorCompany: opts.auditorCompany?.trim() || null, auditorEmail: opts.auditorEmail?.trim() || null, note: opts.note?.trim() || null,
    expiresAt: Timestamp.fromMillis(Date.now() + opts.days * 86_400_000),
    pinHash: pin ? await sha256Hex(`${id}:${pin}`) : null,
    createdAt: serverTimestamp(), createdBy: opts.user.uid, createdByName: opts.user.name,
    revoked: false, ready: false, files: [], opens: 0, downloads: 0,
  };
  await setDoc(linkRef, base);

  const list = [...opts.items].sort((a, b) => [...a.path, a.fileName].join("/").localeCompare([...b.path, b.fileName].join("/"), "es", { numeric: true }));
  const files: { path: string; name: string; folder: string; number: string; type: string; status: string; size: number; sha256: string }[] = [];
  const missingAll: string[] = [];
  const manifest: string[][] = [["Ruta", "Número", "Tipo", "Estado", "SHA-256"]];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const { bytes, missing } = await renderHubItem(it, opts.project, opts.projectId, `${opts.user.name} (para ${opts.auditorName})`);
    const path = [...it.path, it.fileName].join("/");
    await uploadBytes(sref(storage, `projects/${opts.projectId}/audit/${id}/${path}`), bytes, { contentType: "application/pdf" });
    const digest = (await sha256Hex(bytes)).toUpperCase();
    files.push({ path, name: it.fileName, folder: it.path.join(" / "), number: it.number, type: it.typeLabel, status: it.status, size: bytes.length, sha256: digest });
    manifest.push([path, it.number, it.typeLabel, it.status, digest]);
    if (missing.length) missingAll.push(`${it.number}: ${missing.join(", ")}`);
    opts.onProgress?.(i + 1, list.length);
  }
  const csv = new TextEncoder().encode("﻿" + manifest.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n"));
  await uploadBytes(sref(storage, `projects/${opts.projectId}/audit/${id}/MANIFEST.csv`), csv, { contentType: "text/csv" });
  files.push({ path: "MANIFEST.csv", name: "MANIFEST.csv", folder: "", number: "Manifiesto", type: "Índice con huellas", status: "", size: csv.length, sha256: (await sha256Hex(csv)).toUpperCase() });
  await updateDoc(linkRef, { files, ready: true });
  return { url: `${window.location.origin}/auditoria/${token}`, pin, id, missing: missingAll };
}
