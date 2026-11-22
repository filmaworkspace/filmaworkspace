"use client";

// Antigua pantalla "versión móvil en camino": ahora lleva a la versión móvil.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MobileRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/m"); }, [router]);
  return null;
}
