import { doc, getDoc, type Firestore } from "firebase/firestore";

/** Respuesta guardada de un clic para la cola de soporte: no se envía sola, el agente la elige a mano para lo que se repite (cómo resetear una contraseña, cómo pedir acceso a Budgeting...). */
export interface SupportMacro {
  id: string;
  label: string;
  text: string;
}

export interface AutomatedMessages {
  welcomeSales: string;
  welcomeTechnical: string;
  slowResponse: string;
  macros: SupportMacro[];
}

export const DEFAULT_AUTOMATED_MESSAGES: AutomatedMessages = {
  welcomeSales:
    "Hola, {{nombre}} 👋 Gracias por vuestro interés en Filma Workspace. Un agente de ventas os atenderá enseguida — contadnos un poco sobre vuestro proyecto o lo que necesitáis.",
  welcomeTechnical:
    "Hola, {{nombre}} 👋 Un agente de soporte te atenderá enseguida. Mientras tanto, cuéntanos qué te trae por aquí.",
  slowResponse:
    "Estamos tardando en responder. Mientras tanto, escríbenos a ventas@filmaworkspace.com.",
  macros: [
    { id: "m1", label: "Restablecer contraseña", text: "Para restablecer tu contraseña, ve a la pantalla de inicio de sesión y pulsa \"¿Has olvidado tu contraseña?\". Te llegará un correo con el enlace." },
    { id: "m2", label: "Pedir acceso a Budgeting", text: "El acceso a Budgeting lo activa un administrador desde tu cuenta. Dime el email con el que iniciaste sesión y te lo activo ahora mismo." },
    { id: "m3", label: "Derivar a ventas", text: "Para hablar sobre planes y precios, un agente de ventas te atenderá enseguida — gracias por tu paciencia." },
  ],
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
