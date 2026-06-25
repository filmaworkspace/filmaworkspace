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

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      await updateProfile(user, {
        displayName: name.trim(),
      });

      await user.getIdToken(true);

      try {
        await setDoc(doc(db, "users", user.uid), {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          role: "user",
          createdAt: serverTimestamp(),
        });
      } catch (firestoreError: any) {
        console.error("[register] Error creating user document:", firestoreError.code);
        throw firestoreError;
      }

      try {
        const invitationsRef = collection(db, "invitations");
        const q = query(
          invitationsRef,
          where("invitedEmail", "==", email.toLowerCase().trim()),
          where("status", "==", "pending")
        );

        const invitationsSnapshot = await getDocs(q);

        if (!invitationsSnapshot.empty) {
          const updatePromises = invitationsSnapshot.docs.map((inviteDoc) =>
            updateDoc(inviteDoc.ref, {
              invitedUserId: user.uid,
            })
          );
          await Promise.all(updatePromises);
        }
      } catch {
        // Non-critical: invitation linking failure does not block registration
      }

      router.push("/dashboard");
    } catch (error: any) {
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
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return { login, register, loading, error };
}
