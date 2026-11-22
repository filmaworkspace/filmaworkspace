// Pruebas de seguridad de Contabilidad: quién lee y escribe cada colección.
// Se ejecuta junto a test.mjs (npm test).
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, deleteDoc, deleteField } from "firebase/firestore";
import fs from "fs";

const env = await initializeTestEnvironment({
  projectId: `demo-acc-${Date.now()}`, // base de datos nueva en cada ejecución
  firestore: { rules: fs.readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
});

// Proyecto nuevo en cada ejecución: el emulador conserva los datos entre pruebas.
const PID = `acc${Date.now()}`;
const P = `projects/${PID}`;
// uid → miembro del proyecto
const MEMBERS = {
  pm:      { role: "PM", accounting: true, level: "user" },
  ext:     { role: null, position: null, accounting: true, level: "accounting_extended" },
  acct:    { role: null, position: null, accounting: true, level: "accounting" },
  ctrl:    { role: "Controller", accounting: true, level: "user" },
  hod:     { role: null, position: "HOD", department: "Arte", accounting: true, level: "user" },
  crew:    { role: null, position: "Crew", department: "Arte", accounting: true, level: "user" },
  crew2:   { role: null, position: "Crew", department: "Foto", accounting: true, level: "user" },
  cajero:  { role: null, position: null, accounting: true, level: "visitor" },
  noacc:   { role: null, position: "Crew", department: "Arte", accounting: false, level: null },
  approver:{ role: null, position: "Crew", department: "Foto", accounting: true, level: "user" },
};

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, P), { name: "P1" });
  for (const [uid, m] of Object.entries(MEMBERS)) {
    await setDoc(doc(db, `users/${uid}`), { role: "user", name: uid });
    await setDoc(doc(db, `${P}/members/${uid}`), {
      role: m.role ?? null, position: m.position ?? null, department: m.department ?? "",
      accountingAccessLevel: m.level, permissions: { accounting: m.accounting, config: false, team: false },
    });
    await setDoc(doc(db, `userProjects/${uid}/projects/${PID}`), {
      permissions: { accounting: m.accounting, config: false, team: false }, accountingAccessLevel: m.level,
    });
  }
  await setDoc(doc(db, `${P}/accounts/a1`), { code: "03", description: "Escenografía" });
  await setDoc(doc(db, `${P}/accounts/a1/subaccounts/s1`), { code: "03.01", description: "Construcción", committed: 0, actual: 0 });
  await setDoc(doc(db, `${P}/accounts/a1/subaccounts/old`), { code: "03.02", description: "Atrezzo", budgeted: 6000, committed: 0, actual: 0 });
  await setDoc(doc(db, `${P}/budgetLines/s1`), { budgeted: 12000, accountId: "a1", code: "03.01" });
  await setDoc(doc(db, `${P}/pos/poArte`), { number: "0001", department: "Arte", createdBy: "hod", status: "approved", approverIds: [] });
  await setDoc(doc(db, `${P}/pos/poCrew`), { number: "0002", department: "Arte", createdBy: "crew", status: "draft", approverIds: [] });
  await setDoc(doc(db, `${P}/pos/poFoto`), { number: "0003", department: "Foto", createdBy: "crew2", status: "pending", approverIds: ["approver"] });
  await setDoc(doc(db, `${P}/invoices/iArte`), { number: "0001", department: "Arte", createdBy: "acct", status: "approved", approverIds: [] });
  await setDoc(doc(db, `${P}/invoices/iCrewPO`), { number: "0003", department: "Arte", createdBy: "acct", poId: "poCrew", poCreatedBy: "crew", status: "pending" });
  await setDoc(doc(db, `${P}/invoices/iFoto`), { number: "0002", department: "Foto", createdBy: "crew2", status: "pending_approval", approverIds: ["approver"] });
  await setDoc(doc(db, `${P}/suppliers/sup1`), { fiscalName: "Proveedor", bankAccount: "ES00" });
  await setDoc(doc(db, `${P}/paymentForecasts/f1`), { name: "Remesa", status: "draft", items: [] });
  await setDoc(doc(db, `${P}/cardExpenses/ce1`), { amount: 10 });
  await setDoc(doc(db, `${P}/cashMovements/m1`), { type: "expense", amount: 10, status: "pending" });
  await setDoc(doc(db, `${P}/counters/pos`), { last: 3 });
  await setDoc(doc(db, `${P}/config/company/bankAccounts/b1`), { iban: "ES11" });
  await setDoc(doc(db, `${P}/config/production`), { x: 1 });
});

const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.com` }).firestore();
const outsider = env.authenticatedContext("outsider", { email: "o@x.com" }).firestore();

let pass = 0, fail = 0;
async function t(name, expectOk, fn) {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; console.log("  FAIL", name, "-", String(e.message || e).slice(0, 400)); }
}
const col = (db, c) => collection(db, `${P}/${c}`);

console.log("presupuesto");
await t("ampliada lee cifras de presupuesto", true, () => getDocs(col(as("ext"), "budgetLines")));
await t("PM lee cifras de presupuesto", true, () => getDoc(doc(as("pm"), `${P}/budgetLines/s1`)));
await t("contabilidad (no ampliada) NO lee cifras", false, () => getDocs(col(as("acct"), "budgetLines")));
await t("HOD NO lee cifras", false, () => getDoc(doc(as("hod"), `${P}/budgetLines/s1`)));
await t("crew NO lee cifras", false, () => getDocs(col(as("crew"), "budgetLines")));
await t("ampliada escribe cifras", true, () => setDoc(doc(as("ext"), `${P}/budgetLines/s1`), { budgeted: 13000, accountId: "a1", code: "03.01" }));
await t("contabilidad NO escribe cifras", false, () => setDoc(doc(as("acct"), `${P}/budgetLines/s1`), { budgeted: 1 }));
await t("crew lee cuentas (para codificar)", true, () => getDocs(collection(as("crew"), `${P}/accounts/a1/subaccounts`)));
await t("sin contabilidad NO lee cuentas", false, () => getDocs(col(as("noacc"), "accounts")));
await t("ajeno NO lee cuentas", false, () => getDocs(col(outsider, "accounts")));
await t("crew NO mueve comprometido (solo el servidor)", false, () => updateDoc(doc(as("crew"), `${P}/accounts/a1/subaccounts/s1`), { committed: 100 }));
await t("ampliada NO toca realizado (solo el servidor)", false, () => updateDoc(doc(as("ext"), `${P}/accounts/a1/subaccounts/s1`), { actual: 5 }));
await t("crew NO cambia la descripción", false, () => updateDoc(doc(as("crew"), `${P}/accounts/a1/subaccounts/s1`), { description: "x" }));
await t("crew NO mete presupuesto en la subcuenta", false, () => updateDoc(doc(as("crew"), `${P}/accounts/a1/subaccounts/s1`), { budgeted: 1 }));
await t("ampliada NO guarda budgeted en la subcuenta", false, () => updateDoc(doc(as("ext"), `${P}/accounts/a1/subaccounts/s1`), { budgeted: 1 }));
await t("ampliada crea subcuenta sin budgeted", true, () => setDoc(doc(as("ext"), `${P}/accounts/a1/subaccounts/s3`), { code: "03.03", description: "N", committed: 0, actual: 0 }));
await t("ampliada NO crea subcuenta con budgeted", false, () => setDoc(doc(as("ext"), `${P}/accounts/a1/subaccounts/s4`), { code: "03.04", description: "N", budgeted: 5 }));
await t("ampliada traslada el budgeted antiguo (lo borra)", true, () => updateDoc(doc(as("ext"), `${P}/accounts/a1/subaccounts/old`), { budgeted: deleteField() }));
await t("contabilidad NO crea cuentas", false, () => setDoc(doc(as("acct"), `${P}/accounts/a2`), { code: "04" }));
await t("HOD NO marca seguimiento de cuenta", false, () => updateDoc(doc(as("hod"), `${P}/accounts/a1`), { trackingDepartments: ["Arte"] }));

console.log("POs y facturas");
await t("contabilidad lista todas las POs", true, () => getDocs(col(as("acct"), "pos")));
await t("Controller lista todas las POs", true, () => getDocs(col(as("ctrl"), "pos")));
await t("crew NO lista todas las POs", false, () => getDocs(col(as("crew"), "pos")));
await t("crew lista las suyas", true, () => getDocs(query(col(as("crew"), "pos"), where("createdBy", "==", "crew"))));
await t("crew NO lee la PO del HOD", false, () => getDoc(doc(as("crew"), `${P}/pos/poArte`)));
await t("HOD lista su departamento", true, () => getDocs(query(col(as("hod"), "pos"), where("department", "==", "Arte"))));
await t("HOD NO lista otro departamento", false, () => getDocs(query(col(as("hod"), "pos"), where("department", "==", "Foto"))));
await t("HOD lee una PO de su departamento", true, () => getDoc(doc(as("hod"), `${P}/pos/poCrew`)));
await t("aprobador lista lo que aprueba", true, () => getDocs(query(col(as("approver"), "pos"), where("approverIds", "array-contains", "approver"))));
await t("aprobador lee la factura que aprueba", true, () => getDoc(doc(as("approver"), `${P}/invoices/iFoto`)));
await t("aprobador NO lee otra factura", false, () => getDoc(doc(as("approver"), `${P}/invoices/iArte`)));
await t("aprobador aprueba (actualiza) la PO", true, () => updateDoc(doc(as("approver"), `${P}/pos/poFoto`), { currentApprovalStep: 1 }));
await t("crew NO edita la PO de otro", false, () => updateDoc(doc(as("crew"), `${P}/pos/poFoto`), { status: "approved" }));
await t("crew edita la suya", true, () => updateDoc(doc(as("crew"), `${P}/pos/poCrew`), { description: "x" }));
await t("crew NO se quita la autoría", false, () => updateDoc(doc(as("crew"), `${P}/pos/poCrew`), { createdBy: "hod" }));
await t("crew crea una PO a su nombre", true, () => setDoc(doc(as("crew"), `${P}/pos/new1`), { number: "0004", createdBy: "crew", department: "Arte", status: "draft" }));
await t("crew NO crea una PO a nombre de otro", false, () => setDoc(doc(as("crew"), `${P}/pos/new2`), { number: "0005", createdBy: "hod", department: "Arte" }));
await t("crew borra su borrador", true, () => deleteDoc(doc(as("crew"), `${P}/pos/new1`)));
await t("cajero (visitor) NO crea POs", false, () => setDoc(doc(as("cajero"), `${P}/pos/new3`), { createdBy: "cajero" }));
await t("sin contabilidad NO lee POs propias", false, () => getDocs(query(col(as("noacc"), "pos"), where("createdBy", "==", "noacc"))));
await t("crew lee la factura que contabilidad subió a su PO", true, () => getDoc(doc(as("crew"), `${P}/invoices/iCrewPO`)));
await t("crew lista las facturas de sus POs", true, () => getDocs(query(col(as("crew"), "invoices"), where("poCreatedBy", "==", "crew"))));
await t("crew2 NO lee facturas de POs ajenas", false, () => getDoc(doc(as("crew2"), `${P}/invoices/iCrewPO`)));
await t("crew NO lista todas las facturas", false, () => getDocs(col(as("crew"), "invoices")));
await t("contabilidad lista todas las facturas", true, () => getDocs(col(as("acct"), "invoices")));

console.log("numeración");
await t("crew reserva número", true, () => updateDoc(doc(as("crew"), `${P}/counters/pos`), { last: 4 }));
await t("NO se puede bajar el contador", false, () => updateDoc(doc(as("crew"), `${P}/counters/pos`), { last: 1 }));
await t("ajeno NO toca el contador", false, () => updateDoc(doc(outsider, `${P}/counters/pos`), { last: 9 }));

await t("crew de contabilidad NO toca el contador de crew", false, () => setDoc(doc(as("crew"), `${P}/counters/crew`), { last: 1 }));
await t("PM (equipo) crea el contador de crew", true, () => setDoc(doc(as("pm"), `${P}/counters/crew`), { last: 1 }));
await t("NO se crean contadores desconocidos", false, () => setDoc(doc(as("pm"), `${P}/counters/otro`), { last: 1 }));

console.log("proveedores y pagos");
await t("crew lee proveedores", true, () => getDocs(col(as("crew"), "suppliers")));
await t("sin contabilidad NO lee proveedores (IBAN)", false, () => getDocs(col(as("noacc"), "suppliers")));
await t("crew NO borra proveedores", false, () => deleteDoc(doc(as("crew"), `${P}/suppliers/sup1`)));
await t("contabilidad lee previsiones de pago", true, () => getDocs(col(as("acct"), "paymentForecasts")));
await t("crew NO lee previsiones de pago", false, () => getDocs(col(as("crew"), "paymentForecasts")));
await t("cajero lee previsiones (reposición de efectivo)", true, () => getDocs(col(as("cajero"), "paymentForecasts")));
await t("HOD NO lee cuentas bancarias de la productora", false, () => getDocs(collection(as("hod"), `${P}/config/company/bankAccounts`)));
await t("contabilidad lee cuentas bancarias", true, () => getDocs(collection(as("acct"), `${P}/config/company/bankAccounts`)));

console.log("BOX");
await t("cajero lee gastos de tarjeta", true, () => getDocs(col(as("cajero"), "cardExpenses")));
await t("crew (nivel usuario) NO lee gastos de tarjeta", false, () => getDocs(col(as("crew"), "cardExpenses")));
await t("cajero lee el libro de efectivo", true, () => getDocs(col(as("cajero"), "cashMovements")));
await t("crew NO lee el libro de efectivo", false, () => getDocs(col(as("crew"), "cashMovements")));

console.log("escalada de privilegios");
await t("ampliada cambia el nivel de contabilidad", true, () => updateDoc(doc(as("ext"), `${P}/members/crew`), { accountingAccessLevel: "accounting", boxAccess: true }));
await t("ampliada NO cambia el rol de nadie", false, () => updateDoc(doc(as("ext"), `${P}/members/crew`), { role: "EP" }));
await t("ampliada NO se da permiso de configuración", false, () => updateDoc(doc(as("ext"), `${P}/members/ext`), { "permissions.config": true }));
await t("ampliada NO se da config en userProjects", false, () => updateDoc(doc(as("ext"), `userProjects/ext/projects/${PID}`), { "permissions.config": true }));
await t("ampliada da acceso a contabilidad (userProjects)", true, () => updateDoc(doc(as("ext"), `userProjects/noacc/projects/${PID}`), { "permissions.accounting": true, accountingAccessLevel: "user" }));
await t("ampliada edita config de aprobaciones", true, () => setDoc(doc(as("ext"), `${P}/config/approvals`), { poApprovals: [] }));
await t("ampliada NO edita config de producción", false, () => setDoc(doc(as("ext"), `${P}/config/production`), { x: 2 }));

console.log("aprobación de sobres de caja");
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, `${P}/cardEnvelopes/envA`), { status: "pending_approval", approverIds: ["approver"], approvalSteps: [], totalBase: 100 });
  await setDoc(doc(db, `${P}/transferEnvelopes/envT`), { status: "pending_approval", approverIds: ["approver"], approvalSteps: [], totalBase: 50 });
});
await t("aprobador (sin Caja) lee su sobre", true, () => getDoc(doc(as("approver"), `${P}/cardEnvelopes/envA`)));
await t("aprobador lista sus sobres pendientes", true, () => getDocs(query(col(as("approver"), "cardEnvelopes"), where("approverIds", "array-contains", "approver"))));
await t("otro sin Caja NO lee el sobre", false, () => getDoc(doc(as("crew2"), `${P}/cardEnvelopes/envA`)));
await t("aprobador aprueba (estado y circuito)", true, () => updateDoc(doc(as("approver"), `${P}/cardEnvelopes/envA`), { status: "reviewing", approvedAt: new Date(), approvedBy: "approver", approvedByName: "A", approvalSteps: [], currentApprovalStep: -1 }));
await t("aprobador NO cierra el sobre", false, () => updateDoc(doc(as("approver"), `${P}/cardEnvelopes/envA`), { status: "closed" }));
await t("aprobador NO cambia importes", false, () => updateDoc(doc(as("approver"), `${P}/cardEnvelopes/envA`), { totalBase: 1 }));
await t("aprobador rechaza la transferencia", true, () => updateDoc(doc(as("approver"), `${P}/transferEnvelopes/envT`), { status: "draft", rejectedAt: new Date(), rejectedBy: "approver", rejectedByName: "A", rejectionReason: "Falta ticket", approvalSteps: [] }));
await t("aprobador NO liquida la transferencia", false, () => updateDoc(doc(as("approver"), `${P}/transferEnvelopes/envT`), { status: "settled" }));

console.log(`\n${pass} ok, ${fail} fallos`);
await env.cleanup();
process.exit(fail ? 1 : 0);
