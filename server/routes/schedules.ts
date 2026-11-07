import { Router, Request, Response } from "express";
import { requireAuth, authMiddleware } from "./auth";
import {
  createClassSchedule,
  getMySchedule,
  getInviteDetailsByToken,
  rsvpInviteByToken,
  cancelSchedule,
} from "../services/scheduleService";
import { verifyGoogleEmail } from "../services/googleEmailVerifier";

export const schedulesRouter = Router();

/**
 * POST /api/classes/verify-email
 * Verifies whether a student email address exists as an active Google / Gmail / Google Workspace account.
 */
schedulesRouter.post("/verify-email", requireAuth, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Email address is required" });
    }

    const verification = await verifyGoogleEmail(email.trim());
    return res.json({ success: true, verification });
  } catch (err: any) {
    console.error("[SchedulesRouter] Failed to verify email:", err);
    return res.status(500).json({ error: err.message || "Failed to verify email address" });
  }
});

/**
 * POST /api/classes/schedule
 * Tutor creates a scheduled class, registers invitees, and dispatches Nodemailer invites.
 */
schedulesRouter.post("/schedule", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      return res.status(401).json({ error: "Authentication required to schedule a class" });
    }

    if (user.role === "student") {
      return res.status(403).json({ error: "Only tutors can schedule classes. Please switch your role to Tutor." });
    }

    const { title, subject, description, scheduledAt, durationMinutes, inviteeEmails } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "A class title is required" });
    }

    if (!scheduledAt) {
      return res.status(400).json({ error: "Scheduled date and time is required" });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: "Invalid date/time format provided" });
    }

    if (scheduledDate.getTime() < Date.now() - 5 * 60000) {
      return res.status(400).json({ error: "Cannot schedule a class in the past. Please select a future date and time." });
    }

    if (typeof durationMinutes !== "undefined" && !isNaN(Number(durationMinutes)) && Number(durationMinutes) < 0) {
      return res.status(400).json({ error: "Duration cannot be negative" });
    }

    // Verify invitee emails exist in Google
    const rawInviteeEmails = Array.isArray(inviteeEmails) ? inviteeEmails : [];
    const verifiedEmails: string[] = [];
    const rejectedEmails: { email: string; reason: string }[] = [];

    for (const rawEmail of rawInviteeEmails) {
      if (typeof rawEmail === "string" && rawEmail.trim()) {
        const v = await verifyGoogleEmail(rawEmail.trim());
        if (v.valid) {
          verifiedEmails.push(v.email);
        } else {
          rejectedEmails.push({ email: rawEmail.trim(), reason: v.message });
        }
      }
    }

    if (rawInviteeEmails.length > 0 && verifiedEmails.length === 0) {
      return res.status(400).json({
        error: rejectedEmails[0]?.reason || "None of the provided student emails are valid Google accounts",
        rejectedEmails,
      });
    }

    // Determine application origin for invite links
    const appOrigin =
      req.headers.origin ||
      process.env.FRONTEND_URL ||
      `${req.protocol}://${req.get("host")}` ||
      "http://localhost:5174";

    const schedule = await createClassSchedule({
      tutorId: user.id,
      tutorName: user.full_name || "Tutor",
      tutorAvatar: user.avatar_url,
      title: title.trim(),
      subject: subject?.trim(),
      description: description?.trim(),
      scheduledAt: scheduledDate,
      durationMinutes: typeof durationMinutes !== "undefined" && !isNaN(Number(durationMinutes)) ? Number(durationMinutes) : 0,
      inviteeEmails: verifiedEmails,
      appOrigin,
    });

    return res.status(201).json({
      success: true,
      schedule,
      rejectedEmails: rejectedEmails.length > 0 ? rejectedEmails : undefined,
    });
  } catch (err: any) {
    console.error("[SchedulesRouter] Failed to schedule class:", err);
    return res.status(500).json({ error: err.message || "Failed to schedule class" });
  }
});

/**
 * GET /api/classes/my-schedule
 * Returns all upcoming and past classes for the authenticated user.
 * Explicit no-store headers prevent Safari and mobile browsers from serving stale cache.
 */
schedulesRouter.get("/my-schedule", requireAuth, async (req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const user = (req as any).user;
    if (!user || !user.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await getMySchedule(user.id, user.email || "");
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[SchedulesRouter] Failed to fetch schedule:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch schedule" });
  }
});

/**
 * GET /api/classes/invite/:token
 * Public endpoint to fetch invite card details.
 */
schedulesRouter.get("/invite/:token", async (req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const rawToken = req.params.token;
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Invalid invite token" });
    }

    const invite = await getInviteDetailsByToken(token);
    if (!invite) {
      return res.status(404).json({ error: "Class invitation not found or link has expired" });
    }

    return res.json({ success: true, invite });
  } catch (err: any) {
    console.error("[SchedulesRouter] Failed to fetch invite details:", err);
    return res.status(500).json({ error: err.message || "Failed to load invitation" });
  }
});

/**
 * POST /api/classes/invite/:token/rsvp
 * Updates RSVP status (accepted/declined) using the cryptographic invite token sent to recipient's email.
 * If authenticated with Google, links their user ID to the invitation.
 */
schedulesRouter.post("/invite/:token/rsvp", authMiddleware, async (req: Request, res: Response) => {
  try {
    const rawToken = req.params.token;
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    const { status = "accepted" } = req.body;

    if (!["accepted", "declined"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'accepted' or 'declined'" });
    }

    const user = (req as any).user;
    const isGuest = user?.id?.startsWith("guest_") || user?.isParticipantToken;
    const validUserId = isGuest ? null : user?.id || null;
    const validUserEmail = isGuest ? "" : user?.email || "";

    const result = await rsvpInviteByToken({
      token,
      userId: validUserId,
      userEmail: validUserEmail,
      rsvpStatus: status,
    });

    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[SchedulesRouter] Failed to RSVP:", err);
    return res.status(400).json({ error: err.message || "Failed to update RSVP" });
  }
});

/**
 * DELETE /api/classes/:id
 * Tutor cancels their scheduled class.
 */
schedulesRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!user || !user.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const cancelled = await cancelSchedule(id, user.id);
    return res.json({ success: true, cancelled });
  } catch (err: any) {
    console.error("[SchedulesRouter] Failed to cancel class:", err);
    return res.status(500).json({ error: err.message || "Failed to cancel class" });
  }
});
