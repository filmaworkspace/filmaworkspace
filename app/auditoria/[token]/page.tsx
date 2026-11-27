"use client";

// ─── Acceso de auditoría ─────────────────────────────────────────────────────
// Lo que abre el auditor con el enlace: solo lectura, con caducidad y, si se
// configuró, PIN. Los documentos son una copia congelada del día en que se
// compartieron, con sus huellas. Cada apertura y descarga queda registrada.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { zipSync } from "fflate";
import { Download, Eye, FileText, Lock } from "lucide-react";
import { inter } from "@/lib/fonts";
import { Button, Input, Spinner } from "@/components/ds";

interface FileRow { path: string; name: string; folder: string; number: string; type: string; status: string; size: number; sha256: string }
interface Pack { projectName: string; projectCode: string; auditorName: string; auditorCompany: string; note: string; createdByName: string; createdAt: number | null; expiresAt: number; files: FileRow[] }

const day = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export default function AuditPage() {
  const { token } = useParams() as { token: string };
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"loading" | "pin" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [pack, setPack] = useState<Pack | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zip, setZip] = useState<{ done: number; total: number } | null>(null);
  const [q, setQ] = useState("");

  const call = (body: Record<string, unknown>) => fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, pin: pin || undefined, ...body }) });

  const open = async () => {
    setError("");
    const r = await call({ action: "open" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setPack(j); setState("ready"); return; }
    if (j.needsPin) { setState("pin"); if (j.error) setError(j.error); setPack((p) => p || ({ projectName: j.projectName || "", auditorName: j.auditorName || "" } as Pack)); return; }
    setError(j.error || "No se ha podido abrir el enlace"); setState("error");
  };
  useEffect(() => { void open(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const fetchFile = async (f: FileRow) => {
    const r = await call({ action: "file", path: f.path });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se ha podido descargar");
    return new Uint8Array(await r.arrayBuffer());
  };
  const save = (bytes: Uint8Array, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const view = async (f: FileRow) => {
    setBusy(f.path);
    try {
      const bytes = await fetchFile(f);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: f.name.endsWith(".csv") ? "text/csv" : "application/pdf" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(String((e as Error).message)); } finally { setBusy(null); }
  };
  const download = async (f: FileRow) => {
    setBusy(f.path);
    try { save(await fetchFile(f), f.name, f.name.endsWith(".csv") ? "text/csv" : "application/pdf"); }
    catch (e) { setError(String((e as Error).message)); } finally { setBusy(null); }
  };
  const downloadAll = async () => {
    if (!pack) return;
    const out: Record<string, Uint8Array> = {};
    const root = `${pack.projectCode ? `${pack.projectCode} · ` : ""}${pack.projectName}`.replace(/[\\/:*?"<>|]+/g, " ");
    setZip({ done: 0, total: pack.files.length });
    try {
      for (let i = 0; i < pack.files.length; i++) { out[`${root}/${pack.files[i].path}`] = await fetchFile(pack.files[i]); setZip({ done: i + 1, total: pack.files.length }); }
      save(zipSync(out, { level: 6 }), `${root} · auditoría.zip`, "application/zip");
    } catch (e) { setError(String((e as Error).message)); } finally { setZip(null); }
  };

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m = new Map<string, FileRow[]>();
    for (const f of pack?.files || []) {
      if (t && !`${f.number} ${f.name} ${f.type} ${f.status}`.toLowerCase().includes(t)) continue;
      const k = f.folder || "Índice";
      m.set(k, [...(m.get(k) || []), f]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "Índice" ? -1 : b === "Índice" ? 1 : a.localeCompare(b, "es")));
  }, [pack, q]);

  const shell = (children: React.ReactNode) => (
    <div className={`min-h-screen bg-white text-slate-900 ${inter.className}`}>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Image src="/logodark.svg" alt="Filma" width={72} height={16} className="h-auto w-[72px]" priority />
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Lock size={12} /> Acceso de auditoría · solo lectura</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );

  if (state === "loading") return shell(<div className="flex justify-center py-20"><Spinner /></div>);
  if (state === "error") return shell(<div className="py-20 text-center"><p className="text-[15px] font-semibold">No disponible</p><p className="mt-1 text-[13px] text-slate-500">{error}</p></div>);
  if (state === "pin") return shell(
    <form onSubmit={(e) => { e.preventDefault(); void open(); }} className="mx-auto max-w-xs py-12 text-center">
      <p className="text-[15px] font-semibold">{pack?.projectName || "Documentación"}</p>
      <p className="mt-1 text-[13px] text-slate-500">Introduce el PIN que te han facilitado{pack?.auditorName ? `, ${pack.auditorName}` : ""}.</p>
      <Input autoFocus inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="mt-5 h-11 text-center font-mono text-lg tracking-[0.4em]" aria-label="PIN" />
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <Button type="submit" variant="primary" className="mt-4 w-full" disabled={pin.length < 6}>Entrar</Button>
    </form>,
  );

  const p = pack!;
  const docs = p.files.filter((f) => f.path !== "MANIFEST.csv").length;
  return shell(
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{p.projectCode}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.projectName}</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Para {p.auditorName}{p.auditorCompany ? ` · ${p.auditorCompany}` : ""} · compartido por {p.createdByName}{p.createdAt ? ` el ${day(p.createdAt)}` : ""} · disponible hasta el {day(p.expiresAt)}
          </p>
        </div>
        <Button variant="primary" onClick={downloadAll} disabled={!!zip}>
          <Download size={14} /> {zip ? `Preparando ${zip.done}/${zip.total}…` : `Descargar todo (${docs})`}
        </Button>
      </div>
      {p.note && <p className="mt-5 rounded-lg border border-slate-200 bg-[#FAFAFA] px-4 py-3 text-[13px] text-slate-700">{p.note}</p>}
      <p className="mt-5 text-xs text-slate-500">Copia de los documentos tal y como estaban al compartirlos. Cada PDF lleva su huella SHA-256, recogida también en el manifiesto. Las aperturas y descargas quedan registradas.</p>
      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Input aria-label="Buscar documento" placeholder="Buscar por número, proveedor o estado" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-sm" />
        <span className="text-xs text-slate-500">{docs} documentos</span>
      </div>

      <div className="mt-4 space-y-6">
        {groups.map(([folder, rows]) => (
          <section key={folder}>
            <h2 className="mb-2 text-xs font-medium text-slate-500">{folder} <span className="text-slate-400">· {rows.length}</span></h2>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {rows.map((f) => (
                <div key={f.path} className="flex items-center gap-4 border-b border-slate-100 px-4 py-2.5 text-[13px] last:border-0">
                  <FileText size={15} className="flex-shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{f.name}</span>
                    <span className="block truncate text-xs text-slate-500">{[f.type, f.status !== f.type ? f.status : "", kb(f.size)].filter(Boolean).join(" · ")}<span className="ml-2 font-mono text-[10px] text-slate-400" title={f.sha256}>{f.sha256.slice(0, 12)}…</span></span>
                  </span>
                  <button onClick={() => view(f)} disabled={busy === f.path} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"><Eye size={13} /> Ver</button>
                  <button onClick={() => download(f)} disabled={busy === f.path} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"><Download size={13} /> Descargar</button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>,
  );
}
