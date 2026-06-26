"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

interface UserData {
  uid: string;
  email: string | null;
  name: string;
  role: "admin" | "user";
  companyId: string | null;
  isLoading: boolean;
}

interface UserContextType {
  user: UserData | null;
  isLoading: boolean;
  updateUserName: (name: string) => void;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const AUTH_PAGES = ["/", "/login", "/register", "/forgot-password"];
  const isAuthPage = AUTH_PAGES.includes(pathname);
  const requiresAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/project") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/companydashboard");

  const loadUserData = async (firebaseUser: FirebaseUser) => {
    try {
      // Recargar usuario para obtener datos actualizados
      await firebaseUser.reload();
      
      // Obtener datos adicionales de Firestore
      const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
      const userData = userDoc.data();

      setUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || userData?.name || firebaseUser.email?.split("@")[0] || "Usuario",
        role: userData?.role || "user",
        companyId: userData?.companyId || null,
        isLoading: false,
      });
    } catch (error) {
      console.error("Error loading user data:", error);
      setUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "Usuario",
        role: "user",
        companyId: null,
        isLoading: false,
      });
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await loadUserData(firebaseUser);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Redirecciones por rol — se ejecutan una vez que isLoading es false
  useEffect(() => {
    if (isLoading) return;

    if (!user && requiresAuth) {
      router.push("/login");
      return;
    }

    if (!user) return;

    const { role, companyId } = user;
    const isAdmin = role === "admin";
    const isCompanyUser = !!companyId;
    const isAdminPage = pathname.startsWith("/admin");
    const isDashboardPage = pathname === "/dashboard";
    const isCompanyPage = pathname.startsWith("/companydashboard");

    if (isAdmin) {
      if (isDashboardPage) router.push("/admindashboard");
      return;
    }

    if (isCompanyUser) {
      if (isDashboardPage || isAdminPage) {
        router.push(`/companydashboard/${companyId}`);
        return;
      }
      if (isCompanyPage) {
        const companyIdFromUrl = pathname.split("/")[2];
        if (companyId !== companyIdFromUrl) {
          router.push(`/companydashboard/${companyId}`);
        }
      }
      return;
    }

    // Usuario normal
    if (isAdminPage || isCompanyPage) {
      router.push("/dashboard");
    }
  }, [isLoading, user, pathname]);

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
    <UserContext.Provider value={{ user, isLoading, updateUserName, refreshUser }}>
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
