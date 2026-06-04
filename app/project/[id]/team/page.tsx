"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Users } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


export default function TeamPage() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/");
        return;
      }
      setLoading(false);
    });

    return () => unsub();
  }, [id, router]);

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Users size={24} style={{ color: '#6BA319' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Equipo</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-16">
        <div className="max-w-md mx-auto text-center">
          <div 
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: 'rgba(107, 163, 25, 0.1)' }}
          >
            <Users size={36} style={{ color: '#6BA319' }} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Próximamente</h2>
          <p className="text-slate-500">
            Estamos trabajando en las herramientas de coordinación de equipo. 
            Pronto podrás gestionar todo desde aquí.
          </p>
        </div>
      </main>
    </div>
  );
}
