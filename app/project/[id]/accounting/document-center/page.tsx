"use client";

// ─── Documentation hub de contabilidad ───────────────────────────────────────
// Todos los documentos del proyecto en carpetas (Box, Invoices, Purchase
// Orders, Suppliers; siempre en orden alfabético) generados con el diseño del
// proyecto: carátula con la codificación, aprobaciones auditadas e historial
// de versiones, seguida del documento real. Es el único sitio desde el que se
// descargan documentos de contabilidad: de uno en uno, una selección o una
// carpeta entera en un ZIP con su manifiesto (MANIFEST.csv con las huellas).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { zipSync } from "fflate";
import { AlertTriangle, ChevronDown, ChevronRight, Download, ExternalLink, FileText, Folder, FolderOpen, Hash, RefreshCw } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { scopeFromPermissions } from "@/lib/accountingScope";
import { Button, Checkbox, EmptyState, IconButton, Modal, NoAccess, Page, PageHeader, PageLoading, Select, Spinner, useToast } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { loadHub, numberingGaps, renderHubItem, type HubItem, type HubProject } from "@/lib/docs/hub";
import { ACCOUNTING_DOC_TYPES, DOC_TYPES, type DocTypeKey } from "@/lib/docs/projectPdf";

type F = "all" | "number" | "name" | "status";
const FIELDS: SearchField<F>[] = [
  { value: "all", label: "Buscar en todo", placeholder: "Número, proveedor o estado" },
  { value: "number", label: "Número", placeholder: "PO-0013, FRA-0012…", mono: true },
  { value: "name", label: "Proveedor / persona", placeholder: "Nombre" },
  { value: "status", label: "Estado", placeholder: "Pagada, aprobada…" },
];
const TOP = ["Box", "Invoices", "Purchase Orders", "Suppliers"];
const eur = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0) + " €";
const day = (d: Date | null) => (d ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const pathKey = (p: string[]) => p.join("/");
const byName = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

async function sha256(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function saveBlob(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function HubInner() {
  const { id: projectId } = useParams() as { id: string };
  const router = useRouter();
  const params = useSearchParams();
  const { loading: permLoading, permissions } = useAccountingPermissions(projectId);
  const [toast, showToast] = useToast();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<HubProject | null>(null);
  const [items, setItems] = useState<HubItem[]>([]);
  const [used, setUsed] = useState<{ PO: number[]; INV: number[] }>({ PO: [], INV: [] });
  const [path, setPath] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set(TOP));
  const [field, setField] = useState<F>("all");
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | DocTypeKey>("all");
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<HubItem | null>(null);
  const [preview, setPreview] = useState<{ url: string; missing: string[]; fingerprint: string; pages?: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const previewUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scope = scopeFromPermissions({ userId: permissions.userId, canViewAllPOs: permissions.canViewAllPOs, canViewDepartmentPOs: permissions.canViewDepartmentPOs, department: permissions.department });
      const r = await loadHub(db, projectId, scope, permissions.canViewAllPOs);
      setProject(r.project); setItems(r.items); setUsed(r.usedNumbers);
    } catch (e) { console.error(e); showToast("error", "No se pudo cargar la documentación"); }
    finally { setLoading(false); }
  }, [projectId, permissions.userId, permissions.canViewAllPOs, permissions.canViewDepartmentPOs, permissions.department, showToast]);

  useEffect(() => { if (!permLoading && permissions.hasAccountingAccess) load(); }, [permLoading, permissions.hasAccountingAccess, load]);

  // Enlace directo: ?doc=po:<id>
  useEffect(() => {
    const d = params.get("doc");
    if (!d || !items.length) return;
    const it = items.find((i) => i.id === d);
    if (it) { setPath(it.path); setOpen((o) => new Set([...o, ...it.path.map((_, k) => pathKey(it.path.slice(0, k + 1)))])); setCurrent(it); }
  }, [params, items]);

  // Árbol de carpetas (alfabético)
  const tree = useMemo(() => {
    const folders = new Map<string, { path: string[]; count: number; warnings: number }>();
    TOP.forEach((t) => folders.set(t, { path: [t], count: 0, warnings: 0 }));
    for (const it of items) {
      for (let k = 1; k <= it.path.length; k++) {
        const p = it.path.slice(0, k);
        const f = folders.get(pathKey(p)) || { path: p, count: 0, warnings: 0 };
        f.count++; if (it.warnings.length) f.warnings++;
        folders.set(pathKey(p), f);
      }
    }
    return folders;
  }, [items]);
  const childrenOf = (p: string[]) => Array.from(tree.values()).filter((f) => f.path.length === p.length + 1 && pathKey(f.path.slice(0, p.length)) === pathKey(p)).sort((a, b) => byName(a.path[a.path.length - 1], b.path[b.path.length - 1]));

  // Contenido de la carpeta actual (o resultados de búsqueda en todo el hub)
  const searching = !!q.trim() || type !== "all" || onlyWarnings;
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items
      .filter((it) => (searching ? pathKey(it.path).startsWith(pathKey(path)) : pathKey(it.path) === pathKey(path)))
      .filter((it) => type === "all" || it.type === type)
      .filter((it) => !onlyWarnings || it.warnings.length > 0)
      .filter((it) => {
        if (!t) return true;
        const v = field === "number" ? it.number : field === "name" ? it.title : field === "status" ? it.status : `${it.number} ${it.title} ${it.status} ${it.fileName}`;
        return v.toLowerCase().includes(t);
      })
      .sort((a, b) => byName(a.fileName, b.fileName));
  }, [items, path, q, field, type, onlyWarnings, searching]);
  const subfolders = searching ? [] : childrenOf(path);

  // Vista previa
  useEffect(() => {
    if (!current || !project) { setPreview(null); return; }
    let cancelled = false;
    setPreviewing(true);
    renderHubItem(current, project, projectId, permissions.userName || "—")
      .then(({ bytes, missing, fingerprint }) => {
        if (cancelled) return;
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        previewUrl.current = url;
        setPreview({ url, missing, fingerprint });
      })
      .catch((e) => { console.error(e); if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [current, project, projectId, permissions.userName]);

  const logDownload = (count: number, what: string) =>
    addDoc(collection(db, `projects/${projectId}/logs`), {
      type: "hub_download", message: `Descarga del hub: ${what}`, count, actorId: permissions.userId, actorName: permissions.userName, createdAt: serverTimestamp(),
    }).catch(() => {});

  const downloadOne = async (it: HubItem) => {
    if (!project) return;
    setProgress({ done: 0, total: 1 });
    try {
      const { bytes, missing } = await renderHubItem(it, project, projectId, permissions.userName || "—");
      saveBlob(bytes, it.fileName, "application/pdf");
      logDownload(1, it.fileName);
      if (missing.length) showToast("error", `No se pudo añadir: ${missing.join(", ")}`);
    } catch { showToast("error", "No se pudo generar el documento"); }
    finally { setProgress(null); }
  };

  const downloadZip = async (unsorted: HubItem[], zipName: string) => {
    if (!project || !unsorted.length) return;
    const list = [...unsorted].sort((a, b) => byName([...a.path, a.fileName].join("/"), [...b.path, b.fileName].join("/")));
    setProgress({ done: 0, total: list.length });
    const files: Record<string, Uint8Array> = {};
    const manifest: string[][] = [["Ruta", "Número", "Tipo", "Estado", "Versión", "Fecha", "Base imponible", "Total", "SHA-256", "Originales no incluidos"]];
    const root = `${project.code} · ${project.name}`.replace(/[\\/:*?"<>|]+/g, " ");
    try {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const { bytes, missing } = await renderHubItem(it, project, projectId, permissions.userName || "—");
        const rel = [...it.path, it.fileName].join("/");
        files[`${root}/${rel}`] = bytes;
        manifest.push([rel, it.number, it.typeLabel, it.status, it.version, day(it.date), it.base.toFixed(2).replace(".", ","), it.total.toFixed(2).replace(".", ","), await sha256(bytes), missing.join(" | ")]);
        setProgress({ done: i + 1, total: list.length });
      }
      const csv = manifest.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      files[`${root}/MANIFEST.csv`] = new TextEncoder().encode("﻿" + csv);
      saveBlob(zipSync(files, { level: 6 }), zipName, "application/zip");
      logDownload(list.length, zipName);
    } catch (e) { console.error(e); showToast("error", "No se pudo preparar el ZIP"); }
    finally { setProgress(null); }
  };

  if (permLoading) return <PageLoading />;
  if (!permissions.hasAccountingAccess) return <NoAccess backHref={`/project/${projectId}`} />;

  const gaps = permissions.canViewAllPOs ? [...numberingGaps(used.PO, "PO"), ...numberingGaps(used.INV, "FRA/PRF/FNZ")] : [];
  const warnings = items.filter((i) => i.warnings.length).length;
  const folderItems = items.filter((it) => pathKey(it.path).startsWith(pathKey(path)));
  const selectedItems = items.filter((i) => selected.has(i.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const TreeNode = ({ p, depth }: { p: string[]; depth: number }) => {
    const key = pathKey(p);
    const f = tree.get(key);
    const kids = childrenOf(p);
    const isOpen = open.has(key);
    const active = pathKey(path) === key;
    return (
      <div>
        <button
          onClick={() => { setPath(p); setCurrent(null); if (kids.length) setOpen((o) => { const n = new Set(o); if (n.has(key) && active) n.delete(key); else n.add(key); return n; }); }}
          className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] ${active ? "bg-[#F1F1F3] font-medium text-slate-900" : "text-slate-600 hover:bg-[#F7F7F8] hover:text-slate-900"}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {kids.length ? (isOpen ? <ChevronDown size={12} className="flex-shrink-0 text-slate-400" /> : <ChevronRight size={12} className="flex-shrink-0 text-slate-400" />) : <span className="w-3" />}
          {isOpen && kids.length ? <FolderOpen size={14} className="flex-shrink-0 text-slate-400" /> : <Folder size={14} className="flex-shrink-0 text-slate-400" />}
          <span className="flex-1 truncate">{p[p.length - 1]}</span>
          {f && f.warnings > 0 && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />}
          <span className="flex-shrink-0 text-[11px] tabular-nums text-slate-400">{f?.count || 0}</span>
        </button>
        {isOpen && kids.map((k) => <TreeNode key={pathKey(k.path)} p={k.path} depth={depth + 1} />)}
      </div>
    );
  };

  const sourceHref = (it: HubItem) =>
    it.source.kind === "po" ? `/project/${projectId}/accounting/pos/${it.source.id}`
    : it.source.kind === "invoice" ? `/project/${projectId}/accounting/invoices/${it.source.id}`
    : it.source.kind === "supplier" ? `/project/${projectId}/accounting/suppliers/${it.source.id}`
    : `/project/${projectId}/accounting/box`;

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Documentación <span className="text-[15px] font-normal text-slate-400">{items.length}</span></>}
        actions={
          <>
            <IconButton label="Actualizar" onClick={load}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></IconButton>
            {selectedItems.length > 0 ? (
              <Button variant="primary" onClick={() => downloadZip(selectedItems, `${project?.code || "docs"}_seleccion_${selectedItems.length}.zip`)}><Download size={14} /> Descargar selección ({selectedItems.length})</Button>
            ) : (
              <Button variant="primary" disabled={!folderItems.length} onClick={() => downloadZip(folderItems, `${project?.code || "docs"}_${path.length ? path.join("_").replace(/\s+/g, "-") : "completo"}.zip`)}>
                <Download size={14} /> {path.length ? `Descargar ${path[path.length - 1]}` : "Descargar todo"}
              </Button>
            )}
          </>
        }
      />

      {(warnings > 0 || gaps.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
          {warnings > 0 && <button onClick={() => { setOnlyWarnings(true); setPath([]); }} className="flex items-center gap-1.5 hover:text-slate-900"><AlertTriangle size={13} className="text-amber-500" /> {warnings} documento{warnings > 1 ? "s" : ""} con avisos (sin original, proformas, pagadas sin justificante)</button>}
          {gaps.length > 0 && <span className="flex items-center gap-1.5" title={gaps.join(", ")}><Hash size={13} className="text-red-500" /> Faltan números en la secuencia: {gaps.slice(0, 6).join(", ")}{gaps.length > 6 ? "…" : ""}</span>}
        </div>
      )}

      <div className="mt-5 grid gap-6" style={{ gridTemplateColumns: "220px minmax(0,1fr) 380px" }}>
        {/* Árbol */}
        <nav className="min-w-0">
          <button onClick={() => { setPath([]); setCurrent(null); }} className={`mb-1 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] ${!path.length ? "bg-[#F1F1F3] font-medium text-slate-900" : "text-slate-600 hover:bg-[#F7F7F8]"}`}>
            <FolderOpen size={14} className="text-slate-400" /> <span className="flex-1 truncate">{project ? `${project.code}` : "Proyecto"}</span>
            <span className="text-[11px] tabular-nums text-slate-400">{items.length}</span>
          </button>
          {TOP.map((t) => <TreeNode key={t} p={[t]} depth={0} />)}
          <div className="mt-6 space-y-1.5 border-t border-slate-100 pt-4">
            {(["po", "invoice", "proforma", "budget", "guarantee", "box", "supplier"] as DocTypeKey[]).map((k) => (
              <div key={k} className="flex items-center gap-2 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: DOC_TYPES[k].hex }} />{DOC_TYPES[k].label}</div>
            ))}
          </div>
        </nav>

        {/* Lista */}
        <section className="min-w-0">
          <div className="flex items-center gap-1 text-[13px] text-slate-500">
            <button onClick={() => setPath([])} className="hover:text-slate-900">{project?.code || "Proyecto"}</button>
            {path.map((seg, k) => (<span key={k} className="flex items-center gap-1"><ChevronRight size={12} className="text-slate-300" /><button onClick={() => setPath(path.slice(0, k + 1))} className={k === path.length - 1 ? "font-medium text-slate-900" : "hover:text-slate-900"}>{seg}</button></span>))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <SearchBar fields={FIELDS} field={field} onField={setField} value={q} onChange={setQ} count={searching ? rows.length : undefined} />
            <div className="flex items-center gap-3">
              <div className="w-40"><Select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="all">Todos los tipos</option>{ACCOUNTING_DOC_TYPES.map((k) => <option key={k} value={k}>{DOC_TYPES[k].label}</option>)}</Select></div>
              <Checkbox checked={onlyWarnings} onChange={setOnlyWarnings} label="Con avisos" />
            </div>
          </div>

          {loading ? <div className="mt-10 flex justify-center"><Spinner /></div> : !subfolders.length && !rows.length ? (
            <div className="mt-4"><EmptyState title={searching ? "Ningún documento coincide" : "Carpeta vacía"} /></div>
          ) : (
            <table className="tbl mt-4 w-full table-fixed text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className="w-9 py-2 pl-3"><input type="checkbox" checked={allShown} onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allShown ? n.delete(r.id) : n.add(r.id))); return n; })} aria-label="Seleccionar todo" /></th>
                  <th className="px-2">Nombre</th>
                  <th className="w-28 px-2">Fecha</th>
                  <th className="w-28 px-2 text-right">Base</th>
                  <th className="w-12 px-2">Ver.</th>
                </tr>
              </thead>
              <tbody>
                {subfolders.map((f) => (
                  <tr key={pathKey(f.path)} onClick={() => { setPath(f.path); setOpen((o) => new Set([...o, pathKey(f.path)])); }} className="cursor-pointer hover:bg-[#FAFAFA]">
                    <td className="py-1.5 pl-3" />
                    <td className="px-2"><span className="flex items-center gap-2 font-medium text-slate-900"><Folder size={14} className="text-slate-400" />{f.path[f.path.length - 1]}<span className="text-xs font-normal text-slate-400">{f.count}</span></span></td>
                    <td className="px-2" /><td className="px-2" /><td className="px-2" />
                  </tr>
                ))}
                {rows.map((it) => (
                  <tr key={it.id} onClick={() => setCurrent(it)} className={`cursor-pointer ${current?.id === it.id ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}>
                    <td className="py-1.5 pl-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Seleccionar ${it.fileName}`} /></td>
                    <td className="px-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-5 flex-shrink-0 items-end justify-center rounded-[3px] pb-0.5 text-[7px] font-bold text-white" style={{ background: DOC_TYPES[it.type].hex }}>PDF</span>
                        <div className="min-w-0">
                          <div className="truncate text-slate-900"><span className="font-mono text-[12px]">{it.number}</span>{it.title ? <span className="text-slate-700"> · {it.title}</span> : null}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            <span style={{ color: DOC_TYPES[it.type].hex }}>{it.typeLabel}</span> · {it.status}{searching && <span className="text-slate-400"> · {it.path.join(" / ")}</span>}
                            {it.warnings.length > 0 && <span className="text-amber-700"> · {it.warnings.join(" · ")}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 text-slate-600">{day(it.date)}</td>
                    <td className="px-2 text-right tabular-nums text-slate-900">{eur(it.base)}</td>
                    <td className="px-2 font-mono text-[11px] text-slate-500">{it.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Vista previa y metadatos */}
        <aside className="min-w-0">
          <div className="sticky top-[76px]">
            {!current ? (
              <div className="flex aspect-[210/297] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 text-center">
                <FileText size={22} className="text-slate-300" />
                <p className="mt-2 text-[13px] text-slate-500">Elige un documento para verlo</p>
              </div>
            ) : (
              <>
                <div className="relative aspect-[210/297] overflow-hidden rounded-lg border border-slate-200 bg-[#F4F4F5]">
                  {preview && !previewing ? <iframe title="Vista previa" src={`${preview.url}#toolbar=0&navpanes=0&view=FitH`} className="h-full w-full" /> : <div className="flex h-full items-center justify-center"><Spinner /></div>}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" className="flex-1" onClick={() => downloadOne(current)}><Download size={14} /> Descargar PDF</Button>
                  <Link href={sourceHref(current)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[13px] text-slate-700 hover:bg-[#F7F7F8]"><ExternalLink size={13} /> Origen</Link>
                </div>
                <dl className="mt-4 space-y-2 text-[12px]">
                  {[
                    ["Archivo", current.fileName],
                    ["Carpeta", current.path.join(" / ")],
                    ["Tipo", current.typeLabel],
                    ["Estado", current.status],
                    ["Versión", current.version],
                    ["Base imponible", eur(current.base)],
                    ["Total", eur(current.total)],
                    ["Documentos reales", current.originals.length ? current.originals.map((o) => o.label).join(", ") : "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4"><dt className="flex-shrink-0 text-slate-500">{k}</dt><dd className="truncate text-right text-slate-900" title={v}>{v}</dd></div>
                  ))}
                  {preview?.fingerprint && <div><dt className="text-slate-500">Huella del contenido (SHA-256)</dt><dd className="mt-0.5 break-all tabular-nums text-[10.5px] text-slate-600">{preview.fingerprint}</dd></div>}
                </dl>
                {(current.warnings.length > 0 || (preview?.missing.length || 0) > 0) && (
                  <div className="mt-4 rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2 text-xs text-amber-900">
                    {[...current.warnings, ...(preview?.missing || []).map((m) => `No se pudo adjuntar: ${m}`)].map((w) => <p key={w}>{w}</p>)}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      <Modal open={!!progress} onClose={() => {}} title="Preparando documentos">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-slate-600">Generando {progress?.done || 0} de {progress?.total || 0}: carátula, aprobaciones y documentos reales.</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0}%` }} /></div>
        </div>
      </Modal>
    </Page>
  );
}

export default function DocumentCenterPage() {
  return <Suspense fallback={<PageLoading />}><HubInner /></Suspense>;
}
