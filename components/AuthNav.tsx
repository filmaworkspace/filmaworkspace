"use client";

import Link from "next/link";
import Image from "next/image";
import { Home } from "lucide-react";

export default function AuthNav({ variant }: { variant: "login" | "register" | "forgot" }) {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 flex-shrink-0">
      <div className="max-w-6xl mx-auto px-6 py-3 sm:py-0 sm:h-16 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-2.5 sm:gap-0">
        <Link href="/" className="flex items-center">
          <Image src="/logodark.svg" alt="Filma Workspace" width={120} height={28} priority />
        </Link>

        <div className="flex items-center justify-center flex-wrap gap-2 sm:gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 px-3.5 sm:px-4 py-2 transition-colors"
          >
            <Home size={15} />
            Inicio
          </Link>
          {variant !== "login" && (
            <Link
              href="/login"
              className="text-sm font-medium text-slate-700 hover:text-slate-900 px-3.5 sm:px-4 py-2 transition-colors"
            >
              Iniciar sesión
            </Link>
          )}
          {variant !== "register" && (
            <Link
              href="/register"
              className="text-sm font-semibold text-white rounded-full px-4 sm:px-5 py-2.5 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#2F52E0" }}
            >
              Crear cuenta
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
