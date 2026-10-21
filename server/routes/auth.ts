import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

export function generateToken(payload: { id: string; email?: string; role: string; name: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function authMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = decoded;
  } catch (err) {
    // Expired or invalid token
  }
  next();
}

/**
 * POST /api/auth/google
 * Handles Google OAuth authenticated profile from frontend
 */
authRouter.post("/google", async (req: Request, res: Response) => {
  try {
    const { email, name, avatarUrl, providerUserId, role = "tutor" } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const displayName = name || email.split("@")[0] || "User";

    // Upsert user into PostgreSQL
    const upsertSql = `
      INSERT INTO users (email, full_name, avatar_url, role, auth_provider, provider_user_id, updated_at)
      VALUES ($1, $2, $3, $4, 'google', $5, NOW())
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        provider_user_id = COALESCE(EXCLUDED.provider_user_id, users.provider_user_id),
        updated_at = NOW()
      RETURNING id, email, full_name, avatar_url, role;
    `;

    const result = await query(upsertSql, [email, displayName, avatarUrl || "", role, providerUserId || ""]);
    const user = result.rows[0];

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.full_name,
    });

    return res.json({
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        role: user.role,
        isHost: user.role === "tutor",
      },
      token,
    });
  } catch (err: any) {
    console.error("[Auth /google Error]:", err.message);
    return res.status(500).json({ error: "Failed to authenticate with Google", details: err.message });
  }
});

/**
 * POST /api/auth/guest
 * Allows instant guest student or tutor session
 */
authRouter.post("/guest", async (req: Request, res: Response) => {
  try {
    const { guestName, role = "student" } = req.body;
    const cleanName = (guestName || "").trim() || (role === "tutor" ? "Tutor" : "Student");
    const isTutor = role === "tutor";
    const guestAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(cleanName)}&backgroundColor=${isTutor ? "1a73e8" : "10b981"}`;

    const insertSql = `
      INSERT INTO users (full_name, avatar_url, role, auth_provider)
      VALUES ($1, $2, $3, 'guest')
      RETURNING id, full_name, avatar_url, role;
    `;

    const result = await query(insertSql, [cleanName, guestAvatar, role]);
    const user = result.rows[0];

    const token = generateToken({
      id: user.id,
      role: user.role,
      name: user.full_name,
    });

    return res.json({
      user: {
        id: user.id,
        name: user.full_name,
        email: "",
        avatarUrl: user.avatar_url,
        role: user.role,
        isHost: isTutor,
      },
      token,
    });
  } catch (err: any) {
    console.error("[Auth /guest Error]:", err.message);
    return res.status(500).json({ error: "Failed to create guest user", details: err.message });
  }
});

/**
 * GET /api/auth/me
 * Validate current token and fetch profile
 */
authRouter.get("/me", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const result = await query("SELECT id, email, full_name, avatar_url, role FROM users WHERE id = $1", [decoded.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const u = result.rows[0];
    return res.json({
      user: {
        id: u.id,
        name: u.full_name,
        email: u.email || "",
        avatarUrl: u.avatar_url,
        role: u.role,
        isHost: u.role === "tutor",
      },
      token,
    });
  } catch (err: any) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});
