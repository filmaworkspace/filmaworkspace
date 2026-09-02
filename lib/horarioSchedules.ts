// ─────────────────────────────────────────────────────────────────────────────
// Tipos de jornada del Control horario (Team): cada persona, cada día, tiene
// una jornada de rodaje, de oficina, o general (para quien no encaja en las
// otras dos), con sus horas de entrada/salida y tiempo de descanso por
// defecto — así casi nadie tiene que tocar nada al fichar, y solo se cambia
// para casos puntuales. Compartido entre la página de admin, la API de envío
// y el formulario público de fichaje.
// ─────────────────────────────────────────────────────────────────────────────

export type ScheduleType = "rodaje" | "oficina" | "general";

export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  rodaje:  "Rodaje",
  oficina: "Oficina",
  general: "General",
};

export interface ScheduleTimes {
  entrada:  string;
  salida:   string;
  /** Minutos de descanso/comida por defecto. */
  descanso: number;
}

export const DEFAULT_SCHEDULE_TIMES: Record<ScheduleType, ScheduleTimes> = {
  rodaje:  { entrada: "07:00", salida: "19:00", descanso: 60 },
  oficina: { entrada: "09:00", salida: "18:00", descanso: 60 },
  general: { entrada: "09:00", salida: "18:00", descanso: 60 },
};

// Se hace merge con los valores por defecto campo a campo — no solo tipo a
// tipo — porque los proyectos con "schedules" guardado de antes de que
// existiera "general" o "descanso" tienen ese tipo entero ausente, o
// presente pero sin el campo "descanso". Un simple "??" a nivel de tipo
// dejaba pasar objetos incompletos y rompía cualquier lectura de esos campos.
export function resolveScheduleTimes(
  schedules: Partial<Record<ScheduleType, Partial<ScheduleTimes>>> | undefined | null,
  type: ScheduleType
): ScheduleTimes {
  return { ...DEFAULT_SCHEDULE_TIMES[type], ...(schedules?.[type] ?? {}) };
}

/** Versión completa de "resolveScheduleTimes" para los tres tipos a la vez — para formularios de edición. */
export function normalizeSchedules(
  schedules: Partial<Record<ScheduleType, Partial<ScheduleTimes>>> | undefined | null
): Record<ScheduleType, ScheduleTimes> {
  return {
    rodaje:  resolveScheduleTimes(schedules, "rodaje"),
    oficina: resolveScheduleTimes(schedules, "oficina"),
    general: resolveScheduleTimes(schedules, "general"),
  };
}
