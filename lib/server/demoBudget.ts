// Presupuesto de la demo: «La última marea», largometraje ficticio de 4.000.000 €.
// Generado desde la plantilla de importación (CUENTA, SUBCUENTA, DESCRIPCIÓN, PRESUPUESTO).
export const DEMO_BUDGET: { code: string; description: string; subs: [string, string, number][] }[] = [
  { code: "01", description: "Guion y música", subs: [
    ["01-01-01", "Derechos de autor", 30000],
    ["01-01-03", "Guion", 100000],
    ["01-02-03", "Compositor música de fondo", 50000],
  ] },
  { code: "02", description: "Personal artístico", subs: [
    ["02-01-01", "Protagonista: Álvaro Sanz como Daniel Vega", 300000],
    ["02-01-02", "Protagonista: Lucía Ferrer como Inés Robles", 180000],
    ["02-05-01", "Figuración normal", 60000],
    ["02-05-03", "Locales", 60000],
  ] },
  { code: "03", description: "Personal técnico", subs: [
    ["03-01-01", "Director", 120000],
    ["03-02-01", "Productor ejecutivo", 100000],
    ["03-02-02", "Director de producción", 100000],
    ["03-02-04", "Ayudante de producción", 150000],
    ["03-03-01", "Director de fotografía", 90000],
    ["03-03-02", "Operador de cámara", 100000],
    ["03-04-01", "Director de arte", 100000],
    ["03-09-01", "Jefe de sonido", 70000],
    ["03-10-01", "Montador", 100000],
    ["03-11-01", "Jefe de eléctricos", 80000],
  ] },
  { code: "04", description: "Escenografía", subs: [
    ["04-01-01", "Construcción y montaje de decorados en plató", 120000],
    ["04-01-08", "Alquiler de interiores y exteriores naturales", 40000],
    ["04-02-02", "Atrezzo alquilado", 50000],
    ["04-02-09", "Material efectos especiales", 20000],
    ["04-03-01", "Vestuario alquilado", 50000],
    ["04-05-01", "Material peluquería", 20000],
  ] },
  { code: "05", description: "Estudios de rodaje/montaje/sonorización y varios producción", subs: [
    ["05-01-01", "Alquiler de platós", 80000],
    ["05-02-07", "Mezclas de sonido", 60000],
    ["05-03-04", "Alquiler oficinas exteriores", 30000],
    ["05-03-19", "Varios producción", 80000],
  ] },
  { code: "06", description: "Maquinaria y elementos de rodaje y transportes", subs: [
    ["06-01-01", "Cámara principal", 120000],
    ["06-01-07", "Material iluminación alquilado", 100000],
    ["06-01-18", "Equipo de sonido principal", 30000],
    ["06-02-01", "Coches de producción", 100000],
  ] },
  { code: "07", description: "Viajes, hoteles y comidas", subs: [
    ["07-02-01", "Viajes equipo artístico (rodaje)", 60000],
    ["07-03-02", "Facturación hotel personal técnico (rodaje)", 50000],
    ["07-03-04", "Comidas en rodaje", 70000],
  ] },
  { code: "08", description: "Película virgen", subs: [
  ] },
  { code: "09", description: "Laboratorio", subs: [
    ["09-03-02", "Backup de brutos de rodaje + soportes", 40000],
    ["09-03-05", "Etalonaje digital", 80000],
    ["09-03-06", "Composición VFX (efectos digitales)", 150000],
    ["09-03-11", "Master y copias DCP", 30000],
    ["09-03-17", "Transcripción, traducción y sincronización subtítulos", 30000],
    ["09-03-18", "Subtítulos", 10000],
    ["09-03-19", "Audiodescripción", 10000],
  ] },
  { code: "10", description: "Seguros", subs: [
    ["10-01-03", "Seguro de responsabilidad civil", 20000],
    ["10-01-04", "Seguro de accidentes", 10000],
    ["10-01-07", "Seguro de combinado de cinematografía", 70000],
    ["10-01-08", "Seg. Social Régimen General", 140000],
  ] },
  { code: "11", description: "Gastos generales", subs: [
    ["11-01-01", "Alquiler oficina", 30000],
    ["11-01-02", "Personal administrativo", 50000],
    ["11-01-07", "Luz, agua, limpieza, etc.", 20000],
    ["11-01-11", "Informe auditoría", 20000],
    ["11-01-12", "Gastos notaría y registros", 20000],
  ] },
  { code: "12", description: "Gastos de explotación, comerciales y financieros", subs: [
    ["12-02-01", "Prensa", 80000],
    ["12-02-02", "Televisión/medios", 70000],
    ["12-02-03", "Creación y estrenos", 70000],
    ["12-02-04", "Tráiler", 60000],
    ["12-02-07", "Festivales", 30000],
    ["12-02-08", "Diseño cartel", 90000],
  ] },
];
