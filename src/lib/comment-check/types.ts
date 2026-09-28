import { z } from "zod";

// enum ใน DB มี "other" แต่ไม่ให้ AI ใช้
export const FLAG_CATEGORIES = ["profanity", "personal_attack", "negative_tone"] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const FLAG_SEVERITIES = ["low", "medium", "high"] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

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

// ต้อง throw เมื่อตรวจไม่สำเร็จ (ผู้เรียกปล่อยผ่าน) และห้าม log text
export interface CommentChecker {
  // "<provider>/<model>" เก็บลง flags.model_version
  readonly modelVersion: string;
  check(text: string, signal: AbortSignal): Promise<Verdict>;
}
