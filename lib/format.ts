const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("ja-JP");

export function formatYen(value: number | null | undefined): string {
  return yen.format(value ?? 0);
}

export function formatNumber(value: number | null | undefined): string {
  return number.format(value ?? 0);
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  return `${((ratio ?? 0) * 100).toFixed(digits)}%`;
}

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(new Date(value));
}

/** input[type=date] 用の YYYY-MM-DD */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fullName(customer: { lastName: string; firstName: string }): string {
  return `${customer.lastName} ${customer.firstName}`;
}

export function fullNameKana(customer: {
  lastNameKana?: string | null;
  firstNameKana?: string | null;
}): string {
  const kana = [customer.lastNameKana, customer.firstNameKana].filter(Boolean).join(" ");
  return kana || "";
}

/** 今日から何日前か */
export function daysSince(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  return Math.floor(diff / 86_400_000);
}
