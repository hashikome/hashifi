import { type NextFunction, type Request, type Response } from "express";

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }

    next();
  };
}
