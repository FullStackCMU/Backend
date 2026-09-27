import { dbClient } from "@db/client.js";
import { usersTable } from "@db/schema.js";
import { Router } from "express";
import { authenticate, requireStaff } from "../middlewares/auth.middleware.ts";

const router = Router();

router.get("/", authenticate, requireStaff, async (req, res, next) => {
  try {
    const results = await dbClient
      .select({
        id: usersTable.id,
        cmuAccount: usersTable.cmuAccount,
        studentId: usersTable.studentId,
        firstnameTh: usersTable.firstnameTh,
        lastnameTh: usersTable.lastnameTh,
        firstnameEn: usersTable.firstnameEn,
        lastnameEn: usersTable.lastnameEn,
        accountType: usersTable.accountType,
      })
      .from(usersTable);

    res.json({ msg: "Fetch users successfully", data: results });
  } catch (err) {
    next(err);
  }
});

export default router;
