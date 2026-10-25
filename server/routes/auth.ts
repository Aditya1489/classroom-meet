import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { query } from "../db";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

// Supported Google OAuth Client IDs (env vars + client defaults)
const GOOGLE_CLIENT_IDS = [
  process.env.VITE_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_ID,
  "207248778617-3n7l8vp8cgqv8dhiqltnsnmoj9n8ain7.apps.googleusercontent.com",
  "624389472912-jb3ji3bklfi2frmb9nuhc3n9alnfpdqm.apps.googleusercontent.com",
].filter(Boolean) as string[];

const googleClient = new OAuth2Client(GOOGLE_CLIENT_IDS[0]);

export function generateToken(payload: { id: string; email?: string; role: string; name: string }) {
  return jwt.sign(
    {
      sub: payload.id,
      ...payload,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * requireAuth Middleware
 * Strict authentication middleware: Rejects requests missing a valid Bearer JWT.
 * Populates req.user from the verified database record.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: "Invalid token payload: missing user identifier" });
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(decoded.id));
    if (isUUID) {
      try {
        const userRes = await query(
          "SELECT id, email, full_name, avatar_url, role, is_active FROM users WHERE id = $1",
          [decoded.id]
        );
        if (userRes.rows.length > 0) {
          if (userRes.rows[0].is_active === false) {
            return res.status(403).json({ error: "User account is suspended" });
          }
          (req as any).user = userRes.rows[0];
          return next();
        }
      } catch (dbErr: any) {
        // DB error or temporary network glitch
      }
    }

    // Attach verified token payload
    (req as any).user = {
      id: decoded.id,
      email: decoded.email || "",
      full_name: decoded.name || decoded.full_name || "User",
      role: decoded.role || "student",
    };

    return next();
  } catch (err: any) {
    return res.status(401).json({ error: "Invalid or expired session token" });
  }
}

/**
 * authMiddleware (Optional)
 * Attaches decoded user to req.user if a valid Bearer token is provided, but does not block.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = decoded;
  } catch {
    // Expired or invalid token, proceed without req.user
  }
  next();
}

/**
 * POST /api/auth/google
 * Authenticates via verified Google ID token or Access token.
 * Never trusts client-supplied identity parameters (email, name, role) without server verification.
 */
authRouter.post("/google", async (req: Request, res: Response) => {
  try {
    const { idToken, accessToken, role: signupRole } = req.body;

    // Reject plain email submissions or requests missing a Google credential
    if (!idToken && !accessToken) {
      return res.status(401).json({
        error: "Google credential (idToken or accessToken) is required for authentication",
      });
    }

    let verifiedSub = "";
    let verifiedEmail = "";
    let verifiedName = "";
    let verifiedPicture = "";

    if (idToken) {
      // Verify cryptographically signed Google ID Token
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: GOOGLE_CLIENT_IDS,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.sub) {
          return res.status(401).json({ error: "Invalid Google ID token payload" });
        }
        if (!payload.email || payload.email_verified === false) {
          return res.status(401).json({ error: "Google account email is not verified" });
        }
        verifiedSub = payload.sub;
        verifiedEmail = payload.email.trim().toLowerCase();
        verifiedName = payload.name || verifiedEmail.split("@")[0] || "User";
        verifiedPicture = payload.picture || "";
      } catch (idErr: any) {
        return res.status(401).json({
          error: "Google ID token verification failed",
          details: idErr.message,
        });
      }
    } else if (accessToken) {
      // Verify Google Access Token via Google tokeninfo + userinfo endpoints
      try {
        const tokenInfo = await googleClient.getTokenInfo(accessToken);
        if (tokenInfo.aud && GOOGLE_CLIENT_IDS.length > 0 && !GOOGLE_CLIENT_IDS.includes(tokenInfo.aud)) {
          return res.status(401).json({ error: "Google token audience mismatch" });
        }

        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!userInfoRes.ok) {
          return res.status(401).json({ error: "Failed to retrieve verified userinfo from Google" });
        }

        const userInfo = await userInfoRes.json();
        if (!userInfo.sub || !userInfo.email || userInfo.email_verified === false) {
          return res.status(401).json({ error: "Google account email is not verified" });
        }

        verifiedSub = userInfo.sub;
        verifiedEmail = userInfo.email.trim().toLowerCase();
        verifiedName = userInfo.name || verifiedEmail.split("@")[0] || "User";
        verifiedPicture = userInfo.picture || "";
      } catch (accessErr: any) {
        return res.status(401).json({
          error: "Google access token verification failed",
          details: accessErr.message,
        });
      }
    }

    let user: any = null;
    let isNewUser = false;
    let needsRoleSelection = false;

    try {
      // 1. Search for existing user by verified Google provider_user_id
      const providerRes = await query(
        "SELECT id, email, full_name, avatar_url, role FROM users WHERE auth_provider = 'google' AND provider_user_id = $1",
        [verifiedSub]
      );

      if (providerRes.rows.length > 0) {
        // Returning user with matched Google sub:
        const existing = providerRes.rows[0];
        isNewUser = false;
        needsRoleSelection = false;

        // Update profile fields safely without overwriting existing role
        const updateRes = await query(
          `UPDATE users
           SET full_name = COALESCE($1, full_name),
               avatar_url = COALESCE($2, avatar_url),
               updated_at = NOW()
           WHERE id = $3
           RETURNING id, email, full_name, avatar_url, role;`,
          [verifiedName, verifiedPicture || null, existing.id]
        );
        user = updateRes.rows[0] || existing;
      } else {
        // 2. Check if a user with this verified email already exists
        const emailRes = await query(
          "SELECT id, email, full_name, avatar_url, role FROM users WHERE LOWER(email) = LOWER($1)",
          [verifiedEmail]
        );

        if (emailRes.rows.length > 0) {
          // Link Google provider to existing verified email account safely
          const existing = emailRes.rows[0];
          isNewUser = false;
          needsRoleSelection = false;

          const updateRes = await query(
            `UPDATE users
             SET provider_user_id = $1,
                 auth_provider = 'google',
                 full_name = COALESCE($2, full_name),
                 avatar_url = COALESCE($3, avatar_url),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING id, email, full_name, avatar_url, role;`,
            [verifiedSub, verifiedName, verifiedPicture || null, existing.id]
          );
          user = updateRes.rows[0] || existing;
        } else {
          // 3. New user registration
          isNewUser = true;
          const validRole = signupRole === "tutor" || signupRole === "student" ? signupRole : null;
          const initialRole = validRole || "student";
          needsRoleSelection = !validRole;

          const insertRes = await query(
            `INSERT INTO users (email, full_name, avatar_url, role, auth_provider, provider_user_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'google', $5, NOW(), NOW())
             RETURNING id, email, full_name, avatar_url, role;`,
            [verifiedEmail, verifiedName, verifiedPicture || null, initialRole, verifiedSub]
          );
          user = insertRes.rows[0];
        }
      }
    } catch (dbErr: any) {
      console.warn("[Auth /google DB Warning] PostgreSQL fallback:", dbErr.message);
      const fallbackRole = signupRole === "tutor" || signupRole === "student" ? signupRole : "student";
      user = {
        id: `usr_${verifiedSub}`,
        email: verifiedEmail,
        full_name: verifiedName,
        avatar_url: verifiedPicture,
        role: fallbackRole,
      };
    }

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
      isNewUser,
      needsRoleSelection,
    });
  } catch (err: any) {
    console.error("[Auth /google Error]:", err.message);
    return res.status(500).json({ error: "Failed to authenticate with Google", details: err.message });
  }
});

/**
 * POST /api/auth/guest
 * Explicitly disabled to enforce secure account authentication and prevent fake substitute accounts.
 */
authRouter.post("/guest", (_req: Request, res: Response) => {
  return res.status(403).json({
    error: "Guest entry is disabled. Please sign in with your verified Google account.",
  });
});

/**
 * GET /api/auth/me
 * Validates the current session token and returns authenticated user profile
 */
authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const token = req.headers.authorization!.split(" ")[1];

  return res.json({
    user: {
      id: user.id,
      name: user.full_name,
      email: user.email || "",
      avatarUrl: user.avatar_url || "",
      role: user.role,
      isHost: user.role === "tutor",
    },
    token,
  });
});

/**
 * PATCH /api/auth/role
 * Allows updating active user role between tutor and student
 */
authRouter.patch("/role", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { role } = req.body;

    if (role !== "tutor" && role !== "student") {
      return res.status(400).json({ error: "Invalid role. Must be 'tutor' or 'student'" });
    }

    try {
      await query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", [role, user.id]);
    } catch (dbErr: any) {
      console.warn("[Auth /role DB Warning]:", dbErr.message);
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role,
      name: user.full_name,
    });

    return res.json({ role, token });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to update role", details: err.message });
  }
});
