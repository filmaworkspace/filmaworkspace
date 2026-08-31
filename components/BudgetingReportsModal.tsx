"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Download, FileSpreadsheet, FileText, LayoutTemplate, Rows3, Settings2, X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import {
  BTN_LIGHT, BTN_LIGHT_ACTIVE, BudgetingExportConfig, BudgetingProjectInfo,
  PDF_FONT_SIZE_LABELS, PDF_LANGUAGE_LABELS, PdfFontSize, PdfLanguage,
} from "@/lib/budgeting";

const ACCENT = "#E86F4A";

type ReportTab = "cover" | "topsheet" | "detail" | "excel" | "settings";

const TABS: { id: ReportTab; label: string; icon: typeof FileText }[] = [
  { id: "cover", label: "Portada", icon: FileText },
  { id: "topsheet", label: "Top Sheet", icon: LayoutTemplate },
  { id: "detail", label: "Detalle", icon: Rows3 },
  { id: "excel", label: "Excel", icon: FileSpreadsheet },
  { id: "settings", label: "Ajustes", icon: Settings2 },
];

type ExportConfigPatch = Partial<Omit<BudgetingExportConfig, "fields">> & { fields?: Partial<BudgetingExportConfig["fields"]> };

interface Props {
  open: boolean;
  onClose: () => void;
  draftName: string;
  currency: string;
  exportConfig: BudgetingExportConfig;
  onUpdateExportConfig: (patch: ExportConfigPatch) => void;
  projectInfo: BudgetingProjectInfo;
  onSaveProjectInfo: (info: BudgetingProjectInfo) => Promise<void>;
  onDownloadPdf: () => void;
  onDownloadExcel: () => void;
  onDownloadFwb: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// "Reportes": todo lo que antes eran el desplegable "Exportar" (apretado, un
// puñado de checkboxes) y el modal aparte de "Datos de producción" viven
// aquí, como pestañas de un mismo sitio. La idea central: Portada, Top
// Sheet y Detalle son tres reportes de un PDF que se pueden incluir por
// separado —uno de los tres, dos, o los tres juntos, en ese orden— en vez
// de una única casilla que los mezclaba a todos (ver lib/budgeting.ts,
// normalizeExportConfig, que migra el `coverSheet` de siempre sin romper
// nada ya exportado). Cada persona deja aquí su propia configuración
// guardada en el borrador: no hay que rehacerla cada vez que se exporta.
// ─────────────────────────────────────────────────────────────────────────────

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-slate-200 rounded-2xl px-5 py-3.5">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
        style={{ background: checked ? ACCENT : "#e2e8f0" }}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-150 ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700 block mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
      />
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 border border-slate-200 rounded-lg bg-slate-50 w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${value === o.value ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Checkboxes de campos visibles (Unidad/Comentario/Etiquetas): compartidos entre Detalle y Excel, así que es el mismo bloque en las dos pestañas. */
function FieldsChecklist({ fields, onChange }: { fields: BudgetingExportConfig["fields"]; onChange: (patch: Partial<BudgetingExportConfig["fields"]>) => void }) {
  return (
    <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
      {([["unit", "Unidad"], ["notes", "Comentario"], ["tags", "Etiquetas"]] as const).map(([key, label]) => (
        <label key={key} className="flex items-center justify-between gap-2 px-5 py-3 cursor-pointer hover:bg-slate-50">
          <span className="text-sm text-slate-700">{label}</span>
          <input type="checkbox" checked={fields[key]} onChange={(e) => onChange({ [key]: e.target.checked })} className="accent-[#E86F4A]" />
        </label>
      ))}
    </div>
  );
}

export default function BudgetingReportsModal({
  open, onClose, draftName, currency, exportConfig, onUpdateExportConfig,
  projectInfo, onSaveProjectInfo, onDownloadPdf, onDownloadExcel, onDownloadFwb,
}: Props) {
  const [tab, setTab] = useState<ReportTab>("cover");
  const [form, setForm] = useState<BudgetingProjectInfo>(projectInfo);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (open) { setForm(projectInfo); setTab("cover"); setSaved(false); } }, [open, projectInfo]);

  if (!open) return null;

  const set = (patch: Partial<BudgetingProjectInfo>) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };

  const handleSaveInfo = async () => {
    setSaving(true);
    try {
      await onSaveProjectInfo(form);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const includedCount = [exportConfig.includeCoverSheet, exportConfig.includeTopSheet, exportConfig.includeDetail].filter(Boolean).length;
  const summaryChips = [
    exportConfig.includeCoverSheet && "Portada",
    exportConfig.includeTopSheet && "Top Sheet",
    exportConfig.includeDetail && "Detalle",
  ].filter(Boolean) as string[];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[85vh] flex overflow-hidden">
        <aside className="w-48 flex-shrink-0 border-r border-slate-100 py-4 px-2.5 space-y-0.5 overflow-y-auto">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">Reportes</p>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${tab === t.id ? "" : "text-slate-600 hover:bg-slate-50"}`}
              style={tab === t.id ? { background: `${ACCENT}1a`, color: ACCENT, fontWeight: 500 } : undefined}
            >
              <t.icon size={13} className="flex-shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
            <h2 className="text-sm font-semibold text-slate-900">{TABS.find((t) => t.id === tab)?.label}</h2>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            {tab === "cover" && (
              <>
                <ToggleRow
                  label="Incluir Portada en el PDF"
                  hint="Título, datos de producción y notas, en su propia página."
                  checked={exportConfig.includeCoverSheet}
                  onChange={(v) => onUpdateExportConfig({ includeCoverSheet: v })}
                />
                <div className="space-y-3.5">
                  <p className="text-xs text-slate-400">Se quedan guardados en este presupuesto — no hace falta rellenarlos cada vez que se exporta.</p>
                  <Field label="Productora" value={form.productionCompany || ""} onChange={(v) => set({ productionCompany: v })} />
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Formato</label>
                    <Segmented options={[{ value: "Película", label: "Película" }, { value: "Serie", label: "Serie" }]} value={(form.format as "Película" | "Serie") || "Película"} onChange={(v) => set({ format: v })} />
                    {form.format === "Serie" ? (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <input value={form.episodeCount || ""} onChange={(e) => set({ episodeCount: e.target.value })} placeholder="Nº de capítulos" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
                        <input value={form.episodeDuration || ""} onChange={(e) => set({ episodeDuration: e.target.value })} placeholder="Duración de los capítulos" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
                      </div>
                    ) : form.format === "Película" ? (
                      <input value={form.filmDuration || ""} onChange={(e) => set({ filmDuration: e.target.value })} placeholder="Duración de la película" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 mt-2" />
                    ) : null}
                  </div>
                  <Field label="Dirección" value={form.director || ""} onChange={(v) => set({ director: v })} />
                  <Field label="Guion fechado" value={form.scriptDate || ""} onChange={(v) => set({ scriptDate: v })} placeholder="p.ej. 3ª versión, 12/03" />
                  <Field label="Fecha presupuesto" value={form.dateLabel || ""} onChange={(v) => set({ dateLabel: v })} placeholder="Se usa la de hoy si se deja en blanco" />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Inicio rodaje" value={form.startDate || ""} onChange={(v) => set({ startDate: v })} />
                    <Field label="Fin rodaje" value={form.endDate || ""} onChange={(v) => set({ endDate: v })} />
                  </div>
                  <Field label="Postproducción" value={form.post || ""} onChange={(v) => set({ post: v })} />
                  <Field label="Versión #" value={form.version || ""} onChange={(v) => set({ version: v })} placeholder="v1" />
                  <Field label="Preparado por" value={form.preparedBy || ""} onChange={(v) => set({ preparedBy: v })} />
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Notas</label>
                    <textarea
                      value={form.notes || ""}
                      onChange={(e) => set({ notes: e.target.value })}
                      placeholder="Cualquier otra información importante para la portada"
                      rows={3}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 resize-none"
                    />
                  </div>
                  <button onClick={handleSaveInfo} disabled={saving} className={`w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}>
                    {saving ? "Guardando..." : saved ? "Guardado ✓" : "Guardar datos de producción"}
                  </button>
                </div>
              </>
            )}

            {tab === "topsheet" && (
              <>
                <ToggleRow
                  label="Incluir Top Sheet en el PDF"
                  hint="Resumen de capítulos con su total, agrupados por categoría."
                  checked={exportConfig.includeTopSheet}
                  onChange={(v) => onUpdateExportConfig({ includeTopSheet: v })}
                />
                <p className="text-xs text-slate-400 leading-relaxed">
                  Es la vista de una página del presupuesto entero: cada capítulo con su total, sin bajar a Cuentas ni líneas de Detalle. Para eso está la pestaña Detalle.
                </p>
              </>
            )}

            {tab === "detail" && (
              <>
                <ToggleRow
                  label="Incluir Detalle en el PDF"
                  hint="Desglose completo: Capítulo → Cuenta → línea, con Cantidad/Unidad/X/Tarifa."
                  checked={exportConfig.includeDetail}
                  onChange={(v) => onUpdateExportConfig({ includeDetail: v })}
                />
                <ToggleRow
                  label="Salto de página por capítulo"
                  hint="Cada capítulo empieza en una página nueva, en vez de seguir corrido."
                  checked={exportConfig.pageBreakPerChapter}
                  onChange={(v) => onUpdateExportConfig({ pageBreakPerChapter: v })}
                />
                <ToggleRow
                  label="Ocultar Cuentas con total 0€"
                  hint="No dibuja las Cuentas vacías; los Capítulos y líneas sueltas no se ven afectados."
                  checked={exportConfig.hideZeroTotalSubchapters}
                  onChange={(v) => onUpdateExportConfig({ hideZeroTotalSubchapters: v })}
                />
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Campos visibles</p>
                  <FieldsChecklist fields={exportConfig.fields} onChange={(patch) => onUpdateExportConfig({ fields: patch })} />
                </div>
              </>
            )}

            {tab === "excel" && (
              <>
                <p className="text-xs text-slate-400 leading-relaxed">
                  El Excel siempre sale a nivel de línea de Detalle (una fila por línea), con Categoría/Capítulo/Cuenta como columnas propias. No lleva Portada ni Top Sheet — para eso está el PDF.
                </p>
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Campos visibles</p>
                  <FieldsChecklist fields={exportConfig.fields} onChange={(patch) => onUpdateExportConfig({ fields: patch })} />
                </div>
              </>
            )}

            {tab === "settings" && (
              <>
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-1.5">Tamaño de letra</p>
                  <p className="text-xs text-slate-400 mb-2">Solo afecta al PDF: escala portada, tablas y totales juntos.</p>
                  <Segmented options={(["small", "normal", "large"] as PdfFontSize[]).map((v) => ({ value: v, label: PDF_FONT_SIZE_LABELS[v] }))} value={exportConfig.pdfFontSize} onChange={(v) => onUpdateExportConfig({ pdfFontSize: v })} />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-1.5">Idioma</p>
                  <p className="text-xs text-slate-400 mb-2">Traduce las etiquetas fijas del PDF (encabezados, "Total"...); lo escrito en el presupuesto no se traduce.</p>
                  <Segmented options={(["es", "en"] as PdfLanguage[]).map((v) => ({ value: v, label: PDF_LANGUAGE_LABELS[v] }))} value={exportConfig.pdfLanguage} onChange={(v) => onUpdateExportConfig({ pdfLanguage: v })} />
                </div>
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0 space-y-3">
            <div className="flex items-center gap-1.5 flex-wrap min-h-[20px]">
              {summaryChips.length > 0 ? (
                summaryChips.map((chip) => (
                  <span key={chip} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: `${ACCENT}1a`, color: ACCENT }}>{chip}</span>
                ))
              ) : (
                <span className="text-[11px] text-slate-400">Ningún reporte incluido en el PDF todavía.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onDownloadFwb} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium ${BTN_LIGHT}`}>
                <Download size={13} /> .fwb
              </button>
              <button onClick={onDownloadExcel} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium ${BTN_LIGHT}`}>
                <FileSpreadsheet size={13} /> Excel
              </button>
              <button
                onClick={onDownloadPdf}
                disabled={includedCount === 0}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-colors"
                style={{ background: ACCENT }}
              >
                <FileText size={14} /> Descargar PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
