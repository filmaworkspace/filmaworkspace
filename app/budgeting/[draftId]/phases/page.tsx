"use client";

import { useParams } from "next/navigation";
import BudgetingSettingsList from "@/components/BudgetingSettingsList";

export default function BudgetingPhasesPage() {
  const { draftId } = useParams() as { draftId: string };
  return (
    <BudgetingSettingsList
      draftId={draftId}
      arrayField="phases"
      description="Fases de producción del proyecto: Prep, Rodaje, Post"
      fields={[
        { key: "label", label: "Nombre", type: "text" },
      ]}
      emptyLabel="Sin fases todavía"
    />
  );
}
