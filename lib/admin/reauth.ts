"use client";

// Confirmación con contraseña antes de las acciones delicadas del admin
// (borrar, suspender, congelar, papelera, exportar datos…). El servidor
// exige que la última autenticación sea de hace menos de 5 minutos.
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth } from "@/lib/firebase";

export async function confirmPassword(password: string): Promise<void> {
  const u = auth.currentUser;
  if (!u?.email) throw new Error("Sesión no válida");
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
    await u.getIdToken(true);
  } catch (e) {
    const code = (e as { code?: string }).code || "";
    if (code.includes("wrong-password") || code.includes("invalid-credential")) throw new Error("Contraseña incorrecta");
    if (code.includes("too-many-requests")) throw new Error("Demasiados intentos. Espera un poco.");
    throw e;
  }
}
