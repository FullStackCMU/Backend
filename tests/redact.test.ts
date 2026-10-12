import { describe, expect, it } from "vitest";
import { nameVariants, redactPersonalInfo } from "../src/lib/comment-check/redact.ts";

// ข้อความที่ส่งให้ AI ตรวจต้องไม่มีข้อมูลระบุตัวบุคคล
describe("redactPersonalInfo", () => {
  it("ตัดอีเมลและรหัสนักศึกษา 9 หลัก", () => {
    expect(redactPersonalInfo("ติดต่อ somchai_jaidee@cmu.ac.th รหัส 669999001", [])).toBe("ติดต่อ [อีเมล] รหัส [รหัส]");
  });

  it("เลขที่ไม่ใช่ 9 หลักไม่ถูกตัด", () => {
    expect(redactPersonalInfo("โทร 0812345678 ห้อง 12345678", [])).toBe("โทร 0812345678 ห้อง 12345678");
  });

  it("แทนชื่อไทยที่อยู่ติดกับคำอื่น", () => {
    expect(redactPersonalInfo("สมชายมาสายทุกครั้ง", ["สมชาย"])).toBe("[เพื่อน]มาสายทุกครั้ง");
  });

  it("ชื่อยาวถูกแทนก่อนชื่อสั้นที่ซ้อนอยู่ข้างใน", () => {
    expect(redactPersonalInfo("สมชายมาสาย", ["สม", "สมชาย"])).toBe("[เพื่อน]มาสาย");
  });

  it("ชื่อสั้นกว่า 2 ตัวอักษรไม่ถูกแทน", () => {
    expect(redactPersonalInfo("กาก", ["ก"])).toBe("กาก");
  });

  it("ชื่ออังกฤษไม่สนตัวพิมพ์ และไม่ตัดกลางคำ", () => {
    expect(redactPersonalInfo("som is late, Somchai too", ["Som"])).toBe("[เพื่อน] is late, Somchai too");
  });

  it("ชื่อกับนามสกุลที่ติดกันรวมเป็นคำแทนเดียว", () => {
    expect(redactPersonalInfo("สมชาย ใจดี ไม่ส่งงาน", ["สมชาย", "ใจดี"])).toBe("[เพื่อน] ไม่ส่งงาน");
  });

  it("อีเมลถูกแทนทั้งก้อนก่อนจะแทนชื่อ", () => {
    expect(redactPersonalInfo("somchai_jaidee@cmu.ac.th", ["somchai"])).toBe("[อีเมล]");
  });
});

describe("nameVariants", () => {
  it("รวมชื่อไทย ชื่ออังกฤษ และส่วนของบัญชี CMU โดยข้ามค่าที่ว่าง", () => {
    expect(
      nameVariants({
        firstnameTh: "สมชาย",
        lastnameTh: "ใจดี",
        firstnameEn: "SOMCHAI",
        lastnameEn: null,
        cmuAccount: "somchai_jaidee@cmu.ac.th",
      })
    ).toEqual(["สมชาย", "ใจดี", "SOMCHAI", "somchai_jaidee", "somchai", "jaidee"]);
  });
});
