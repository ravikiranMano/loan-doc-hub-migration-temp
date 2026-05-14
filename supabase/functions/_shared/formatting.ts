/**
 * Formatting Utilities for Document Generation
 * 
 * Provides value formatting and transformation functions for
 * currency, dates, text, percentages, phone numbers, etc.
 */

// ============================================
// Basic Formatters
// ============================================

export function formatCurrency(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatCurrencyInWords(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";

  const dollars = Math.floor(num);
  const cents = Math.round((num - dollars) * 100);

  const words = numberToWords(dollars);
  return `${words} and ${cents.toString().padStart(2, "0")}/100 Dollars`;
}

export function numberToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const thousands = ["", "Thousand", "Million", "Billion"];

  if (num === 0) return "Zero";
  if (num < 0) return "Negative " + numberToWords(-num);

  let words = "";
  let i = 0;

  while (num > 0) {
    if (num % 1000 !== 0) {
      let chunk = "";
      const n = num % 1000;

      if (n >= 100) {
        chunk += ones[Math.floor(n / 100)] + " Hundred ";
      }

      const remainder = n % 100;
      if (remainder >= 10 && remainder < 20) {
        chunk += teens[remainder - 10] + " ";
      } else {
        if (remainder >= 20) {
          chunk += tens[Math.floor(remainder / 10)] + " ";
        }
        if (remainder % 10 > 0) {
          chunk += ones[remainder % 10] + " ";
        }
      }

      words = chunk + thousands[i] + " " + words;
    }
    num = Math.floor(num / 1000);
    i++;
  }

  return words.trim();
}

// ============================================
// Date Formatters
// ============================================

export function formatDateDDMMYYYY(value: string | null): string {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return "";
  }
}

export function formatDateMMDDYYYY(value: string | null): string {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  } catch {
    return "";
  }
}

export function formatDateLong(value: string | null): string {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export function formatDateShort(value: string | null): string {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

// ============================================
// Text Formatters
// ============================================

export function formatUppercase(value: string | null): string {
  if (!value) return "";
  return value.toUpperCase();
}

export function formatTitlecase(value: string | null): string {
  if (!value) return "";
  return value.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

export function formatLowercase(value: string | null): string {
  if (!value) return "";
  return value.toLowerCase();
}

// ============================================
// Number/Percentage Formatters
// ============================================

/**
 * Smart-trim percentage formatter (matches client `formatPercentDisplay`):
 *   - min 2 decimals, max `decimals` decimals
 *   - trailing zeros beyond the 2nd decimal are stripped
 *   - source value is the stored precision (4dp), never re-derived
 */
export function formatPercentage(value: string | number | null, decimals = 4): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  const safeMax = Math.max(2, Math.floor(decimals));
  let s = num.toFixed(safeMax);
  if (safeMax === 2) return `${s}%`;
  const dotIdx = s.indexOf(".");
  if (dotIdx === -1) return `${s}%`;
  const intPart = s.slice(0, dotIdx);
  const decPart = s.slice(dotIdx + 1);
  const head = decPart.slice(0, 2);
  const tail = decPart.slice(2).replace(/0+$/, "");
  return tail.length === 0 ? `${intPart}.${head}%` : `${intPart}.${head}${tail}%`;
}

// ============================================================================
// Category-aware percentage formatting (mirrors src/lib/precisionFormat.ts)
// ============================================================================

export type PercentCategory = "interestRate" | "proRata" | "ratio" | "lateChargePct";

export function resolvePercentCategory(fieldKey: string | null | undefined): PercentCategory {
  if (!fieldKey) return "interestRate";
  const k = fieldKey.toLowerCase();
  if (/(^|_)(ltv|cltv)(_|$)/.test(k) || k.includes("protective_equity") || k.includes("protectiveequity")) {
    return "ratio";
  }
  if (k.includes("late_charge") && (k.includes("pct") || k.includes("percent") || k.includes("rate"))) {
    return "lateChargePct";
  }
  if (
    k.includes("pro_rata") ||
    k.includes("prorata") ||
    k.includes("funding_pct") ||
    k.includes("pct_owned") ||
    k.includes("pctowned") ||
    k.includes("allocation_pct") ||
    k.includes("allocationpct")
  ) {
    return "proRata";
  }
  return "interestRate";
}

export function formatPercentByFieldKey(
  fieldKey: string | null | undefined,
  value: string | number | null
): string {
  switch (resolvePercentCategory(fieldKey)) {
    case "ratio": return formatPercentage(value, 2);
    case "proRata": return formatPercentage(value, 4);
    case "lateChargePct": return formatPercentage(value, 3);
    case "interestRate":
    default: return formatPercentage(value, 3);
  }
}

export function formatNumber(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  return new Intl.NumberFormat("en-US").format(num);
}

// ============================================
// Phone/SSN Formatters
// ============================================

export function formatPhone(value: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value;
}

export function formatSSNMasked(value: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) {
    return `XXX-XX-${digits.slice(5)}`;
  }
  return value;
}

// ============================================
// Boolean Formatter
// ============================================

export function formatBoolean(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const boolStr = String(value).toLowerCase();
  if (boolStr === "true" || boolStr === "1" || boolStr === "yes") return "Yes";
  if (boolStr === "false" || boolStr === "0" || boolStr === "no") return "No";
  return String(value);
}

// ============================================
// Checkbox Formatters
// ============================================

function isTruthy(value: string | number | null): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value).toLowerCase().trim();
  return s === "true" || s === "1" || s === "yes";
}

/** ☑ / ☐ */
export function formatCheckbox(value: string | number | null): string {
  return isTruthy(value) ? "☑" : "☐";
}

/** Yes / No */
export function formatCheckboxYesNo(value: string | number | null): string {
  return isTruthy(value) ? "Yes" : "No";
}

/** [X] / [ ] */
export function formatCheckboxX(value: string | number | null): string {
  return isTruthy(value) ? "[X]" : "[ ]";
}

// ============================================
// Transform Dispatcher
// ============================================

export function applyTransform(value: string | number | null, transform: string): string {
  if (value === null || value === undefined) value = "";
  const valueStr = String(value);
  const t = transform.toLowerCase().trim();

  switch (t) {
    case "currency":
      return formatCurrency(value);
    case "currency_words":
      return formatCurrencyInWords(value);
    case "date":
      return formatDateMMDDYYYY(valueStr);
    case "date_mmddyyyy":
      return formatDateMMDDYYYY(valueStr);
    case "date_long":
    case "long":
      return formatDateLong(valueStr);
    case "date_short":
      return formatDateShort(valueStr);
    case "uppercase":
    case "upper":
      return formatUppercase(valueStr);
    case "titlecase":
      return formatTitlecase(valueStr);
    case "lowercase":
      return formatLowercase(valueStr);
    case "percentage":
      return formatPercentage(value);
    case "phone":
      return formatPhone(valueStr);
    case "ssn_masked":
      return formatSSNMasked(valueStr);
    case "words":
      return formatCurrencyInWords(value);
    case "checkbox":
      return formatCheckbox(value);
    case "checkbox_yes_no":
      return formatCheckboxYesNo(value);
    case "checkbox_x":
      return formatCheckboxX(value);
    default:
      return valueStr;
  }
}

export function formatByDataType(
  value: string | number | null,
  dataType: string,
  fieldKey?: string | null,
): string {
  if (value === null || value === undefined) return "";

  switch (dataType) {
    case "currency":
      return formatCurrency(value);
    case "percentage":
      // Category-aware: stored at 4dp; display rule depends on field key.
      return fieldKey ? formatPercentByFieldKey(fieldKey, value) : formatPercentage(value, 4);
    case "date":
      return formatDateMMDDYYYY(String(value));
    case "number": {
      const numStr = String(value);
      if (/^\d{5,}$/.test(numStr.trim())) return numStr.trim();
      return formatNumber(value);
    }
    case "boolean":
      return formatCheckbox(value);
    case "dropdown":
    case "text":
    default:
      return String(value);
  }
}
