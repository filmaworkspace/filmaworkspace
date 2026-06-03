import { Inter } from "next/font/google";

// Instancia única compartida por todos los componentes.
// layout.tsx la usa como variable CSS (--font-inter); el resto puede
// usar inter.className o simplemente la clase Tailwind `font-sans`.
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});
