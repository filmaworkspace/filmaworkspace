"use client";

import { inter } from "@/lib/fonts";
import SupportChat from "./SupportChat";

export default function Footer() {
  return (
    <>
      <footer className={`w-full py-6 text-center text-xs text-slate-500 ${inter.className}`}>
        © {new Date().getFullYear()} Filma Workspace. Todos los derechos reservados.
      </footer>
      <SupportChat />
    </>
  );
}
