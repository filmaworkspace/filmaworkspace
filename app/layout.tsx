// ─── Framework ────────────────────────────────────────────────────────────────
import type { Metadata, Viewport } from "next";
import { inter } from "@/lib/fonts";

// ─── Internal ────────────────────────────────────────────────────────────────
import ClientLayout from "./layout-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Filma Workspace",
  description: "Gestión de proyectos audiovisuales",
  applicationName: "Filma",
  appleWebApp: { capable: true, title: "Filma", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-64.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  viewportFit: "cover",
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