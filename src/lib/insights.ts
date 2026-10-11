// สัญญาณให้อาจารย์ดูต่อ ไม่ใช่ข้อสรุป — เกณฑ์เป็นคะแนนบนสเกล 1–5 ของรูบริก (ระดับ 3 = ทำได้ตามที่คาดหวัง)
const LOW_OVERALL = 3;
const BELOW_TEAMMATES = 1;
const SELF_GAP = 1;
const SELF_SERVING = 1.5;
const RATER_BIAS = 1;
// ผู้ประเมิน 2 คนบอกไม่ได้ว่าใครให้สูงหรือใครให้ต่ำ
const MIN_RATERS_FOR_BIAS = 3;

// value = ค่าของนักศึกษาคนนั้น, reference = ค่าที่เอามาเทียบ
export type ReceivedSignal = { studentId: string } & (
  | { type: "low_overall"; value: number }
  | { type: "low_dimension"; dimensions: { questionId: string; value: number; reference: number }[] }
  | { type: "self_over" | "self_under"; value: number; reference: number }
  | { type: "few_raters"; count: number }
);

export type GiverSignal = { studentId: string } & (
  | { type: "not_submitted" }
  | { type: "straight_lining"; value: number }
  | { type: "self_serving"; value: number; reference: number }
  | { type: "lenient" | "harsh"; value: number; reference: number }
  | { type: "ignored_warnings"; count: number }
);

type Member = {
  student: { id: string };
  submission: { status: "draft" | "submitted" } | null;
  peerCount: number;
  scores: { questionId: string; peerAverage: number | null; selfScore: number | null }[];
  overall: { peerAverage: number | null; selfAverage: number | null; gap: number | null };
};

type Score = { evaluatorId: string; evaluateeId: string; questionId: string; score: number };

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function median(xs: number[]) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function receivedSignals(members: Member[], closed: boolean, minPeers: number): ReceivedSignal[] {
  const signals: ReceivedSignal[] = [];
  for (const m of members) {
    const studentId = m.student.id;
    const { peerAverage, selfAverage, gap } = m.overall;

    if (peerAverage !== null && peerAverage < LOW_OVERALL)
      signals.push({ studentId, type: "low_overall", value: peerAverage });

    // เทียบกับเพื่อนร่วมกลุ่มโดยไม่นับตัวเอง — กลุ่มเล็ก ถ้านับรวมค่าเฉลี่ยจะถูกดึงลงตามคนที่กำลังเทียบ
    const dimensions = m.scores.flatMap((s) => {
      if (s.peerAverage === null) return [];
      const teammates = members.flatMap((o) => {
        const score = o.student.id === studentId ? null : o.scores.find((x) => x.questionId === s.questionId)?.peerAverage;
        return score == null ? [] : [score];
      });
      if (teammates.length === 0) return [];
      const reference = round1(mean(teammates));
      return round1(reference - s.peerAverage) >= BELOW_TEAMMATES
        ? [{ questionId: s.questionId, value: s.peerAverage, reference }]
        : [];
    });
    if (dimensions.length > 0) signals.push({ studentId, type: "low_dimension", dimensions });

    if (gap !== null && Math.abs(gap) >= SELF_GAP)
      signals.push({
        studentId,
        type: gap > 0 ? "self_over" : "self_under",
        value: selfAverage!,
        reference: peerAverage!,
      });

    // ระหว่างเปิดรับ ผู้ประเมินยังน้อยเป็นเรื่องปกติ
    if (closed && m.peerCount < minPeers) signals.push({ studentId, type: "few_raters", count: m.peerCount });
  }
  return signals;
}

function giverSignals(
  members: Member[],
  scores: Score[],
  ignoredWarnings: Map<string, number>,
  closed: boolean
): GiverSignal[] {
  const signals: GiverSignal[] = [];
  const givenBy = (id: string) => scores.filter((s) => s.evaluatorId === id && s.evaluateeId !== id);

  // เทียบกับค่ากลางของกลุ่ม ไม่ใช่ค่าเฉลี่ย — คนที่ให้ต่ำมากคนเดียวจะไม่ทำให้คนอื่นดูเหมือนให้สูง
  const raterAverages = members.flatMap((m) => {
    const given = givenBy(m.student.id);
    return given.length > 0 ? [mean(given.map((s) => s.score))] : [];
  });
  const groupTypical = raterAverages.length >= MIN_RATERS_FOR_BIAS ? median(raterAverages) : null;

  for (const m of members) {
    const studentId = m.student.id;
    if (m.submission?.status !== "submitted") {
      if (closed) signals.push({ studentId, type: "not_submitted" });
      continue;
    }

    const given = givenBy(studentId);
    if (given.length > 0) {
      // เพื่อนคนเดียวให้เท่ากันทุกข้อเกิดได้ตามปกติ
      const peers = new Set(given.map((s) => s.evaluateeId)).size;
      if (peers >= 2 && given.every((s) => s.score === given[0].score))
        signals.push({ studentId, type: "straight_lining", value: given[0].score });

      const givenAverage = round1(mean(given.map((s) => s.score)));
      const selfAverage = m.overall.selfAverage;
      if (selfAverage !== null && round1(selfAverage - givenAverage) >= SELF_SERVING)
        signals.push({ studentId, type: "self_serving", value: selfAverage, reference: givenAverage });

      if (groupTypical !== null && Math.abs(round1(givenAverage - groupTypical)) >= RATER_BIAS)
        signals.push({
          studentId,
          type: givenAverage > groupTypical ? "lenient" : "harsh",
          value: givenAverage,
          reference: groupTypical,
        });
    }

    const ignored = ignoredWarnings.get(studentId) ?? 0;
    if (ignored > 0) signals.push({ studentId, type: "ignored_warnings", count: ignored });
  }
  return signals;
}

// scores = คะแนนที่ส่งแล้วของรอบนี้ (จะกรองเหลือเฉพาะที่ให้กันในกลุ่มเอง)
// ignoredWarnings = จำนวนข้อความถึงเพื่อนที่ AI เตือนแล้วผู้เขียนเลือกส่งตามเดิม ต่อผู้เขียน
export function groupSignals(opts: {
  members: Member[];
  scores: Score[];
  ignoredWarnings: Map<string, number>;
  closed: boolean;
  minPeers: number;
}) {
  const ids = new Set(opts.members.map((m) => m.student.id));
  const scores = opts.scores.filter((s) => ids.has(s.evaluatorId) && ids.has(s.evaluateeId));
  return {
    received: receivedSignals(opts.members, opts.closed, opts.minPeers),
    givers: giverSignals(opts.members, scores, opts.ignoredWarnings, opts.closed),
  };
}
