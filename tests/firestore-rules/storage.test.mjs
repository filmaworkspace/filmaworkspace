// Pruebas de storage.rules (necesita los emuladores de Firestore y Storage:
// las reglas de Storage consultan Firestore para saber quién es quién).
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";
import fs from "fs";

const PROJECT = "demo-filma";
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: "127.0.0.1", port: 8085 },
  storage: { rules: fs.readFileSync(new URL("../../storage.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 9199 },
});

const P = "pst";
const RUN = Date.now(); // nombres únicos: el emulador conserva lo subido entre ejecuciones
const people = {
  stAdmin: { user: { role: "admin" } },
  stAcc:   { perms: { accounting: true, team: false, config: false }, role: null },
  stTeam:  { perms: { accounting: false, team: true, config: false }, role: null },
  stCrew:  { perms: { accounting: false, team: false, config: false }, role: null },
  stEP:    { perms: { accounting: false, team: false, config: false }, role: "EP" },
};
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  for (const [uid, p] of Object.entries(people)) {
    await setDoc(doc(db, `users/${uid}`), { role: p.user?.role || "user" });
    if (p.perms) {
      await setDoc(doc(db, `projects/${P}/members/${uid}`), { role: p.role, permissions: p.perms });
      await setDoc(doc(db, `userProjects/${uid}/projects/${P}`), { permissions: p.perms });
    }
  }
  await setDoc(doc(db, "forms/stFormPending"), { projectId: P, status: "pending", type: "crew_onboarding" });
  await setDoc(doc(db, "forms/stFormDone"), { projectId: P, status: "submitted", type: "crew_onboarding" });
  const st = c.storage();
  await uploadBytes(ref(st, `projects/${P}/crew/m1/docs/dniFront`), new Uint8Array([1]), { contentType: "image/png" });
  await uploadBytes(ref(st, `projects/${P}/invoices/i1/f.pdf`), new Uint8Array([1]), { contentType: "application/pdf" });
  await uploadBytes(ref(st, `projects/${P}/cover/c.jpg`), new Uint8Array([1]), { contentType: "image/jpeg" });
  await uploadBytes(ref(st, `forms/stFormDone/docs/x.png`), new Uint8Array([1]), { contentType: "image/png" });
  await uploadBytes(ref(st, `guides/g1/cover.png`), new Uint8Array([1]), { contentType: "image/png" });
});

const as = (uid) => env.authenticatedContext(uid).storage();
const anon = env.unauthenticatedContext().storage();
const png = (n = 10) => [new Uint8Array(n), { contentType: "image/png" }];
const pdf = [new Uint8Array(10), { contentType: "application/pdf" }];

let pass = 0, fail = 0;
async function t(name, expectOk, fn) {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; console.log("  FAIL", name, "-", String(e.message || e).slice(0, 300)); }
}

console.log("crew (documentación personal)");
await t("equipo lee el DNI de una ficha", true, () => getBytes(ref(as("stTeam"), `projects/${P}/crew/m1/docs/dniFront`)));
await t("EP lee el DNI", true, () => getBytes(ref(as("stEP"), `projects/${P}/crew/m1/docs/dniFront`)));
await t("contabilidad NO lee el DNI", false, () => getBytes(ref(as("stAcc"), `projects/${P}/crew/m1/docs/dniFront`)));
await t("crew sin permisos NO lee el DNI", false, () => getBytes(ref(as("stCrew"), `projects/${P}/crew/m1/docs/dniFront`)));
await t("equipo sube un documento", true, () => uploadBytes(ref(as("stTeam"), `projects/${P}/crew/m1/docs/dniBack`), ...png()));
await t("ajeno NO lee", false, () => getBytes(ref(as("nadie"), `projects/${P}/crew/m1/docs/dniFront`)));

console.log("contabilidad");
await t("contabilidad lee una factura", true, () => getBytes(ref(as("stAcc"), `projects/${P}/invoices/i1/f.pdf`)));
await t("contabilidad sube una factura", true, () => uploadBytes(ref(as("stAcc"), `projects/${P}/invoices/i2/f.pdf`), ...pdf));
await t("EP lee una factura", true, () => getBytes(ref(as("stEP"), `projects/${P}/invoices/i1/f.pdf`)));
await t("equipo NO lee facturas", false, () => getBytes(ref(as("stTeam"), `projects/${P}/invoices/i1/f.pdf`)));
await t("crew NO lee facturas", false, () => getBytes(ref(as("stCrew"), `projects/${P}/invoices/i1/f.pdf`)));

console.log("portada");
await t("cualquier miembro ve la portada", true, () => getBytes(ref(as("stCrew"), `projects/${P}/cover/c.jpg`)));
await t("crew NO cambia la portada", false, () => uploadBytes(ref(as("stCrew"), `projects/${P}/cover/d.jpg`), ...png()));
await t("ajeno NO ve la portada", false, () => getBytes(ref(as("nadie"), `projects/${P}/cover/c.jpg`)));

console.log("formularios públicos");
await t("sin login sube a un formulario pendiente", true, () => uploadBytes(ref(anon, `forms/stFormPending/docs/a-${RUN}.png`), ...png()));
await t("sin login lee lo subido (para la URL)", true, () => getBytes(ref(anon, `forms/stFormPending/docs/a-${RUN}.png`)));
await t("sin login NO sube a un formulario enviado", false, () => uploadBytes(ref(anon, `forms/stFormDone/docs/b.png`), ...png()));
await t("sin login NO lee un formulario enviado", false, () => getBytes(ref(anon, `forms/stFormDone/docs/x.png`)));
await t("el equipo del proyecto lee un formulario enviado", true, () => getBytes(ref(as("stCrew"), `forms/stFormDone/docs/x.png`)));
await t("NO a un formulario que no existe", false, () => uploadBytes(ref(anon, `forms/noexiste/docs/a.png`), ...png()));
await t("NO sube ejecutables", false, () => uploadBytes(ref(anon, `forms/stFormPending/docs/a.html`), new Uint8Array(5), { contentType: "text/html" }));
await t("NO sube más de 20 MB", false, () => uploadBytes(ref(anon, `forms/stFormPending/docs/big.png`), ...png(21 * 1024 * 1024)));
await t("NO sobrescribe lo subido", false, () => uploadBytes(ref(anon, `forms/stFormPending/docs/a-${RUN}.png`), ...png()));

console.log("guías y otros");
await t("cualquiera ve la imagen de una guía", true, () => getBytes(ref(anon, `guides/g1/cover.png`)));
await t("usuario NO sube a guías", false, () => uploadBytes(ref(as("stCrew"), `guides/g1/x.png`), ...png()));
await t("admin sube a guías", true, () => uploadBytes(ref(as("stAdmin"), `guides/g1/x.png`), ...png()));
await t("ruta desconocida denegada", false, () => uploadBytes(ref(as("stAdmin"), `otra/x.png`), ...png()));

console.log(`\n${pass} ok, ${fail} fallos`);
await env.cleanup();
process.exit(fail ? 1 : 0);
