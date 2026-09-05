/**
 * 顧客登録で集める項目の設定。
 *
 * 個人情報は「必要なものだけ集める」方針に寄せられるよう、項目ごとに
 * 必須 / 任意 / 集めない を切り替えられるようにする。
 * 店頭の登録フォームと LINE の登録フォームの両方に効く。
 */
export type FieldMode = "REQUIRED" | "OPTIONAL" | "HIDDEN";

/** 氏名の扱い。NICKNAME にすると「お名前」1欄だけになる (ニックネーム可) */
export type NameMode = "FULL" | "NICKNAME";

export type CustomerFieldPolicy = {
  nameMode: NameMode;
  /** 氏名を必須にするか。ニックネーム運用でも呼び名は要る想定で既定は必須 */
  nameRequired: boolean;
  kana: FieldMode;
  phone: FieldMode;
  email: FieldMode;
  birthday: FieldMode;
  gender: FieldMode;
  address: FieldMode;
  /** 住所を市区町村までに留める (番地・建物名は集めない) */
  addressCityOnly: boolean;
};

export const CUSTOMER_FIELD_KEYS = [
  "kana",
  "phone",
  "email",
  "birthday",
  "gender",
  "address",
] as const;

export type CustomerFieldKey = (typeof CUSTOMER_FIELD_KEYS)[number];

export const CUSTOMER_FIELD_LABELS: Record<CustomerFieldKey, string> = {
  kana: "カナ (セイ・メイ)",
  phone: "電話番号",
  email: "メールアドレス",
  birthday: "誕生日",
  gender: "性別",
  address: "住所",
};

/** 項目を減らすと使えなくなる機能を、設定画面で先に知らせるための注記 */
export const CUSTOMER_FIELD_NOTES: Partial<Record<CustomerFieldKey, string>> = {
  birthday: "集めないと誕生日リマインドが送れなくなります",
  phone: "集めないとレジの「お名前・電話番号で検索」で電話番号が使えません",
};

/** 既定はこれまでどおり (氏名のみ必須、ほかは任意) */
export const DEFAULT_CUSTOMER_FIELD_POLICY: CustomerFieldPolicy = {
  nameMode: "FULL",
  nameRequired: true,
  kana: "OPTIONAL",
  phone: "OPTIONAL",
  email: "OPTIONAL",
  birthday: "OPTIONAL",
  gender: "OPTIONAL",
  address: "OPTIONAL",
  addressCityOnly: false,
};

/**
 * ヒアリングで挙がった最小構成。
 * 呼び名 (ニックネーム可) + 市区町村 + 性別 + 誕生日だけを集める。
 * 誕生日は誕生日リマインドで使うため残す。
 */
export const MINIMAL_CUSTOMER_FIELD_POLICY: CustomerFieldPolicy = {
  nameMode: "NICKNAME",
  nameRequired: true,
  kana: "HIDDEN",
  phone: "HIDDEN",
  email: "HIDDEN",
  birthday: "OPTIONAL",
  gender: "OPTIONAL",
  address: "OPTIONAL",
  addressCityOnly: true,
};

export const CUSTOMER_FIELD_POLICY_KEY = "customer.fieldPolicy";

/** 保存された JSON を、欠けている項目を既定で補いながら読み込む */
export function parseCustomerFieldPolicy(raw: string | undefined): CustomerFieldPolicy {
  if (!raw) return DEFAULT_CUSTOMER_FIELD_POLICY;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomerFieldPolicy>;
    const mode = (value: unknown, fallback: FieldMode): FieldMode =>
      value === "REQUIRED" || value === "OPTIONAL" || value === "HIDDEN" ? value : fallback;
    return {
      nameMode: parsed.nameMode === "NICKNAME" ? "NICKNAME" : "FULL",
      nameRequired: parsed.nameRequired !== false,
      kana: mode(parsed.kana, DEFAULT_CUSTOMER_FIELD_POLICY.kana),
      phone: mode(parsed.phone, DEFAULT_CUSTOMER_FIELD_POLICY.phone),
      email: mode(parsed.email, DEFAULT_CUSTOMER_FIELD_POLICY.email),
      birthday: mode(parsed.birthday, DEFAULT_CUSTOMER_FIELD_POLICY.birthday),
      gender: mode(parsed.gender, DEFAULT_CUSTOMER_FIELD_POLICY.gender),
      address: mode(parsed.address, DEFAULT_CUSTOMER_FIELD_POLICY.address),
      addressCityOnly: parsed.addressCityOnly === true,
    };
  } catch {
    return DEFAULT_CUSTOMER_FIELD_POLICY;
  }
}
