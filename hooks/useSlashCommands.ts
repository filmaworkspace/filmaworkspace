"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Comandos "/" en un campo Descripción: escribir "/" abre un mini-menú (a lo
// Notion/Slack) para crear directamente una línea de texto o un subtotal. Se
// activa solo cuando "/" es lo primero que hay en el campo —justo el caso de
// un campo vacío, así que funciona igual en la fila fantasma de un nivel
// vacío que en cualquier fila real recién añadida o con la descripción
// borrada—, nunca a mitad de una descripción ya escrita. Compartido por las
// filas fantasma (BudgetingPhantomRow / PhantomLineRow) y por el campo
// Descripción de las filas reales de los 3 niveles.
// ─────────────────────────────────────────────────────────────────────────────

export interface SlashCommand { cmd: string; label: string; hint: string }

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "texto", label: "Texto", hint: "Nota o separador, sin código ni importe" },
  { cmd: "subtotal", label: "Subtotal", hint: "Suma las líneas de arriba hasta el subtotal anterior" },
];

export function useSlashCommands(description: string) {
  const isCommand = description.startsWith("/");
  const query = isCommand ? description.slice(1).toLowerCase() : "";
  const matches = isCommand ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(query)) : [];
  return { isCommand, matches };
}
