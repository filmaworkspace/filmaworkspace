import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Desarrollo y pruebas: con NEXT_PUBLIC_FIREBASE_EMULATORS=1 la app usa los
// emuladores locales de Firebase (Auth 9099, Firestore 8085, Storage 9199).
// En producción esta variable no existe y no cambia nada.
if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1" && typeof window !== "undefined") {
  const w = window as unknown as { __filmaEmulators?: boolean };
  if (!w.__filmaEmulators) {
    w.__filmaEmulators = true;
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
}
