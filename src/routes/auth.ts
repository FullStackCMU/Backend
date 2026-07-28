import { dbClient } from "@db/client.js";
import { usersTable } from "@db/schema.js";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Router } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "7d") as SignOptions["expiresIn"];

// POST /auth/login
router.post("/login", async (req, res, next) => {
  try {
    const username = req.body.username ?? "";
    const password = req.body.password ?? "";
    if (!username || !password)
      throw new Error("username and password are required");

    // เลือกเฉพาะคอลัมน์ที่ต้องใช้ (password ใช้เทียบ hash ในเครื่องเท่านั้น ไม่ส่งกลับ)
    const [user] = await dbClient
      .select({
        id: usersTable.id,
        username: usersTable.username,
        name: usersTable.name,
        role: usersTable.role,
        password: usersTable.password,
      })
      .from(usersTable)
      .where(eq(usersTable.username, username));
    if (!user) throw new Error("Invalid credentials");

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new Error("Invalid credentials");

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      msg: "Login successfully",
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/register — สมัครบัญชี (บังคับเป็น role "student" เท่านั้น ห้ามสมัครเป็นอาจารย์เอง)
router.post("/register", async (req, res, next) => {
  try {
    const username = String(req.body.username ?? "").trim();
    const name = String(req.body.name ?? "").trim();
    const password = req.body.password ?? "";

    if (!username || !name || !password)
      throw new Error("username, name และ password ต้องกรอกให้ครบ");
    if (password.length < 6)
      throw new Error("รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร");

    // เช็คชื่อผู้ใช้ซ้ำก่อน (มี unique constraint กันซ้ำจริงอีกชั้นตอน insert)
    const [existing] = await dbClient
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, username));
    if (existing) throw new Error("ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น");

    const hashed = await bcrypt.hash(password, 10);

    const [user] = await dbClient
      .insert(usersTable)
      .values({ username, name, password: hashed, role: "student" })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        name: usersTable.name,
        role: usersTable.role,
      });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ msg: "Register successfully", data: { token, user } });
  } catch (err) {
    next(err);
  }
});

export default router;