import { describe, expect, it } from "vitest";
import { groupSignals, median } from "../src/lib/insights.ts";

type Options = Parameters<typeof groupSignals>[0];
type Member = Options["members"][number];
type Score = Options["scores"][number];

function member(
  id: string,
  o: {
    peer?: number | null;
    self?: number | null;
    peerCount?: number;
    status?: "draft" | "submitted" | null;
    scores?: Member["scores"];
  } = {}
): Member {
  const peer = o.peer === undefined ? 4 : o.peer;
  const self = o.self === undefined ? 4 : o.self;
  return {
    student: { id },
    submission: o.status === null ? null : { status: o.status ?? "submitted" },
    peerCount: o.peerCount ?? 2,
    scores: o.scores ?? [],
    overall: {
      peerAverage: peer,
      selfAverage: self,
      gap: peer !== null && self !== null ? Math.round((self - peer) * 10) / 10 : null,
    },
  };
}

// คะแนนที่ evaluator ให้ evaluatee ข้อละหนึ่งค่า
const give = (evaluatorId: string, evaluateeId: string, ...values: number[]): Score[] =>
  values.map((score, i) => ({ evaluatorId, evaluateeId, questionId: `q${i + 1}`, score }));

const run = (members: Member[], extra: Partial<Options> = {}) =>
  groupSignals({ members, scores: [], ignoredWarnings: new Map(), closed: true, minPeers: 2, ...extra });

const ofType = <T extends { type: string }>(signals: T[], type: string) => signals.filter((s) => s.type === type);

describe("median", () => {
  it("ไม่มีข้อมูลคืน null", () => {
    expect(median([])).toBeNull();
  });

  it("จำนวนคี่ใช้ค่ากลาง จำนวนคู่ใช้ค่าเฉลี่ยของสองค่ากลาง", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("ปัดเป็นทศนิยมหนึ่งตำแหน่ง", () => {
    expect(median([3.33, 3.38])).toBe(3.4);
  });
});

describe("สัญญาณจากผลที่ได้รับ", () => {
  it("คะแนนรวมจากเพื่อนต่ำกว่า 3 เท่านั้นจึงเตือน", () => {
    const { received } = run([member("a", { peer: 2.9, self: 2.9 }), member("b", { peer: 3, self: 3 })]);
    expect(ofType(received, "low_overall")).toEqual([{ studentId: "a", type: "low_overall", value: 2.9 }]);
  });

  it("ด้านที่ต่ำกว่าเพื่อนร่วมกลุ่มตั้งแต่ 1 คะแนน เทียบโดยไม่นับตัวเอง", () => {
    const q1 = (peerAverage: number) => [{ questionId: "q1", peerAverage, selfScore: 4 }];
    const { received } = run([
      member("a", { scores: q1(3) }),
      member("b", { scores: q1(4) }),
      member("c", { scores: q1(4) }),
    ]);
    expect(ofType(received, "low_dimension")).toEqual([
      { studentId: "a", type: "low_dimension", dimensions: [{ questionId: "q1", value: 3, reference: 4 }] },
    ]);
  });

  it("ต่ำกว่าเพื่อนไม่ถึง 1 คะแนนไม่เตือน", () => {
    const q1 = (peerAverage: number) => [{ questionId: "q1", peerAverage, selfScore: 4 }];
    const { received } = run([member("a", { scores: q1(3.1) }), member("b", { scores: q1(4) })]);
    expect(ofType(received, "low_dimension")).toEqual([]);
  });

  it("ให้ตัวเองต่างจากเพื่อนตั้งแต่ 1 คะแนน แยกเป็นสูงกว่าและต่ำกว่า", () => {
    const { received } = run([
      member("over", { peer: 3, self: 4.5 }),
      member("under", { peer: 4.5, self: 3 }),
      member("close", { peer: 4, self: 4.9 }),
    ]);
    expect(ofType(received, "self_over")).toEqual([{ studentId: "over", type: "self_over", value: 4.5, reference: 3 }]);
    expect(ofType(received, "self_under")).toEqual([
      { studentId: "under", type: "self_under", value: 3, reference: 4.5 },
    ]);
  });

  it("ผู้ประเมินไม่พอเตือนเฉพาะหลังปิดรับ", () => {
    const members = [member("a", { peerCount: 1 }), member("b", { peerCount: 2 })];
    expect(ofType(run(members).received, "few_raters")).toEqual([{ studentId: "a", type: "few_raters", count: 1 }]);
    expect(ofType(run(members, { closed: false }).received, "few_raters")).toEqual([]);
  });
});

describe("สัญญาณการเป็นผู้ให้ฟีดแบ็ก", () => {
  it("ไม่ส่งหรือส่งค้างเป็นแบบร่าง เตือนเฉพาะหลังปิดรับ และไม่มีสัญญาณอื่นของคนนั้น", () => {
    const members = [member("none", { status: null }), member("draft", { status: "draft" }), member("ok")];
    const ignoredWarnings = new Map([["none", 3]]);
    expect(run(members, { ignoredWarnings }).givers).toEqual([
      { studentId: "none", type: "not_submitted" },
      { studentId: "draft", type: "not_submitted" },
    ]);
    expect(run(members, { closed: false, ignoredWarnings }).givers).toEqual([]);
  });

  it("ให้เพื่อนตั้งแต่สองคนเท่ากันทุกข้อ ไม่นับคะแนนที่ให้ตัวเอง", () => {
    const members = [member("a"), member("b"), member("c")];
    const scores = [...give("a", "a", 3, 3), ...give("a", "b", 5, 5), ...give("a", "c", 5, 5)];
    expect(ofType(run(members, { scores }).givers, "straight_lining")).toEqual([
      { studentId: "a", type: "straight_lining", value: 5 },
    ]);
  });

  it("ให้เพื่อนคนเดียวเท่ากันทุกข้อ หรือให้ไม่เท่ากัน ไม่เตือน", () => {
    const members = [member("a"), member("b"), member("c")];
    expect(ofType(run(members, { scores: give("a", "b", 4, 4) }).givers, "straight_lining")).toEqual([]);
    const mixed = [...give("a", "b", 5, 5), ...give("a", "c", 5, 4)];
    expect(ofType(run(members, { scores: mixed }).givers, "straight_lining")).toEqual([]);
  });

  it("ให้ตัวเองสูงกว่าที่ให้เพื่อนตั้งแต่ 1.5 คะแนน", () => {
    const members = [member("a", { self: 5 }), member("b"), member("c")];
    const gap15 = [...give("a", "b", 4, 3), ...give("a", "c", 4, 3)];
    expect(ofType(run(members, { scores: gap15 }).givers, "self_serving")).toEqual([
      { studentId: "a", type: "self_serving", value: 5, reference: 3.5 },
    ]);
    const gap14 = [...give("a", "b", 4, 4, 4), ...give("a", "c", 3, 3)];
    expect(ofType(run(members, { scores: gap14 }).givers, "self_serving")).toEqual([]);
  });

  it("ให้คะแนนต่างจากค่ากลางของกลุ่มตั้งแต่ 1 คะแนน เมื่อมีผู้ประเมินอย่างน้อยสามคน", () => {
    const members = [member("a"), member("b"), member("c")];
    const scores = [
      ...give("a", "b", 5),
      ...give("a", "c", 5),
      ...give("b", "a", 4),
      ...give("b", "c", 4),
      ...give("c", "a", 2),
      ...give("c", "b", 2),
    ];
    const { givers } = run(members, { scores });
    expect(ofType(givers, "lenient")).toEqual([{ studentId: "a", type: "lenient", value: 5, reference: 4 }]);
    expect(ofType(givers, "harsh")).toEqual([{ studentId: "c", type: "harsh", value: 2, reference: 4 }]);
  });

  it("ผู้ประเมินสองคนบอกไม่ได้ว่าใครให้สูงหรือต่ำ", () => {
    const members = [member("a"), member("b")];
    const { givers } = run(members, { scores: [...give("a", "b", 5), ...give("b", "a", 2)] });
    expect([...ofType(givers, "lenient"), ...ofType(givers, "harsh")]).toEqual([]);
  });

  it("นับข้อความที่ AI เตือนแล้วส่งตามเดิม", () => {
    const { givers } = run([member("a"), member("b")], { ignoredWarnings: new Map([["a", 2]]) });
    expect(givers).toEqual([{ studentId: "a", type: "ignored_warnings", count: 2 }]);
  });

  it("ไม่นับคะแนนที่ให้คนนอกกลุ่ม", () => {
    const scores = [...give("a", "x", 5, 5), ...give("a", "y", 5, 5), ...give("a", "b", 5, 5)];
    expect(ofType(run([member("a"), member("b")], { scores }).givers, "straight_lining")).toEqual([]);
  });
});
