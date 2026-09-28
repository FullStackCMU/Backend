import OpenAI from "openai";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import { verdictSchema, type CommentChecker, type Verdict } from "./types.ts";

class MalformedResponse extends Error {}

interface OpenAICompatibleOptions {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  // DeepSeek thinking ฯลฯ ที่ SDK ไม่มี type
  extraBody?: Record<string, unknown>;
}

export class OpenAICompatibleChecker implements CommentChecker {
  readonly modelVersion: string;
  private client: OpenAI;
  private options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.options = options;
    this.modelVersion = `${options.provider}/${options.model}`;
    // ไม่ retry — ทั้งหมดต้องจบใน 5 วินาที
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 0 });
  }

  async check(text: string, signal: AbortSignal): Promise<Verdict> {
    // โมเดลตอบผิดรูปแบบเป็นครั้งคราว → ลองใหม่ 1 ครั้งในเวลาที่เหลือ
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
    // โมเดลอาจห่อด้วย ```json หรือมีข้อความก่อน/หลัง
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    let json: unknown;
    try {
      json = JSON.parse(content.slice(start, end + 1));
    } catch {
      throw new MalformedResponse("invalid_json");
    }
    const parsed = verdictSchema.safeParse(json);
    // ห้ามแนบ content/ZodError — อาจมีข้อความของนักศึกษา
    if (!parsed.success) throw new MalformedResponse("invalid_verdict");
    return parsed.data;
  }
}
