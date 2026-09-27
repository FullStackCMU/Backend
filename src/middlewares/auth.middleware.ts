import { dbClient } from "@db/client.js";
import { enrollmentsTable, usersTable } from "@db/schema.js";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

// JWT ของระบบเก็บใน httpOnly cookie นี้ (ออกให้ตอน /auth/callback)
export const AUTH_COOKIE = "cr_token";

export type EnrollmentRole = (typeof enrollmentsTable.$inferSelect)["role"];

export interface AuthedRequest extends Request {
  user?: typeof usersTable.$inferSelect;
}

export function readCookie(header: string | undefined, name: string) {
  const pair = header
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

function unauthorized(res: Response, message: string) {
  return res.status(401).json({ message, type: "Unauthorized" });
}

// อ่าน JWT จาก cookie แล้วโหลด user จาก DB ทุก request
// (account_type / สิทธิ์ต้องมาจาก DB ไม่ใช่จาก token)
export async function authenticate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const token = readCookie(req.headers.cookie, AUTH_COOKIE);
  if (!token) return unauthorized(res, "Not logged in");

  let userId: string;
  try {
    ({ userId } = jwt.verify(token, JWT_SECRET) as { userId: string });
  } catch (err) {
    return unauthorized(res, "Invalid or expired token");
  }

  try {
    const [user] = await dbClient
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user) return unauthorized(res, "User not found");

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// บุคลากร มช. (อาจารย์/เจ้าหน้าที่) — ใช้กับงานระดับระบบ เช่น สร้างรายวิชา
export function requireStaff(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.user?.accountType !== "MISEmpAcc") {
    return res.status(403).json({
      message: "Only staff can perform this action",
      type: "Forbidden",
    });
  }
  next();
}

// ค่า default หา courseId จาก :courseId, ?courseId= หรือ body.courseId
function defaultCourseId(req: Request) {
  const value =
    req.params.courseId ?? req.query.courseId ?? req.body?.courseId;
  return typeof value === "string" ? value : undefined;
}

// ต้องลงทะเบียนในวิชานั้นด้วย role ที่กำหนด (เช็คจาก enrollments)
export function requireCourseRole(
  role: EnrollmentRole,
  getCourseId: (req: Request) => string | undefined = defaultCourseId
) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const courseId = getCourseId(req);
      if (!courseId) throw new Error("courseId is required");

      const [enrollment] = await dbClient
        .select({ id: enrollmentsTable.id })
        .from(enrollmentsTable)
        .where(
          and(
            eq(enrollmentsTable.courseId, courseId),
            eq(enrollmentsTable.userId, req.user!.id),
            eq(enrollmentsTable.role, role)
          )
        );

      if (!enrollment) {
        return res.status(403).json({
          message: `Only course ${role} can perform this action`,
          type: "Forbidden",
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
