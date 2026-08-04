import { doc, getDoc, type Firestore } from "firebase/firestore";

export interface AutomatedMessages {
  welcomeSales: string;
  welcomeTechnical: string;
  slowResponse: string;
}

export const DEFAULT_AUTOMATED_MESSAGES: AutomatedMessages = {
  welcomeSales:
    "Hola, {{nombre}} 👋 Gracias por vuestro interés en Filma Workspace. Un agente de ventas os atenderá enseguida — contadnos un poco sobre vuestro proyecto o lo que necesitáis.",
  welcomeTechnical:
    "Hola, {{nombre}} 👋 Un agente de soporte te atenderá enseguida. Mientras tanto, cuéntanos qué te trae por aquí.",
  slowResponse:
    "Estamos tardando en responder. Mientras tanto, escríbenos a ventas@filmaworkspace.com.",
};

// Sustituye {{nombre}} (y variantes con espacios/mayúsculas) por el valor dado.
export function fillTemplate(text: string, vars: { nombre: string }): string {
  return text.replace(/\{\{\s*nombre\s*\}\}/gi, vars.nombre);
}

export async function fetchAutomatedMessages(db: Firestore): Promise<AutomatedMessages> {
  try {
    const snap = await getDoc(doc(db, "meta", "automatedMessages"));
    return { ...DEFAULT_AUTOMATED_MESSAGES, ...(snap.exists() ? (snap.data() as Partial<AutomatedMessages>) : {}) };
  } catch {
    return DEFAULT_AUTOMATED_MESSAGES;
  }
}
