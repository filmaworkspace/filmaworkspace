// Helpers for the split invoice data model.
//
// `status` now only encodes lifecycle: "draft" | "submitted" | "cancelled" | "rejected" | "void".
// Everything else lives in independent track fields:
//   - codedAt / codedBy / codedByName
//   - approvedAt / approvedBy / approvedByName
//   - accountedAt / accountedBy / accountedByName
//   - paidAt / paidBy / paidByName
//
// Old docs may still carry legacy status values (pending_approval, pending,
// overdue, coded, accounted, paid). These helpers stay backwards compatible.

export type InvoiceDisplayState =
  | "draft"
  | "submitted"
  | "approved"
  | "coded"
  | "accounted"
  | "paid"
  | "overdue"
  | "cancelled"
  | "rejected"
  | "void"
  | "returned"
  | "partial_return";

export function getInvoiceDisplayState(invoice: {
  status: string;
  codedAt?: any;
  approvedAt?: any;
  accountedAt?: any;
  paidAt?: any;
  dueDate?: Date | null;
  totalReturned?: number;
}): InvoiceDisplayState {
  // Guarantee return states (kept as-is, driven by status)
  if (invoice.status === "returned") return "returned";
  if (invoice.status === "partial_return") return "partial_return";

  // Terminal lifecycle states
  if (invoice.status === "cancelled") return "cancelled";
  if (invoice.status === "rejected") return "rejected";
  if (invoice.status === "void") return "void";
  if (invoice.status === "draft") return "draft";

  // Tracks + legacy status values (order matters for display priority).
  if (invoice.status === "paid" || invoice.paidAt) return "paid";
  if (invoice.status === "accounted" || invoice.accountedAt) return "accounted";
  if (invoice.status === "coded" || invoice.codedAt) return "coded";
  if (invoice.status === "pending" || invoice.approvedAt) return "approved";

  // submitted / pending_approval / overdue
  if (invoice.dueDate && invoice.dueDate < new Date()) return "overdue";
  return "submitted";
}

// Normalize invoices loaded from Firestore that may have old status values.
// Any legacy "active" status collapses to "submitted"; the track fields carry
// the detailed state.
export function normalizeInvoiceStatus(status: string): string {
  const oldToNew: Record<string, string> = {
    pending_approval: "submitted",
    pending: "submitted",
    overdue: "submitted",
    coded: "submitted",
    accounted: "submitted",
    paid: "submitted",
  };
  return oldToNew[status] || status;
}

export function normalizeInvoiceData(data: any): any {
  if (!data) return data;
  const mapped = normalizeInvoiceStatus(data.status);
  if (mapped === data.status) return data;
  return { ...data, status: mapped };
}

// True when an invoice is in an "active in the system" lifecycle state,
// accounting for legacy status values still present in Firestore.
export function isActiveInvoiceStatus(status: string): boolean {
  return [
    "submitted",
    "pending_approval",
    "pending",
    "overdue",
    "coded",
    "accounted",
    "paid",
  ].includes(status);
}

// Status values to use in Firestore `where("status", "in", [...])` queries that
// need to match both new "submitted" docs and legacy active docs.
export const ACTIVE_STATUS_VALUES = [
  "submitted",
  "pending_approval",
  "pending",
  "overdue",
  "coded",
  "accounted",
  "paid",
];

export function isOverdue(invoice: {
  status: string;
  paidAt?: any;
  dueDate?: Date | null;
}): boolean {
  return (
    !invoice.paidAt &&
    !!invoice.dueDate &&
    invoice.dueDate < new Date() &&
    isActiveInvoiceStatus(invoice.status)
  );
}
