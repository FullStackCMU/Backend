// ชื่อเล่นยังไม่มีในระบบ — ถ้าเพิ่มให้ใส่ใน names
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const STUDENT_ID = /(?<!\d)\d{9}(?!\d)/g;
const FRIEND = "[เพื่อน]";
const REPEATED_FRIEND = /\[เพื่อน\](?:\s*\[เพื่อน\])+/g;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactPersonalInfo(text: string, names: readonly string[]): string {
  let out = text.replace(EMAIL, "[อีเมล]").replace(STUDENT_ID, "[รหัส]");

  // ยาวก่อน กัน "สม" ตัด "สมชาย" ครึ่งคำ; สั้นกว่า 2 ตัวไม่ตัด (ชนคำทั่วไป)
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
    (a, b) => b.length - a.length
  );
  for (const name of unique) {
    const pattern = /[A-Za-z]/.test(name)
      ? new RegExp(`(?<![A-Za-z])${escapeRegExp(name)}(?![A-Za-z])`, "gi")
      : // ไทยไม่มีช่องว่างระหว่างคำ ใช้ขอบคำไม่ได้
        new RegExp(escapeRegExp(name), "g");
    out = out.replace(pattern, FRIEND);
  }
  return out.replace(REPEATED_FRIEND, FRIEND);
}

export function nameVariants(person: {
  firstnameTh: string | null;
  lastnameTh: string | null;
  firstnameEn: string | null;
  lastnameEn: string | null;
  cmuAccount: string;
}): string[] {
  const account = person.cmuAccount.split("@")[0];
  return [
    person.firstnameTh,
    person.lastnameTh,
    person.firstnameEn,
    person.lastnameEn,
    account,
    ...account.split(/[._-]/),
  ].filter((n): n is string => !!n);
}
