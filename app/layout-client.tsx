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
  const isDashboardPage = pathname.startsWith("/dashboard");
  const isAdminPage = pathname.startsWith("/admin");
  const isProjectPage = pathname.startsWith("/project");
  const isProfilePage = pathname.startsWith("/profile");
  const requiresAuth = isDashboardPage || isAdminPage || isProjectPage || isProfilePage;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Si no hay usuario y la página requiere autenticación, redirigir a login
      if (!user && requiresAuth) {
        router.push("/login");
        return;
      }

      // Si es admin dashboard, verificar que sea admin
      if (user && isAdminPage) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const role = userDoc.exists() ? userDoc.data().role : "user";
          if (role !== "admin") {
            router.push("/dashboard");
            return;
          }
        } catch (error) {
          console.error("Error verificando rol:", error);
        }
      }
    });

    return () => unsubscribe();
  }, [pathname, router, requiresAuth, isAdminPage]);

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
