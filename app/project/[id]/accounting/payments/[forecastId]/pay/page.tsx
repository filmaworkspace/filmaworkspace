"use client";

// ─── Pagos › Pagar una previsión ─────────────────────────────────────────────
// Tabla de pagos con su IBAN, vencimiento, importe (editable para pagos
// parciales) y justificante. Los justificantes del banco se sueltan de golpe y
// se propone a qué pago va cada uno (nombre del archivo y contenido del PDF);
// quien paga confirma. Un justificante puede servir para varios pagos. Al
// marcar como pagado, el justificante se guarda también en la factura, así
// contabilidad lo tiene en la propia factura y en el Centro de documentación.
// «Paquete para contabilidad»: ZIP con los justificantes y un resumen CSV.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, Timestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { zipSync, strToU8 } from "fflate";
import { ArrowLeft, Check, Download, ExternalLink, FileText, Loader2, MoreHorizontal, Package, Paperclip, RotateCcw, ShieldAlert, ShieldCheck, Upload, X } from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { syncBudget } from "@/lib/ledgerClient";
import { toast } from "@/lib/toast";
import { matchReceipt, type ReceiptTarget } from "@/lib/payments/matchReceipts";
import { Button, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Select } from "@/components/ds";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface PaymentItem {
  id: string;
  type: string;
  invoiceId?: string;
  invoiceNumber?: string;
  supplier: string;
  supplierId?: string;
  description: string;
  amount: number;
  partialAmount?: number;
  addedAt: Date;
  status: "pending" | "completed";
  receiptUrl?: string;
  receiptName?: string;
  completedAt?: Date;
  completedBy?: string;
  completedByName?: string;
  iban?: string;
  bic?: string;
  attachmentUrl?: string;
  cashMovementId?: string;
  [k: string]: unknown;
}
interface Forecast { id: string; name: string; paymentDate: Date; type: "remesa" | "fuera_remesa"; status: "draft" | "pending" | "completed"; items: PaymentItem[]; totalAmount: number }
interface BankAccount { id: string; alias: string; fiscalName: string; taxId: string; iban: string; bic?: string; isDefault?: boolean }
interface SupplierInfo { name: string; iban: string; bic?: string; cert: "verified" | "unverified" | "none" }
interface InvoiceInfo { displayNumber?: string; supplierNumber?: string; dueDate?: Date; attachmentUrl?: string }
/** Archivo soltado, pendiente de confirmar a qué pago(s) va. */
interface Pending { key: string; file: File; target: string; reasons: string[]; reading: boolean }

const TYPE_LABEL: Record<string, string> = { invoice: "Factura", partial: "Pago parcial", proforma: "Proforma", budget: "Presupuesto", deposit: "Depósito", guarantee: "Fianza", cash_funding: "Reposición de caja" };
const money = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0) + " €";
const dateEs = (d?: Date) => (d ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(d) : "—");
const isPdf = (url?: string, name?: string) => /\.pdf($|\?)/i.test(name || "") || (url || "").toLowerCase().includes(".pdf");
const safeName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
const SELECTED = "__selected__";
const ALL_MISSING = "__all_missing__";

const serialize = (items: PaymentItem[]) => items.map((it) => {
  const o: Record<string, unknown> = { ...it, addedAt: it.addedAt instanceof Date ? Timestamp.fromDate(it.addedAt) : it.addedAt };
  o.completedAt = it.completedAt instanceof Date ? Timestamp.fromDate(it.completedAt) : it.completedAt ?? null;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
});

// ─────────────────────────────────────────────────────────────────────────────

export default function PayForecastPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const forecastId = params?.forecastId as string;
  const { loading: permLoading, error: permError, permissions } = useAccountingPermissions(id);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [suppliers, setSuppliers] = useState<Record<string, SupplierInfo>>({});
  const [invoices, setInvoices] = useState<Record<string, InvoiceInfo>>({});
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [incoming, setIncoming] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name?: string; title: string } | null>(null);
  const [sepa, setSepa] = useState<{ open: boolean; bankId: string; date: string; onlySelected: boolean }>({ open: false, bankId: "", date: new Date().toISOString().slice(0, 10), onlySelected: false });
  const [confirmMissing, setConfirmMissing] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const rowFileInput = useRef<HTMLInputElement>(null);
  const rowTarget = useRef<string | null>(null);

  const canAccess = permissions.accountingAccessLevel === "accounting_extended";

  // ── Carga ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const snap = await getDoc(doc(db, `projects/${id}/paymentForecasts`, forecastId));
    if (!snap.exists()) { toast.error("Previsión no encontrada"); router.push(`/project/${id}/accounting/payments`); return; }
    const d = snap.data();
    const f: Forecast = {
      id: snap.id, name: d.name, paymentDate: d.paymentDate?.toDate?.() || new Date(), type: d.type || "remesa", status: d.status, totalAmount: d.totalAmount || 0,
      items: (d.items || []).map((it: any) => ({ ...it, addedAt: it.addedAt?.toDate ? it.addedAt.toDate() : new Date(it.addedAt || Date.now()), completedAt: it.completedAt?.toDate ? it.completedAt.toDate() : undefined })),
    };
    setForecast(f);
    setAmounts(Object.fromEntries(f.items.map((it) => [it.id, it.partialAmount || it.amount])));
    const supplierIds = [...new Set(f.items.map((i) => i.supplierId).filter(Boolean))] as string[];
    const invoiceIds = [...new Set(f.items.map((i) => i.invoiceId).filter(Boolean))] as string[];
    const [banksSnap, supSnaps, invSnaps] = await Promise.all([
      getDocs(collection(db, `projects/${id}/config/company/bankAccounts`)).catch(() => null),
      Promise.all(supplierIds.map((sid) => getDoc(doc(db, `projects/${id}/suppliers`, sid)).catch(() => null))),
      Promise.all(invoiceIds.map((iid) => getDoc(doc(db, `projects/${id}/invoices`, iid)).catch(() => null))),
    ]);
    const bk = ((banksSnap?.docs || []).map((x) => ({ id: x.id, ...x.data() })) as BankAccount[]).sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
    setBanks(bk);
    setSepa((s) => ({ ...s, bankId: s.bankId || bk[0]?.id || "" }));
    const sm: Record<string, SupplierInfo> = {};
    supSnaps.forEach((x, k) => {
      const v = x?.data(); if (!v) return;
      const c = v.certificates?.bankOwnership;
      sm[supplierIds[k]] = { name: v.fiscalName || v.commercialName || v.name || "", iban: (v.bankAccount || v.iban || "").replace(/\s+/g, ""), bic: v.bic, cert: c?.verified ? "verified" : c?.uploaded ? "unverified" : "none" };
    });
    setSuppliers(sm);
    const im: Record<string, InvoiceInfo> = {};
    invSnaps.forEach((x, k) => { const v = x?.data(); if (v) im[invoiceIds[k]] = { displayNumber: v.displayNumber, supplierNumber: v.supplierNumber, dueDate: v.dueDate?.toDate?.(), attachmentUrl: v.attachmentUrl }; });
    setInvoices(im);
  }, [id, forecastId, router]);

  useEffect(() => {
    if (permLoading || !permissions.userId) return;
    load().catch((e) => toast.error(e)).finally(() => setLoading(false));
  }, [permLoading, permissions.userId, load]);

  // ── Datos derivados ──────────────────────────────────────────────────────
  const items = forecast?.items || [];
  const pending = items.filter((i) => i.status === "pending");
  const done = items.filter((i) => i.status === "completed");
  const amountOf = (it: PaymentItem) => (it.status === "completed" ? it.partialAmount || it.amount : amounts[it.id] ?? it.amount);
  const totals = useMemo(() => ({
    all: items.reduce((a, it) => a + amountOf(it), 0),
    paid: done.reduce((a, it) => a + amountOf(it), 0),
    pending: pending.reduce((a, it) => a + amountOf(it), 0),
    withReceipt: items.filter((i) => i.receiptUrl).length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, amounts]);
  const ibanOf = (it: PaymentItem) => (it.supplierId && suppliers[it.supplierId]?.iban) || (it.iban || "").replace(/\s+/g, "");
  const numberOf = (it: PaymentItem) => (it.invoiceId && invoices[it.invoiceId]?.displayNumber) || it.invoiceNumber || "";
  const selItems = pending.filter((i) => selected.has(i.id));

  // ── Guardar ──────────────────────────────────────────────────────────────
  const saveItems = async (next: PaymentItem[], extra: Record<string, unknown> = {}) => {
    const total = next.reduce((a, it) => a + (it.status === "completed" ? it.partialAmount || it.amount : it.amount), 0);
    await updateDoc(doc(db, `projects/${id}/paymentForecasts`, forecastId), { items: serialize(next), totalAmount: total, ...extra });
    setForecast((f) => (f ? { ...f, items: next, totalAmount: total, ...(extra as Partial<Forecast>) } : f));
  };
  const upload = async (file: File, tag: string) => {
    const r = ref(storage, `projects/${id}/receipts/${forecastId}/${tag}_${Date.now()}_${safeName(file.name)}`);
    await uploadBytes(r, file, { contentType: file.type || undefined });
    return getDownloadURL(r);
  };
  /** El justificante también en la factura: lo ve contabilidad y el Centro de documentación. */
  const receiptToInvoice = async (it: PaymentItem, url: string | null, name: string | null) => {
    if (!it.invoiceId || it.status !== "completed") return;
    await updateDoc(doc(db, `projects/${id}/invoices`, it.invoiceId), url ? { receiptUrl: url, receiptName: name, receiptUploadedAt: Timestamp.now() } : { receiptUrl: null, receiptName: null }).catch(() => {});
  };

  // ── Justificantes ────────────────────────────────────────────────────────
  const targets: ReceiptTarget[] = items.filter((i) => i.status === "pending" || !i.receiptUrl).map((it) => ({
    id: it.id, supplier: (it.supplierId && suppliers[it.supplierId]?.name) || it.supplier, amount: amountOf(it),
    numbers: [numberOf(it), it.invoiceNumber || "", (it.invoiceId && invoices[it.invoiceId]?.supplierNumber) || ""].filter(Boolean),
  }));

  /** Archivos soltados: se proponen asignaciones y se abre la revisión. */
  const receive = async (files: File[]) => {
    if (!files.length) return;
    const taken = new Set(items.filter((i) => i.receiptUrl).map((i) => i.id));
    const list: Pending[] = files.map((file, k) => {
      const m = matchReceipt(file.name, "", targets, taken);
      if (m.itemId) taken.add(m.itemId);
      return { key: `${Date.now()}-${k}`, file, target: m.itemId || "", reasons: m.reasons, reading: !m.itemId && /pdf/i.test(file.type || file.name) };
    });
    setIncoming(list);
    // Sin coincidencia por nombre: se lee el PDF (texto, sin OCR) para buscar número e importe.
    const { readFile } = await import("@/lib/ocr/readDocument");
    for (const p of list.filter((x) => x.reading)) {
      let text = "";
      try { text = (await readFile(p.file, () => {}, { ocr: false })).text; } catch { /* sin texto */ }
      setIncoming((cur) => {
        const used = new Set([...items.filter((i) => i.receiptUrl).map((i) => i.id), ...cur.filter((x) => x.key !== p.key && x.target && !x.target.startsWith("__")).map((x) => x.target)]);
        const m = matchReceipt(p.file.name, text, targets, used);
        return cur.map((x) => (x.key === p.key ? { ...x, reading: false, target: x.target || m.itemId || "", reasons: m.itemId ? m.reasons : x.reasons } : x));
      });
    }
  };

  const confirmIncoming = async () => {
    if (!forecast) return;
    setBusy("receipts");
    try {
      let next = [...forecast.items];
      const missing = () => next.filter((i) => i.status === "pending" && !i.receiptUrl).map((i) => i.id);
      for (const p of incoming) {
        const ids = p.target === SELECTED ? [...selected] : p.target === ALL_MISSING ? missing() : p.target ? [p.target] : [];
        if (!ids.length) continue;
        const url = await upload(p.file, ids.length > 1 ? "multi" : ids[0]);
        next = next.map((it) => (ids.includes(it.id) ? { ...it, receiptUrl: url, receiptName: p.file.name } : it));
        for (const it of next.filter((x) => ids.includes(x.id))) await receiptToInvoice(it, url, p.file.name);
      }
      await saveItems(next);
      const n = incoming.filter((p) => p.target).length;
      toast.success(`${n} ${n === 1 ? "justificante asignado" : "justificantes asignados"}`);
      setIncoming([]);
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  const setRowReceipt = async (itemId: string, file: File | null) => {
    if (!forecast) return;
    setBusy(itemId);
    try {
      const url = file ? await upload(file, itemId) : null;
      const next = forecast.items.map((it) => (it.id === itemId ? { ...it, receiptUrl: url || undefined, receiptName: file?.name || undefined } : it));
      await saveItems(next);
      const it = next.find((x) => x.id === itemId)!;
      await receiptToInvoice(it, url, file?.name || null);
      toast.success(file ? "Justificante guardado" : "Justificante quitado");
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  // ── Pagar ────────────────────────────────────────────────────────────────
  const markPaid = async (ids: string[], force = false) => {
    if (!forecast || !ids.length) return;
    const noReceipt = ids.filter((i) => !forecast.items.find((x) => x.id === i)?.receiptUrl);
    if (noReceipt.length && !force) { setConfirmMissing(ids); return; }
    setConfirmMissing(null);
    setBusy("pay");
    try {
      const now = new Date();
      let next = [...forecast.items];
      const extra: PaymentItem[] = [];
      for (const itemId of ids) {
        const k = next.findIndex((x) => x.id === itemId);
        if (k < 0) continue;
        const it = next[k];
        const paying = Math.min(amounts[itemId] ?? it.amount, it.amount);
        const partial = paying < it.amount - 0.005;
        next[k] = { ...it, status: "completed", partialAmount: paying, completedAt: now, completedBy: permissions.userId || "", completedByName: permissions.userName || "" };
        if (partial) {
          extra.push({ ...it, id: `${it.id}_remaining_${Date.now()}`, description: `${it.description} (restante)`, amount: +(it.amount - paying).toFixed(2), partialAmount: undefined, receiptUrl: undefined, receiptName: undefined, addedAt: now, status: "pending" });
        }
        if (it.cashMovementId && !partial) {
          await updateDoc(doc(db, `projects/${id}/cashMovements`, it.cashMovementId), { treasuryPaidAt: Timestamp.now(), treasuryPaidByName: permissions.userName || "" }).catch(() => {});
        }
        if (it.invoiceId) {
          await updateDoc(doc(db, `projects/${id}/invoices`, it.invoiceId), {
            status: partial ? "partial_paid" : "paid", paidAmount: paying, paidAt: Timestamp.now(), paymentForecastId: forecastId, paymentMethod: "transfer",
            ...(it.receiptUrl ? { receiptUrl: it.receiptUrl, receiptName: it.receiptName || null, receiptUploadedAt: Timestamp.now() } : {}),
          });
        }
      }
      next = [...next, ...extra];
      const allDone = next.every((x) => x.status === "completed");
      await saveItems(next, { status: allDone ? "completed" : forecast.status === "draft" ? "pending" : forecast.status });
      setAmounts((a) => ({ ...a, ...Object.fromEntries(extra.map((x) => [x.id, x.amount])) }));
      setSelected(new Set());
      if (ids.some((i) => forecast.items.find((x) => x.id === i)?.invoiceId)) await syncBudget(id);
      toast.success(extra.length ? `Pagado. Queda un pago pendiente por ${money(extra.reduce((a, x) => a + x.amount, 0))}` : `${ids.length} ${ids.length === 1 ? "pago marcado" : "pagos marcados"} como pagados`);
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  const undo = async (itemId: string) => {
    if (!forecast) return;
    setBusy(itemId);
    try {
      let next = [...forecast.items];
      const k = next.findIndex((x) => x.id === itemId);
      const it = next[k];
      const rest = next.findIndex((x) => x.id.startsWith(`${itemId}_remaining_`) && x.status === "pending");
      next[k] = { ...it, status: "pending", amount: rest >= 0 ? +(it.amount + next[rest].amount).toFixed(2) : it.amount, partialAmount: undefined, completedAt: undefined, completedBy: undefined, completedByName: undefined };
      if (rest >= 0) next = next.filter((_, j) => j !== rest);
      if (it.invoiceId) {
        const others = next.filter((x) => x.invoiceId === it.invoiceId && x.status === "completed");
        await updateDoc(doc(db, `projects/${id}/invoices`, it.invoiceId), others.length
          ? { status: "partial_paid", paidAmount: others.reduce((a, x) => a + (x.partialAmount || x.amount), 0) }
          : { status: "submitted", paidAmount: 0, paidAt: null, paymentForecastId: null, receiptUrl: null, receiptName: null }).catch(() => {});
        await syncBudget(id);
      }
      await saveItems(next, { status: "pending" });
      setAmounts((a) => ({ ...a, [itemId]: next[k].amount }));
      toast.success("Pago deshecho");
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  // ── SEPA ─────────────────────────────────────────────────────────────────
  const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const sepaItems = sepa.onlySelected && selItems.length ? selItems : pending;
  const sepaNoIban = sepaItems.filter((i) => !ibanOf(i));
  const generateSepa = () => {
    const bank = banks.find((b) => b.id === sepa.bankId);
    if (!forecast || !bank) { toast.error("Elige la cuenta ordenante"); return; }
    const list = sepaItems.filter((i) => ibanOf(i));
    if (!list.length) { toast.error("No hay pagos con IBAN"); return; }
    const total = list.reduce((a, i) => a + amountOf(i), 0);
    const msgId = `REMESA-${forecast.id.slice(0, 8)}-${Date.now()}`;
    const txs = list.map((it, k) => {
      const bic = (it.supplierId && suppliers[it.supplierId]?.bic) || it.bic || "";
      const ref = numberOf(it) || it.description.slice(0, 35);
      return `<CdtTrfTxInf><PmtId><EndToEndId>${msgId}-${k + 1}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amountOf(it).toFixed(2)}</InstdAmt></Amt>${bic ? `<CdtrAgt><FinInstnId><BIC>${xmlEsc(bic)}</BIC></FinInstnId></CdtrAgt>` : ""}<Cdtr><Nm>${xmlEsc(((it.supplierId && suppliers[it.supplierId]?.name) || it.supplier).slice(0, 70))}</Nm></Cdtr><CdtrAcct><Id><IBAN>${ibanOf(it)}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${xmlEsc(ref)}</Ustrd></RmtInf></CdtTrfTxInf>`;
    }).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>${msgId}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${list.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><InitgPty><Nm>${xmlEsc(bank.fiscalName)}</Nm><Id><OrgId><Othr><Id>${xmlEsc(bank.taxId)}</Id></Othr></OrgId></Id></InitgPty></GrpHdr><PmtInf><PmtInfId>${msgId}-1</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${list.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${sepa.date}</ReqdExctnDt><Dbtr><Nm>${xmlEsc(bank.fiscalName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${bank.iban.replace(/\s/g, "")}</IBAN></Id></DbtrAcct>${bank.bic ? `<DbtrAgt><FinInstnId><BIC>${xmlEsc(bank.bic)}</BIC></FinInstnId></DbtrAgt>` : ""}<ChrgBr>SLEV</ChrgBr>${txs}</PmtInf></CstmrCdtTrfInitn></Document>`;
    downloadBlob(new Blob([xml], { type: "application/xml" }), `SEPA_${safeName(forecast.name)}_${sepa.date}.xml`);
    setSepa((s) => ({ ...s, open: false }));
    toast.success(`Fichero SEPA con ${list.length} ${list.length === 1 ? "pago" : "pagos"}`);
  };

  // ── Paquete para contabilidad ────────────────────────────────────────────
  const buildPackage = async () => {
    if (!forecast) return;
    setBusy("zip");
    try {
      const files: Record<string, Uint8Array> = {};
      const seen = new Map<string, string>();
      const rows = [["Estado", "Proveedor", "Factura", "Concepto", "Importe", "Fecha de pago", "Pagado por", "Justificante"]];
      for (const it of items) {
        let fname = "";
        if (it.receiptUrl) {
          if (seen.has(it.receiptUrl)) fname = seen.get(it.receiptUrl)!;
          else {
            const ext = (it.receiptName || "").match(/\.[a-z0-9]+$/i)?.[0] || ".pdf";
            fname = `Justificantes/${safeName(numberOf(it) || it.id)}_${safeName(it.supplier).slice(0, 40)}${ext}`;
            const r = await fetch(`/api/storage-proxy?url=${encodeURIComponent(it.receiptUrl)}`);
            if (r.ok) { files[fname] = new Uint8Array(await r.arrayBuffer()); seen.set(it.receiptUrl, fname); } else fname = "(no disponible)";
          }
        }
        rows.push([it.status === "completed" ? "Pagado" : "Pendiente", it.supplier, numberOf(it), it.description, amountOf(it).toFixed(2).replace(".", ","), it.completedAt ? it.completedAt.toLocaleDateString("es-ES") : "", it.completedByName || "", fname]);
      }
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
      files["resumen.csv"] = strToU8(csv);
      const zip = zipSync(files, { level: 0 });
      downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${safeName(forecast.name)}_justificantes.zip`);
      toast.success("Paquete descargado");
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  // ── Arrastrar en toda la página ──────────────────────────────────────────
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragging(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e: DragEvent) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); setDragging(false); receive(Array.from(e.dataTransfer.files)); };
    window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  });

  // ── Render ───────────────────────────────────────────────────────────────
  if (permLoading || loading) return <PageLoading />;
  if (permError || !canAccess) {
    return (
      <Page>
        <PageHeader title="Pagos" />
        <div className="mt-6"><EmptyState title="Pagos es solo para contabilidad ampliada" action={<Link href={`/project/${id}/accounting`} className="text-[13px] text-slate-700 underline">Volver al panel</Link>} /></div>
      </Page>
    );
  }
  if (!forecast) return null;

  const progress = items.length ? Math.round((done.length / items.length) * 100) : 0;
  const allPendingSelected = pending.length > 0 && pending.every((i) => selected.has(i.id));
  const optionLabel = (it: PaymentItem) => `${numberOf(it) ? `${numberOf(it)} · ` : ""}${it.supplier} · ${money(amountOf(it))}`;

  return (
    <Page>
      <Link href={`/project/${id}/accounting/payments`} className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Pagos</Link>
      <PageHeader
        title={<>{forecast.name} <span className="text-[15px] font-normal text-slate-400">{forecast.type === "remesa" ? "Remesa" : "Fuera de remesa"} · {dateEs(forecast.paymentDate)}</span></>}
        actions={
          <>
            <Button onClick={buildPackage} disabled={busy === "zip" || totals.withReceipt === 0} title="Justificantes y resumen en un ZIP">
              {busy === "zip" ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />} Paquete para contabilidad
            </Button>
            <Button variant="primary" onClick={() => setSepa((s) => ({ ...s, open: true, onlySelected: selItems.length > 0 }))} disabled={!pending.length}><Download size={14} /> SEPA XML</Button>
          </>
        }
      />

      {/* Resumen */}
      <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 md:grid-cols-4">
        {[
          ["Total", money(totals.all), `${items.length} ${items.length === 1 ? "pago" : "pagos"}`],
          ["Pagado", money(totals.paid), `${done.length} de ${items.length}`],
          ["Pendiente", money(totals.pending), `${pending.length} ${pending.length === 1 ? "pago" : "pagos"}`],
          ["Justificantes", `${totals.withReceipt} de ${items.length}`, totals.withReceipt === items.length && items.length ? "Todo justificado" : `Faltan ${items.length - totals.withReceipt}`],
        ].map(([k, v, s], idx) => (
          <div key={k} className={`px-4 py-3 ${idx ? "border-l border-slate-100" : ""} ${idx === 2 ? "max-md:border-l-0 max-md:border-t" : ""} ${idx === 3 ? "max-md:border-t" : ""}`}>
            <p className="text-xs text-slate-500">{k}</p>
            <p className="mt-0.5 text-[17px] font-semibold tabular-nums text-slate-900">{v}</p>
            <p className="text-xs text-slate-500">{s}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[#F1F1F3]" aria-hidden="true"><div className="h-full bg-[#2F52E0] transition-all" style={{ width: `${progress}%` }} /></div>

      {/* Soltar justificantes */}
      <button type="button" onClick={() => fileInput.current?.click()}
        className={`mt-5 flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left transition ${dragging ? "border-[#2F52E0] bg-[#2F52E0]/[.05]" : "border-slate-300 hover:border-slate-400 hover:bg-[#FAFAFA]"}`}>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[#F1F1F3] text-slate-600"><Upload size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-slate-900">Suelta aquí los justificantes del banco</span>
          <span className="block text-xs text-slate-500">Varios a la vez. Te proponemos a qué pago va cada uno por el nombre del archivo o leyendo el PDF.</span>
        </span>
        <span className="text-xs font-medium text-slate-700">Elegir archivos</span>
      </button>
      <input ref={fileInput} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => { receive(Array.from(e.target.files || [])); e.target.value = ""; }} />
      <input ref={rowFileInput} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && rowTarget.current) setRowReceipt(rowTarget.current, f); e.target.value = ""; }} />

      {/* Tabla */}
      {items.length === 0 ? (
        <div className="mt-5"><EmptyState title="Esta previsión no tiene pagos" /></div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-600">
                <th scope="col" className="w-10 py-2 pl-4">
                  <input type="checkbox" aria-label="Seleccionar todos los pendientes" checked={allPendingSelected} disabled={!pending.length}
                    onChange={() => setSelected(allPendingSelected ? new Set() : new Set(pending.map((i) => i.id)))} className="h-3.5 w-3.5 accent-slate-900" />
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Pago</th>
                <th scope="col" className="w-44 px-3 py-2 text-left font-medium">Cuenta del proveedor</th>
                <th scope="col" className="w-24 px-3 py-2 text-left font-medium">Vence</th>
                <th scope="col" className="w-40 px-3 py-2 text-right font-medium">Importe</th>
                <th scope="col" className="w-56 px-3 py-2 text-left font-medium">Justificante</th>
                <th scope="col" className="w-36 px-3 py-2 text-left font-medium">Estado</th>
                <th scope="col" className="w-12 py-2 pr-3"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {[...pending, ...done].map((it) => {
                const paid = it.status === "completed";
                const iban = ibanOf(it);
                const cert = it.supplierId ? suppliers[it.supplierId]?.cert : undefined;
                const due = it.invoiceId ? invoices[it.invoiceId]?.dueDate : undefined;
                const overdue = !paid && due && due < new Date(new Date().toDateString());
                const num = numberOf(it);
                return (
                  <tr key={it.id} className={`border-b border-slate-100 last:border-0 ${selected.has(it.id) ? "bg-[#F7F8FE]" : "hover:bg-[#FAFAFA]"}`}>
                    <td className="py-2 pl-4 align-top">
                      {!paid && <input type="checkbox" aria-label={`Seleccionar ${it.supplier}`} checked={selected.has(it.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} className="mt-1 h-3.5 w-3.5 accent-slate-900" />}
                    </td>
                    <td className="px-3 py-2">
                      <p className="flex items-center gap-2">
                        <span className={`font-medium ${paid ? "text-slate-600" : "text-slate-900"}`}>{(it.supplierId && suppliers[it.supplierId]?.name) || it.supplier}</span>
                        {num && (it.invoiceId
                          ? <Link href={`/project/${id}/accounting/invoices/${it.invoiceId}`} className="font-mono text-[11px] text-slate-500 hover:text-slate-900">{num}</Link>
                          : <span className="font-mono text-[11px] text-slate-500">{num}</span>)}
                      </p>
                      <p className="truncate text-xs text-slate-500">{TYPE_LABEL[it.type] && it.type !== "invoice" ? `${TYPE_LABEL[it.type]} · ` : ""}{it.description || "Sin concepto"}</p>
                    </td>
                    <td className="px-3 py-2">
                      {iban ? (
                        <span className="flex items-center gap-1.5" title={iban.replace(/(.{4})/g, "$1 ").trim()}>
                          <span className="font-mono text-xs text-slate-700">···· {iban.slice(-4)}</span>
                          {cert === "verified" ? <ShieldCheck size={13} className="text-emerald-600" aria-label="Certificado verificado" /> : cert ? <ShieldAlert size={13} className="text-amber-600" aria-label="Sin certificado verificado" /> : null}
                        </span>
                      ) : <span className="text-xs text-red-700">Sin IBAN</span>}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${overdue ? "text-red-700" : "text-slate-600"}`}>{dateEs(due)}</td>
                    <td className="px-3 py-2 text-right">
                      {paid ? (
                        <span className="tabular-nums text-slate-900">{money(amountOf(it))}{it.partialAmount && it.partialAmount < it.amount - 0.005 ? <span className="block text-[11px] text-slate-500">de {money(it.amount)}</span> : null}</span>
                      ) : (
                        <span className="inline-flex flex-col items-end">
                          <span className="relative w-32">
                            <Input inputMode="decimal" aria-label={`Importe a pagar a ${it.supplier}`} value={String(amounts[it.id] ?? it.amount)}
                              onChange={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); setAmounts((a) => ({ ...a, [it.id]: isNaN(v) ? 0 : Math.min(v, it.amount) })); }}
                              className="h-8 pr-6 text-right tabular-nums" />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                          </span>
                          {(amounts[it.id] ?? it.amount) < it.amount - 0.005 && <span className="mt-0.5 text-[11px] text-amber-700">Parcial de {money(it.amount)}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {busy === it.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : it.receiptUrl ? (
                        <span className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setPreview({ url: it.receiptUrl!, name: it.receiptName, title: `Justificante · ${it.supplier}` })}
                            className="flex min-w-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:border-slate-300 hover:text-slate-900">
                            <Paperclip size={12} className="flex-shrink-0 text-slate-400" /><span className="max-w-[140px] truncate">{it.receiptName || "Justificante"}</span>
                          </button>
                          <IconButton label="Quitar justificante" onClick={() => setRowReceipt(it.id, null)}><X size={13} /></IconButton>
                        </span>
                      ) : (
                        <button type="button" onClick={() => { rowTarget.current = it.id; rowFileInput.current?.click(); }}
                          className="flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900">
                          <Upload size={12} /> Subir
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {paid ? (
                        <span className="text-xs">
                          <span className="flex items-center gap-1.5 text-slate-900"><span className="h-1.5 w-1.5 rounded-full bg-[#2F52E0]" />Pagado {dateEs(it.completedAt)}</span>
                          {it.completedByName && <span className="block pl-3 text-slate-500">{it.completedByName}</span>}
                        </span>
                      ) : <span className="flex items-center gap-1.5 text-xs text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Pendiente</span>}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                        {(close) => (
                          <>
                            {!paid && <MenuItem onClick={() => { close(); markPaid([it.id]); }}>Marcar como pagado</MenuItem>}
                            {it.receiptUrl
                              ? <MenuItem onClick={() => { close(); rowTarget.current = it.id; rowFileInput.current?.click(); }}>Cambiar justificante</MenuItem>
                              : <MenuItem onClick={() => { close(); rowTarget.current = it.id; rowFileInput.current?.click(); }}>Subir justificante</MenuItem>}
                            {it.invoiceId && invoices[it.invoiceId]?.attachmentUrl && <MenuItem onClick={() => { close(); setPreview({ url: invoices[it.invoiceId!]!.attachmentUrl!, title: `Factura ${num}` }); }}>Ver la factura</MenuItem>}
                            {paid && (<><MenuSeparator /><MenuItem onClick={() => { close(); undo(it.id); }}>Deshacer el pago</MenuItem></>)}
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
      <p className="mt-3 text-xs text-slate-500">Los justificantes se guardan también en cada factura: contabilidad los tiene en la factura y en el Centro de documentación.</p>

      {/* Barra de selección */}
      {selItems.length > 0 && (
        <div className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-lg">
          <span className="text-[13px] text-slate-900"><span className="font-medium tabular-nums">{selItems.length}</span> {selItems.length === 1 ? "pago" : "pagos"} · <span className="tabular-nums">{money(selItems.reduce((a, i) => a + amountOf(i), 0))}</span></span>
          <span className="text-xs text-slate-500">{selItems.filter((i) => !i.receiptUrl).length ? `${selItems.filter((i) => !i.receiptUrl).length} sin justificante` : "Todos con justificante"}</span>
          <span className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Quitar selección</Button>
            <Button onClick={() => setSepa((s) => ({ ...s, open: true, onlySelected: true }))}><Download size={14} /> SEPA de estos</Button>
            <Button variant="primary" onClick={() => markPaid(selItems.map((i) => i.id))} disabled={busy === "pay"}>{busy === "pay" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Marcar como pagados</Button>
          </span>
        </div>
      )}

      {/* Revisión de justificantes soltados */}
      <Modal open={incoming.length > 0} onClose={() => !busy && setIncoming([])} title={`Asignar ${incoming.length} ${incoming.length === 1 ? "justificante" : "justificantes"}`} width="max-w-3xl"
        footer={<>
          <Button variant="ghost" onClick={() => setIncoming([])} disabled={busy === "receipts"}>Cancelar</Button>
          <Button variant="primary" onClick={confirmIncoming} disabled={busy === "receipts" || !incoming.some((p) => p.target) || incoming.some((p) => p.reading)}>
            {busy === "receipts" ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : `Asignar ${incoming.filter((p) => p.target).length}`}
          </Button>
        </>}>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {incoming.map((p) => (
            <div key={p.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[13px] text-slate-900"><FileText size={13} className="flex-shrink-0 text-slate-400" />{p.file.name}</p>
                <p className="text-[11.5px] text-slate-500">
                  {p.reading ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Leyendo el PDF…</span>
                    : p.reasons.length && p.target && !p.target.startsWith("__") ? `Coincide por ${p.reasons.join(" y ")}` : p.target ? "Asignado a mano" : "Sin coincidencia: elige el pago"}
                </p>
              </div>
              <Select value={p.target} onChange={(e) => setIncoming((cur) => cur.map((x) => (x.key === p.key ? { ...x, target: e.target.value, reasons: [] } : x)))}>
                <option value="">Sin asignar</option>
                {selected.size > 1 && <option value={SELECTED}>{`Los ${selected.size} pagos seleccionados`}</option>}
                <option value={ALL_MISSING}>Todos los pendientes sin justificante</option>
                {items.map((it) => <option key={it.id} value={it.id}>{optionLabel(it)}{it.receiptUrl ? " (ya tiene)" : ""}</option>)}
              </Select>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Un mismo justificante puede servir para varios pagos: elige «pagos seleccionados» o «todos los pendientes sin justificante».</p>
      </Modal>

      {/* SEPA */}
      <Modal open={sepa.open} onClose={() => setSepa((s) => ({ ...s, open: false }))} title="Fichero SEPA"
        footer={<><Button variant="ghost" onClick={() => setSepa((s) => ({ ...s, open: false }))}>Cancelar</Button><Button variant="primary" onClick={generateSepa} disabled={!banks.length}><Download size={14} /> Descargar XML</Button></>}>
        {banks.length === 0 ? (
          <p className="text-[13px] text-slate-700">Añade una cuenta ordenante en <Link href={`/project/${id}/accounting/config`} className="underline">Configuración › Empresa</Link>.</p>
        ) : (
          <div className="space-y-4">
            <Field label="Cuenta ordenante">
              <Select value={sepa.bankId} onChange={(e) => setSepa((s) => ({ ...s, bankId: e.target.value }))}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.alias} · ···· {b.iban.replace(/\s/g, "").slice(-4)}</option>)}
              </Select>
            </Field>
            <Field label="Fecha de ejecución"><Input type="date" value={sepa.date} onChange={(e) => setSepa((s) => ({ ...s, date: e.target.value }))} /></Field>
            <div className="rounded-md border border-slate-200 px-3 py-2 text-[13px]">
              <p className="text-slate-900">{sepaItems.length - sepaNoIban.length} {sepaItems.length - sepaNoIban.length === 1 ? "pago" : "pagos"} · <span className="tabular-nums">{money(sepaItems.filter((i) => ibanOf(i)).reduce((a, i) => a + amountOf(i), 0))}</span></p>
              {sepaNoIban.length > 0 && <p className="mt-1 text-xs text-amber-800">Quedan fuera {sepaNoIban.length} sin IBAN: {sepaNoIban.map((i) => i.supplier).join(", ")}.</p>}
              {selItems.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={sepa.onlySelected} onChange={(e) => setSepa((s) => ({ ...s, onlySelected: e.target.checked }))} className="h-3.5 w-3.5 accent-slate-900" /> Solo los {selItems.length} seleccionados
                </label>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Pagar sin justificante */}
      <Modal open={!!confirmMissing} onClose={() => setConfirmMissing(null)} title="Pagos sin justificante"
        footer={<><Button variant="ghost" onClick={() => setConfirmMissing(null)}>Volver</Button><Button variant="primary" onClick={() => confirmMissing && markPaid(confirmMissing, true)}>Marcar igualmente</Button></>}>
        <p className="text-[13px] text-slate-700">
          {confirmMissing?.filter((i) => !items.find((x) => x.id === i)?.receiptUrl).length} de {confirmMissing?.length} no tienen justificante. Puedes subirlo después: la factura quedará marcada como «Pagada sin justificante» para contabilidad hasta entonces.
        </p>
      </Modal>

      {/* Vista previa */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title || ""} width="max-w-4xl"
        footer={preview ? <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-slate-700 hover:text-slate-900">Abrir en otra pestaña <ExternalLink size={12} /></a> : undefined}>
        {preview && (isPdf(preview.url, preview.name)
          ? <iframe title={preview.title} src={preview.url} className="h-[70vh] w-full rounded-md border border-slate-200" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={preview.url} alt={preview.title} className="max-h-[70vh] w-full rounded-md object-contain" />)}
      </Modal>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-[#2F52E0]/[.06]">
          <div className="rounded-xl border-2 border-dashed border-[#2F52E0] bg-white px-8 py-6 text-center shadow-lg">
            <Upload size={22} className="mx-auto text-[#2F52E0]" />
            <p className="mt-2 text-[14px] font-medium text-slate-900">Suelta los justificantes</p>
            <p className="text-xs text-slate-500">Te proponemos a qué pago va cada uno</p>
          </div>
        </div>
      )}
    </Page>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
