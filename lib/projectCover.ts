// ─── Portada de proyecto ─────────────────────────────────────────────────────
// Cada proyecto puede tener una foto de portada (projects/{id}.coverUrl). Si no
// tiene, se pinta un degradado de luz como el del login, con una variación de
// tono fija por proyecto para que se distingan entre sí.

import { doc, updateDoc, deleteField } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

// [luz arriba, luz abajo, color medio, degradado base (3 paradas)]
const PALETTES: [string, string, string, [string, string, string]][] = [
  // 0 · el del login
  ["148,190,214", "120,150,210", "47,82,224", ["#3B5A86", "#24406E", "#1A2E52"]],
  // 1 · azul océano
  ["150,205,220", "96,140,200", "36,99,200", ["#2F5F86", "#1F4466", "#132D4A"]],
  // 2 · índigo
  ["170,180,235", "130,120,210", "79,70,229", ["#3F4A8F", "#2A2F6E", "#1B1D4F"]],
  // 3 · azul pizarra
  ["185,200,220", "130,150,180", "71,105,160", ["#4A5C78", "#33445E", "#222F44"]],
  // 4 · verde azulado
  ["150,215,205", "100,165,185", "20,130,150", ["#2E6A72", "#1F4E5A", "#143642"]],
  // 5 · atardecer azul
  ["205,180,225", "140,150,215", "88,80,200", ["#4D4A86", "#33366B", "#202650"]],
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Fondo CSS (`background`) del degradado. Sin `seed` devuelve el del login. */
export function coverGradient(seed?: string): string {
  const [top, bottom, mid, [a, b, c]] = PALETTES[seed ? hash(seed) % PALETTES.length : 0];
  return (
    `radial-gradient(60% 70% at 85% 15%, rgba(${top},0.85) 0%, transparent 70%),` +
    `radial-gradient(55% 60% at 10% 95%, rgba(${bottom},0.7) 0%, transparent 70%),` +
    `radial-gradient(70% 80% at 30% 30%, rgba(${mid},0.55) 0%, transparent 70%),` +
    `linear-gradient(160deg, ${a} 0%, ${b} 45%, ${c} 100%)`
  );
}

// ─── Subida ──────────────────────────────────────────────────────────────────
const MAX_WIDTH = 1800;
export const MAX_COVER_BYTES = 15 * 1024 * 1024;

/** Reduce la imagen a MAX_WIDTH px de ancho y la pasa a JPEG para no subir fotos enormes. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Sube la portada y la guarda en el proyecto. Devuelve la URL nueva. */
export async function uploadProjectCover(projectId: string, file: File, previousPath?: string | null): Promise<{ url: string; path: string }> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo tiene que ser una imagen");
  if (file.size > MAX_COVER_BYTES) throw new Error("La imagen pesa demasiado (máx. 15 MB)");

  const blob = await shrink(file);
  const path = `projects/${projectId}/cover/${Date.now()}.jpg`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);

  await updateDoc(doc(db, "projects", projectId), { coverUrl: url, coverPath: path });
  if (previousPath && previousPath !== path) {
    deleteObject(ref(storage, previousPath)).catch(() => {});
  }
  return { url, path };
}

/** Quita la portada (vuelve al degradado). */
export async function removeProjectCover(projectId: string, coverPath?: string | null): Promise<void> {
  await updateDoc(doc(db, "projects", projectId), { coverUrl: deleteField(), coverPath: deleteField() });
  if (coverPath) deleteObject(ref(storage, coverPath)).catch(() => {});
}
