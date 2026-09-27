import { z } from "zod";

// ประเภทที่ AI เตือนได้ (enum flag_category ใน DB มี "other" เผื่อไว้ แต่ไม่ให้ AI ใช้)
export const FLAG_CATEGORIES = ["profanity", "personal_attack", "negative_tone"] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const FLAG_SEVERITIES = ["low", "medium", "high"] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

/** ผลตรวจ 1 ข้อความที่ LLM ต้องตอบ — ตรวจด้วย Zod ทุกครั้ง ตอบผิดรูปแบบ = ถือว่าตรวจไม่ได้ */
export const verdictSchema = z.discriminatedUnion("flagged", [
  z.object({ flagged: z.literal(false) }),
  z.object({
    flagged: z.literal(true),
    category: z.enum(FLAG_CATEGORIES),
    severity: z.enum(FLAG_SEVERITIES),
    suggestion: z.string().trim().min(1).max(1000),
  }),
]);
export type Verdict = z.infer<typeof verdictSchema>;

/**
 * ตัวตรวจข้อความ 1 เจ้า (DeepSeek / Claude / โมเดลในเครื่อง ...)
 *
 * ผู้เรียกรับประกันว่า text ผ่าน redactPersonalInfo แล้ว — provider ห้ามส่งข้อมูลอื่นนอกจาก text
 * ตรวจไม่สำเร็จ (timeout, network, ตอบผิดรูปแบบ) ให้ throw — ผู้เรียกจะปล่อยผ่าน (ไม่บล็อกนักศึกษา)
 * ห้าม log text หรือคำตอบของโมเดล (อาจยกข้อความเดิมมา)
 */
export interface CommentChecker {
  /** "<provider>/<model>" — เก็บลง flags.model_version */
  readonly modelVersion: string;
  check(text: string, signal: AbortSignal): Promise<Verdict>;
}
