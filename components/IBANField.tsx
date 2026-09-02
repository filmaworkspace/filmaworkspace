"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Building2 } from "lucide-react";
import { formatIBAN, cleanIBAN, validateIBAN, detectBank, spanishDigitsToIBAN } from "@/lib/ibanUtils";

interface IBANFieldProps {
  iban: string;
  bic: string;
  onIBANChange: (iban: string) => void;
  onBICChange: (bic: string) => void;
  ibanClassName?: string;
  bicClassName?: string;
  ibanPlaceholder?: string;
  bicPlaceholder?: string;
  disabled?: boolean;
}

export function IBANField({
  iban,
  bic,
  onIBANChange,
  onBICChange,
  ibanClassName = "",
  bicClassName = "",
  ibanPlaceholder = "ES12 3456 7890 1234 5678 90",
  bicPlaceholder = "BSCHESMMXXX",
  disabled = false,
}: IBANFieldProps) {
  const [bank, setBank] = useState<{ name: string; bic: string } | null>(null);
  const [isValid, setIsValid] = useState<boolean | null>(null);

  useEffect(() => {
    const clean = cleanIBAN(iban);
    if (clean.length < 5) {
      setBank(null);
      setIsValid(null);
      return;
    }

    // Auto-detect from 20 raw digits (Spanish shorthand)
    if (/^\d{20}$/.test(clean)) {
      const converted = spanishDigitsToIBAN(clean);
      if (converted) {
        onIBANChange(converted);
        return;
      }
    }

    const valid = validateIBAN(clean);
    setIsValid(valid);

    const detected = detectBank(clean);
    setBank(detected);

    // Auto-fill BIC only if field is empty or previously auto-filled
    if (detected && !bic) {
      onBICChange(detected.bic);
    }
  }, [iban]);

  const handleIBANInput = (value: string) => {
    const clean = cleanIBAN(value);
    // If user pastes 20 digits → auto-convert to IBAN
    if (/^\d{20}$/.test(clean)) {
      const converted = spanishDigitsToIBAN(clean);
      onIBANChange(converted || formatIBAN(value));
    } else {
      onIBANChange(formatIBAN(value));
    }
  };

  const showBank = bank && isValid;
  const showInvalid = isValid === false && cleanIBAN(iban).length >= 16;

  return (
    <div className="space-y-2">
      {/* IBAN input */}
      <div className="relative">
        <input
          type="text"
          value={iban}
          onChange={(e) => handleIBANInput(e.target.value)}
          placeholder={ibanPlaceholder}
          disabled={disabled}
          className={`font-mono pr-8 ${ibanClassName} ${showInvalid ? "border-red-300 focus:ring-red-400" : showBank ? "border-emerald-300 focus:ring-emerald-400" : ""}`}
          spellCheck={false}
          autoComplete="off"
        />
        {showBank && (
          <CheckCircle2 size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
        )}
        {showInvalid && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-400 text-lg leading-none pointer-events-none">!</span>
        )}
      </div>

      {/* Bank recognition banner */}
      {showBank && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <Building2 size={13} className="text-emerald-600 shrink-0" />
          <span className="text-xs font-semibold text-emerald-800">{bank.name}</span>
          <span className="text-xs text-emerald-600 font-mono ml-auto">{bank.bic}</span>
        </div>
      )}
      {showInvalid && (
        <p className="text-xs text-red-500 px-1">IBAN no válido</p>
      )}

      {/* BIC input */}
      <div className="relative">
        <input
          type="text"
          value={bic}
          onChange={(e) => onBICChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))}
          placeholder={bicPlaceholder}
          disabled={disabled}
          className={`font-mono uppercase ${bicClassName} ${showBank && bic === bank.bic ? "border-emerald-300" : ""}`}
          spellCheck={false}
          autoComplete="off"
          maxLength={11}
        />
        {showBank && bic === bank.bic && (
          <CheckCircle2 size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
        )}
      </div>
    </div>
  );
}
