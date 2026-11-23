"use client";

// Plantilla de Filma Sign: marco de las páginas públicas de firma (cabecera
// con el degradado de Filma, pasos y pie). La usa /sign/[token] y sirve para
// cualquier documento que se mande a firmar.

import Image from "next/image";
import { Check, ShieldCheck } from "lucide-react";
import { inter } from "@/lib/fonts";

export function SignShell({ eyebrow = "Filma Sign", title, subtitle, steps, step, children, footer }: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  steps?: string[];
  step?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className={`min-h-screen bg-[#F5F6F8] text-slate-900 ${inter.className}`}>
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative px-5 pb-5 pt-5 sm:px-7" style={{ background: "radial-gradient(120% 140% at 100% 0%, #6E8FC7 0%, rgba(110,143,199,0) 55%), linear-gradient(135deg, #172544 0%, #24406E 55%, #3B5D96 100%)" }}>
            <div className="flex items-center justify-between">
              <Image src="/logo.svg" alt="Filma" width={64} height={16} className="h-auto w-[64px]" />
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-white backdrop-blur">
                <ShieldCheck size={11} /> {eyebrow}
              </span>
            </div>
            <h1 className="mt-6 text-[20px] font-semibold leading-tight tracking-tight text-white sm:text-[22px]">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-white/80">{subtitle}</p>}
          </div>
          {steps && step !== undefined && (
            <ol className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 sm:px-7">
              {steps.map((s, i) => (
                <li key={s} className="flex flex-1 items-center gap-2 last:flex-none">
                  <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i < step ? "bg-emerald-500 text-white" : i === step ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {i < step ? <Check size={13} /> : i + 1}
                  </span>
                  <span className={`text-[12.5px] ${i === step ? "font-medium text-slate-900" : "text-slate-400"}`}>{s}</span>
                  {i < steps.length - 1 && <span className="mx-1 hidden h-px flex-1 bg-slate-200 sm:block" />}
                </li>
              ))}
            </ol>
          )}
          <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
        </div>
        {footer}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
          <ShieldCheck size={12} /> Filma Sign · Enlace personal · Cada paso queda registrado
        </p>
      </div>
    </div>
  );
}
