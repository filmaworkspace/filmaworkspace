// ─── Estilo común de la app (mismo lenguaje que login, header y dashboard) ───
// Clases de Tailwind compartidas para que las páginas rediseñadas se vean
// igual: fondo blanco, grises suaves, botón principal gris claro, pestañas con
// una marca fina en lugar de botones rellenos.

export const ui = {
  /** Contenedor de página (deja sitio al header fijo de 53 px). */
  page: "mx-auto px-6 pb-20 pt-[85px] sm:px-10",
  /** Título de página. */
  title: "text-[1.75rem] font-semibold tracking-tight text-slate-900",
  /** Encabezado de sección pequeño. */
  sectionTitle: "text-[13px] font-medium text-slate-500",

  /** Botón principal / secundario: gris claro con borde fino. */
  softButton:
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#E4E4E7] bg-[#F1F1F3] px-3 text-[13px] font-medium text-slate-900 transition-colors hover:bg-[#E8E8EB] disabled:cursor-not-allowed disabled:opacity-60",
  /** Control neutro (filtros, desplegables). */
  control:
    "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors hover:border-slate-300",
  /** Botón de solo icono. */
  iconButton:
    "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-[#F1F1F3] hover:text-slate-900",

  /** Menú desplegable y sus opciones. */
  menu: "absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg",
  menuItem:
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-600 transition-colors hover:bg-[#F7F7F8] hover:text-slate-900",

  card: "rounded-2xl border border-slate-200 bg-white",
  chip: "rounded-md bg-[#F4F4F5] px-2 py-0.5 text-[11px] text-slate-600",
  /** Etiqueta de cristal sobre una portada. */
  glassPill:
    "inline-flex h-6 items-center gap-1 rounded-md border border-white/25 bg-black/25 px-2 text-[11px] font-medium text-white backdrop-blur-md",

  label: "mb-1.5 block text-sm font-medium text-slate-800",
  input:
    "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10 disabled:bg-[#F7F7F8] disabled:text-slate-500",

  /** Pestañas: texto, y la activa en seminegrita con una marca fina debajo. */
  tabs: "flex gap-6 border-b border-slate-200",
  tab: (active: boolean) =>
    `relative -mb-px flex items-center gap-1.5 border-b-[1.5px] pb-3 text-[13px] transition-colors ${
      active ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"
    }`,
};

/** Color propio de cada módulo. */
export const MODULE_COLORS = { accounting: "#2F52E0", team: "#6BA319" } as const;
