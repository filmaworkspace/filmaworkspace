"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export default function Footer() {
  return (
    <footer
      className={`w-full py-6 text-center text-xs text-slate-500 ${inter.className}`}
    >
      © {new Date().getFullYear()} Filma Workspace. Todos los derechos
      reservados.
    </footer>
  );
}