"use client";

// Proveedor de una PO / factura: nombre bien visible y vista previa de sus
// datos (fiscales, contacto, pago y certificados) sin salir del documento.

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { Building2, ExternalLink } from "lucide-react";
import { db } from "@/lib/firebase";
import { Modal, Spinner } from "@/components/ds";

type Sup = Record<string, any>;
const fmtDate = (v: any) => { const d = v?.toDate ? v.toDate() : v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toLocaleDateString("es-ES") : "—"; };
const PAY: Record<string, string> = { transferencia: "Transferencia", transfer: "Transferencia", tarjeta: "Tarjeta", card: "Tarjeta", efectivo: "Efectivo", cash: "Efectivo", domiciliacion: "Domiciliación", direct_debit: "Domiciliación" };

export function SupplierHeader({ projectId, supplierId: givenId, name, meta }: { projectId: string; supplierId?: string | null; name: string; meta?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Documentos antiguos sin id de proveedor: se busca por nombre fiscal.
  const [supplierId, setSupplierId] = useState<string | null>(givenId || null);
  useEffect(() => {
    if (givenId) { setSupplierId(givenId); return; }
    if (!name) return;
    getDocs(query(collection(db, `projects/${projectId}/suppliers`), where("fiscalName", "==", name), limit(1)))
      .then((r) => setSupplierId(r.docs[0]?.id || null)).catch(() => setSupplierId(null));
  }, [givenId, name, projectId]);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <Building2 size={18} className="shrink-0 text-slate-400" />
        <span className="truncate text-lg font-semibold tracking-tight text-slate-900">{name || "Sin proveedor"}</span>
      </div>
      {meta && <span className="text-[13px] text-slate-500">{meta}</span>}
      {supplierId && (
        <button onClick={() => setOpen(true)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900">
          Ver proveedor
        </button>
      )}
      {supplierId && <SupplierModal open={open} onClose={() => setOpen(false)} projectId={projectId} supplierId={supplierId} />}
    </div>
  );
}

export function SupplierModal({ open, onClose, projectId, supplierId }: { open: boolean; onClose: () => void; projectId: string; supplierId: string }) {
  const [s, setS] = useState<Sup | null | undefined>(undefined);
  useEffect(() => {
    if (!open || s !== undefined) return;
    getDoc(doc(db, `projects/${projectId}/suppliers`, supplierId)).then((d) => setS(d.exists() ? d.data() : null)).catch(() => setS(null));
  }, [open, s, projectId, supplierId]);
  const a = s?.address || {};
  const addr = [[a.street, a.number].filter(Boolean).join(" "), [a.postalCode, a.city].filter(Boolean).join(" "), a.province].filter(Boolean).join(", ");
  const cert = (c: Sup | undefined) => !c?.uploaded ? "No subido" : `${c.verified ? "Verificado" : "Subido"}${c.expiryDate ? ` · caduca ${fmtDate(c.expiryDate)}` : ""}`;
  return (
    <Modal open={open} onClose={onClose} title={s?.fiscalName || "Proveedor"} width="max-w-lg"
      footer={<Link href={`/project/${projectId}/accounting/suppliers/${supplierId}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700 hover:text-slate-900"><ExternalLink size={13} /> Abrir ficha</Link>}>
      {s === undefined ? <div className="flex justify-center py-8"><Spinner /></div> : s === null ? <p className="text-[13px] text-slate-500">No se ha encontrado el proveedor.</p> : (
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[13px]">
          {[
            ["Nombre comercial", s.commercialName],
            ["NIF", <span key="n" className="font-mono">{s.taxId || "—"}</span>],
            ["Dirección", addr],
            ["Contacto", [s.contact?.name, s.contact?.email, s.contact?.phone].filter(Boolean).join(" · ")],
            ["Forma de pago", PAY[s.paymentMethod] || s.paymentMethod],
            ["IBAN", s.bankAccount ? <span key="i" className="font-mono">{s.bankAccount}</span> : ""],
            ["BIC", s.bic ? <span key="b" className="font-mono">{s.bic}</span> : ""],
            ["Titularidad", cert(s.certificates?.bankOwnership)],
            ["Contratistas", cert(s.certificates?.contractorsCertificate)],
          ].map(([k, v]) => (
            <div key={String(k)} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="min-w-0 break-words text-slate-900">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}
