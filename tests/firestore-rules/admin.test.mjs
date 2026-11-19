// Pruebas del panel de admin: "Ver como" (solo lectura), proyectos
// congelados y las colecciones nuevas (registros, avisos, notas de cuentas).
// Se ejecuta junto a test.mjs (npm test).
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, addDoc } from "firebase/firestore";
import fs from "fs";

const env = await initializeTestEnvironment({
  projectId: `demo-admin-${Date.now()}`,
  firestore: { rules: fs.readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
});

const PID = `adm${Date.now()}`;
const FROZEN = `${PID}f`;
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "users/admin"), { role: "admin", name: "A" });
  await setDoc(doc(db, "users/pm"), { role: "user", name: "PM" });
  await setDoc(doc(db, "users/other"), { role: "user", name: "O" });
  for (const id of [PID, FROZEN]) {
    await setDoc(doc(db, `projects/${id}`), { name: id, ...(id === FROZEN ? { frozen: true } : {}) });
    await setDoc(doc(db, `projects/${id}/members/pm`), { role: "PM", permissions: { config: true, team: true, accounting: true } });
    await setDoc(doc(db, `userProjects/pm/projects/${id}`), { role: "PM", permissions: { config: true, team: true, accounting: true } });
  }
  await setDoc(doc(db, "emailLog/e1"), { to: ["x@x.com"], status: "sent" });
  await setDoc(doc(db, "securityEvents/s1"), { type: "rate_limited" });
  await setDoc(doc(db, "appErrors/a1"), { message: "boom", count: 1, resolved: false });
  await setDoc(doc(db, "announcements/all1"), { kind: "banner", active: true, audienceAll: true, audienceUserIds: [] });
  await setDoc(doc(db, "announcements/pm1"), { kind: "banner", active: true, audienceAll: false, audienceUserIds: ["pm"] });
  await setDoc(doc(db, "producers/prod1"), { name: "Prod" });
});

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@x.com`, ...claims }).firestore();
const imp = () => as("pm", { impersonatedBy: "admin" });

let pass = 0, fail = 0;
async function t(name, expectOk, fn) {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; console.log("  FAIL", name, "-", String(e.message || e).slice(0, 400)); }
}

console.log("ver como (solo lectura)");
await t("lee su proyecto", true, () => getDoc(doc(imp(), `projects/${PID}`)));
await t("lee sus proyectos", true, () => getDocs(collection(imp(), "userProjects/pm/projects")));
await t("NO edita el proyecto", false, () => updateDoc(doc(imp(), `projects/${PID}`), { name: "x" }));
await t("NO crea departamentos", false, () => setDoc(doc(imp(), `projects/${PID}/departments/d1`), { name: "x" }));
await t("NO edita su perfil", false, () => updateDoc(doc(imp(), "users/pm"), { name: "x" }));
await t("NO escribe en soporte", false, () => setDoc(doc(imp(), "supportChats/pm"), { status: "open" }));
await t("NO crea POs", false, () => setDoc(doc(imp(), `projects/${PID}/pos/p1`), { createdBy: "pm" }));
await t("el usuario real sí edita el proyecto", true, () => updateDoc(doc(as("pm"), `projects/${PID}`), { name: "ok" }));

console.log("proyecto congelado");
await t("miembro lee el congelado", true, () => getDoc(doc(as("pm"), `projects/${FROZEN}`)));
await t("miembro NO edita el congelado", false, () => updateDoc(doc(as("pm"), `projects/${FROZEN}`), { name: "x" }));
await t("miembro NO crea departamentos", false, () => setDoc(doc(as("pm"), `projects/${FROZEN}/departments/d1`), { name: "x" }));
await t("miembro NO añade miembros", false, () => setDoc(doc(as("pm"), `projects/${FROZEN}/members/other`), { role: "x" }));
await t("admin descongela", true, () => updateDoc(doc(as("admin"), `projects/${FROZEN}`), { frozen: false }));
await t("ya descongelado, miembro edita", true, () => updateDoc(doc(as("pm"), `projects/${FROZEN}`), { name: "y" }));
await t("admin crea proyecto nuevo", true, () => setDoc(doc(as("admin"), `projects/${PID}new`), { name: "n" }));

console.log("registros del admin");
for (const c of ["emailLog", "securityEvents", "appErrors"]) {
  await t(`admin lee ${c}`, true, () => getDocs(collection(as("admin"), c)));
  await t(`usuario NO lee ${c}`, false, () => getDocs(collection(as("pm"), c)));
  await t(`nadie crea en ${c}`, false, () => addDoc(collection(as("admin"), c), { x: 1 }));
}
await t("admin marca error resuelto", true, () => updateDoc(doc(as("admin"), "appErrors/a1"), { resolved: true, resolvedAt: 1, resolvedBy: "admin" }));
await t("admin NO reescribe el error", false, () => updateDoc(doc(as("admin"), "appErrors/a1"), { message: "x" }));
await t("usuario NO lee adminConfig", false, () => getDoc(doc(as("pm"), "adminConfig/digest")));
await t("admin escribe adminConfig", true, () => setDoc(doc(as("admin"), "adminConfig/digest"), { enabled: true }));
await t("usuario NO marca suspended", false, () => updateDoc(doc(as("pm"), "users/pm"), { suspended: false }));

console.log("avisos");
await t("usuario lee los avisos para todos", true, () => getDocs(query(collection(as("other"), "announcements"), where("audienceAll", "==", true), where("active", "==", true))));
await t("usuario lee los suyos", true, () => getDocs(query(collection(as("pm"), "announcements"), where("audienceUserIds", "array-contains", "pm"), where("active", "==", true))));
await t("otro NO lee los de pm", false, () => getDoc(doc(as("other"), "announcements/pm1")));
await t("usuario NO lista todos", false, () => getDocs(collection(as("other"), "announcements")));
await t("usuario NO crea avisos", false, () => setDoc(doc(as("pm"), "announcements/x"), { audienceAll: true }));
await t("admin crea avisos", true, () => setDoc(doc(as("admin"), "announcements/x"), { audienceAll: true, active: true, audienceUserIds: [] }));

console.log("notas de cuentas");
await t("admin escribe notas", true, () => addDoc(collection(as("admin"), "producers/prod1/notes"), { text: "llamar" }));
await t("usuario NO lee notas", false, () => getDocs(collection(as("pm"), "producers/prod1/notes")));

console.log(`\n${pass} ok, ${fail} fallos`);
await env.cleanup();
process.exit(fail ? 1 : 0);
