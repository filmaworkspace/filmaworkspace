import { describe, expect, it } from "vitest";
import {
  applyApproval, applyRejection, buildFlow, canApprove, pendingSummary, rebuildFlow, repairFlow, stepApplies,
  type ApprovalStepConfig, type ApprovalStepState, type FlowMember,
} from "@/lib/approvalFlow";

const acc = { accounting: true };
const members: FlowMember[] = [
  { userId: "ep", name: "Marta (EP)", role: "EP" },
  { userId: "pm", name: "Ana (PM)", role: "PM" },
  { userId: "ctrl", name: "Jorge (Controller)", role: "Controller" },
  { userId: "hodArte", name: "Lucía (HOD Arte)", position: "HOD", department: "Arte", permissions: acc },
  { userId: "hodFoto", name: "Raúl (HOD Foto, sin contabilidad)", position: "HOD", department: "Fotografía", permissions: { accounting: false } },
  { userId: "coordArte", name: "Pablo (Coord. Arte)", position: "Coordinator", department: "Arte", permissions: acc },
  { userId: "crew", name: "Eva (crew)", position: "Crew", department: "Arte", permissions: acc },
];
const step = (p: Partial<ApprovalStepConfig>): ApprovalStepConfig => ({ id: p.id || Math.random().toString(36).slice(2), order: p.order || 1, approverType: "role", requireAll: false, ...p });

describe("construcción del flujo", () => {
  it("omite el paso HOD si el departamento no tiene HOD y sigue con el siguiente", () => {
    const f = buildFlow([step({ id: "h", order: 1, approverType: "hod" }), step({ id: "r", order: 2, roles: ["PM"] })], members, { department: "Sonido", baseAmount: 100 });
    expect(f.steps[0].status).toBe("skipped");
    expect(f.steps[0].skipReason).toContain("Sonido no tiene HOD");
    expect(f.currentApprovalStep).toBe(1);
    expect(f.complete).toBe(false);
  });

  it("si todos los pasos se omiten, el documento queda aprobado", () => {
    const f = buildFlow([step({ approverType: "hod" }), step({ approverType: "coordinator", order: 2 })], members, { department: "Sonido", baseAmount: 100 });
    expect(f.complete).toBe(true);
    expect(f.currentApprovalStep).toBe(-1);
  });

  it("sin configuración, aprobado", () => {
    expect(buildFlow([], members, { department: "Arte", baseAmount: 1 }).complete).toBe(true);
  });

  it("el HOD sale del departamento del documento cuando el paso no fija uno", () => {
    const f = buildFlow([step({ approverType: "hod" })], members, { department: "Arte", baseAmount: 100 });
    expect(f.steps[0].approvers).toEqual(["hodArte"]);
    expect(f.approverIds).toEqual(["hodArte"]);
  });

  it("no asigna a quien no tiene acceso a contabilidad (no podría ver el documento)", () => {
    const f = buildFlow([step({ approverType: "hod" })], members, { department: "Fotografía", baseAmount: 100 });
    expect(f.steps[0].status).toBe("skipped");
    expect(f.steps[0].skipReason).toContain("no tiene acceso a contabilidad");
  });

  it("personas concretas que ya no están en el proyecto: omitido", () => {
    const f = buildFlow([step({ approverType: "fixed", approvers: ["fuera"] })], members, { department: "Arte", baseAmount: 1 });
    expect(f.steps[0].status).toBe("skipped");
    expect(f.complete).toBe(true);
  });

  it("umbrales sobre la base imponible", () => {
    expect(stepApplies(step({ hasAmountThreshold: true, amountThreshold: 1000, amountCondition: "above" }), 1000)).toBe(false);
    expect(stepApplies(step({ hasAmountThreshold: true, amountThreshold: 1000, amountCondition: "above" }), 1000.01)).toBe(true);
    expect(stepApplies(step({ hasAmountThreshold: true, amountThreshold: 1000, amountCondition: "below" }), 999)).toBe(true);
    expect(stepApplies(step({ hasAmountThreshold: true, amountThreshold: 1000, amountCondition: "between", amountThresholdMax: 5000 }), 5000)).toBe(true);
    expect(stepApplies(step({ hasAmountThreshold: true, amountThreshold: 1000, amountCondition: "between", amountThresholdMax: 5000 }), 5001)).toBe(false);
    const f = buildFlow([step({ id: "a", roles: ["PM"] }), step({ id: "b", order: 2, roles: ["EP"], hasAmountThreshold: true, amountThreshold: 5000, amountCondition: "above" })], members, { department: "Arte", baseAmount: 1200 });
    expect(f.steps[1].status).toBe("skipped");
    expect(f.steps[1].skipReason).toBe("No aplica por importe");
  });

  it("respeta el orden configurado aunque venga desordenado", () => {
    const f = buildFlow([step({ id: "2", order: 2, roles: ["EP"] }), step({ id: "1", order: 1, roles: ["PM"] })], members, { department: "Arte", baseAmount: 1 });
    expect(f.steps.map((s) => s.id)).toEqual(["1", "2"]);
  });
});

describe("aprobar", () => {
  const flow = () => buildFlow([
    step({ id: "h", approverType: "hod" }),
    step({ id: "x", order: 2, approverType: "coordinator", department: "Sonido" }), // se omite
    step({ id: "r", order: 3, roles: ["PM", "EP"], requireAll: true }),
  ], members, { department: "Arte", baseAmount: 500 });

  it("solo puede aprobar quien está en el paso actual", () => {
    const f = flow();
    const doc = { approvalSteps: f.steps, currentApprovalStep: f.currentApprovalStep };
    expect(canApprove(doc, "hodArte")).toBe(true);
    expect(canApprove(doc, "pm")).toBe(false);
    expect(canApprove(doc, "crew")).toBe(false);
    expect(() => applyApproval(doc, "pm", "Ana", new Date())).toThrow();
  });

  it("avanza saltando el paso omitido y exige a TODAS las personas cuando es 'todos'", () => {
    const f = flow();
    let doc: { approvalSteps: ApprovalStepState[]; currentApprovalStep: number } = { approvalSteps: f.steps, currentApprovalStep: f.currentApprovalStep };
    let r = applyApproval(doc, "hodArte", "Lucía", new Date());
    expect(r.stepCompleted).toBe(true);
    expect(r.currentApprovalStep).toBe(2); // salta el 1 (omitido)
    doc = { approvalSteps: r.steps, currentApprovalStep: r.currentApprovalStep };
    r = applyApproval(doc, "pm", "Ana", new Date());
    expect(r.complete).toBe(false);
    expect(r.currentApprovalStep).toBe(2);
    expect(pendingSummary({ approvalSteps: r.steps, currentApprovalStep: r.currentApprovalStep }).waitingFor.map((w) => w.uid)).toEqual(["ep"]);
    doc = { approvalSteps: r.steps, currentApprovalStep: r.currentApprovalStep };
    expect(() => applyApproval(doc, "pm", "Ana", new Date())).toThrow(); // no aprueba dos veces
    r = applyApproval(doc, "ep", "Marta", new Date());
    expect(r.complete).toBe(true);
    expect(r.currentApprovalStep).toBe(-1);
  });

  it("'basta uno' se completa con la primera aprobación", () => {
    const f = buildFlow([step({ roles: ["PM", "EP"] })], members, { department: "Arte", baseAmount: 1 });
    const r = applyApproval({ approvalSteps: f.steps, currentApprovalStep: 0 }, "ep", "Marta", new Date());
    expect(r.complete).toBe(true);
  });

  it("rechazar deja el paso y el documento rechazados", () => {
    const f = flow();
    const r = applyRejection({ approvalSteps: f.steps, currentApprovalStep: 0 }, "hodArte", "Lucía", new Date());
    expect(r.steps[0].status).toBe("rejected");
    expect(pendingSummary({ approvalSteps: r.steps, currentApprovalStep: 0 }).state).toBe("rejected");
  });
});

describe("flujos heredados y cambios de configuración", () => {
  it("repara un flujo atascado en un paso sin aprobador (lógica antigua)", () => {
    const legacy = {
      baseAmount: 300,
      currentApprovalStep: 0,
      approvalSteps: [
        { id: "a", order: 1, approverType: "hod", approvers: [], approverNames: [], approvedBy: [], rejectedBy: [], status: "pending", requireAll: false },
        { id: "b", order: 2, approverType: "role", roles: ["PM"], approvers: ["pm"], approverNames: ["Ana"], approvedBy: [], rejectedBy: [], status: "pending", requireAll: false },
      ] as ApprovalStepState[],
    };
    expect(pendingSummary(legacy).state).toBe("blocked");
    const r = repairFlow(legacy);
    expect(r.changed).toBe(true);
    expect(r.steps[0].status).toBe("skipped");
    expect(r.currentApprovalStep).toBe(1);
    expect(pendingSummary({ approvalSteps: r.steps, currentApprovalStep: r.currentApprovalStep }).waitingFor.map((w) => w.uid)).toEqual(["pm"]);
  });

  it("repara un paso que no aplicaba por importe (antes se quedaba bloqueado)", () => {
    const legacy = {
      baseAmount: 100, currentApprovalStep: 0,
      approvalSteps: [{ id: "a", order: 1, approverType: "role", roles: ["EP"], approvers: ["ep"], approverNames: ["Marta"], approvedBy: [], rejectedBy: [], status: "pending", requireAll: false, hasAmountThreshold: true, amountThreshold: 5000, amountCondition: "above" }] as ApprovalStepState[],
    };
    const r = repairFlow(legacy);
    expect(r.complete).toBe(true);
  });

  it("recalcular con la configuración nueva conserva las aprobaciones válidas", () => {
    const f = buildFlow([step({ id: "r", roles: ["PM", "EP"], requireAll: true })], members, { department: "Arte", baseAmount: 1 });
    const half = applyApproval({ approvalSteps: f.steps, currentApprovalStep: 0 }, "pm", "Ana", new Date());
    const rebuilt = rebuildFlow({ approvalSteps: half.steps, currentApprovalStep: half.currentApprovalStep, baseAmount: 1, department: "Arte" },
      [step({ id: "r", roles: ["PM", "EP"], requireAll: true }), step({ id: "c", order: 2, roles: ["Controller"] })], members);
    expect(rebuilt.steps[0].approvedBy).toEqual(["pm"]);
    expect(rebuilt.currentApprovalStep).toBe(0);
    expect(pendingSummary({ approvalSteps: rebuilt.steps, currentApprovalStep: rebuilt.currentApprovalStep }).waitingFor.map((w) => w.uid)).toEqual(["ep"]);
  });
});
