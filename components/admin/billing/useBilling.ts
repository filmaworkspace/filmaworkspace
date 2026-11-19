"use client";

// Facturas y presupuestos de Filma en tiempo real (todas, o las de una cuenta)
// y los datos fiscales de Filma.

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { BillingInvoice, BillingQuote, BillingSettings, DEFAULT_SETTINGS, fetchBillingSettings } from "@/lib/billing";

const byNewest = <T extends { issueDate?: string; createdAt?: { toMillis: () => number } | null }>(a: T, b: T) =>
  (b.issueDate || "").localeCompare(a.issueDate || "") || (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);

export function useBilling(producerId?: string) {
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [quotes, setQuotes] = useState<BillingQuote[]>([]);
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const inv = producerId ? query(collection(db, "billingInvoices"), where("producerId", "==", producerId)) : collection(db, "billingInvoices");
    const quo = producerId ? query(collection(db, "billingQuotes"), where("producerId", "==", producerId)) : collection(db, "billingQuotes");
    let n = 0;
    const done = () => { n += 1; if (n >= 2) setLoading(false); };
    const u1 = onSnapshot(inv, (s) => { setInvoices(s.docs.map((d) => ({ id: d.id, ...d.data() } as BillingInvoice)).sort(byNewest)); done(); }, () => done());
    const u2 = onSnapshot(quo, (s) => { setQuotes(s.docs.map((d) => ({ id: d.id, ...d.data() } as BillingQuote)).sort(byNewest)); done(); }, () => done());
    fetchBillingSettings(db).then(setSettings);
    return () => { u1(); u2(); };
  }, [producerId]);

  return { invoices, quotes, settings, setSettings, loading };
}

/** Estado de cobro de una factura emitida. */
export function invoiceState(i: BillingInvoice): { label: string; tone: "none" | "info" | "ok" | "warn" | "bad" } {
  if (i.status === "draft") return { label: "Borrador", tone: "none" };
  if (i.status === "voided") return { label: "Anulada", tone: "none" };
  if (i.kind === "rectifying") return { label: "Rectificativa", tone: "info" };
  if (i.paid) return { label: "Cobrada", tone: "ok" };
  const today = new Date().toISOString().slice(0, 10);
  if (i.dueDate && i.dueDate < today) return { label: "Vencida", tone: "bad" };
  return { label: "Pendiente de cobro", tone: "warn" };
}

/** Solo los datos fiscales de Filma. */
export function useBillingSettings() {
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_SETTINGS);
  useEffect(() => { fetchBillingSettings(db).then(setSettings); }, []);
  return settings;
}
