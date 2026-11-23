import type { MetadataRoute } from "next";

// App instalable (PWA): al añadirla a la pantalla de inicio abre la versión móvil.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Filma Workspace",
    short_name: "Filma",
    description: "Aprobaciones, documentos y proyectos de Filma Workspace.",
    id: "/m",
    start_url: "/m?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Aprobaciones", short_name: "Aprobar", url: "/m/aprobaciones", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Buscar", url: "/m/buscar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
