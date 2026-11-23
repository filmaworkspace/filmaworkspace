/** @type {import('next').NextConfig} */

// Cabeceras de seguridad para todas las rutas.
// CSP: la app carga Firebase (Firestore, Auth, Storage), fuentes de Google y
// scripts propios de Next. Se permite 'unsafe-inline' en estilos (Tailwind y
// estilos en línea) y en scripts (bootstrap de Next sin nonce).
const csp = [
  "default-src 'self'",
  // cdn.jsdelivr.net: motor de OCR local (tesseract.js: worker, wasm e idioma).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://cdn.jsdelivr.net https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasestorage.app https://firebasestorage.googleapis.com https://*.cloudfunctions.net" +
    // Emuladores de Firebase en desarrollo y pruebas
    (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1"
      ? " http://127.0.0.1:* http://localhost:* ws://localhost:* ws://127.0.0.1:*"
      : ""),
  "frame-src 'self' https://*.firebaseapp.com https://*.firebasestorage.app https://firebasestorage.googleapis.com blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig = {
  async redirects() {
    return [
      // De momento no hay portada: la raíz lleva directamente al login.
      // Temporal (307) para que los navegadores no lo memoricen.
      { source: "/", destination: "/login", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
