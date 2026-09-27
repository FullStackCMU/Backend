/**
 * จุดเดียวที่ตรวจข้อความความเห็นก่อนนักศึกษากดส่งแบบประเมิน
 *
 * ตอนนี้ยังไม่ตรวจอะไร (ผ่านทุกข้อความ) — AI flagger จะเสียบที่นี่:
 *   1. ส่งข้อความไป LLM (ต้องมี consent ของนักศึกษาแล้ว — POST /answers/:roundId/submit ตรวจให้ก่อนเรียก)
 *   2. บันทึกผลลงตาราง flags (category / severity / ai_suggestion / model_version)
 *   3. คืน issue ที่ต้องให้นักศึกษาแก้ก่อนส่ง → route ตอบ 422 พร้อม issues
 */

export interface CommentToCheck {
  questionId: string;
  evaluateeId: string;
  text: string;
}

export interface CommentIssue extends Omit<CommentToCheck, "text"> {
  category: "profanity" | "personal_attack" | "negative_tone" | "other";
  severity: "low" | "medium" | "high";
  suggestion: string | null;
}

export async function checkComments(_input: {
  submissionId: string;
  comments: CommentToCheck[];
}): Promise<CommentIssue[]> {
  return [];
}
