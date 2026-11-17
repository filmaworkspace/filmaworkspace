import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, deleteDoc } from "firebase/firestore";
import fs from "fs";

const env = await initializeTestEnvironment({
  projectId: "demo-filma",
  firestore: { rules: fs.readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
});

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "users/admin"), { role: "admin", name: "A" });
  await setDoc(doc(db, "users/alice"), { role: "user", name: "Alice" });
  await setDoc(doc(db, "users/mallory"), { role: "user", name: "M" });
  await setDoc(doc(db, "projects/p1"), { name: "P1" });
  await setDoc(doc(db, "projects/p1/members/alice"), { role: "PM", permissions: { config: true, team: true, accounting: true } });
  await setDoc(doc(db, "userProjects/alice/projects/p1"), { permissions: { config: true, team: true, accounting: true } });
  await setDoc(doc(db, "invitations/inv1"), { projectId: "p1", invitedEmail: "bob@x.com", invitedUserId: null, status: "pending", permissions: { config: false, accounting: false, team: false } });
  await setDoc(doc(db, "forms/f1"), { projectId: "p1", status: "pending", type: "box_request" });
  await setDoc(doc(db, "access/c1"), { projectId: "p1", active: true, pin: "1234" });
  await setDoc(doc(db, "access/c5"), { projectId: "p1", active: true });
  await setDoc(doc(db, "horarioForms/h1"), { projectId: "p1", recipientUid: "x", date: "2026-11-01" });
  await setDoc(doc(db, "projects/p1/horarioForms/h1"), { projectId: "p1", recipientUid: "x" });
  await setDoc(doc(db, "horarioAccess/r1"), { projectId: "p1", recipientUid: "x", active: true });
  await setDoc(doc(db, "projects/p1/payrollMonths/2026-11"), { entries: {} });
  await setDoc(doc(db, "users/agent"), { role: "support_agent", name: "Ag" });
  await setDoc(doc(db, "supportArchive/a1"), { userId: "alice", status: "resolved" });
  await setDoc(doc(db, "supportArchive/a1/messages/m1"), { text: "hola" });
  await setDoc(doc(db, "meta/featureFlags"), { x: { enabledGlobally: false } });
});

const anon = env.unauthenticatedContext().firestore();
const alice = env.authenticatedContext("alice", { email: "alice@x.com" }).firestore();
const mallory = env.authenticatedContext("mallory", { email: "m@x.com" }).firestore();
const bob = env.authenticatedContext("bob", { email: "bob@x.com" }).firestore();
const admin = env.authenticatedContext("admin", { email: "admin@x.com" }).firestore();

let pass = 0, fail = 0;
async function t(name, expectOk, fn) {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; console.log("  FAIL", name, "-", e.message.split("\n")[0]); }
}

console.log("users");
await t("registro nuevo como user", true, () => setDoc(doc(bob, "users/bob"), { name: "Bob", email: "bob@x.com", role: "user" }));
await t("registro como admin", false, () => setDoc(doc(env.authenticatedContext("eve").firestore(), "users/eve"), { name: "E", role: "admin" }));
await t("registro con budgetingAccess", false, () => setDoc(doc(env.authenticatedContext("eve2").firestore(), "users/eve2"), { name: "E", role: "user", budgetingAccess: true }));
await t("editar su nombre", true, () => updateDoc(doc(mallory, "users/mallory"), { name: "Mal" }));
await t("hacerse admin", false, () => updateDoc(doc(mallory, "users/mallory"), { role: "admin" }));
await t("darse companyId", false, () => updateDoc(doc(mallory, "users/mallory"), { companyId: "acme" }));
await t("darse budgetingAccess", false, () => updateDoc(doc(mallory, "users/mallory"), { budgetingAccess: true }));
await t("admin cambia rol", true, () => updateDoc(doc(admin, "users/mallory"), { role: "support_agent" }));
await t("admin da budgeting", true, () => updateDoc(doc(admin, "users/mallory"), { budgetingAccess: true, role: "user" }));

console.log("proyectos");
await t("colarse como miembro", false, () => setDoc(doc(mallory, "projects/p1/members/mallory"), { role: "EP", permissions: { config: true } }));
await t("darse userProjects", false, () => setDoc(doc(mallory, "userProjects/mallory/projects/p1"), { permissions: { accounting: true } }));
await t("leer proyecto ajeno", false, () => getDoc(doc(mallory, "projects/p1")));
await t("PM añade miembro", true, () => setDoc(doc(alice, "projects/p1/members/carol"), { role: "PC" }));
await t("PM da acceso", true, () => setDoc(doc(alice, "userProjects/carol/projects/p1"), { permissions: { team: true } }));
await t("marcar favorito", true, () => updateDoc(doc(alice, "userProjects/alice/projects/p1"), { favorite: true }));
await t("archivar/notificaciones", true, () => updateDoc(doc(alice, "userProjects/alice/projects/p1"), { archived: true, notifications: { a: 1 } }));
await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), "userProjects/carol/projects/p1"), { permissions: { team: false } }));
const carol = env.authenticatedContext("carol", { email: "carol@x.com" }).firestore();
await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), "projects/p1/members/carol"), { role: "Crew" }));
await t("subirse permisos propios", false, () => updateDoc(doc(carol, "userProjects/carol/projects/p1"), { "permissions.config": true }));

console.log("invitaciones");
await t("invitado cambia permisos", false, () => updateDoc(doc(bob, "invitations/inv1"), { "permissions.config": true }));
await t("invitado se acepta solo", false, () => updateDoc(doc(bob, "invitations/inv1"), { status: "accepted" }));
await t("invitado vincula su uid", true, () => updateDoc(doc(bob, "invitations/inv1"), { invitedUserId: "bob" }));
await t("vincular uid ajeno", false, () => updateDoc(doc(bob, "invitations/inv1"), { invitedUserId: "zzz" }));
await t("invitado rechaza", true, () => updateDoc(doc(bob, "invitations/inv1"), { status: "rejected", respondedAt: new Date() }));
await t("otro toca invitación", false, () => updateDoc(doc(mallory, "invitations/inv1"), { status: "pending" }));

console.log("forms");
await t("anon abre por id", true, () => getDoc(doc(anon, "forms/f1")));
await t("anon lista forms", false, () => getDocs(collection(anon, "forms")));
await t("usuario ajeno lista forms", false, () => getDocs(query(collection(mallory, "forms"), where("projectId", "==", "p1"))));
await t("equipo lista forms del proyecto", true, () => getDocs(query(collection(alice, "forms"), where("projectId", "==", "p1"), where("type", "==", "box_request"))));
await t("anon envía formulario y toca projectId", false, () => updateDoc(doc(anon, "forms/f1"), { status: "submitted", responseData: {}, projectId: "p2" }));
await t("anon envía formulario", true, () => updateDoc(doc(anon, "forms/f1"), { status: "submitted", submittedAt: new Date(), responseData: { a: 1 } }));
await t("anon reenvía formulario", false, () => updateDoc(doc(anon, "forms/f1"), { responseData: { a: 2 } }));

console.log("access");
await t("anon abre código", true, () => getDoc(doc(anon, "access/c1")));
await t("anon lista códigos", false, () => getDocs(collection(anon, "access")));
await t("ajeno lista códigos del proyecto", false, () => getDocs(query(collection(mallory, "access"), where("projectId", "==", "p1"))));
await t("equipo lista códigos", true, () => getDocs(query(collection(alice, "access"), where("projectId", "==", "p1"))));
await t("ajeno crea código", false, () => setDoc(doc(mallory, "access/c2"), { projectId: "p1", active: true }));
await t("equipo crea código", true, () => setDoc(doc(alice, "access/c3"), { projectId: "p1", active: true }));
await t("equipo activa/desactiva", true, () => setDoc(doc(alice, "access/c1"), { active: false }, { merge: true }));
await t("ajeno borra código", false, () => deleteDoc(doc(mallory, "access/c1")));
await t("equipo borra código", true, () => deleteDoc(doc(alice, "access/c3")));

console.log("horarios");
await t("anon abre horario", true, () => getDoc(doc(anon, "horarioForms/h1")));
await t("anon lista horarios", false, () => getDocs(collection(anon, "horarioForms")));
await t("anon rellena horas", true, () => updateDoc(doc(anon, "horarioForms/h1"), { entrada: "08:00", salida: "18:00", comida: 60, observaciones: "", submittedAt: new Date() }));
await t("anon rellena horas (proyecto)", true, () => updateDoc(doc(anon, "projects/p1/horarioForms/h1"), { entrada: "08:00", salida: "18:00", comida: null, observaciones: "", submittedAt: new Date() }));
await t("anon cambia destinatario", false, () => updateDoc(doc(anon, "horarioForms/h1"), { recipientUid: "y" }));
await t("anon cambia destinatario (proyecto)", false, () => updateDoc(doc(anon, "projects/p1/horarioForms/h1"), { projectId: "zz" }));
await t("cualquiera crea horario", false, () => setDoc(doc(mallory, "horarioForms/h9"), { projectId: "p1" }));
await t("anon lee código de revisión", false, () => getDoc(doc(anon, "horarioAccess/r1")));
await t("usuario crea código de revisión", false, () => setDoc(doc(mallory, "horarioAccess/r2"), { active: true }));

console.log("payrollMonths");
await t("anon lee mes por id", true, () => getDoc(doc(anon, "projects/p1/payrollMonths/2026-11")));
await t("anon lista meses", false, () => getDocs(collection(anon, "projects/p1/payrollMonths")));
await t("anon escribe con código activo", true, () => setDoc(doc(anon, "projects/p1/payrollMonths/2026-11"), { entries: { a: 1 }, accessCode: "c5" }));
await t("anon escribe con código desactivado", false, () => setDoc(doc(anon, "projects/p1/payrollMonths/2026-11"), { entries: { a: 1 }, accessCode: "c1" }));
await t("equipo lee meses", true, () => getDocs(collection(alice, "projects/p1/payrollMonths")));

console.log("soporte");
const agent = env.authenticatedContext("agent", { email: "ag@x.com" }).firestore();
await t("usuario no lee el archivo", false, () => getDoc(doc(alice, "supportArchive/a1")));
await t("usuario no lee mensajes archivados", false, () => getDocs(collection(alice, "supportArchive/a1/messages")));
await t("agente lee el archivo", true, () => getDocs(collection(agent, "supportArchive")));
await t("agente lee mensajes archivados", true, () => getDocs(collection(agent, "supportArchive/a1/messages")));
await t("nadie escribe en el archivo desde cliente", false, () => setDoc(doc(agent, "supportArchive/a2"), { x: 1 }));
await t("usuario no puede desactivar el chat", false, () => setDoc(doc(alice, "meta/supportChat"), { enabled: false }));
await t("agente desactiva el chat", true, () => setDoc(doc(agent, "meta/supportChat"), { enabled: false }));
await t("chat desactivado: no se abren conversaciones", false, () => setDoc(doc(alice, "supportChats/alice"), { status: "open" }));
await t("agente activa el chat", true, () => setDoc(doc(agent, "meta/supportChat"), { enabled: true }));
await t("chat activo: el usuario abre conversación", true, () => setDoc(doc(alice, "supportChats/alice"), { status: "open" }));
await t("contador de tickets", true, () => setDoc(doc(alice, "meta/supportTicketCounter"), { count: 1 }, { merge: true }));
await t("usuario edita featureFlags", false, () => setDoc(doc(mallory, "meta/featureFlags"), { x: { enabledGlobally: true } }));
await t("usuario edita mantenimiento", false, () => setDoc(doc(mallory, "meta/maintenance"), { enabled: true }));

console.log(`\n${pass} ok, ${fail} fallos`);
await env.cleanup();
process.exit(fail ? 1 : 0);
