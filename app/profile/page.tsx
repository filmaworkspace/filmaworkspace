"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { User, ArrowLeft, CheckCircle, Lock, Eye, EyeOff, Bell, Shield, AlertCircle, LogOut, BarChart3, Users } from "lucide-react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential, signOut } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const CONFIG_SECTIONS = [
  { id: "profile", label: "Perfil", icon: User, description: "Información personal" },
  { id: "security", label: "Seguridad", icon: Shield, description: "Contraseña y acceso" },
  { id: "notifications", label: "Notificaciones", icon: Bell, description: "Alertas y avisos" },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, updateUserName } = useUser();

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [activeSection, setActiveSection] = useState("profile");

  const [formData, setFormData] = useState({ name: "", email: "" });
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState({ current: false, new: false, confirm: false });
  const [notifications, setNotifications] = useState({ accounting: true, team: true });

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (user) {
      setFormData({ name: user.name || "", email: user.email || "" });
      loadNotificationPreferences();
    }
  }, [user]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/");
  }, [isLoading, user, router]);

  const loadNotificationPreferences = async () => {
    if (!user?.uid) return;
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const prefs = userDoc.data().notificationPreferences;
        if (prefs) setNotifications(prev => ({ ...prev, ...prefs }));
      }
    } catch (error) {
      console.error("Error loading notification preferences:", error);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) { showToast("error", "No hay usuario autenticado"); setSaving(false); return; }
      if (!formData.name.trim()) { showToast("error", "El nombre no puede estar vacío"); setSaving(false); return; }
      await updateProfile(currentUser, { displayName: formData.name.trim() });
      updateUserName(formData.name.trim());
      showToast("success", "Perfil actualizado correctamente");
    } catch (err: any) {
      showToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) { showToast("error", "No hay usuario autenticado"); setSaving(false); return; }
      if (passwordData.newPassword.length < 6) { showToast("error", "La nueva contraseña debe tener al menos 6 caracteres"); setSaving(false); return; }
      if (passwordData.newPassword !== passwordData.confirmPassword) { showToast("error", "Las contraseñas no coinciden"); setSaving(false); return; }
      const credential = EmailAuthProvider.credential(currentUser.email, passwordData.currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, passwordData.newPassword);
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast("success", "Contraseña actualizada correctamente");
    } catch (err: any) {
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        showToast("error", "La contraseña actual es incorrecta");
      } else {
        showToast("error", err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { notificationPreferences: notifications });
      showToast("success", "Preferencias guardadas");
    } catch (error) {
      showToast("error", "Error al guardar preferencias");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/");
    } catch (err) {
      showToast("error", "Error al cerrar sesión");
    }
  };

  const renderProfileSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Información personal</h2>
        <p className="text-sm text-slate-500 mt-1">Actualiza tu información de perfil</p>
      </div>

      <form onSubmit={handleProfileSubmit} className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
            <div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xl font-semibold">
              {formData.name?.[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{formData.name || "Usuario"}</p>
              <p className="text-sm text-slate-500">{formData.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Nombre completo</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                placeholder="Tu nombre"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Correo electrónico</label>
              <div className="relative">
                <input
                  type="email"
                  disabled
                  value={formData.email}
                  className="w-full px-4 py-2.5 border border-slate-200 bg-slate-50 rounded-xl text-sm text-slate-500 pr-10"
                />
                <Lock size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
              <p className="text-xs text-slate-400 mt-1.5">El correo no se puede cambiar</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );

  const renderSecuritySection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Cambiar contraseña</h2>
        <p className="text-sm text-slate-500 mt-1">Asegúrate de usar una contraseña segura</p>
      </div>

      <form onSubmit={handlePasswordSubmit} className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Contraseña actual</label>
            <div className="relative">
              <input
                type={showPassword.current ? "text" : "password"}
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword({ ...showPassword, current: !showPassword.current })}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword.current ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Nueva contraseña</label>
              <div className="relative">
                <input
                  type={showPassword.new ? "text" : "password"}
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword({ ...showPassword, new: !showPassword.new })}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword.new ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Confirmar contraseña</label>
              <div className="relative">
                <input
                  type={showPassword.confirm ? "text" : "password"}
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword({ ...showPassword, confirm: !showPassword.confirm })}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs text-amber-800">Usa al menos 6 caracteres con una combinación de letras, números y símbolos.</p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Actualizando..." : "Actualizar contraseña"}
          </button>
        </div>
      </form>
    </div>
  );

  const renderNotificationsSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Preferencias de notificaciones</h2>
        <p className="text-sm text-slate-500 mt-1">Elige qué alertas quieres recibir</p>
      </div>

      <form onSubmit={handleNotificationsSubmit} className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 flex items-center justify-between border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                <BarChart3 size={18} className="text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Notificaciones de Accounting</p>
                <p className="text-xs text-slate-500 mt-0.5">POs, facturas, aprobaciones y pagos</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">Próximamente</span>
              <div className="relative opacity-50 pointer-events-none">
                <input type="checkbox" checked={notifications.accounting} onChange={() => setNotifications({ ...notifications, accounting: !notifications.accounting })} className="sr-only peer" disabled />
                <div className="w-11 h-6 bg-slate-200 rounded-full peer-checked:bg-slate-900 transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-5 transition-transform" />
              </div>
            </div>
          </div>

          <div className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <Users size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Notificaciones de Team</p>
                <p className="text-xs text-slate-500 mt-0.5">Invitaciones, cambios de equipo y asignaciones</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">Próximamente</span>
              <div className="relative opacity-50 pointer-events-none">
                <input type="checkbox" checked={notifications.team} onChange={() => setNotifications({ ...notifications, team: !notifications.team })} className="sr-only peer" disabled />
                <div className="w-11 h-6 bg-slate-200 rounded-full peer-checked:bg-slate-900 transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-5 transition-transform" />
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <p className="text-sm text-slate-600">
            Las notificaciones te ayudarán a estar al tanto de las actualizaciones importantes en tus proyectos. 
            Esta funcionalidad estará disponible próximamente.
          </p>
        </div>
      </form>
    </div>
  );

  if (isLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  const userInitial = formData.name?.[0]?.toUpperCase() || "U";

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Toast bottom-right */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="mb-4">
            <Link href="/dashboard" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm transition-colors">
              <ArrowLeft size={16} />
              Proyectos
            </Link>
          </div>

          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-semibold">
                {userInitial}
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Mi cuenta</h1>
                <p className="text-slate-500 text-sm mt-0.5">{formData.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-5 py-2.5 text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-xl text-sm font-medium transition-colors"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="flex gap-8">
          {/* Sidebar sticky */}
          <div className="lg:w-52 flex-shrink-0">
            <nav className="sticky top-24 space-y-1">
              {CONFIG_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                      isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Icon size={18} className={isActive ? "text-white" : "text-slate-400"} />
                    <div>
                      <p className="text-sm font-medium">{section.label}</p>
                      <p className={`text-xs mt-0.5 ${isActive ? "text-slate-300" : "text-slate-400"}`}>
                        {section.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Contenido principal */}
          <div className="flex-1 min-w-0 max-w-3xl">
            {activeSection === "profile" && renderProfileSection()}
            {activeSection === "security" && renderSecuritySection()}
            {activeSection === "notifications" && renderNotificationsSection()}
          </div>
        </div>
      </main>
    </div>
  );
}
