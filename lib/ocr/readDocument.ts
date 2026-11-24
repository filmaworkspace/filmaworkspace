// ─── Lectura del documento (navegador) ───────────────────────────────────────
// PDF con texto: se extrae el texto directamente (rápido y exacto). PDF
// escaneado o imagen: OCR en el propio navegador (Tesseract, español). El
// documento no sale del equipo: solo se descarga el motor de OCR la primera vez.

export interface ReadResult { text: string; method: "pdf-text" | "ocr"; pages: number }
type Progress = (label: string, pct?: number) => void;

async function fetchBytes(url: string) {
  const r = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error("No se ha podido abrir el documento");
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
}

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return lib;
}

/** Texto de un PDF, línea a línea (agrupando por altura en la página). */
async function pdfText(bytes: Uint8Array, maxPages = 4) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  const out: string[] = [];
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) || []), { x: it.transform[4], s: it.str }]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => out.push(r.sort((a, b) => a.x - b.x).map((x) => x.s).join("  ")));
  }
  return { text: out.join("\n"), pages: doc.numPages, doc };
}

async function ocrImages(images: (Blob | HTMLCanvasElement)[], progress: Progress) {
  const { createWorker } = await import("tesseract.js");
  progress("Preparando el OCR…");
  const worker = await createWorker("spa", 1, {
    logger: (m: { status: string; progress: number }) => { if (m.status === "recognizing text") progress("Leyendo el documento…", Math.round(m.progress * 100)); },
  });
  try {
    const parts: string[] = [];
    for (const img of images) parts.push((await worker.recognize(img)).data.text);
    return parts.join("\n");
  } finally { await worker.terminate(); }
}

export async function readDocument(url: string, progress: Progress = () => {}): Promise<ReadResult> {
  progress("Abriendo el documento…");
  const { bytes, type } = await fetchBytes(url);
  return readBytes(bytes, type, progress);
}

/** Lo mismo con un archivo que aún no se ha subido (p. ej. un justificante arrastrado). */
export async function readFile(file: File, progress: Progress = () => {}, opts: { ocr?: boolean } = {}): Promise<ReadResult> {
  return readBytes(new Uint8Array(await file.arrayBuffer()), file.type, progress, opts);
}

async function readBytes(bytes: Uint8Array, type: string, progress: Progress, opts: { ocr?: boolean } = {}): Promise<ReadResult> {
  const isPdf = type.includes("pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  if (isPdf) {
    const { text, pages, doc } = await pdfText(bytes);
    // Con texto suficiente no hace falta OCR.
    if (text.replace(/\s/g, "").length > 60 || opts.ocr === false) return { text, method: "pdf-text", pages };
    // Escaneado: se pintan las dos primeras páginas y se pasan por OCR.
    const canvases: HTMLCanvasElement[] = [];
    for (let p = 1; p <= Math.min(2, pages); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never).promise;
      canvases.push(c);
    }
    return { text: await ocrImages(canvases, progress), method: "ocr", pages };
  }
  if (opts.ocr === false) return { text: "", method: "ocr", pages: 1 };
  return { text: await ocrImages([new Blob([bytes as BlobPart], { type: type || "image/jpeg" })], progress), method: "ocr", pages: 1 };
}
