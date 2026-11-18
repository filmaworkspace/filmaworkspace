import { defineConfig } from "vitest/config";
import path from "path";

// Pruebas de lógica (importes, presupuesto, caja). Las reglas de Firestore y
// Storage se prueban aparte con el emulador (tests/firestore-rules).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
