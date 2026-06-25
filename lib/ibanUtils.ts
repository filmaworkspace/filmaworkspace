// ─── IBAN formatting ─────────────────────────────────────────────────────────

export function formatIBAN(raw: string): string {
  const clean = raw.replace(/\s/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.match(/.{1,4}/g)?.join(" ") ?? clean;
}

export function cleanIBAN(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ─── IBAN validation (mod-97) ─────────────────────────────────────────────────

export function validateIBAN(raw: string): boolean {
  const iban = cleanIBAN(raw);
  if (iban.length < 5) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.split("").map(c => {
    const code = c.charCodeAt(0);
    return code >= 65 && code <= 90 ? String(code - 55) : c;
  }).join("");
  let remainder = 0;
  for (const char of numeric) {
    remainder = (remainder * 10 + parseInt(char)) % 97;
  }
  return remainder === 1;
}

// ─── Spanish 20-digit → IBAN ──────────────────────────────────────────────────

export function spanishDigitsToIBAN(digits: string): string {
  const clean = digits.replace(/\s/g, "");
  if (!/^\d{20}$/.test(clean)) return "";
  const numericString = clean + "142800"; // E=14, S=28, check placeholder 00
  let remainder = 0;
  for (const c of numericString) remainder = (remainder * 10 + parseInt(c)) % 97;
  const check = String(98 - remainder).padStart(2, "0");
  return formatIBAN(`ES${check}${clean}`);
}

// ─── Bank directory (entity code → name + BIC) ───────────────────────────────
// Spanish IBAN: ES CC EEEE OOOO D AAAAAAAAAA  (EEEE = entity code at positions 4–7)

interface BankInfo { name: string; bic: string }

const ES_BANKS: Record<string, BankInfo> = {
  "0049": { name: "Banco Santander",        bic: "BSCHESMMXXX" },
  "0075": { name: "Banco Popular",          bic: "POPLESMMXXX" },
  "0081": { name: "Banco Sabadell",         bic: "BSABESBBXXX" },
  "0182": { name: "BBVA",                   bic: "BBVAESMMXXX" },
  "2100": { name: "CaixaBank",              bic: "CAIXESBBXXX" },
  "2038": { name: "Bankia / CaixaBank",     bic: "CAHMESMMXXX" },
  "0128": { name: "Bankinter",              bic: "BKBKESMMXXX" },
  "1465": { name: "ING",                    bic: "INGDESMMXXX" },
  "0073": { name: "OpenBank",               bic: "OPENESMMXXX" },
  "0162": { name: "Unicaja",                bic: "UCJAES2MXXX" },
  "2103": { name: "Unicaja (BMN)",          bic: "UCJAES2MXXX" },
  "2085": { name: "Ibercaja",               bic: "IBENESBBXXX" },
  "2080": { name: "Abanca",                 bic: "CECCESMMXXX" },
  "3025": { name: "Caja Laboral",           bic: "CLPEES2MXXX" },
  "0019": { name: "Deutsche Bank",          bic: "DEUTESBBXXX" },
  "2011": { name: "Kutxabank",              bic: "BASKES2BXXX" },
  "0487": { name: "Banca March",            bic: "BMARES2MXXX" },
  "1491": { name: "Triodos Bank",           bic: "TRIOESMMXXX" },
  "0239": { name: "Caja de Ingenieros",     bic: "CDENESBBXXX" },
  "0093": { name: "EVO Banco",              bic: "EVOBESMXXXX" },
  "0234": { name: "Andbank",                bic: "ENTBESBBXXX" },
  "0186": { name: "Cajamar",                bic: "CCRIES2AXXX" },
  "0108": { name: "Degussa Bank",           bic: "DEGUESMXXXX" },
  "0131": { name: "Novo Banco",             bic: "BESCESMXXXX" },
  "0198": { name: "Bankoa",                 bic: "BKOAES22XXX" },
  "0238": { name: "Bankoa",                 bic: "BKOAES22XXX" },
  "2095": { name: "Liberbank",              bic: "LBKNESMMXXX" },
  "3035": { name: "Caja Rural del Sur",     bic: "BCOEESMXXXX" },
  "3058": { name: "Cajasiete",              bic: "CSURES2MXXX" },
  "3183": { name: "Caja Rural de Aragón",   bic: "CRARES2MXXX" },
  "0061": { name: "Banca Pueyo",            bic: "BPUYES2MXXX" },
  "0030": { name: "Banco Pastor",           bic: "PSTRESMMXXX" },
  "6016": { name: "Wizink",                 bic: "WZKNESMMXXX" },
  "1550": { name: "N26",                    bic: "NTSBDEB1XXX" },
  "1544": { name: "Revolut",                bic: "REVOLT21XXX" },
};

// Non-ES country-level BIC hints (partial, for display only)
const COUNTRY_BANKS: Record<string, Record<string, BankInfo>> = {
  GB: {
    "BARC": { name: "Barclays",     bic: "BARCGB22XXX" },
    "HSBC": { name: "HSBC",         bic: "HBUKGB4BXXX" },
    "NWBK": { name: "NatWest",      bic: "NWBKGB2LXXX" },
    "LLOY": { name: "Lloyds",       bic: "LOYDGB2LXXX" },
    "SORT": { name: "Santander UK", bic: "ABBYGB2LXXX" },
  },
  DE: {
    "10020030": { name: "Deutsche Bank",   bic: "DEUTDEDBXXX" },
    "20070024": { name: "Commerzbank",     bic: "COBADEFFXXX" },
    "37010050": { name: "Postbank",        bic: "PBNKDEFFXXX" },
  },
  FR: {
    "30003": { name: "BNP Paribas",       bic: "BNPAFRPPXXX" },
    "30006": { name: "Crédit Agricole",   bic: "AGRIFRPPXXX" },
    "30004": { name: "Société Générale",  bic: "SOGEFRPPXXX" },
  },
  IT: {
    "0301": { name: "UniCredit",     bic: "UNCRITMMXXX" },
    "1030": { name: "Intesa Sanpaolo", bic: "BCITITMM" },
  },
};

export function detectBank(raw: string): BankInfo | null {
  const iban = cleanIBAN(raw);
  if (iban.length < 8) return null;
  const country = iban.slice(0, 2);

  if (country === "ES" && iban.length >= 8) {
    const entityCode = iban.slice(4, 8);
    return ES_BANKS[entityCode] ?? null;
  }

  const countryMap = COUNTRY_BANKS[country];
  if (countryMap) {
    // Try matching the start of the BBAN against known codes
    const bban = iban.slice(4);
    for (const [key, info] of Object.entries(countryMap)) {
      if (bban.startsWith(key)) return info;
    }
  }

  return null;
}
