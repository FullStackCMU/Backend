import OpenAI from "openai";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import { verdictSchema, type CommentChecker, type Verdict } from "./types.ts";

/** คำตอบผิดรูปแบบ — message เป็นแค่โค้ด ไม่มีเนื้อหาคำตอบ */
class MalformedResponse extends Error {}

export interface OpenAICompatibleOptions {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** พารามิเตอร์เฉพาะเจ้า ที่ SDK ไม่มี type ให้ เช่น DeepSeek thinking */
  extraBody?: Record<string, unknown>;
}

/**
 * provider ที่ใช้ OpenAI-compatible Chat Completions API (DeepSeek, vLLM/Ollama ในเครื่อง ฯลฯ)
 * ส่งแค่ system prompt + ข้อความที่ลบข้อมูลส่วนตัวแล้ว — ไม่ส่ง user/metadata ใดๆ
 */
export class OpenAICompatibleChecker implements CommentChecker {
  readonly modelVersion: string;
  private client: OpenAI;
  private options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.options = options;
    this.modelVersion = `${options.provider}/${options.model}`;
    // retry ไม่ได้ช่วย — ทั้งหมดต้องจบใน 5 วินาที (ผู้เรียกคุมด้วย signal)
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 0 });
  }

  async check(text: string, signal: AbortSignal): Promise<Verdict> {
    // โมเดลตอบผิดรูปแบบเป็นครั้งคราว (JSON เสีย / content ว่างตามเอกสาร DeepSeek) → ลองใหม่ 1 ครั้งในเวลาที่เหลือ
    try {
      return await this.request(text, signal);
    } catch (err) {
      if (signal.aborted || !(err instanceof MalformedResponse)) throw err;
      return this.request(text, signal);
    }
  }

  private async request(text: string, signal: AbortSignal): Promise<Verdict> {
    const res = await this.client.chat.completions.create(
      {
        model: this.options.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(text) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 400,
        ...this.options.extraBody,
      },
      { signal }
    );
    const content = res.choices[0]?.message?.content;
    if (!content) throw new MalformedResponse("empty_response");
    // เผื่อโมเดลห่อด้วย ```json หรือมีข้อความก่อน/หลัง — เอาเฉพาะ {...} ก้อนนอกสุด
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    let json: unknown;
    try {
      json = JSON.parse(content.slice(start, end + 1));
    } catch {
      throw new MalformedResponse("invalid_json");
    }
    const parsed = verdictSchema.safeParse(json);
    // ห้ามแนบ content/ZodError ไปกับ error — อาจมีข้อความของนักศึกษา
    if (!parsed.success) throw new MalformedResponse("invalid_verdict");
    return parsed.data;
  }
}
