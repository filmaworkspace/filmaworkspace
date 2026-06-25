"use client";

export default function MobilePage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] flex flex-col items-center justify-center px-8 text-center">
      {/* Logo */}
      <div className="mb-10">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="48" height="48" rx="12" fill="#1A1A1A" />
          <path d="M14 16h8l4 8-4 8h-8V16z" fill="white" fillOpacity="0.9" />
          <path d="M26 16h8v16h-8l4-8-4-8z" fill="white" fillOpacity="0.4" />
        </svg>
      </div>

      {/* Headline */}
      <h1
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        className="text-[28px] leading-snug font-normal text-[#1A1A1A] mb-4"
      >
        Versión móvil<br />en camino
      </h1>

      {/* Body */}
      <p className="text-[15px] text-[#6B6B6B] leading-relaxed max-w-[280px] mb-2">
        Estamos trabajando en una versión optimizada para dispositivos móviles.
      </p>
      <p className="text-[15px] text-[#6B6B6B] leading-relaxed max-w-[280px]">
        Hasta entonces, accede desde un ordenador para disfrutar de la experiencia completa.
      </p>

      {/* Divider */}
      <div className="w-8 h-px bg-[#D4D0C8] my-8" />

      {/* Closing note */}
      <p className="text-[13px] text-[#9B9892]">
        Perdona las molestias — el equipo de Filma
      </p>
    </div>
  );
}
