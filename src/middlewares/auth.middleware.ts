import { dbClient } from "@db/client.js";
import { enrollmentsTable, usersTable } from "@db/schema.js";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

export const AUTH_COOKIE = "cr_token";

export type EnrollmentRole = (typeof enrollmentsTable.$inferSelect)["role"];

export interface AuthedRequest extends Request {
  user?: typeof usersTable.$inferSelect;
  // courseId / courseRole มีค่าเฉพาะหลังผ่าน requireCourseRole
  courseId?: string;
  courseRole?: EnrollmentRole;
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

// สิทธิ์ต้องมาจาก DB ไม่ใช่จาก token
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

// MISEmpAcc = บุคลากร มช.
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

function defaultCourseId(req: Request) {
  const value =
    req.params.courseId ?? req.query.courseId ?? req.body?.courseId;
  return typeof value === "string" ? value : undefined;
}

export function requireCourseRole(
  role: EnrollmentRole | EnrollmentRole[],
  getCourseId: (req: Request) => string | undefined | Promise<string | undefined> = defaultCourseId
) {
  const roles = Array.isArray(role) ? role : [role];
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const courseId = await getCourseId(req);
      if (!courseId) throw new Error("courseId is required");

      const [enrollment] = await dbClient
        .select({ role: enrollmentsTable.role })
        .from(enrollmentsTable)
        .where(
          and(
            eq(enrollmentsTable.courseId, courseId),
            eq(enrollmentsTable.userId, req.user!.id)
          )
        );

      if (!enrollment || !roles.includes(enrollment.role)) {
        return res.status(403).json({
          message: `Only course ${roles.join("/")} can perform this action`,
          type: "Forbidden",
        });
      }
      req.courseId = courseId;
      req.courseRole = enrollment.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}
