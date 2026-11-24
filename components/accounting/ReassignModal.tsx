"use client";

// ─── Reasignar PO o factura (contabilidad ampliada) ──────────────────────────
// Cambia a quién pertenece el documento y su departamento: lo que decide quién
// lo ve (el responsable, su departamento) y, si está pendiente, quién lo
// aprueba (se recalcula el circuito). Queda registrado en el documento.

import { useEffect, useState } from "react";
import { arrayUnion, collection, doc, getDoc, getDocs, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button, Field, Modal, Select, Textarea } from "@/components/ds";
import { isAwaitingApproval, loadFlowContext, rebuildDoc, type FlowDocType } from "@/lib/approvalActions";
import { approverIdsOf } from "@/lib/approvers";
import { toast } from "@/lib/toast";

export interface ReassignTarget {
  id: string;
  label: string;
  createdBy?: string;
  createdByName?: string;
  department?: string | null;
}

export function ReassignModal({ open, onClose, projectId, kind, target, actor, onDone }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  kind: FlowDocType;
  target: ReassignTarget | null;
  actor: { uid: string; name: string };
  onDone: (patch: { createdBy: string; createdByName: string; department: string }) => void;
}) {
  const [members, setMembers] = useState<{ id: string; name: string; department?: string; role?: string }[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [dept, setDept] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    setOwner(target.createdBy || ""); setDept(target.department || ""); setReason("");
    Promise.all([getDocs(collection(db, `projects/${projectId}/members`)), getDoc(doc(db, "projects", projectId))]).then(([ms, ps]) => {
      setMembers(ms.docs.map((m) => ({ id: m.id, name: m.data().name || m.data().email || m.id, department: m.data().department || "", role: m.data().role || m.data().position || "" }))
        .filter((m) => ms.docs.find((x) => x.id === m.id)?.data().permissions?.accounting !== false)
        .sort((a, b) => a.name.localeCompare(b.name, "es")));
      setDepartments((ps.data()?.departments as string[]) || []);
    }).catch(() => {});
  }, [open, target, projectId]);

  if (!target) return null;
  const ownerName = members.find((m) => m.id === owner)?.name || target.createdByName || "";
  const changed = owner !== (target.createdBy || "") || dept !== (target.department || "");
  const deptOptions = Array.from(new Set([...departments, target.department || "", dept].filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));

  const save = async () => {
    setBusy(true);
    try {
      const ref = doc(db, `projects/${projectId}/${kind === "po" ? "pos" : "invoices"}`, target.id);
      const snap = await getDoc(ref);
      const before = snap.data() || {};
      await updateDoc(ref, {
        createdBy: owner, createdByName: ownerName, department: dept || null,
        reassignments: arrayUnion({
          at: Timestamp.now(), byUid: actor.uid, byName: actor.name, reason: reason.trim() || null,
          fromUser: before.createdByName || null, toUser: ownerName, fromDepartment: before.department || null, toDepartment: dept || null,
        }),
      });
      // Pendiente de aprobación: el circuito depende del departamento.
      if (isAwaitingApproval(kind, before) && (before.department || "") !== dept) {
        const ctx = await loadFlowContext(projectId);
        await rebuildDoc(projectId, kind, target.id, actor, ctx, "Departamento cambiado al reasignar");
        const after = (await getDoc(ref)).data();
        if (after) await updateDoc(ref, { approverIds: approverIdsOf(after.approvalSteps) }).catch(() => {});
      }
      toast.success(`${target.label} reasignada`);
      onDone({ createdBy: owner, createdByName: ownerName, department: dept });
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Reasignar ${target.label}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save} disabled={busy || !changed || !owner}>{busy ? "Guardando…" : "Reasignar"}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Responsable">
          <Select value={owner} onChange={(e) => {
            setOwner(e.target.value);
            const m = members.find((x) => x.id === e.target.value);
            if (m?.department) setDept(m.department);
          }}>
            {!members.some((m) => m.id === owner) && owner && <option value={owner}>{target.createdByName || owner}</option>}
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` · ${m.role}` : ""}{m.department ? ` · ${m.department}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Departamento">
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Sin departamento</option>
            {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Motivo"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional. Queda en el historial del documento." /></Field>
        <p className="text-xs text-slate-500">
          El responsable y su departamento deciden quién ve el documento. Si está pendiente de aprobación, el circuito se recalcula con el nuevo departamento.
        </p>
      </div>
    </Modal>
  );
}
