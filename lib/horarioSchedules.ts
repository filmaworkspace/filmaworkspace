// ─────────────────────────────────────────────────────────────────────────────
// Tipos de jornada del Control horario (Team): cada persona, cada día, tiene
// una jornada "rodaje" u "oficina" con sus horas de entrada/salida por
// defecto — así casi nadie tiene que tocar nada al fichar, y solo se cambia
// para casos puntuales. Compartido entre la página de admin, la API de envío
// y el formulario público de fichaje.
// ─────────────────────────────────────────────────────────────────────────────

export type ScheduleType = "rodaje" | "oficina";

export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  rodaje:  "Rodaje",
  oficina: "Oficina",
};

export const DEFAULT_SCHEDULE_TIMES: Record<ScheduleType, { entrada: string; salida: string }> = {
  rodaje:  { entrada: "07:00", salida: "19:00" },
  oficina: { entrada: "09:00", salida: "18:00" },
};

export function resolveScheduleTimes(
  schedules: Partial<Record<ScheduleType, { entrada: string; salida: string }>> | undefined | null,
  type: ScheduleType
): { entrada: string; salida: string } {
  return schedules?.[type] ?? DEFAULT_SCHEDULE_TIMES[type];
}
