"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { UserProvider } from "@/contexts/UserContext";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Páginas sin header ni footer (páginas de autenticación)
  const isAuthPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password";

  // Páginas que requieren autenticación
  const isDashboardPage = pathname === "/dashboard";
  const isAdminPage = pathname.startsWith("/admin");
  const isProjectPage = pathname.startsWith("/project");
  const isProfilePage = pathname.startsWith("/profile");
  const isCompanyPage = pathname.startsWith("/companydashboard");
  const requiresAuth = isDashboardPage || isAdminPage || isProjectPage || isProfilePage || isCompanyPage;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Si no hay usuario y la página requiere autenticación, redirigir a login
      if (!user && requiresAuth) {
        router.push("/login");
        return;
      }

      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (!userDoc.exists()) return;
          
          const userData = userDoc.data();
          const role = userData.role || "user";
          const companyId = userData.companyId || null;
          const isAdmin = role === "admin";
          const isCompanyUser = !!companyId;

          // ADMIN: puede ir a cualquier sitio, no redirigir
          if (isAdmin) {
            return;
          }

          // USUARIO DE PRODUCTORA (no admin)
          if (isCompanyUser) {
            // Si intenta ir a dashboard normal, redirigir a companydashboard
            if (isDashboardPage) {
              router.push(`/companydashboard/${companyId}`);
              return;
            }
            // Si intenta ir a admindashboard, redirigir a companydashboard
            if (isAdminPage) {
              router.push(`/companydashboard/${companyId}`);
              return;
            }
            // Si intenta ir a otro companydashboard que no es el suyo, redirigir al suyo
            if (isCompanyPage) {
              const companyIdFromUrl = pathname.split("/")[2];
              if (companyId !== companyIdFromUrl) {
                router.push(`/companydashboard/${companyId}`);
                return;
              }
            }
            return;
          }

          // USUARIO NORMAL (sin companyId, no admin)
          // Si intenta ir a admindashboard, redirigir a dashboard
          if (isAdminPage) {
            router.push("/dashboard");
            return;
          }
          // Si intenta ir a companydashboard, redirigir a dashboard
          if (isCompanyPage) {
            router.push("/dashboard");
            return;
          }

        } catch (error) {
          console.error("Error verificando usuario:", error);
        }
      }
    });

    return () => unsubscribe();
  }, [pathname, router, requiresAuth, isAdminPage, isDashboardPage, isCompanyPage]);

  return (
    <UserProvider>
      <div className="flex flex-col min-h-screen">
        {!isAuthPage && <Header />}
        <main className="flex flex-col flex-grow">{children}</main>
        {!isAuthPage && <Footer />}
      </div>
    </UserProvider>
  );
}
