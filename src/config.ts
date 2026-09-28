// แก้เนื้อหานโยบายต้องขึ้นเวอร์ชันให้ตรงกับ Frontend/src/lib/consent-policy.ts
export const CONSENT_POLICY_VERSION = "2026-09-v4";

// ต้องตรงกับ provider ที่แจ้งใน consent — ไม่ตรง = ระบบปิดการตรวจ
export const CONSENT_AI_PROVIDER = "deepseek";

// รวมทุกข้อความในคำขอเดียว เกินแล้วปล่อยผ่าน
export const COMMENT_CHECK_TIMEOUT_MS = 5000;

// เพื่อนประเมินน้อยกว่านี้ไม่แสดงผล — คะแนนจากคนเดียวรู้ได้ว่าใครให้
export const MIN_PEERS_FOR_ANONYMITY = 2;
