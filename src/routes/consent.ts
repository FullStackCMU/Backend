import { dbClient } from "@db/client.js";
import { consentsTable } from "@db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { CONSENT_POLICY_VERSION } from "../config.ts";
import { authenticate, type AuthedRequest } from "../middlewares/auth.middleware.ts";

const router = Router();

async function findActiveConsent(userId: string) {
  const [consent] = await dbClient
    .select({ acceptedAt: consentsTable.acceptedAt })
    .from(consentsTable)
    .where(
      and(
        eq(consentsTable.userId, userId),
        eq(consentsTable.policyVersion, CONSENT_POLICY_VERSION),
        isNull(consentsTable.withdrawnAt)
      )
    );
  return {
    policyVersion: CONSENT_POLICY_VERSION,
    accepted: !!consent,
    acceptedAt: consent?.acceptedAt ?? null,
  };
}

// GET /consents/me — ยอมรับนโยบายเวอร์ชันปัจจุบันแล้วหรือยัง
router.get("/me", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const data = await findActiveConsent(req.user!.id);
    res.json({ msg: "Fetch consent successfully", data });
  } catch (err) {
    next(err);
  }
});

// POST /consents { policyVersion } — ยอมรับนโยบาย
// ต้องส่งเวอร์ชันที่หน้าเว็บแสดงอยู่มาด้วย กันกรณีนโยบายเปลี่ยนระหว่างที่เปิดหน้าค้างไว้
router.post("/", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const policyVersion = String(req.body.policyVersion ?? "");
    if (policyVersion !== CONSENT_POLICY_VERSION) {
      const err: any = new Error(
        "นโยบายมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่แล้วอ่านอีกครั้ง"
      );
      err.statusCode = 409;
      throw err;
    }

    // ยอมรับซ้ำ = ไม่ทำอะไร (partial unique index กันแถวซ้ำอยู่แล้ว)
    await dbClient
      .insert(consentsTable)
      .values({ userId: req.user!.id, policyVersion })
      .onConflictDoNothing();

    const data = await findActiveConsent(req.user!.id);
    res.json({ msg: "Accept consent successfully", data });
  } catch (err) {
    next(err);
  }
});

export default router;
