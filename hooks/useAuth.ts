// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

export function useAuth() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async (
    email: string,
    password: string,
    rememberMe: boolean
  ) => {
    setError("");
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      if (rememberMe) {
        localStorage.setItem("rememberedEmail", email);
      } else {
        localStorage.removeItem("rememberedEmail");
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));
      const userData = userDoc.exists() ? userDoc.data() : null;
      const userRole = userData?.role || "user";

      if (userRole === "admin") {
        router.push("/admindashboard");
      } else {
        router.push("/dashboard");
      }
    } catch (error: any) {
      let errorMessage = "Error al iniciar sesión";

      if (error.code === "auth/invalid-credential") {
        errorMessage = "Email o contraseña incorrectos";
      } else if (error.code === "auth/user-not-found") {
        errorMessage = "No existe una cuenta con este email";
      } else if (error.code === "auth/wrong-password") {
        errorMessage = "Contraseña incorrecta";
      } else if (error.code === "auth/invalid-email") {
        errorMessage = "Email inválido";
      } else if (error.code === "auth/user-disabled") {
        errorMessage = "Esta cuenta ha sido deshabilitada";
      } else if (error.code === "auth/too-many-requests") {
        errorMessage = "Demasiados intentos. Intenta más tarde";
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const register = async (name: string, email: string, password: string) => {
    setError("");
    setLoading(true);

    try {
      console.log("=== INICIO REGISTRO ===");
      
      if (password.length < 6) {
        setError("La contraseña debe tener al menos 6 caracteres");
        setLoading(false);
        return;
      }

      if (!name.trim()) {
        setError("El nombre es obligatorio");
        setLoading(false);
        return;
      }

      // 1. Crear usuario en Firebase Auth
      console.log("1. Creando usuario en Auth...");
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;
      console.log("✅ Usuario creado en Auth:", user.uid);

      // 2. Actualizar perfil
      console.log("2. Actualizando perfil...");
      await updateProfile(user, {
        displayName: name.trim(),
      });
      console.log("✅ Perfil actualizado");

      // 3. Forzar refresh del token
      console.log("3. Refrescando token...");
      await user.getIdToken(true);
      console.log("✅ Token refrescado");

      // 4. Crear documento en Firestore
      console.log("4. Creando documento en Firestore...");
      console.log("   - UID:", user.uid);
      console.log("   - Email:", email.toLowerCase().trim());
      
      try {
        await setDoc(doc(db, "users", user.uid), {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          role: "user",
          createdAt: serverTimestamp(),
        });
        console.log("✅ Documento creado en Firestore");
      } catch (firestoreError: any) {
        console.error("❌ ERROR al crear documento:", firestoreError);
        console.error("   - Código:", firestoreError.code);
        console.error("   - Mensaje:", firestoreError.message);
        throw firestoreError;
      }

      // 5. Verificar que el documento existe
      console.log("5. Verificando documento...");
      const userDoc = await getDoc(doc(db, "users", user.uid));
      console.log("   - Documento existe:", userDoc.exists());
      if (userDoc.exists()) {
        console.log("   - Datos:", userDoc.data());
      }

      // 6. Actualizar invitaciones
      console.log("6. Actualizando invitaciones...");
      try {
        const invitationsRef = collection(db, "invitations");
        const q = query(
          invitationsRef,
          where("invitedEmail", "==", email.toLowerCase().trim()),
          where("status", "==", "pending")
        );

        const invitationsSnapshot = await getDocs(q);
        console.log("   - Invitaciones encontradas:", invitationsSnapshot.size);

        if (!invitationsSnapshot.empty) {
          const updatePromises = invitationsSnapshot.docs.map((inviteDoc) =>
            updateDoc(inviteDoc.ref, {
              invitedUserId: user.uid,
            })
          );

          await Promise.all(updatePromises);
          console.log("✅ Invitaciones actualizadas");
        }
      } catch (inviteError: any) {
        console.error("⚠️ Error al actualizar invitaciones (no crítico):", inviteError);
      }

      // 7. Redirigir
      console.log("7. Redirigiendo a dashboard...");
      router.push("/dashboard");
      console.log("=== FIN REGISTRO EXITOSO ===");
      
    } catch (error: any) {
      console.error("=== ERROR EN REGISTRO ===");
      console.error("Error completo:", error);
      console.error("Código:", error.code);
      console.error("Mensaje:", error.message);
      console.error("Stack:", error.stack);
      
      let errorMessage = "Error al crear la cuenta";

      if (error.code === "auth/email-already-in-use") {
        errorMessage = "Este email ya está registrado";
      } else if (error.code === "auth/invalid-email") {
        errorMessage = "Email inválido";
      } else if (error.code === "auth/operation-not-allowed") {
        errorMessage = "Registro deshabilitado. Contacta al administrador";
      } else if (error.code === "auth/weak-password") {
        errorMessage = "La contraseña es demasiado débil";
      } else if (error.code === "auth/network-request-failed") {
        errorMessage = "Error de conexión. Verifica tu internet";
      } else if (error.code === "permission-denied" || error.message?.includes("permission")) {
        errorMessage = "Error de permisos. Contacta al administrador";
        console.error("⚠️ El usuario se creó en Auth pero falló algo después");
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return { login, register, loading, error };
}
