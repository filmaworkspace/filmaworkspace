"use client";

import { useParams } from "next/navigation";
import BudgetingSettingsList from "@/components/BudgetingSettingsList";

export default function BudgetingGlobalsPage() {
  const { draftId } = useParams() as { draftId: string };
  return (
    <BudgetingSettingsList
      draftId={draftId}
      arrayField="globals"
      description="Valores de referencia del presupuesto: semanas de rodaje, semanas de prep, número de unidades"
      fields={[
        { key: "label", label: "Nombre", type: "text" },
        { key: "value", label: "Valor", type: "text" },
      ]}
      emptyLabel="Sin globales todavía"
    />
  );
}
