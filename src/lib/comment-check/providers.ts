import { CONSENT_AI_PROVIDER } from "../../config.ts";
import { OpenAICompatibleChecker } from "./openai-compatible.ts";
import type { CommentChecker } from "./types.ts";

/**
 * เลือก provider จาก AI_PROVIDER ใน .env — เพิ่มเจ้าใหม่ = เพิ่ม entry ที่นี่ + class ที่ implement CommentChecker
 * เช่น
 *   claude: () => new ClaudeChecker({ apiKey: env.ANTHROPIC_API_KEY, model: "claude-haiku-4-5" })  // @anthropic-ai/sdk
 *   local:  () => new OpenAICompatibleChecker({ provider: "local", baseURL: env.LOCAL_AI_BASE_URL, apiKey: "none", model: env.LOCAL_AI_MODEL })
 */
const PROVIDERS: Record<string, (env: NodeJS.ProcessEnv) => CommentChecker | string> = {
  deepseek: (env) => {
    if (!env.DEEPSEEK_API_KEY) return "ไม่มี DEEPSEEK_API_KEY";
    return new OpenAICompatibleChecker({
      provider: "deepseek",
      // https://api-docs.deepseek.com/
      baseURL: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || "deepseek-flash",
      // thinking เปิดเป็นค่าเริ่มต้น — ช้ากว่าและเปลือง token โดยไม่จำเป็นสำหรับงานจัดประเภทสั้นๆ
      extraBody: { thinking: { type: "disabled" } },
    });
  },
};

/**
 * null = ปิดการตรวจ (ทุกข้อความผ่าน)
 * ส่งข้อความไปได้เฉพาะเจ้าที่บอกไว้ในนโยบายความยินยอมเท่านั้น (CONSENT_AI_PROVIDER)
 */
export function createChecker(env: NodeJS.ProcessEnv = process.env): CommentChecker | null {
  const provider = (env.AI_PROVIDER ?? "none").trim().toLowerCase();
  if (provider === "none" || provider === "") return null;

  let problem: string;
  if (provider !== CONSENT_AI_PROVIDER)
    problem = `นโยบายความยินยอมระบุ "${CONSENT_AI_PROVIDER}" — เปลี่ยน provider ต้องแก้ข้อความ consent และขึ้น CONSENT_POLICY_VERSION ก่อน`;
  else if (!PROVIDERS[provider]) problem = "ไม่รู้จัก provider นี้";
  else {
    const created = PROVIDERS[provider](env);
    if (typeof created !== "string") return created;
    problem = created;
  }
  console.warn(`[comment-check] ปิดการตรวจข้อความ (AI_PROVIDER=${provider}): ${problem}`);
  return null;
}
