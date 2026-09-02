"use client";

import Image from "next/image";

export default function MobilePage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-8 text-center">
      {/* Logo */}
      <div className="mb-10">
        <Image src="/logodark.svg" alt="Filma Workspace" width={120} height={28} priority />
      </div>

      {/* Divider */}
      <div className="w-8 h-px bg-slate-200 mb-10" />

      {/* Headline */}
      <h1 className="text-xl font-semibold text-slate-900 mb-3">
        Versión móvil en camino
      </h1>

      {/* Body */}
      <p className="text-sm text-slate-500 leading-relaxed max-w-xs mb-2">
        Estamos trabajando en una versión optimizada para dispositivos móviles.
      </p>
      <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
        Accede desde un ordenador para disfrutar de la experiencia completa.
      </p>

      {/* Divider */}
      <div className="w-8 h-px bg-slate-200 mt-10 mb-6" />

      {/* Closing note */}
      <p className="text-xs text-slate-400">Perdona las molestias.</p>
      <p className="text-xs text-slate-400 mt-1">El equipo de Filma</p>
    </div>
  );
}
