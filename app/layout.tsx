// ─── Framework ────────────────────────────────────────────────────────────────
import type { Metadata } from "next";
import { inter } from "@/lib/fonts";

// ─── Internal ────────────────────────────────────────────────────────────────
import ClientLayout from "./layout-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Filma Workspace",
  description: "Gestión de proyectos audiovisuales",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body
        suppressHydrationWarning
        className={`${inter.variable} font-sans antialiased`}
      >
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}