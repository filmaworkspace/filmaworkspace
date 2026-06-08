"use client";
// ─── Framework ────────────────────────────────────────────────────────────────
import { usePathname } from "next/navigation";
// ─── Internal ────────────────────────────────────────────────────────────────
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { UserProvider } from "@/contexts/UserContext";
export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAuthPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password";
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
