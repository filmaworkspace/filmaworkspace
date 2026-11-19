"use client";

// ─── Caja de efectivo (Petty Cash) ───────────────────────────────────────────
// Pensada para el cajero-pagador: libro de caja con saldo en vivo, anticipos a
// personas y su justificación, pagos directos con ticket, reposiciones,
// arqueos por billetes y monedas y vales en PDF para firmar.

import { syncBudget } from "@/lib/ledgerClient";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, Paperclip, X } from "lucide-react";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, Timestamp, updateDoc, deleteDoc, where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, storage } from "@/lib/firebase";
import {
  Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Segmented, Select, Textarea,
} from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";
import {
  CashCount, CashFloat, CashLine, CashMovement, CashMovementType, DENOMINATIONS, MOVEMENT_LABEL,
  advanceOutstanding, balanceOf, cashEffect, isCostMovement, lineTotals, round2, todayISO,
} from "@/lib/cashBox";

interface SubAccountOption { code: string; description: string }

interface Props {
  projectId: string;
  projectName: string;
  userId: string | null;
  userName: string;
  subAccounts: SubAccountOption[];
  departments: string[];
  onToast: (type: "success" | "error", message: string) => void;
}

const money = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);
const shortDate = (iso: string) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }).replace(".", "");
};
const daysSince = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.max(0, Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000));
};
const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : null);
const VAT_RATES = [0, 4, 10, 21];
const emptyLine = (): CashLine => ({ subAccountCode: "", subAccountDescription: "", description: "", baseAmount: 0, vatRate: 21, vatAmount: 0 });

type FormKind = "advance" | "expense" | "funding" | "settle" | "return";

interface MovementForm {
  kind: FormKind;
  date: string;
  personName: string;
  personDepartment: string;
  supplier: string;
  supplierTaxId: string;
  documentType: "ticket" | "invoice";
  description: string;
  reference: string;
  amount: string;
  lines: CashLine[];
  advanceId: string;
  settleLeftover: "return" | "keep";
  file: File | null;
  fundingSource: "now" | "treasury";
  forecastId: string;
  /** Tickets que llegan del enlace público: se adjuntan todos al movimiento. */
  attachments: { url: string; name: string }[];
  fromFormId: string;
}

const emptyForm = (kind: FormKind): MovementForm => ({
  kind, date: todayISO(), personName: "", personDepartment: "", supplier: "", supplierTaxId: "", documentType: "ticket",
  description: "", reference: "", amount: "", lines: [emptyLine()], advanceId: "", settleLeftover: "return", file: null,
  fundingSource: "now", forecastId: "", attachments: [], fromFormId: "",
});

const STATUS_LABEL: Record<string, { label: string; dot: string; text: string }> = {
  pending: { label: "Pendiente", dot: "bg-amber-500", text: "text-amber-800" },
  reviewed: { label: "Revisado", dot: "bg-slate-400", text: "text-slate-600" },
  accounted: { label: "Contabilizado", dot: "bg-emerald-500", text: "text-emerald-800" },
};

export default function CashBox({ projectId, projectName, userId, userName, subAccounts, departments, onToast }: Props) {
  const [floats, setFloats] = useState<CashFloat[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [counts, setCounts] = useState<CashCount[]>([]);
  const [floatId, setFloatId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Búsqueda y filtros del libro
  type LedgerField = "all" | "number" | "person" | "supplier" | "concept" | "account" | "amount";
  const [search, setSearch] = useState("");
  const [field, setField] = useState<LedgerField>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | CashMovementType>("all");
  const [onlyPending, setOnlyPending] = useState(false);
  const [onlyNoReceipt, setOnlyNoReceipt] = useState(false);

  // Modales
  const [floatModal, setFloatModal] = useState<null | "new" | "edit">(null);
  const [floatForm, setFloatForm] = useState({ name: "", code: "", custodianName: "", department: "", initialAmount: "", notes: "" });
  const [form, setForm] = useState<MovementForm | null>(null);
  const [countOpen, setCountOpen] = useState(false);
  const [countForm, setCountForm] = useState<Record<string, string>>({});
  const [countNotes, setCountNotes] = useState("");
  const [countAdjust, setCountAdjust] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<CashMovement | null>(null);
  // Previsiones de pago en borrador (para pedir reposiciones a tesorería)
  const [draftForecasts, setDraftForecasts] = useState<{ id: string; name: string; paymentDate: string }[] | null>(null);
  // Enlaces públicos para que cada persona suba los tickets de su anticipo
  const [ticketForms, setTicketForms] = useState<any[]>([]);
  const [linkModal, setLinkModal] = useState<{ url: string; pin: string; personName: string; advanceNumber: string } | null>(null);

  // ── Datos en vivo ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) return;
    const base = `projects/${projectId}`;
    const u1 = onSnapshot(query(collection(db, `${base}/cashFloats`), orderBy("createdAt", "asc")), (snap) => {
      const list = snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, name: x.name, code: x.code, custodianName: x.custodianName || "", department: x.department || "", status: x.status || "open", nextNumber: x.nextNumber || 1, notes: x.notes || "", createdAt: toDate(x.createdAt), createdByName: x.createdByName } as CashFloat;
      });
      setFloats(list);
      setFloatId((cur) => cur || list.find((f) => f.status === "open")?.id || list[0]?.id || "");
      setLoading(false);
    }, () => setLoading(false));
    const u2 = onSnapshot(collection(db, `${base}/cashMovements`), (snap) => {
      // Un movimiento de efectivo que cambia puede mover la caja del presupuesto.
      if (!snap.metadata.hasPendingWrites && snap.docChanges().some((c) => c.type !== "added") ) syncBudget(projectId);
      setMovements(snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, ...x, createdAt: toDate(x.createdAt) } as CashMovement;
      }));
    });
    const u3 = onSnapshot(collection(db, `${base}/cashCounts`), (snap) => {
      setCounts(snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toDate(d.data().createdAt) }) as CashCount));
    });
    const u4 = onSnapshot(
      query(collection(db, "forms"), where("projectId", "==", projectId), where("type", "==", "cash_settlement")),
      (snap) => setTicketForms(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setTicketForms([]),
    );
    return () => { u1(); u2(); u3(); u4(); };
  }, [projectId]);

  useEffect(() => {
    if (form?.kind !== "funding" || draftForecasts !== null) return;
    getDocs(query(collection(db, `projects/${projectId}/paymentForecasts`), where("status", "==", "draft")))
      .then((snap) => setDraftForecasts(snap.docs.map((d) => ({
        id: d.id, name: d.data().name || "Previsión",
        paymentDate: d.data().paymentDate?.toDate ? d.data().paymentDate.toDate().toISOString().slice(0, 10) : "",
      }))))
      .catch(() => setDraftForecasts([])); // sin acceso a Pagos: solo efectivo recibido
  }, [form?.kind, draftForecasts, projectId]);

  const current = floats.find((f) => f.id === floatId) || null;
  const floatMovements = useMemo(
    () => movements.filter((m) => m.floatId === floatId).sort((a, b) => (a.date === b.date ? (a.number || "").localeCompare(b.number || "") : a.date.localeCompare(b.date))),
    [movements, floatId],
  );
  const balance = balanceOf(floatMovements);
  const openAdvances = floatMovements
    .filter((m) => m.type === "advance")
    .map((a) => ({ advance: a, outstanding: advanceOutstanding(a, floatMovements) }))
    .filter((x) => x.outstanding > 0.004)
    .sort((a, b) => a.advance.date.localeCompare(b.advance.date));
  const outstandingTotal = round2(openAdvances.reduce((s, x) => s + x.outstanding, 0));
  const floatCounts = counts.filter((c) => c.floatId === floatId).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  const lastCount = floatCounts[0];
  const persons = Array.from(new Set(movements.map((m) => m.personName).filter(Boolean))) as string[];

  // Libro con saldo acumulado y filtros
  const ledger = useMemo(() => {
    let running = 0;
    return floatMovements.map((m) => { running = round2(running + cashEffect(m)); return { m, running }; });
  }, [floatMovements]);
  const LEDGER_FIELDS: SearchField<LedgerField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Vale, persona o proveedor" },
    { value: "number", label: "Nº de vale", placeholder: "Ej. CP-0012", mono: true },
    { value: "person", label: "Persona", placeholder: "Ej. Lucía" },
    { value: "supplier", label: "Proveedor", placeholder: "Nombre o NIF" },
    { value: "concept", label: "Concepto", placeholder: "Ej. gasolina" },
    { value: "account", label: "Cuenta", placeholder: "Ej. 03.02", mono: true },
    { value: "amount", label: "Importe", placeholder: "50 · >100 · 20-80", mono: true },
  ];
  const rows = ledger.filter(({ m }) => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (onlyPending && !(isCostMovement(m) && m.status !== "accounted")) return false;
    if (onlyNoReceipt && !(isCostMovement(m) && !m.attachmentUrl)) return false;
    const q = search.trim();
    if (!q) return true;
    const byNumber = matchCode(q, m.number);
    const byPerson = matchWords(q, m.personName, m.personDepartment);
    const bySupplier = matchWords(q, m.supplier) || matchCode(q, m.supplierTaxId);
    const byConcept = matchWords(q, m.description, ...(m.lines || []).map((l) => l.description));
    const byAccount = (m.lines || []).some((l) => matchCode(q, l.subAccountCode) || matchWords(q, l.subAccountDescription));
    const byAmount = matchAmount(q, m.amount) === true;
    switch (field) {
      case "number": return byNumber;
      case "person": return byPerson;
      case "supplier": return bySupplier;
      case "concept": return byConcept;
      case "account": return byAccount;
      case "amount": return byAmount;
      default: return byNumber || byPerson || bySupplier || byConcept || byAccount || byAmount;
    }
  }).reverse(); // lo último arriba

  // ── Escrituras ─────────────────────────────────────────────────────────────
  const uploadFile = async (file: File) => {
    const path = `projects/${projectId}/cash/${floatId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const r = ref(storage, path);
    await uploadBytes(r, file);
    return { url: await getDownloadURL(r), name: file.name };
  };

  /** Crea un movimiento reservando el nº de vale correlativo de la caja. */
  const createMovement = async (data: Omit<CashMovement, "id" | "number" | "createdAt" | "status"> & { status?: CashMovement["status"] }) => {
    const floatRef = doc(db, `projects/${projectId}/cashFloats`, data.floatId);
    const number = await runTransaction(db, async (tx) => {
      const snap = await tx.get(floatRef);
      const n = (snap.data()?.nextNumber as number) || 1;
      tx.update(floatRef, { nextNumber: n + 1 });
      return `${snap.data()?.code || "EF"}-${String(n).padStart(4, "0")}`;
    });
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== ""));
    const docRef = await addDoc(collection(db, `projects/${projectId}/cashMovements`), {
      ...clean,
      number,
      status: data.status || (isCostMovement(data) ? "pending" : "reviewed"),
      createdAt: Timestamp.now(),
      createdBy: userId,
      createdByName: userName,
    });
    return { id: docRef.id, number };
  };

  const saveFloat = async () => {
    const name = floatForm.name.trim();
    const code = (floatForm.code.trim() || name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)).toUpperCase();
    if (!name || !floatForm.custodianName.trim()) { onToast("error", "Nombre y custodio son obligatorios"); return; }
    setSaving(true);
    try {
      if (floatModal === "edit" && current) {
        await updateDoc(doc(db, `projects/${projectId}/cashFloats`, current.id), { name, code, custodianName: floatForm.custodianName.trim(), department: floatForm.department, notes: floatForm.notes });
      } else {
        const r = await addDoc(collection(db, `projects/${projectId}/cashFloats`), {
          name, code, custodianName: floatForm.custodianName.trim(), department: floatForm.department, notes: floatForm.notes,
          status: "open", nextNumber: 1, createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
        const initial = parseFloat(floatForm.initialAmount.replace(",", ".")) || 0;
        if (initial > 0) {
          await createMovement({ floatId: r.id, type: "funding", date: todayISO(), description: "Fondo inicial de caja", amount: round2(initial) });
        }
        setFloatId(r.id);
      }
      setFloatModal(null);
      onToast("success", floatModal === "edit" ? "Caja actualizada" : "Caja abierta");
    } catch (e: any) {
      onToast("error", e?.message || "No se pudo guardar la caja");
    } finally {
      setSaving(false);
    }
  };

  const formTotals = form ? lineTotals(form.lines) : { base: 0, vat: 0, total: 0 };
  const settleAdvance = form?.kind === "settle" || form?.kind === "return" ? openAdvances.find((x) => x.advance.id === form.advanceId) : undefined;

  const submitForm = async () => {
    if (!form || !current) return;
    const amount = round2(parseFloat(form.amount.replace(",", ".")) || 0);
    const base = { floatId: current.id, date: form.date, description: form.description.trim() };
    try {
      setSaving(true);
      let attachment: { url: string; name: string } | null = null;
      if (form.file) attachment = await uploadFile(form.file);
      const att = attachment ? { attachmentUrl: attachment.url, attachmentFileName: attachment.name } : {};

      if (form.kind === "funding") {
        if (amount <= 0) throw new Error("Indica el importe que entra en caja");
        if (form.fundingSource === "treasury") {
          const fc = draftForecasts?.find((f) => f.id === form.forecastId);
          if (!fc) throw new Error("Elige la previsión de pago");
          const { id: movId, number } = await createMovement({
            ...base, type: "funding", amount, pendingFunding: true, forecastId: fc.id, forecastName: fc.name,
            reference: form.reference.trim(), description: base.description || "Reposición de caja", ...att,
          });
          // Se añade como pago a la previsión: tesorería lo verá junto al resto.
          const fRef = doc(db, `projects/${projectId}/paymentForecasts`, fc.id);
          const fSnap = await getDoc(fRef);
          const items = [...(fSnap.data()?.items || []), {
            id: `cash_${movId}`, type: "cash_funding", cashMovementId: movId,
            supplier: `${current.name} · ${current.custodianName}`, description: `${number} · ${base.description || "Reposición de caja"}`,
            amount, addedBy: userId, addedByName: userName, addedAt: new Date(), status: "pending",
          }];
          await updateDoc(fRef, { items, totalAmount: items.reduce((t: number, i: any) => t + (i.partialAmount || i.amount || 0), 0) });
        } else {
          await createMovement({ ...base, type: "funding", amount, reference: form.reference.trim(), description: base.description || "Reposición de caja", ...att });
        }
      }

      if (form.kind === "advance") {
        if (!form.personName.trim()) throw new Error("¿A quién se entrega el anticipo?");
        if (amount <= 0) throw new Error("Indica el importe del anticipo");
        if (amount > balance + 0.004) throw new Error(`No hay suficiente efectivo: en caja quedan ${money(balance)} €`);
        const { number } = await createMovement({ ...base, type: "advance", amount, personName: form.personName.trim(), personDepartment: form.personDepartment, description: base.description || "Anticipo a justificar", ...att });
      }

      if (form.kind === "expense") {
        if (!form.supplier.trim()) throw new Error("Indica el proveedor");
        if (formTotals.total <= 0) throw new Error("Añade al menos una línea con importe");
        if (form.lines.some((l) => l.baseAmount > 0 && !l.subAccountCode)) throw new Error("Cada línea necesita su cuenta");
        if (formTotals.total > balance + 0.004) throw new Error(`No hay suficiente efectivo: en caja quedan ${money(balance)} €`);
        await createMovement({
          ...base, type: "expense", amount: formTotals.total, supplier: form.supplier.trim(), supplierTaxId: form.supplierTaxId.trim().toUpperCase(),
          documentType: form.documentType, personName: form.personName.trim() || undefined, lines: form.lines.filter((l) => l.baseAmount > 0), ...att,
        });
      }

      if (form.kind === "settle") {
        if (!settleAdvance) throw new Error("Elige el anticipo que se justifica");
        if (formTotals.total <= 0) throw new Error("Añade los tickets que justifican el anticipo");
        if (form.lines.some((l) => l.baseAmount > 0 && !l.subAccountCode)) throw new Error("Cada línea necesita su cuenta");
        const adv = settleAdvance.advance;
        await createMovement({
          ...base, type: "settlement", amount: formTotals.total, advanceId: adv.id, personName: adv.personName, personDepartment: adv.personDepartment,
          supplier: form.supplier.trim(), supplierTaxId: form.supplierTaxId.trim().toUpperCase(), documentType: form.documentType,
          description: base.description || `Justificación de ${adv.number}`, lines: form.lines.filter((l) => l.baseAmount > 0), ...att,
          ...(form.attachments.length ? { attachments: form.attachments, attachmentUrl: attachment?.url || form.attachments[0].url, attachmentFileName: attachment?.name || form.attachments[0].name } : {}),
        } as any);
        if (form.fromFormId) await updateDoc(doc(db, "forms", form.fromFormId), { importedAt: Timestamp.now(), importedByName: userName });
        const diff = round2(settleAdvance.outstanding - formTotals.total);
        if (diff > 0.004 && form.settleLeftover === "return") {
          await createMovement({ floatId: current.id, type: "return", date: form.date, amount: diff, advanceId: adv.id, personName: adv.personName, description: `Sobrante de ${adv.number}` });
        } else if (diff < -0.004) {
          await createMovement({ floatId: current.id, type: "reimbursement", date: form.date, amount: -diff, advanceId: adv.id, personName: adv.personName, description: `Gastó más de lo anticipado en ${adv.number}` });
        }
      }

      if (form.kind === "return") {
        if (!settleAdvance) throw new Error("Elige el anticipo");
        if (amount <= 0 || amount > settleAdvance.outstanding + 0.004) throw new Error(`Como mucho ${money(settleAdvance.outstanding)} €`);
        const adv = settleAdvance.advance;
        await createMovement({ ...base, type: "return", amount, advanceId: adv.id, personName: adv.personName, description: base.description || `Devolución de ${adv.number}` });
      }

      setForm(null);
      onToast("success", "Movimiento registrado");
    } catch (e: any) {
      onToast("error", e?.message || "No se pudo registrar");
    } finally {
      setSaving(false);
    }
  };

  const formForAdvance = (advanceId: string) =>
    ticketForms.filter((f) => f.advanceId === advanceId && !f.importedAt).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0];

  const createTicketLink = async (a: CashMovement, outstanding: number) => {
    try {
      const existing = formForAdvance(a.id);
      let id = existing?.id, pin = existing?.pin;
      if (!existing || existing.status === "submitted") {
        pin = String(Math.floor(1000 + Math.random() * 9000));
        const expires = new Date(); expires.setDate(expires.getDate() + 30);
        const refDoc = await addDoc(collection(db, "forms"), {
          type: "cash_settlement", pin, status: "pending", projectId, projectName,
          floatId: a.floatId, advanceId: a.id, advanceNumber: a.number, personName: a.personName, amount: outstanding,
          createdBy: userId, createdByName: userName, createdAt: Timestamp.now(), expiresAt: Timestamp.fromDate(expires), prefilled: {},
        });
        id = refDoc.id;
      }
      setLinkModal({ url: `${window.location.origin}/caja/${id}`, pin: String(pin), personName: a.personName || "", advanceNumber: a.number });
    } catch (e: any) { onToast("error", e?.message || "No se pudo crear el enlace"); }
  };

  const reviewTickets = (a: CashMovement, f: any) => {
    const tickets: any[] = f.responseData?.tickets || [];
    setForm({
      ...emptyForm("settle"),
      advanceId: a.id,
      supplier: tickets.length === 1 ? tickets[0].supplier : "Varios",
      date: tickets[tickets.length - 1]?.date || todayISO(),
      description: `Tickets enviados por ${a.personName}`,
      // El ticket trae el total; IVA a 0 % hasta que el cajero lo revise.
      lines: tickets.map((t) => ({ ...emptyLine(), description: [t.supplier, t.description].filter(Boolean).join(" · "), baseAmount: t.amount, vatRate: 0, vatAmount: 0 })),
      attachments: tickets.filter((t) => t.fileUrl).map((t) => ({ url: t.fileUrl, name: t.fileName || t.supplier || "ticket" })),
      fromFormId: f.id,
    });
  };

  const confirmFunding = async (m: CashMovement) => {
    try {
      await updateDoc(doc(db, `projects/${projectId}/cashMovements`, m.id), { pendingFunding: false, receivedAt: Timestamp.now(), receivedByName: userName });
      onToast("success", `${money(m.amount)} € recibidos en caja`);
    } catch (e: any) { onToast("error", e?.message || "No se pudo confirmar"); }
  };

  const setStatus = async (m: CashMovement, status: CashMovement["status"]) => {
    try {
      await updateDoc(doc(db, `projects/${projectId}/cashMovements`, m.id), { status, [`${status}At`]: Timestamp.now(), [`${status}ByName`]: userName });
    } catch (e: any) { onToast("error", e?.message || "No se pudo actualizar"); }
  };

  const attachReceipt = async (m: CashMovement, file: File) => {
    try {
      const a = await uploadFile(file);
      await updateDoc(doc(db, `projects/${projectId}/cashMovements`, m.id), { attachmentUrl: a.url, attachmentFileName: a.name });
      onToast("success", "Justificante adjuntado");
    } catch (e: any) { onToast("error", e?.message || "No se pudo subir el archivo"); }
  };

  const deleteMovement = async (m: CashMovement) => {
    try {
      await deleteDoc(doc(db, `projects/${projectId}/cashMovements`, m.id));
      setConfirmDelete(null);
      onToast("success", `${m.number} eliminado`);
    } catch (e: any) { onToast("error", e?.message || "No se pudo eliminar"); }
  };

  // ── Arqueo ─────────────────────────────────────────────────────────────────
  const counted = round2(DENOMINATIONS.reduce((s, d) => s + d * (parseInt(countForm[String(d)] || "0", 10) || 0), 0));
  const countDiff = round2(counted - balance);
  const saveCount = async () => {
    if (!current) return;
    setSaving(true);
    try {
      await addDoc(collection(db, `projects/${projectId}/cashCounts`), {
        floatId: current.id, date: todayISO(),
        counts: Object.fromEntries(DENOMINATIONS.map((d) => [String(d), parseInt(countForm[String(d)] || "0", 10) || 0])),
        counted, expected: balance, difference: countDiff, notes: countNotes.trim(),
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      if (Math.abs(countDiff) > 0.004 && countAdjust) {
        await createMovement({ floatId: current.id, type: "adjustment", date: todayISO(), amount: countDiff, description: `Descuadre de arqueo${countNotes.trim() ? ` · ${countNotes.trim()}` : ""}` });
      }
      setCountOpen(false);
      onToast("success", Math.abs(countDiff) < 0.005 ? "Arqueo cuadrado" : `Arqueo registrado con ${money(countDiff)} € de diferencia`);
    } catch (e: any) { onToast("error", e?.message || "No se pudo registrar el arqueo"); }
    finally { setSaving(false); }
  };

  const exportLedger = () => {
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const head = ["Fecha", "Vale", "Tipo", "Persona", "Proveedor", "NIF", "Concepto", "Cuentas", "Entrada", "Salida", "Saldo", "Estado"];
    const lines = ledger.map(({ m, running }) => {
      const eff = cashEffect(m);
      return [m.date, m.number, MOVEMENT_LABEL[m.type], m.personName, m.supplier, m.supplierTaxId, m.description, (m.lines || []).map((l) => l.subAccountCode).join(" "),
        eff > 0 ? money(eff) : "", eff < 0 ? money(-eff) : m.type === "settlement" ? `(${money(m.amount)})` : "", money(running), STATUS_LABEL[m.status]?.label || ""].map(q).join(";");
    });
    const blob = new Blob(["﻿" + [head.map(q).join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Libro_de_caja_${current?.code || "caja"}_${todayISO()}.csv`;
    a.click();
  };

  // ── Interfaz ───────────────────────────────────────────────────────────────
  if (loading) return <div className="px-6 py-16 text-center text-[13px] text-slate-500 sm:px-10">Cargando caja…</div>;

  const openForm = (kind: FormKind, preset?: Partial<MovementForm>) => setForm({ ...emptyForm(kind), ...preset });
  const accountOptions = subAccounts.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.description}</option>);

  // Función (no componente) para que los campos no pierdan el foco al escribir.
  const linesEditor = () => form && (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-slate-200">
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_96px_72px_28px] gap-2 border-b border-slate-200 bg-[#FAFAFA] px-2.5 py-1.5 text-[11px] text-slate-500">
          <span>Cuenta</span><span>Concepto</span><span className="text-right">Base</span><span>IVA</span><span />
        </div>
        {form.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_96px_72px_28px] items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 last:border-0">
            <Select value={l.subAccountCode} onChange={(e) => {
              const s = subAccounts.find((x) => x.code === e.target.value);
              setForm({ ...form, lines: form.lines.map((x, j) => j === i ? { ...x, subAccountCode: e.target.value, subAccountDescription: s?.description || "" } : x) });
            }}>
              <option value="">Cuenta…</option>
              {accountOptions}
            </Select>
            <Input value={l.description} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} placeholder="Concepto" />
            <Input
              type="number" step="0.01" min="0" className="text-right font-mono"
              value={l.baseAmount || ""}
              onChange={(e) => {
                const b = parseFloat(e.target.value) || 0;
                setForm({ ...form, lines: form.lines.map((x, j) => j === i ? { ...x, baseAmount: b, vatAmount: round2(b * x.vatRate / 100) } : x) });
              }}
            />
            <Select value={String(l.vatRate)} onChange={(e) => {
              const r = parseInt(e.target.value, 10);
              setForm({ ...form, lines: form.lines.map((x, j) => j === i ? { ...x, vatRate: r, vatAmount: round2(x.baseAmount * r / 100) } : x) });
            }}>
              {VAT_RATES.map((r) => <option key={r} value={String(r)}>{r} %</option>)}
            </Select>
            <IconButton label="Quitar línea" onClick={() => setForm({ ...form, lines: form.lines.length > 1 ? form.lines.filter((_, j) => j !== i) : [emptyLine()] })}><X size={13} /></IconButton>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <button onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })} className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"><Plus size={12} /> Línea</button>
        <span className="text-slate-500">Base <span className="font-mono text-slate-900">{money(formTotals.base)}</span> · IVA <span className="font-mono text-slate-900">{money(formTotals.vat)}</span> · Total <span className="font-mono font-semibold text-slate-900">{money(formTotals.total)} €</span></span>
      </div>
    </div>
  );

  const fileInput = form && (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-[13px] text-slate-600 hover:bg-[#FAFAFA]">
      <Paperclip size={14} className="text-slate-400" />
      <span className="truncate">{form.file ? form.file.name : "Adjuntar ticket o factura (foto o PDF)"}</span>
      <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} />
    </label>
  );

  return (
    <div className="px-6 pb-16 sm:px-10">
      {floats.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Aún no hay ninguna caja de efectivo"
            action={<Button variant="primary" size="sm" onClick={() => { setFloatForm({ name: "Caja de producción", code: "CP", custodianName: userName, department: "", initialAmount: "", notes: "" }); setFloatModal("new"); }}>Abrir caja</Button>}
          />
        </div>
      ) : (
        <>
          {/* Selector de caja y acciones */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {floats.length > 1 && (
                <div className="w-56">
                  <Select value={floatId} onChange={(e) => setFloatId(e.target.value)}>
                    {floats.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status === "closed" ? " (cerrada)" : ""}</option>)}
                  </Select>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => { setFloatForm({ name: "", code: "", custodianName: "", department: "", initialAmount: "", notes: "" }); setFloatModal("new"); }}><Plus size={13} /> Otra caja</Button>
            </div>
            {current?.status === "open" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => openForm("funding")}>Reponer</Button>
                <Button variant="secondary" onClick={() => { setCountForm({}); setCountNotes(""); setCountAdjust(true); setCountOpen(true); }}>Arqueo</Button>
                <Button variant="secondary" onClick={() => openForm("expense")}>Pago con ticket</Button>
                <Button variant="primary" onClick={() => openForm("advance")}><Plus size={14} /> Anticipo</Button>
                <Menu trigger={(t) => <IconButton label="Más acciones de la caja" onClick={t}><span className="text-base leading-none">⋯</span></IconButton>}>
                  {(close) => (
                    <>
                      <MenuItem onClick={() => { close(); exportLedger(); }}>Exportar libro de caja (CSV)</MenuItem>
                      <MenuItem onClick={() => { close(); if (current) { setFloatForm({ name: current.name, code: current.code, custodianName: current.custodianName, department: current.department || "", initialAmount: "", notes: current.notes || "" }); setFloatModal("edit"); } }}>Editar caja</MenuItem>
                      <MenuSeparator />
                      <MenuItem onClick={async () => {
                        close();
                        if (!current) return;
                        if (Math.abs(balance) > 0.004 || openAdvances.length) { onToast("error", "Para cerrar la caja debe quedar a cero y sin anticipos abiertos"); return; }
                        await updateDoc(doc(db, `projects/${projectId}/cashFloats`, current.id), { status: "closed", closedAt: Timestamp.now(), closedByName: userName });
                        onToast("success", "Caja cerrada");
                      }}>Cerrar caja</MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            )}
          </div>

          {current && (
            <>
              {/* Posición de caja */}
              <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 md:grid-cols-4">
                <div className="flex flex-col gap-0.5 border-r border-slate-100 px-4 py-3">
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">Efectivo en caja</span>
                  <span className={`font-mono text-xl font-semibold ${balance < 0 ? "text-red-700" : "text-slate-900"}`}>{money(balance)} €</span>
                </div>
                <div className="flex flex-col gap-0.5 border-r border-slate-100 px-4 py-3">
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">Anticipos fuera</span>
                  <span className="font-mono text-xl font-semibold">{money(outstandingTotal)} €</span>
                </div>
                <div className="flex flex-col gap-0.5 border-r border-slate-100 px-4 py-3">
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">Fondo total</span>
                  <span className="font-mono text-xl font-semibold text-slate-600">{money(round2(balance + outstandingTotal))} €</span>
                </div>
                <div className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">Último arqueo</span>
                  {lastCount ? (
                    <span className="text-[13px]">
                      {shortDate(lastCount.date)} ·{" "}
                      <span className={Math.abs(lastCount.difference) < 0.005 ? "text-emerald-800" : "text-red-700"}>
                        {Math.abs(lastCount.difference) < 0.005 ? "cuadrado" : `${lastCount.difference > 0 ? "+" : ""}${money(lastCount.difference)} €`}
                      </span>
                    </span>
                  ) : <span className="text-[13px] text-amber-800">Sin arqueos</span>}
                  <span className="text-xs text-slate-500">Custodio: {current.custodianName}</span>
                </div>
              </div>

              <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                {/* Libro de caja */}
                <section className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <SearchBar fields={LEDGER_FIELDS} field={field} onField={setField} value={search} onChange={setSearch} count={rows.length} />
                    <div className="w-44">
                      <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
                        <option value="all">Todos los movimientos</option>
                        {(Object.keys(MOVEMENT_LABEL) as CashMovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-4">
                    <Checkbox label="Por contabilizar" checked={onlyPending} onChange={setOnlyPending} />
                    <Checkbox label="Sin justificante" checked={onlyNoReceipt} onChange={setOnlyNoReceipt} />
                  </div>

                  {rows.length === 0 ? (
                    <EmptyState title={floatMovements.length ? "Sin resultados" : "Sin movimientos"} />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="tbl w-full min-w-[920px] border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                            <th scope="col" className="px-4 py-2 text-left font-medium">Fecha</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Vale</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Movimiento</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Cuenta</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Entrada</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Salida</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Saldo</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                            <th scope="col" className="w-12 py-2 pr-3" />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ m, running }) => {
                            const eff = cashEffect(m);
                            const st = isCostMovement(m) ? STATUS_LABEL[m.status] : null;
                            const who = m.type === "expense" || m.type === "settlement" ? m.supplier || m.personName : m.personName;
                            return (
                              <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                                <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-600">{shortDate(m.date)}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs font-medium">{m.number}</td>
                                <td className="max-w-[300px] px-3 py-1.5">
                                  <span className="block truncate">
                                    <span className="text-slate-500">{MOVEMENT_LABEL[m.type]}</span>
                                    {who && <> · <span className="text-slate-900">{who}</span></>}
                                    {m.type === "settlement" && m.personName && m.supplier && <span className="text-slate-500"> ({m.personName})</span>}
                                  </span>
                                  {m.description && <span className="block truncate text-xs text-slate-500">{m.description}</span>}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-600">{(m.lines || []).map((l) => l.subAccountCode).filter(Boolean).join(", ") || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-emerald-800">{eff > 0 ? money(eff) : ""}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs">
                                  {eff < 0 ? money(-eff) : m.type === "settlement" ? <span className="text-slate-400" title="Justifica un anticipo; no mueve efectivo">({money(m.amount)})</span> : ""}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs font-medium">{money(running)}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                                  {m.pendingFunding ? (
                                    <span className="inline-flex items-center gap-1.5 text-amber-800" title={m.forecastName ? `Previsión: ${m.forecastName}` : undefined}>
                                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{m.treasuryPaidAt ? "Pagada por tesorería" : "Pedida a tesorería"}
                                    </span>
                                  ) : st ? <span className={`inline-flex items-center gap-1.5 ${st.text}`}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</span> : <span className="text-slate-400">—</span>}
                                  {isCostMovement(m) && !m.attachmentUrl && <span className="ml-1.5 text-red-700" title="Falta el ticket o la factura">· sin ticket</span>}
                                </td>
                                <td className="py-1.5 pr-3 text-right">
                                  <Menu trigger={(t) => <IconButton label="Acciones del movimiento" onClick={t} className="-my-1"><span className="text-base leading-none">⋯</span></IconButton>}>
                                    {(close) => (
                                      <>
                                        {m.pendingFunding && <MenuItem onClick={() => { close(); confirmFunding(m); }}>Confirmar recepción del efectivo</MenuItem>}
                                        {(m as any).attachments?.length > 1
                                          ? (m as any).attachments.map((a: any, i: number) => <MenuItem key={i} onClick={() => { close(); window.open(a.url, "_blank", "noopener"); }}>Ver ticket {i + 1}</MenuItem>)
                                          : m.attachmentUrl && <MenuItem onClick={() => { close(); window.open(m.attachmentUrl, "_blank", "noopener"); }}>Ver justificante</MenuItem>}
                                        {isCostMovement(m) && (
                                          <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-600 hover:bg-[#F7F7F8] hover:text-slate-900">
                                            {m.attachmentUrl ? "Cambiar justificante" : "Adjuntar justificante"}
                                            <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { close(); const f = e.target.files?.[0]; if (f) attachReceipt(m, f); }} />
                                          </label>
                                        )}
                                        {(m.type === "advance" || m.type === "return" || m.type === "reimbursement" || m.type === "expense") && (
                                          <MenuItem onClick={() => { close(); window.location.href = `/project/${projectId}/accounting/document-center?doc=cash:${m.id}`; }}>Ver vale en documentación</MenuItem>
                                        )}
                                        {m.type === "advance" && advanceOutstanding(m, floatMovements) > 0.004 && (
                                          <>
                                            <MenuItem onClick={() => { close(); openForm("settle", { advanceId: m.id }); }}>Justificar</MenuItem>
                                            <MenuItem onClick={() => { close(); openForm("return", { advanceId: m.id, amount: String(advanceOutstanding(m, floatMovements)) }); }}>Registrar devolución</MenuItem>
                                          </>
                                        )}
                                        {isCostMovement(m) && m.status === "pending" && <MenuItem onClick={() => { close(); setStatus(m, "reviewed"); }}>Marcar revisado</MenuItem>}
                                        {isCostMovement(m) && m.status !== "accounted" && <MenuItem onClick={() => { close(); setStatus(m, "accounted"); }}>Contabilizar</MenuItem>}
                                        {isCostMovement(m) && m.status === "accounted" && <MenuItem onClick={() => { close(); setStatus(m, "reviewed"); }}>Descontabilizar</MenuItem>}
                                        {m.status !== "accounted" && !movements.some((x) => x.advanceId === m.id) && (
                                          <>
                                            <MenuSeparator />
                                            <MenuItem danger onClick={() => { close(); setConfirmDelete(m); }}>Eliminar</MenuItem>
                                          </>
                                        )}
                                      </>
                                    )}
                                  </Menu>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Anticipos abiertos y arqueos */}
                <aside className="flex min-w-0 flex-col gap-6 text-[13px]">
                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-medium text-slate-500">Anticipos por justificar <span className="font-normal text-slate-400">{openAdvances.length}</span></h3>
                    {openAdvances.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">Nadie tiene efectivo pendiente de justificar</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-slate-200">
                        {openAdvances.map(({ advance: a, outstanding }) => {
                          const days = daysSince(a.date);
                          return (
                            <div key={a.id} className="flex flex-col gap-1.5 border-b border-slate-100 px-3.5 py-2.5 last:border-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate font-medium">{a.personName}</span>
                                <span className="font-mono text-xs font-medium">{money(outstanding)} €</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                                <span>
                                  <span className="font-mono">{a.number}</span> · {shortDate(a.date)}
                                  <span className={days > 7 ? " text-amber-800" : ""}> · {days} d</span>
                                  {outstanding < a.amount - 0.004 && <> · de {money(a.amount)}</>}
                                </span>
                                <span className="flex gap-2">
                                  <button onClick={() => openForm("return", { advanceId: a.id, amount: String(outstanding) })} className="hover:text-slate-900">Devolución</button>
                                  <button onClick={() => openForm("settle", { advanceId: a.id })} className="font-medium text-slate-900 hover:underline">Justificar</button>
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs">
                                {(() => {
                                  const f = formForAdvance(a.id);
                                  if (f?.status === "submitted") return (
                                    <button onClick={() => reviewTickets(a, f)} className="inline-flex items-center gap-1.5 font-medium text-slate-900 hover:underline">
                                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{f.responseData?.tickets?.length || 0} tickets recibidos · revisar
                                    </button>
                                  );
                                  return (
                                    <button onClick={() => createTicketLink(a, outstanding)} className="text-slate-500 hover:text-slate-900">
                                      {f ? "Enlace enviado · ver" : "Pedir tickets por enlace"}
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {floatMovements.some((m) => m.pendingFunding) && (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-xs font-medium text-slate-500">Reposiciones en camino</h3>
                      <div className="overflow-hidden rounded-lg border border-slate-200">
                        {floatMovements.filter((m) => m.pendingFunding).map((m) => (
                          <div key={m.id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5 text-xs last:border-0">
                            <span className="min-w-0">
                              <span className="block font-mono font-medium text-slate-900">{money(m.amount)} €</span>
                              <span className="block truncate text-slate-500">{m.forecastName} · {m.treasuryPaidAt ? "pagada por tesorería" : "pendiente de pago"}</span>
                            </span>
                            <button onClick={() => confirmFunding(m)} className="flex-shrink-0 font-medium text-slate-900 hover:underline">Recibida</button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-medium text-slate-500">Arqueos</h3>
                    {floatCounts.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">Haz un arqueo para comprobar que el efectivo cuadra</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-slate-200">
                        {floatCounts.slice(0, 6).map((c) => (
                          <div key={c.id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2 text-xs last:border-0">
                            <span className="text-slate-600">{shortDate(c.date)} · {c.createdByName}</span>
                            <span className="font-mono">
                              {money(c.counted)}
                              <span className={`ml-2 ${Math.abs(c.difference) < 0.005 ? "text-emerald-800" : "text-red-700"}`}>
                                {Math.abs(c.difference) < 0.005 ? "✓" : `${c.difference > 0 ? "+" : ""}${money(c.difference)}`}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Caja: nueva / editar ────────────────────────────────────────────── */}
      <Modal
        open={!!floatModal}
        onClose={() => setFloatModal(null)}
        title={floatModal === "edit" ? "Editar caja" : "Abrir caja de efectivo"}
        footer={<><Button variant="secondary" onClick={() => setFloatModal(null)}>Cancelar</Button><Button variant="primary" onClick={saveFloat} disabled={saving}>{floatModal === "edit" ? "Guardar" : "Abrir caja"}</Button></>}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <Field label="Nombre"><Input value={floatForm.name} onChange={(e) => setFloatForm({ ...floatForm, name: e.target.value })} placeholder="Caja de producción" autoFocus /></Field>
            <Field label="Código"><Input value={floatForm.code} onChange={(e) => setFloatForm({ ...floatForm, code: e.target.value.toUpperCase().slice(0, 4) })} placeholder="CP" className="font-mono" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Custodio (cajero-pagador)"><Input value={floatForm.custodianName} onChange={(e) => setFloatForm({ ...floatForm, custodianName: e.target.value })} /></Field>
            <Field label="Departamento">
              <Select value={floatForm.department} onChange={(e) => setFloatForm({ ...floatForm, department: e.target.value })}>
                <option value="">—</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
          </div>
          {floatModal === "new" && (
            <Field label="Fondo inicial (€)"><Input type="number" min="0" step="0.01" value={floatForm.initialAmount} onChange={(e) => setFloatForm({ ...floatForm, initialAmount: e.target.value })} className="font-mono" /></Field>
          )}
          <Field label="Notas"><Textarea rows={2} value={floatForm.notes} onChange={(e) => setFloatForm({ ...floatForm, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      {/* ── Movimientos ─────────────────────────────────────────────────────── */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        width={form?.kind === "expense" || form?.kind === "settle" ? "max-w-3xl" : "max-w-md"}
        title={form ? { advance: "Entregar anticipo", expense: "Pago con ticket", funding: "Reponer caja", settle: "Justificar anticipo", return: "Devolución de anticipo" }[form.kind] : ""}
        footer={
          <>
            <span className="mr-auto text-xs text-slate-500">En caja: <span className="font-mono text-slate-900">{money(balance)} €</span></span>
            <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
            <Button variant="primary" onClick={submitForm} disabled={saving}>Registrar</Button>
          </>
        }
      >
        {form && (
          <div className="flex flex-col gap-4">
            {(form.kind === "settle" || form.kind === "return") && (
              <Field label="Anticipo">
                <Select value={form.advanceId} onChange={(e) => {
                  const a = openAdvances.find((x) => x.advance.id === e.target.value);
                  setForm({ ...form, advanceId: e.target.value, amount: form.kind === "return" && a ? String(a.outstanding) : form.amount });
                }}>
                  <option value="">Elegir…</option>
                  {openAdvances.map(({ advance: a, outstanding }) => <option key={a.id} value={a.id}>{a.number} · {a.personName} · pendiente {money(outstanding)} €</option>)}
                </Select>
              </Field>
            )}

            {form.kind === "advance" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Persona">
                  <Input value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} list="cash-persons" autoFocus />
                  <datalist id="cash-persons">{persons.map((p) => <option key={p} value={p} />)}</datalist>
                </Field>
                <Field label="Departamento">
                  <Select value={form.personDepartment} onChange={(e) => setForm({ ...form, personDepartment: e.target.value })}>
                    <option value="">—</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
              </div>
            )}

            {(form.kind === "expense" || form.kind === "settle") && (
              <div className="grid grid-cols-[1fr_150px_130px] gap-3">
                <Field label="Proveedor"><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} autoFocus /></Field>
                <Field label="NIF"><Input value={form.supplierTaxId} onChange={(e) => setForm({ ...form, supplierTaxId: e.target.value })} className="font-mono" /></Field>
                <Field label="Documento">
                  <Select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as "ticket" | "invoice" })}>
                    <option value="ticket">Ticket</option>
                    <option value="invoice">Factura</option>
                  </Select>
                </Field>
              </div>
            )}

            <div className={`grid gap-3 ${form.kind === "expense" || form.kind === "settle" ? "grid-cols-[150px_1fr]" : "grid-cols-[150px_1fr]"}`}>
              <Field label="Fecha"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              {(form.kind === "advance" || form.kind === "funding" || form.kind === "return") ? (
                <Field label="Importe (€)"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-mono" /></Field>
              ) : form.kind === "expense" ? (
                <Field label="Pagado a (opcional)"><Input value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} list="cash-persons" /></Field>
              ) : <div />}
            </div>

            {form.kind === "funding" && (
              <>
                {!!draftForecasts?.length && (
                  <Segmented
                    value={form.fundingSource}
                    onChange={(v) => setForm({ ...form, fundingSource: v, forecastId: form.forecastId || draftForecasts[0]?.id || "" })}
                    options={[{ value: "now", label: "Ya tengo el efectivo" }, { value: "treasury", label: "Pedir a tesorería" }]}
                  />
                )}
                {form.fundingSource === "treasury" ? (
                  <Field label="Previsión de pago">
                    <Select value={form.forecastId} onChange={(e) => setForm({ ...form, forecastId: e.target.value })}>
                      {(draftForecasts || []).map((f) => <option key={f.id} value={f.id}>{f.name}{f.paymentDate ? ` · ${shortDate(f.paymentDate)}` : ""}</option>)}
                    </Select>
                  </Field>
                ) : (
                  <Field label="Referencia"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Cheque, retirada de cajero, transferencia…" /></Field>
                )}
                {form.fundingSource === "treasury" && <p className="text-xs text-slate-500">Se añade a la previsión como pago. El saldo no cambia hasta que confirmes que has recibido el efectivo.</p>}
              </>
            )}

            <Field label="Concepto"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

            {(form.kind === "expense" || form.kind === "settle") && linesEditor()}

            {form.kind === "settle" && settleAdvance && formTotals.total > 0 && (() => {
              const diff = round2(settleAdvance.outstanding - formTotals.total);
              if (Math.abs(diff) < 0.005) return <p className="text-xs text-emerald-800">Justifica exactamente lo pendiente: el anticipo queda cerrado.</p>;
              if (diff < 0) return <p className="text-xs text-amber-900">Ha gastado {money(-diff)} € más de lo anticipado: se registrará un reembolso desde la caja.</p>;
              return (
                <div className="flex flex-col gap-1.5 text-xs">
                  <span className="text-slate-600">Sobran {money(diff)} € del anticipo.</span>
                  <Segmented
                    value={form.settleLeftover}
                    onChange={(v) => setForm({ ...form, settleLeftover: v })}
                    options={[{ value: "return", label: "Los devuelve ahora en efectivo" }, { value: "keep", label: "Se los queda (justificará más)" }]}
                  />
                </div>
              );
            })()}

            {form.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {form.attachments.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:border-slate-300">Ticket {i + 1} ↗</a>)}
              </div>
            )}
            {form.kind !== "return" && fileInput}
            {form.kind === "advance" && <p className="text-xs text-slate-500">El vale para firmar estará en Documentación → Box → Cash.</p>}
          </div>
        )}
      </Modal>

      {/* ── Arqueo ──────────────────────────────────────────────────────────── */}
      <Modal
        open={countOpen}
        onClose={() => setCountOpen(false)}
        title="Arqueo de caja"
        width="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setCountOpen(false)}>Cancelar</Button><Button variant="primary" onClick={saveCount} disabled={saving || counted === 0}>Registrar arqueo</Button></>}
      >
        <div className="flex flex-col gap-4 text-[13px]">
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            {DENOMINATIONS.map((d) => {
              const units = parseInt(countForm[String(d)] || "0", 10) || 0;
              return (
                <Fragment key={d}>
                  <label className="col-span-1 flex items-center gap-2">
                    <span className="w-14 text-right font-mono text-xs text-slate-600">{d >= 1 ? `${d} €` : `${Math.round(d * 100)} c`}</span>
                    <Input type="number" min="0" step="1" value={countForm[String(d)] || ""} onChange={(e) => setCountForm({ ...countForm, [String(d)]: e.target.value })} className="h-7 text-right font-mono" aria-label={`Unidades de ${d} €`} />
                  </label>
                  {units > 0 ? <span className="sr-only">{money(units * d)}</span> : null}
                </Fragment>
              );
            })}
          </div>
          <dl className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-200 text-center">
            <div className="border-r border-slate-100 px-3 py-2"><dt className="text-[11px] text-slate-500">Contado</dt><dd className="font-mono font-semibold">{money(counted)}</dd></div>
            <div className="border-r border-slate-100 px-3 py-2"><dt className="text-[11px] text-slate-500">Según libro</dt><dd className="font-mono">{money(balance)}</dd></div>
            <div className="px-3 py-2"><dt className="text-[11px] text-slate-500">Diferencia</dt><dd className={`font-mono font-semibold ${Math.abs(countDiff) < 0.005 ? "text-emerald-800" : "text-red-700"}`}>{countDiff > 0 ? "+" : ""}{money(countDiff)}</dd></div>
          </dl>
          {Math.abs(countDiff) >= 0.005 && counted > 0 && (
            <Checkbox label="Registrar el descuadre como ajuste en el libro" checked={countAdjust} onChange={setCountAdjust} />
          )}
          <Field label="Notas"><Input value={countNotes} onChange={(e) => setCountNotes(e.target.value)} placeholder="Opcional" /></Field>
        </div>
      </Modal>

      <Modal
        open={!!linkModal}
        onClose={() => setLinkModal(null)}
        title="Enlace para subir tickets"
        footer={<Button variant="primary" onClick={() => setLinkModal(null)}>Listo</Button>}
      >
        {linkModal && (
          <div className="flex flex-col gap-4 text-[13px]">
            <p className="text-slate-600">{linkModal.personName} podrá hacer foto a sus tickets desde el móvil para justificar <span className="font-mono">{linkModal.advanceNumber}</span>. Te avisará aquí cuando los envíe.</p>
            <div className="flex items-center gap-2">
              <Input value={linkModal.url} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(linkModal.url); onToast("success", "Enlace copiado"); }}>Copiar</Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span className="text-slate-600">PIN</span>
              <span className="font-mono text-lg tracking-[0.3em]">{linkModal.pin}</span>
            </div>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Hola ${linkModal.personName}, sube aquí los tickets del anticipo ${linkModal.advanceNumber}: ${linkModal.url} (PIN ${linkModal.pin})`)}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium text-slate-900 hover:underline"
            >
              Enviar por WhatsApp ↗
            </a>
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Eliminar ${confirmDelete?.number || ""}`}
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</Button><Button variant="danger" onClick={() => confirmDelete && deleteMovement(confirmDelete)}>Eliminar</Button></>}
      >
        <p className="text-[13px] text-slate-600">El movimiento desaparece del libro y el saldo se recalcula. Úsalo solo para corregir errores de registro.</p>
      </Modal>

    </div>
  );
}
