/**
 * ลบข้อมูลที่ระบุตัวบุคคลออกจากข้อความก่อนส่งให้ AI ภายนอก
 * - ชื่อ/นามสกุล (ไทย อังกฤษ) ของสมาชิกในกลุ่ม → "[เพื่อน]"
 * - อีเมล → "[อีเมล]", ตัวเลข 9 หลัก (รหัสนักศึกษา มช.) → "[รหัส]"
 *
 * ชื่อเล่นยังไม่มีในระบบ (CMU OAuth ไม่ให้มา) — ถ้าเพิ่มเมื่อไหร่ แค่ใส่ใน names ที่ส่งเข้ามา
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const STUDENT_ID = /(?<!\d)\d{9}(?!\d)/g;
const FRIEND = "[เพื่อน]";
// ชื่อ-นามสกุลติดกัน → เหลือ [เพื่อน] อันเดียว
const REPEATED_FRIEND = /\[เพื่อน\](?:\s*\[เพื่อน\])+/g;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactPersonalInfo(text: string, names: readonly string[]): string {
  let out = text.replace(EMAIL, "[อีเมล]").replace(STUDENT_ID, "[รหัส]");

  // ยาวก่อน — กัน "สม" ไปตัด "สมชาย" ครึ่งคำ; สั้นกว่า 2 ตัวอักษรไม่ตัด (ชนคำทั่วไปเยอะ)
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
    (a, b) => b.length - a.length
  );
  for (const name of unique) {
    const pattern = /[A-Za-z]/.test(name)
      ? // อังกฤษ: ไม่สนตัวพิมพ์ และต้องไม่อยู่กลางคำอังกฤษอื่น
        new RegExp(`(?<![A-Za-z])${escapeRegExp(name)}(?![A-Za-z])`, "gi")
      : // ไทยไม่มีช่องว่างระหว่างคำ → ตัดทุกที่ที่เจอ
        new RegExp(escapeRegExp(name), "g");
    out = out.replace(pattern, FRIEND);
  }
  return out.replace(REPEATED_FRIEND, FRIEND);
}

/** ชื่อทุกแบบของคนหนึ่งคนที่อาจถูกเขียนถึงในความเห็น */
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
