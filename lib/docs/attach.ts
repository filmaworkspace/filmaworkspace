// ─── Documento real detrás de la carátula ────────────────────────────────────
// Une la carátula generada con los originales (factura, ticket, presupuesto
// del proveedor…) en un solo PDF. Las imágenes se convierten a página A4; cada
// página añadida lleva una marca discreta con el número del documento.

import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

async function fetchOriginal(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const r = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
  } catch { return null; }
}

/** Convierte cualquier imagen que el navegador sepa pintar (webp, heic en Safari…) a JPEG. */
async function toJpeg(bytes: Uint8Array, type: string): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

export interface Original { url: string; label: string }

/**
 * Añade los originales a la carátula. Devuelve el PDF final y la lista de
 * originales que no se han podido añadir (para avisar en el hub).
 */
export async function appendOriginals(cover: ArrayBuffer | Uint8Array, originals: Original[], stamp: string, opts: { voided?: boolean; watermark?: { text: string; rgb: [number, number, number] } } = {}) {
  const out = await PDFDocument.load(cover);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const missing: string[] = [];
  const mark = (page: ReturnType<typeof out.addPage>, label: string) => {
    // Marca pequeña abajo a la izquierda, sobre un fondo blanco ajustado al texto
    const text = `${stamp} · ${label}`;
    const tw = font.widthOfTextAtSize(text, 6.5);
    page.drawRectangle({ x: 8, y: 4, width: tw + 8, height: 11, color: rgb(1, 1, 1), opacity: 0.9 });
    page.drawText(text, { x: 12, y: 7.5, size: 6.5, font, color: rgb(0.4, 0.45, 0.53) });
  };
  for (const o of originals) {
    const f = await fetchOriginal(o.url);
    if (!f) { missing.push(o.label); continue; }
    try {
      if (f.type.includes("pdf") || (f.bytes[0] === 0x25 && f.bytes[1] === 0x50)) {
        const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((pg) => { out.addPage(pg); mark(pg, o.label); });
      } else {
        let bytes: Uint8Array | null = f.bytes;
        let img;
        if (f.type.includes("png")) img = await out.embedPng(bytes);
        else if (f.type.includes("jpeg") || f.type.includes("jpg")) img = await out.embedJpg(bytes);
        else { bytes = await toJpeg(f.bytes, f.type); if (!bytes) throw new Error("formato"); img = await out.embedJpg(bytes); }
        const page = out.addPage([595.28, 841.89]);
        const s = Math.min((595.28 - 40) / img.width, (841.89 - 60) / img.height, 1.5);
        page.drawImage(img, { x: (595.28 - img.width * s) / 2, y: 841.89 - 30 - img.height * s, width: img.width * s, height: img.height * s });
        mark(page, o.label);
      }
    } catch { missing.push(o.label); }
  }
  const wm = opts.watermark || (opts.voided ? { text: "ANULADA", rgb: [0.86, 0.15, 0.15] as [number, number, number] } : null);
  if (wm) {
    // Anulada o cerrada: marca de agua en diagonal en TODAS las páginas (carátula y originales).
    const bold = await out.embedFont(StandardFonts.HelveticaBold);
    for (const page of out.getPages()) {
      const { width, height } = page.getSize();
      const size = Math.min(width, height) / 5.2;
      const tw = bold.widthOfTextAtSize(wm.text, size);
      const angle = Math.atan2(height, width);
      const cx = width / 2, cy = height / 2;
      page.drawText(wm.text, {
        x: cx - (tw / 2) * Math.cos(angle) + (size / 3) * Math.sin(angle),
        y: cy - (tw / 2) * Math.sin(angle) - (size / 3) * Math.cos(angle),
        size, font: bold, color: rgb(...wm.rgb), opacity: 0.2,
        rotate: degrees((angle * 180) / Math.PI),
      });
    }
  }
  return { bytes: await out.save(), missing };
}
