// ─── Demo guiada ─────────────────────────────────────────────────────────────
// El admin crea un enlace de demo (demoLinks, id = hash del token). Quien lo
// abre entra con un usuario propio y desechable en un proyecto de ejemplo con
// datos ficticios: presupuesto, proveedores, POs, facturas en distintos
// estados, crew y calendario. Nada de esto se enseña a los demás usuarios.

import { createHash, randomBytes } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { syncProjectLedger } from "@/lib/server/ledger";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");

const DEPARTMENTS = ["Producción", "Dirección", "Fotografía", "Arte", "Sonido", "Vestuario", "Maquillaje y peluquería", "Reparto"];

/** IBAN español válido a partir de banco+sucursal+cuenta (20 dígitos). */
function iban(bban: string) {
  const n = (bban + "ES00").replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of n) r = (r * 10 + Number(d)) % 97;
  return `ES${String(98 - r).padStart(2, "0")}${bban}`;
}

/** Crea el proyecto de ejemplo para un usuario demo y devuelve su id. */
export async function createDemoProject(uid: string, person: { name: string; email: string }) {
  const projectId = `demo-${randomBytes(4).toString("hex")}`;
  const base = db.collection("projects").doc(projectId);
  const now = Date.now(), day = 86400000;
  const ts = (offsetDays: number) => Timestamp.fromMillis(now + offsetDays * day);
  const ymd = (offsetDays: number) => new Date(now + offsetDays * day).toISOString().slice(0, 10);
  const batch = db.batch();
  const set = (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => batch.set(ref, data);

  // Proyecto y miembro (la persona de la demo es la PM, con acceso completo)
  set(base, {
    name: "El último verano", description: "Largometraje de ejemplo · datos ficticios", phase: "Rodaje", producers: [],
    departments: DEPARTMENTS, language: "es", createdAt: FieldValue.serverTimestamp(), isDemo: true,
    modules: { accounting: true, team: true, sign: false },
  });
  const perms = { config: true, accounting: true, team: true };
  const member = { role: "PM", department: null, position: null, permissions: perms, accountingAccessLevel: "accounting_extended", boxAccess: true, addedAt: Timestamp.now() };
  set(base.collection("members").doc(uid), { userId: uid, name: person.name, email: person.email, ...member });
  set(db.doc(`userProjects/${uid}/projects/${projectId}`), { projectId, ...member });
  // Compañeros ficticios (sin cuenta)
  const others: [string, string, string | null, string | null, string | null][] = [
    ["demo-ep", "Carmen Ibáñez", "EP", null, null],
    ["demo-ctl", "Andrés Molina", "Controller", null, null],
    ["demo-hod-foto", "Lucía Prieto", null, "Fotografía", "HOD"],
    ["demo-hod-arte", "Diego Vidal", null, "Arte", "HOD"],
  ];
  for (const [id, name, role, department, position] of others) {
    set(base.collection("members").doc(id), {
      userId: id, name, email: `${id}@demo.filma`, role, department, position,
      permissions: { config: false, accounting: !!role || position === "HOD", team: false },
      accountingAccessLevel: role === "Controller" ? "accounting" : "user", addedAt: Timestamp.now(),
    });
  }

  set(base.collection("config").doc("company"), { fiscalName: "Producciones Ejemplo S.L.", taxId: "B00000000", address: "Calle Ficticia 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "España" });
  set(base.collection("config").doc("production"), { projectType: "pelicula", shootingDays: 30, shootingStartDate: ymd(-20), shootingEndDate: ymd(16), language: "Español" });

  // Presupuesto: cuentas, subcuentas y cifras (budgetLines)
  const budget: [string, string, [string, string, number][]][] = [
    ["02", "Personal artístico", [["02.01", "Protagonistas", 90000], ["02.02", "Secundarios", 45000]]],
    ["03", "Equipo técnico", [["03.01", "Dirección", 60000], ["03.02", "Fotografía", 75000], ["03.03", "Arte", 40000]]],
    ["04", "Escenografía", [["04.01", "Construcción de decorados", 38000], ["04.02", "Atrezo", 18000]]],
    ["05", "Material técnico", [["05.01", "Cámara y ópticas", 42000], ["05.02", "Iluminación y grupo", 30000]]],
    ["08", "Viajes, alojamiento y dietas", [["08.01", "Alojamiento", 26000], ["08.03", "Catering", 22000]]],
  ];
  const subs: Record<string, { id: string; description: string }> = {};
  for (const [code, description, lines] of budget) {
    const acc = base.collection("accounts").doc(`a${code}`);
    set(acc, { code, description, createdAt: ts(-40) });
    for (const [scode, sdesc, amount] of lines) {
      const sid = `s${scode.replace(".", "")}`;
      subs[scode] = { id: sid, description: sdesc };
      set(acc.collection("subaccounts").doc(sid), { code: scode, description: sdesc, accountId: acc.id, committed: 0, actual: 0, box: 0, createdAt: ts(-40) });
      set(base.collection("budgetLines").doc(sid), { budgeted: amount, accountId: acc.id, code: scode });
    }
  }

  // Proveedores (IBAN con certificado verificado salvo uno)
  const suppliers: [string, string, string, string, string, boolean][] = [
    ["sup-rental", "Alquileres Cámara Norte S.L.", "Cámara Norte", "B10000003", "21000418450200051332", true],
    ["sup-luz", "Iluminación Sur S.L.", "Luz Sur", "B20000002", "00491500051234567892", true],
    ["sup-carpinteria", "Carpintería del Río S.L.", "Carpintería del Río", "B30000001", "20800000650000000123", true],
    ["sup-catering", "Catering La Mesa S.L.", "La Mesa Catering", "B40000000", "01822370410201234567", true],
    ["sup-hotel", "Hotel Mirador S.A.", "Hotel Mirador", "A50000009", "21003000141234567890", false],
  ];
  for (const [id, fiscal, commercial, taxId, bban, verified] of suppliers) {
    set(base.collection("suppliers").doc(id), {
      fiscalName: fiscal, commercialName: commercial, country: "ES", taxId,
      address: { street: "Calle Ejemplo 10", number: "", city: "Madrid", province: "Madrid", postalCode: "28010" },
      contact: { name: "Contacto", email: `${id}@demo.filma`, phone: "600000000" },
      paymentMethod: "transferencia", bankAccount: iban(bban), bic: "",
      certificates: { bankOwnership: { uploaded: true, verified }, contractorsCertificate: { uploaded: false } },
      createdAt: ts(-35), createdBy: uid,
    });
  }
  const sup = (id: string) => suppliers.find((s) => s[0] === id)!;

  // Paso de aprobación pendiente: aprueba la propia persona de la demo.
  const step = () => ({ id: "s1", order: 1, approverType: "role", roles: ["PM"], requireAll: false, approvers: [uid], approverNames: [person.name], approvedBy: [], rejectedBy: [], status: "pending" });

  // Autoría por departamento (compañeros ficticios); el borrador de la PO-0006 es de la propia persona.
  const AUTHOR: Record<string, [string, string]> = { "Fotografía": ["demo-hod-foto", "Lucía Prieto"], "Arte": ["demo-hod-arte", "Diego Vidal"], "Producción": ["demo-ep", "Carmen Ibáñez"] };
  const authorOf = (department: string, own = false) => {
    const [id, name] = own ? [uid, person.name] : AUTHOR[department] || [uid, person.name];
    return { createdBy: id, createdByName: name };
  };

  // POs
  const poItem = (d: string, code: string, amount: number, vat = 21) => ({
    description: d, subAccountId: subs[code].id, subAccountCode: code, subAccountDescription: subs[code].description,
    quantity: 1, unitPrice: amount, baseAmount: amount, vatRate: vat, vatAmount: +(amount * vat / 100).toFixed(2), irpfRate: 0, irpfAmount: 0, totalAmount: +(amount * (1 + vat / 100)).toFixed(2),
  });
  const pos: [string, string, string, string, string, ReturnType<typeof poItem>[], Record<string, unknown>][] = [
    ["po1", "0001", "sup-rental", "Fotografía", "Paquete de cámara y ópticas, 6 semanas", [poItem("Cámara y ópticas", "05.01", 18600)], { status: "approved", approvedAt: ts(-25) }],
    ["po2", "0002", "sup-luz", "Fotografía", "Iluminación y grupo electrógeno", [poItem("Material de iluminación", "05.02", 12400), poItem("Grupo electrógeno", "05.02", 2900)], { status: "approved", approvedAt: ts(-22) }],
    ["po3", "0003", "sup-carpinteria", "Arte", "Construcción del decorado de la casa", [poItem("Construcción decorado", "04.01", 21500)], { status: "approved", approvedAt: ts(-18) }],
    ["po4", "0004", "sup-catering", "Producción", "Catering semanas 1 a 4", [poItem("Catering 45 personas", "08.03", 15800, 10)], { status: "approved", approvedAt: ts(-15) }],
    ["po5", "0005", "sup-hotel", "Producción", "Alojamiento del equipo en exteriores", [poItem("Habitaciones 12 noches", "08.01", 9600, 10)], { status: "pending", approvalSteps: [step()], currentApprovalStep: 0, approverIds: [uid] }],
    ["po6", "0006", "sup-carpinteria", "Arte", "Atrezo de época", [poItem("Atrezo", "04.02", 3200)], { status: "draft" }],
  ];
  for (const [id, number, sid, department, desc, items, extra] of pos) {
    const baseAmount = items.reduce((a, i) => a + i.baseAmount, 0), vat = items.reduce((a, i) => a + i.vatAmount, 0);
    set(base.collection("pos").doc(id), {
      number, version: 1, supplier: sup(sid)[2], supplierId: sid, department, generalDescription: desc, items,
      baseAmount, vatAmount: vat, irpfAmount: 0, totalAmount: +(baseAmount + vat).toFixed(2),
      committedAmount: baseAmount, invoicedAmount: 0, remainingAmount: baseAmount,
      createdAt: ts(-28 + Number(number)), ...authorOf(department, id === "po6"), ...extra,
    });
  }
  set(base.collection("counters").doc("pos"), { last: 6 });

  // Facturas en distintos momentos del circuito
  const inv = (n: number, poId: string | null, sid: string, desc: string, code: string, amount: number, vat: number, extra: Record<string, unknown>, invoiceDay: number, dueDay: number) => {
    const it = { ...poItem(desc, code, amount, vat), ...(poId ? { poId, poNumber: pos.find((p) => p[0] === poId)![1], poItemIndex: 0, poItemId: "item-0", isNewItem: false } : { isNewItem: true }) };
    set(base.collection("invoices").doc(`inv${n}`), {
      documentType: "invoice", number: `FAC-${String(n).padStart(4, "0")}`, displayNumber: `FAC-${String(n).padStart(4, "0")}`,
      supplier: sup(sid)[2], supplierId: sid, supplierTaxId: sup(sid)[3], supplierNumber: `${sid.slice(4, 7).toUpperCase()}-26/${100 + n}`,
      department: poId ? pos.find((p) => p[0] === poId)![3] : "Producción",
      poId, poNumber: poId ? pos.find((p) => p[0] === poId)![1] : null, description: desc, items: [it],
      baseAmount: it.baseAmount, vatAmount: it.vatAmount, irpfAmount: 0, totalAmount: it.totalAmount,
      invoiceDate: ts(invoiceDay), dueDate: ts(dueDay), attachmentUrl: "",
      createdAt: ts(invoiceDay + 1), ...authorOf(poId ? pos.find((p) => p[0] === poId)![3] : "Producción"), ...extra,
    });
  };
  inv(1, "po1", "sup-rental", "Cámara y ópticas · semanas 1 y 2", "05.01", 6200, 21, { status: "submitted", approvalStatus: "approved", approvedAt: ts(-12), codedAt: ts(-11), paidAt: ts(-4), paymentDate: ts(-4) }, -14, 16);
  inv(2, "po1", "sup-rental", "Cámara y ópticas · semanas 3 y 4", "05.01", 6200, 21, { status: "submitted", approvalStatus: "approved", approvedAt: ts(-2), codedAt: ts(-1) }, -3, 27);
  inv(3, "po3", "sup-carpinteria", "Primer pago decorado (50 %)", "04.01", 10750, 21, { status: "submitted", approvalStatus: "approved", approvedAt: ts(-6) }, -8, 2);
  inv(4, "po4", "sup-catering", "Catering semanas 1 y 2", "08.03", 7900, 10, { status: "submitted", approvalStatus: "approved", approvedAt: ts(-9), codedAt: ts(-8) }, -10, -1);
  inv(5, "po2", "sup-luz", "Iluminación · primera quincena", "05.02", 7650, 21, { status: "submitted", approvalStatus: "pending", approvalSteps: [step()], currentApprovalStep: 0, approverIds: [uid] }, -2, 28);
  inv(6, null, "sup-hotel", "Alojamiento localizaciones", "08.01", 1840, 10, { status: "submitted", approvalStatus: "pending", approvalSteps: [step()], currentApprovalStep: 0, approverIds: [uid] }, -1, 29);
  set(base.collection("counters").doc("invoices"), { last: 6 });

  // Crew
  const crew: [string, string, string, string, string, number][] = [
    ["Laura", "Benítez", "Directora", "Dirección", "technical", 3200],
    ["Martín", "Roca", "Ayudante de dirección", "Dirección", "technical", 1650],
    ["Lucía", "Prieto", "Directora de fotografía", "Fotografía", "technical", 2600],
    ["Hugo", "Serrano", "Foquista", "Fotografía", "technical", 1400],
    ["Diego", "Vidal", "Director de arte", "Arte", "technical", 2100],
    ["Paula", "Nieto", "Ambientadora", "Arte", "technical", 1150],
    ["Sara", "León", "Jefa de sonido", "Sonido", "technical", 1800],
    ["Elena", "Campos", "Protagonista", "Reparto", "cast", 0],
  ];
  crew.forEach(([firstName, lastName1, role, department, section, weekly], i) => {
    set(base.collection("crew").doc(`crew${i + 1}`), {
      crewNumber: String(i + 1).padStart(4, "0"), section, firstName, lastName1, role, department, status: "active",
      email: `${firstName.toLowerCase()}@demo.filma`, ...(weekly ? { salaryType: "weekly", salaryAmount: weekly } : { sessions: 20, salaryPerSession: 600 }),
      startDate: ymd(-27), createdAt: ts(-30), createdBy: uid, createdByName: person.name,
    });
  });
  set(base.collection("counters").doc("crew"), { last: crew.length });
  set(base.collection("teamConfig").doc("departmentOrder"), { order: ["Dirección", "Fotografía", "Arte", "Sonido", "Reparto"] });

  // Calendario
  const events: [number, string, string, string?][] = [
    [-20, "milestone", "Inicio de rodaje"], [-6, "location", "Exteriores: playa", "Costa norte"], [2, "scene", "Escenas 24 a 31", "Casa del faro"],
    [9, "location", "Cambio de localización", "Pueblo"], [16, "milestone", "Fin de rodaje"],
  ];
  events.forEach(([d, category, title, location], i) => {
    set(base.collection("calendarEvents").doc(`ev${i + 1}`), {
      category, title, description: "", date: ymd(d), endDate: null, allDay: true, startTime: null, endTime: null,
      location: location || "", sceneNumber: "", crewMemberId: null, crewMemberName: null, crewSection: null,
      createdAt: Timestamp.now(), createdBy: uid, createdByName: person.name,
    });
  });

  await batch.commit();
  // Comprometido, realizado y facturado por PO a partir de los documentos.
  await syncProjectLedger(projectId, { write: true }).catch(() => {});
  return projectId;
}

/**
 * Demos creadas antes de que los pendientes llevaran approvalStatus y
 * approverIds: se completan al volver a entrar, para que se puedan aprobar.
 */
export async function repairDemoApprovals(projectId: string, uid: string) {
  const base = db.collection("projects").doc(projectId);
  const [pos, invs] = await Promise.all([base.collection("pos").where("status", "==", "pending").get(), base.collection("invoices").get()]);
  const batch = db.batch();
  let n = 0;
  for (const d of pos.docs) if (!d.data().approverIds) { batch.update(d.ref, { approverIds: [uid] }); n++; }
  for (const d of invs.docs) {
    const x = d.data();
    if (x.approvalStatus) continue;
    if (x.approvedAt) batch.update(d.ref, { approvalStatus: "approved" });
    else batch.update(d.ref, {
      approvalStatus: "pending", currentApprovalStep: 0, approverIds: [uid],
      approvalSteps: x.approvalSteps?.length ? x.approvalSteps : [{ id: "s1", order: 1, approverType: "role", roles: ["PM"], requireAll: false, approvers: [uid], approverNames: [""], approvedBy: [], rejectedBy: [], status: "pending" }],
    });
    n++;
  }
  if (n) await batch.commit();
}

/** Usuario desechable para la demo. */
export async function createDemoUser(link: { name: string; email?: string | null; expiresAt: Timestamp }) {
  const email = `demo+${randomBytes(5).toString("hex")}@demo.filmaworkspace.com`;
  const user = await adminAuth.createUser({ email, password: randomBytes(18).toString("base64url"), displayName: link.name || "Demo", emailVerified: true });
  await db.collection("users").doc(user.uid).set({
    name: link.name || "Demo", email, contactEmail: link.email || null, phone: "", role: "user",
    isDemo: true, demoExpiresAt: link.expiresAt, createdAt: FieldValue.serverTimestamp(),
  });
  return { uid: user.uid, email };
}
