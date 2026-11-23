"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { arrayUnion, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { roleRedirect } from "@/lib/homePath";

interface UserData {
  uid: string;
  email: string | null;
  name: string;
  role: "admin" | "user" | "support_agent";
  companyId: string | null;
  /** Acceso al entorno Budgeting (fuera de cualquier proyecto) — concedido desde AdminDashboard. */
  budgetingAccess: boolean;
  isLoading: boolean;
  /** Sesión de "Ver como" abierta por un admin (solo lectura). */
  impersonatedBy: string | null;
}

interface MaintenanceState {
  enabled: boolean;
  startAt: Date | null;
  message: string;
}

interface UserContextType {
  user: UserData | null;
  isLoading: boolean;
  updateUserName: (name: string) => void;
  refreshUser: () => Promise<void>;
  maintenance: MaintenanceState;
  /** Hay una redirección en marcha: no pintar la página actual. */
  redirecting: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const DEFAULT_MAINTENANCE: MaintenanceState = { enabled: false, startAt: null, message: "" };

// Último acceso y meses activos (para el admin: "último acceso", retención por
// cohortes). Como mucho una escritura por hora y navegador.
function trackLastSeen(uid: string) {
  try {
    const key = `filma:lastSeen:${uid}`;
    const prev = Number(localStorage.getItem(key) || 0);
    if (Date.now() - prev < 60 * 60 * 1000) return;
    localStorage.setItem(key, String(Date.now()));
  } catch { /* sin localStorage: se escribe igual */ }
  const month = new Date().toISOString().slice(0, 7);
  updateDoc(doc(db, "users", uid), { lastSeenAt: serverTimestamp(), activeMonths: arrayUnion(month) }).catch(() => {});
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceState>(DEFAULT_MAINTENANCE);
  const router = useRouter();
  const pathname = usePathname();

  const AUTH_PAGES = ["/", "/login", "/register", "/forgot-password"];
  const isAuthPage = AUTH_PAGES.includes(pathname);
  const requiresAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/project") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/companydashboard") ||
    pathname.startsWith("/budgeting") ||
    pathname === "/m" ||
    pathname.startsWith("/m/");

  const loadUserData = async (firebaseUser: FirebaseUser) => {
    try {
      // Recargar usuario para obtener datos actualizados
      await firebaseUser.reload();
      
      // Obtener datos adicionales de Firestore
      const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
      const userData = userDoc.data();
      const claims = (await firebaseUser.getIdTokenResult()).claims;
      const impersonatedBy = typeof claims.impersonatedBy === "string" ? claims.impersonatedBy : null;
      if (!impersonatedBy && userDoc.exists()) trackLastSeen(firebaseUser.uid);

      setUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || userData?.name || firebaseUser.email?.split("@")[0] || "Usuario",
        role: userData?.role || "user",
        companyId: userData?.companyId || null,
        budgetingAccess: userData?.budgetingAccess || false,
        isLoading: false,
        impersonatedBy,
      });
    } catch (error) {
      console.error("Error loading user data:", error);
      setUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "Usuario",
        role: "user",
        companyId: null,
        budgetingAccess: false,
        isLoading: false,
        impersonatedBy: null,
      });
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Mientras se cargan sus datos no hay que redirigir a /login: justo
        // después de iniciar sesión, la página de destino podría ver user=null
        // y devolver al usuario al login.
        setIsLoading(true);
        await loadUserData(firebaseUser);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Modo mantenimiento — escucha en tiempo real para que el bloqueo/aviso
  // aparezca (o desaparezca) sin recargar la página.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "meta", "maintenance"),
      (snap) => {
        const data = snap.data();
        if (!data) {
          setMaintenance(DEFAULT_MAINTENANCE);
          return;
        }
        setMaintenance({
          enabled: !!data.enabled,
          startAt: data.startAt?.toDate() || null,
          message: data.message || "",
        });
      },
      () => setMaintenance(DEFAULT_MAINTENANCE)
    );
    return () => unsubscribe();
  }, []);

  // Redirecciones por rol. Se calculan al pintar (no después), y mientras
  // haya una pendiente la app no enseña la página (MaintenanceGate), así no
  // se ve ni un instante una pantalla que no corresponde.
  const redirectTo = useMemo(() => {
    if (isLoading) return null;
    if (!user) return requiresAuth ? "/login" : null;
    return roleRedirect(user, pathname);
  }, [isLoading, user, pathname, requiresAuth]);

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  // Función para actualizar el nombre localmente (sin esperar a Firebase)
  const updateUserName = (name: string) => {
    if (user) {
      setUser({ ...user, name });
    }
  };

  // Función para refrescar datos del usuario desde Firebase
  const refreshUser = async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      await loadUserData(currentUser);
    }
  };

  return (
    <UserContext.Provider value={{ user, isLoading, updateUserName, refreshUser, maintenance, redirecting: !!redirectTo }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
