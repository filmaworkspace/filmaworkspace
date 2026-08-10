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

export function resolveScheduleTimes(
  schedules: Partial<Record<ScheduleType, ScheduleTimes>> | undefined | null,
  type: ScheduleType
): ScheduleTimes {
  return schedules?.[type] ?? DEFAULT_SCHEDULE_TIMES[type];
}
