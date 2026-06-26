"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "gradient";
  loading?: boolean;
  loadingText?: string;
}

export default function Button({
  children,
  variant = "primary",
  loading = false,
  loadingText = "Cargando...",
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const baseStyles =
    "w-full mt-3 font-medium rounded-lg py-3 text-sm transition-all duration-500 ease-out focus:ring-2 focus:outline-none shadow-md hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";

  const variants = {
    primary:
      "text-white bg-slate-900 hover:bg-gradient-to-r hover:from-indigo-500 hover:via-blue-600 hover:to-sky-500 focus:ring-indigo-300 disabled:hover:bg-slate-900",
    secondary:
      "text-white bg-slate-900 hover:bg-gradient-to-r hover:from-amber-500 hover:via-orange-500 hover:to-rose-500 focus:ring-amber-300 disabled:hover:bg-slate-900",
    gradient:
      "text-white bg-gradient-to-r from-indigo-500 via-blue-600 to-sky-500 hover:from-indigo-600 hover:via-blue-700 hover:to-sky-600 focus:ring-indigo-300",
  };

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {loading ? loadingText : children}
    </button>
  );
}