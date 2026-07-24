import { dbClient } from "@db/client.js";
import { usersTable } from "@db/schema.js";
import { Router } from "express";
import { authenticate, requireInstructor } from "../middlewares/auth.middleware.ts";

const router = Router();

router.get("/", authenticate, requireInstructor, async (req, res, next) => {
  try {
    const results = await dbClient
      .select({
        id: usersTable.id,
        username: usersTable.username,
        name: usersTable.name,
        role: usersTable.role,
      })
      .from(usersTable);

    res.json({ msg: "Fetch users successfully", data: results });
  } catch (err) {
    next(err);
  }
});

export default router;