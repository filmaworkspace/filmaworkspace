"use client";

// Enviar a firmar con Filma Sign: firmante, mensaje y la firma de Filma
// (se firma al enviar). Sirve para presupuestos y para documentos de texto.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ds";
import { useAdminDataOptional } from "@/components/admin/AdminData";
import { useUser } from "@/contexts/UserContext";
import { adminFetch } from "@/components/admin/ui";
import { SignaturePad, type SignatureValue } from "./SignaturePad";
import { SIGN_DOC_TYPES, SIGN_TEMPLATES, type SignDocType, type SignKind } from "@/lib/sign/types";

const LS_SIG = "filma-sign:last";
const readSig = (): SignatureValue | null => { try { const v = localStorage.getItem(LS_SIG); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeSig = (v: SignatureValue) => { try { localStorage.setItem(LS_SIG, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

export function SendToSignModal({ open, onClose, kind, quoteId, projectId, defaultSigner, issuerRole, onSent }: {
  open: boolean;
  onClose: () => void;
  kind: SignKind;
  quoteId?: string;
  /** Envío desde un proyecto (Equipo › Filma Sign). */
  projectId?: string;
  defaultSigner?: { name?: string; email?: string; role?: string };
  issuerRole?: string;
  onSent?: (r: { id: string; url: string }) => void;
}) {
  const { user } = useUser();
  // En el admin se elige a qué cuenta se imputa; en un proyecto va sola a su cuenta.
  const admin = useAdminDataOptional();
  const producers = admin?.producers || [], projects = admin?.projects || [];
  const [billTo, setBillTo] = useState({ producerId: "", projectId: "" });
  const [signer, setSigner] = useState({ name: "", email: "", role: "" });
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<SignDocType>("employment");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [me, setMe] = useState({ name: "", role: "" });
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [saved, setSaved] = useState<SignatureValue | null>(null);
  const [useSaved, setUseSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; url: string; emailError: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSigner({ name: defaultSigner?.name || "", email: defaultSigner?.email || "", role: defaultSigner?.role || "" });
    setTitle(""); setDocType("employment"); setBody(""); setMessage(""); setError(""); setDone(null); setCopied(false); setBillTo({ producerId: "", projectId: "" });
    setMe({ name: user?.name || "", role: issuerRole || "Filma Workspace" });
    const s = readSig(); setSaved(s); setUseSaved(!!s); setSig(null);
  }, [open, defaultSigner?.name, defaultSigner?.email, defaultSigner?.role, user?.name, issuerRole]);

  const onSig = useCallback((v: SignatureValue | null) => setSig(v), []);
  const signature = useSaved ? saved : sig;

  const send = async () => {
    setBusy(true); setError("");
    try {
      if (!signature) throw new Error("Firma antes de enviar");
      const r = await adminFetch<{ id: string; url: string; emailError: string | null }>(projectId ? `/api/projects/${projectId}/sign` : "/api/admin/sign", {
        action: "create", kind, quoteId, title, body, docType, signer, message, signature, issuerName: me.name, issuerRole: me.role,
        billTo: billTo.producerId ? { ...billTo, projectName: projects.find((p) => p.id === billTo.projectId)?.name || null } : null,
      });
      writeSig(signature);
      setDone(r);
      onSent?.(r);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (done) return (
    <Modal open={open} onClose={onClose} title="Enviado a firmar" width="max-w-lg"
      footer={<Button variant="primary" onClick={onClose}>Hecho</Button>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-slate-700">{done.emailError ? <span className="text-red-600">No se ha podido enviar el email ({done.emailError}). Comparte el enlace a mano:</span> : <>Le hemos enviado el enlace a <strong>{signer.email}</strong>. También puedes compartirlo tú:</>}</p>
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-[#FAFAFA] px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-slate-600">{done.url}</span>
          <button onClick={() => { navigator.clipboard.writeText(done.url).then(() => setCopied(true)); }} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-slate-500">El enlace es personal. Cuando firme, las dos partes recibiréis el PDF firmado.</p>
      </div>
    </Modal>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Firmar con Filma Sign · ${SIGN_TEMPLATES[kind].label}`} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={send} disabled={busy || !signature || !signer.email || !signer.name || (kind === "document" && (!title.trim() || !body.trim()))}>{busy ? "Enviando…" : "Firmar y enviar"}</Button></>}>
      <div className="flex flex-col gap-5">
        {kind === "document" && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[220px_1fr] gap-3">
              <Field label="Tipo">
                <Select value={docType} onChange={(e) => setDocType(e.target.value as SignDocType)}>
                  {(Object.keys(SIGN_DOC_TYPES) as SignDocType[]).map((k) => <option key={k} value={k}>{SIGN_DOC_TYPES[k]}</option>)}
                </Select>
              </Field>
              <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${SIGN_DOC_TYPES[docType]} · nombre`} /></Field>
            </div>
            <Field label="Texto"><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          </div>
        )}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-600">Firmante</p>
          <div className="grid grid-cols-[1fr_1fr_160px] gap-3">
            <Input value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} placeholder="Nombre y apellidos" />
            <Input value={signer.email} onChange={(e) => setSigner({ ...signer, email: e.target.value })} placeholder="Email" type="email" />
            <Input value={signer.role} onChange={(e) => setSigner({ ...signer, role: e.target.value })} placeholder="Cargo / empresa" />
          </div>
        </div>
        {kind === "document" && admin && !projectId && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Se imputa a la cuenta">
              <Select value={billTo.producerId} onChange={(e) => setBillTo({ producerId: e.target.value, projectId: "" })}>
                <option value="">Ninguna (uso de Filma)</option>
                {producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            {billTo.producerId && (
              <Field label="Proyecto">
                <Select value={billTo.projectId} onChange={(e) => setBillTo({ ...billTo, projectId: e.target.value })}>
                  <option value="">Sin proyecto</option>
                  {projects.filter((p) => p.producers.includes(billTo.producerId) && !p.trashedAt).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
        )}
        <Field label="Mensaje (opcional)"><Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Te paso el presupuesto para que lo firmes." /></Field>
        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 grid grid-cols-2 gap-3">
            <Field label="Firma por Filma"><Input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} /></Field>
            <Field label="Cargo"><Input value={me.role} onChange={(e) => setMe({ ...me, role: e.target.value })} /></Field>
          </div>
          {saved && useSaved ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={saved.image} alt="Tu firma" className="h-12 object-contain" />
              <span className="flex-1 text-xs text-slate-500">Tu última firma</span>
              <Button size="sm" variant="ghost" onClick={() => setUseSaved(false)}>Firmar de nuevo</Button>
            </div>
          ) : <SignaturePad onChange={onSig} defaultName={me.name} height={150} />}
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
