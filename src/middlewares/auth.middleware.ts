import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: string };
}

export function authenticate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Missing or invalid Authorization header",
      type: "Unauthorized",
    });
  }

  const token = authHeader.split(" ")[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthedRequest["user"];
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ message: "Invalid or expired token", type: "Unauthorized" });
  }
}

export function requireInstructor(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.user?.role !== "instructor") {
    return res.status(403).json({
      message: "Only instructor can perform this action",
      type: "Forbidden",
    });
  }
  next();
}