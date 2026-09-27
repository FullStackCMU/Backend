import { dbClient } from "@db/client.js";
import { usersTable } from "@db/schema.js";
import { randomBytes } from "node:crypto";
import Debug from "debug";
import { sql } from "drizzle-orm";
import { Router, type CookieOptions } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import {
  AUTH_COOKIE,
  authenticate,
  readCookie,
  type AuthedRequest,
} from "../middlewares/auth.middleware.ts";

const router = Router();
const debug = Debug("pf-backend:oauth");

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "7d") as SignOptions["expiresIn"];

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? "";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? "";
const OAUTH_AUTHORIZE_URL = process.env.OAUTH_AUTHORIZE_URL ?? "";
const OAUTH_TOKEN_URL = process.env.OAUTH_TOKEN_URL ?? "";
const OAUTH_REDIRECT_URL = process.env.OAUTH_REDIRECT_URL ?? "";
const OAUTH_SCOPE = process.env.OAUTH_SCOPE ?? "openid profile email basic_info";
// Authentik: userinfo อยู่ข้าง token endpoint (.../application/o/userinfo/)
const OAUTH_USERINFO_URL =
  process.env.OAUTH_USERINFO_URL ??
  OAUTH_TOKEN_URL.replace(/token\/$/, "userinfo/");

// login เสร็จแล้วส่งกลับหน้าเว็บ (ตัวแรกของ CORS_ORIGIN)
const FRONTEND_URL =
  process.env.CORS_ORIGIN?.split(",")[0]?.trim() || "http://localhost:5173";

const OAUTH_STATE_COOKIE = "cr_oauth_state";

const cookieBase: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

type AccountType = NonNullable<(typeof usersTable.$inferSelect)["accountType"]>;
const ACCOUNT_TYPES: AccountType[] = ["StdAcc", "MISEmpAcc"];

type BasicInfo = {
  cmuitaccount?: string;
  student_id?: string;
  firstname_TH?: string;
  lastname_TH?: string;
  firstname_EN?: string;
  lastname_EN?: string;
  itaccounttype_id?: string;
};

// GET /auth/login — redirect ไปหน้า authorize ของ CPE OAuth
router.get("/login", (req, res, next) => {
  try {
    if (!OAUTH_CLIENT_ID || !OAUTH_AUTHORIZE_URL || !OAUTH_REDIRECT_URL)
      throw new Error("OAuth is not configured");

    // state กัน CSRF — เก็บใน cookie แล้วเทียบตอน callback
    const state = randomBytes(16).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      ...cookieBase,
      maxAge: 10 * 60 * 1000,
    });

    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URL);
    url.searchParams.set("scope", OAUTH_SCOPE);
    url.searchParams.set("state", state);

    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

// error ของ callback → redirect ไปหน้า login ของ frontend พร้อม ?error=<code>
class CallbackError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

function loginErrorUrl(code: string) {
  const url = new URL("/login", FRONTEND_URL);
  url.searchParams.set("error", code);
  return url.toString();
}

// GET /auth/callback?code=&state= — แลก code → ดึง userinfo → upsert user
// → ออก JWT ใส่ cookie แล้ว redirect กลับหน้าเว็บ
router.get("/callback", async (req, res) => {
  try {
    if (req.query.error)
      throw new CallbackError(
        "oauth_error",
        `${req.query.error} ${req.query.error_description ?? ""}`
      );

    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const expectedState = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
    res.clearCookie(OAUTH_STATE_COOKIE, cookieBase);

    if (!code) throw new CallbackError("missing_code");
    if (!state || state !== expectedState)
      throw new CallbackError("invalid_state");

    const tokenRes = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: OAUTH_REDIRECT_URL,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
      }),
    });
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokens.access_token)
      throw new CallbackError(
        "token_exchange_failed",
        `${tokens.error} ${tokens.error_description ?? ""}`
      );

    const userinfoRes = await fetch(OAUTH_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userinfoRes.ok)
      throw new CallbackError("userinfo_failed", `HTTP ${userinfoRes.status}`);
    const userinfo = (await userinfoRes.json()) as { basic_info?: BasicInfo };
    const info = userinfo.basic_info ?? {};

    const cmuAccount = info.cmuitaccount?.trim().toLowerCase();
    if (!cmuAccount) throw new CallbackError("missing_account");

    const accountType = info.itaccounttype_id as AccountType;
    if (!ACCOUNT_TYPES.includes(accountType))
      throw new CallbackError(
        "account_type_not_allowed",
        String(info.itaccounttype_id)
      );

    // ข้อมูลจาก CMU เป็นข้อมูลล่าสุดเสมอ — อัปเดตทุกครั้งที่ login
    const profile = {
      studentId: info.student_id || null,
      firstnameTh: info.firstname_TH || null,
      lastnameTh: info.lastname_TH || null,
      firstnameEn: info.firstname_EN || null,
      lastnameEn: info.lastname_EN || null,
      accountType,
    };
    const now = new Date();

    // มีอยู่แล้ว (import ไว้หรือเคย login) → อัปเดต profile + เวลา login, ไม่มี → สร้างใหม่
    const [user] = await dbClient
      .insert(usersTable)
      .values({
        cmuAccount,
        ...profile,
        firstLoginAt: now,
        lastLoginAt: now,
      })
      .onConflictDoUpdate({
        target: usersTable.cmuAccount,
        set: {
          ...profile,
          lastLoginAt: now,
          firstLoginAt: sql`coalesce(${usersTable.firstLoginAt}, now())`,
        },
      })
      .returning({ id: usersTable.id });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
    const { exp } = jwt.decode(token) as { exp: number };

    res.cookie(AUTH_COOKIE, token, {
      ...cookieBase,
      expires: new Date(exp * 1000),
    });
    res.redirect(FRONTEND_URL);
  } catch (err) {
    const code = err instanceof CallbackError ? err.code : "server_error";
    debug("callback failed [%s]: %s", code, (err as Error).message);
    res.redirect(loginErrorUrl(code));
  }
});

// GET /auth/me — ข้อมูลผู้ใช้ที่ login อยู่
router.get("/me", authenticate, (req: AuthedRequest, res) => {
  res.json({ msg: "Fetch current user successfully", data: req.user });
});

// POST /auth/logout — ลบ cookie
router.post("/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE, cookieBase);
  res.json({ msg: "Logout successfully", data: null });
});

export default router;
