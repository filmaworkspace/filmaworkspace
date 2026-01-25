"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import {
  Users,
  Calendar,
  FileText,
  Truck,
  ClipboardList,
  MapPin,
  Coffee,
  Clock,
  Bell,
  MessageSquare,
  UserCheck,
  Briefcase,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const UPCOMING_FEATURES = [
  {
    icon: Calendar,
    title: "Órdenes del día",
    description: "Crea y distribuye call sheets con horarios, localizaciones y necesidades de cada departamento."
  },
  {
    icon: FileText,
    title: "Partes de producción",
    description: "Genera informes diarios de progreso con escenas rodadas, incidencias y métricas de producción."
  },
  {
    icon: Truck,
    title: "Transporte y logística",
    description: "Coordina traslados del equipo, alquiler de vehículos y rutas a localizaciones."
  },
  {
    icon: MapPin,
    title: "Gestión de localizaciones",
    description: "Centraliza permisos, contratos, contactos y documentación de cada localización."
  },
  {
    icon: Coffee,
    title: "Catering y servicios",
    description: "Organiza el catering diario, necesidades dietéticas especiales y servicios de craft."
  },
  {
    icon: Clock,
    title: "Control de horarios",
    description: "Registra horas de trabajo del equipo, menores y extras para cumplir normativa laboral."
  },
  {
    icon: ClipboardList,
    title: "Distribución de guiones",
    description: "Gestiona versiones del guión, revisiones y distribución controlada al equipo."
  },
  {
    icon: Bell,
    title: "Comunicaciones",
    description: "Envía notificaciones instantáneas sobre cambios de plan, convocatorias y actualizaciones."
  },
  {
    icon: UserCheck,
    title: "Gestión de extras",
    description: "Coordina figuración: convocatorias, vestuario, documentación y pagos."
  },
  {
    icon: Briefcase,
    title: "Onboarding de equipo",
    description: "Automatiza la incorporación de nuevos miembros: contratos, NDAs y documentación."
  },
  {
    icon: MessageSquare,
    title: "Chat de producción",
    description: "Comunicación en tiempo real entre departamentos con canales organizados por área."
  },
];

export default function TeamPage() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/");
        return;
      }

      if (id) {
        try {
          const projectDoc = await getDoc(doc(db, "projects", id as string));
          if (projectDoc.exists()) {
            setProjectName(projectDoc.data().name || "");
          }
        } catch (error) {
          console.error("Error loading project:", error);
        }
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
              <Users size={24} style={{ color: '#10b981' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Equipo</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {/* Coming Soon Banner */}
        <div 
          className="rounded-2xl p-8 mb-10"
          style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
        >
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Users size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Coordinación de producción
              </h2>
              <p className="text-white/90 text-base max-w-2xl">
                Estamos desarrollando un módulo completo para la gestión operativa del rodaje. 
                Todas las herramientas que necesita un coordinador de producción para mantener 
                el set funcionando sin problemas.
              </p>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-6">
            Funcionalidades en desarrollo
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {UPCOMING_FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={index}
                  className="group p-5 rounded-xl border border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all duration-200"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-200 transition-colors">
                      <Icon size={20} className="text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 mb-1">{feature.title}</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">{feature.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Feedback Section */}
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center">
              <MessageSquare size={20} className="text-slate-400" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-slate-900">¿Qué funcionalidad necesitas más?</h4>
              <p className="text-sm text-slate-500">
                Tu feedback nos ayuda a priorizar el desarrollo. Cuéntanos qué herramientas son imprescindibles para tu día a día.
              </p>
            </div>
            <button
              className="px-5 py-2.5 text-sm font-medium rounded-xl border border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 transition-colors"
            >
              Enviar feedback
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
