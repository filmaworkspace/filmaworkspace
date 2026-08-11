"use client";

import { useParams } from "next/navigation";
import BudgetingSettingsList from "@/components/BudgetingSettingsList";

export default function BudgetingFringesPage() {
  const { draftId } = useParams() as { draftId: string };
  return (
    <BudgetingSettingsList
      draftId={draftId}
      arrayField="fringes"
      fields={[
        { key: "label", label: "Nombre", type: "text" },
        { key: "percent", label: "Porcentaje", type: "number", suffix: "%" },
      ]}
      emptyLabel="Sin conceptos de Seguridad Social todavía"
    />
  );
}
