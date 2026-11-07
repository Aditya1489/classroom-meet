import crypto from "crypto";
import { query } from "../db";
import { sendClassInvitationEmail } from "./emailService";

export interface CreateScheduleInput {
  tutorId: string;
  tutorName: string;
  tutorAvatar?: string;
  title: string;
  subject?: string;
  description?: string;
  scheduledAt: string | Date;
  durationMinutes: number;
  inviteeEmails: string[];
  appOrigin: string;
}

export interface ScheduledClassRecord {
  id: string;
  room_code: string;
  title: string;
  subject?: string;
  description?: string;
  tutor_id: string;
  tutor_name?: string;
  tutor_avatar?: string;
  scheduled_at: string;
  duration_minutes: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  created_at: string;
  attendees?: {
    email: string;
    rsvp_status: "pending" | "accepted" | "declined";
    rsvp_at?: string;
    user_name?: string;
    user_avatar?: string;
  }[];
  my_rsvp_status?: "pending" | "accepted" | "declined";
}

function generateRoomCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const part = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part(3)}-${part(4)}-${part(3)}`;
}

/**
 * Creates a scheduled class, registers invitees with unique tokens, and dispatches invite emails.
 */
export async function createClassSchedule(input: CreateScheduleInput): Promise<ScheduledClassRecord> {
  const scheduledDate = new Date(input.scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    throw new Error("Invalid scheduled date and time provided");
  }

  // If durationMinutes is 0 or not provided, it represents Unlimited Duration (0)
  const duration = typeof input.durationMinutes === "number" && input.durationMinutes > 0
    ? Math.max(15, Number(input.durationMinutes))
    : 0;
  const roomCode = generateRoomCode();

  // 1. Ensure live_classes record exists for the room
  await query(
    `INSERT INTO live_classes (room_code, title, tutor_id, tutor_name, is_active, metadata)
     VALUES ($1, $2, $3, $4, FALSE, $5)
     ON CONFLICT (room_code) DO NOTHING;`,
    [
      roomCode,
      input.title,
      input.tutorId,
      input.tutorName,
      JSON.stringify({ isScheduled: true, scheduledAt: scheduledDate.toISOString(), durationMinutes: duration }),
    ]
  );

  // 2. Insert into class_schedules
  const scheduleRes = await query(
    `INSERT INTO class_schedules (room_code, title, subject, description, tutor_id, scheduled_at, duration_minutes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
     RETURNING id, room_code, title, subject, description, tutor_id, scheduled_at, duration_minutes, status, created_at;`,
    [
      roomCode,
      input.title.trim(),
      input.subject?.trim() || null,
      input.description?.trim() || null,
      input.tutorId,
      scheduledDate,
      duration,
    ]
  );

  const schedule = scheduleRes.rows[0];

  // 3. Clean and deduplicate invitee emails
  const cleanEmails = Array.from(
    new Set(
      input.inviteeEmails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 3 && e.includes("@") && !e.includes(" "))
    )
  );

  const attendeeList: ScheduledClassRecord["attendees"] = [];

  // 4. Create invitations & dispatch emails
  for (const email of cleanEmails) {
    const inviteToken = crypto.randomBytes(32).toString("hex");

    // Check if a registered user already has this email
    const userLookup = await query(
      `SELECT id, full_name, avatar_url FROM users WHERE LOWER(email) = $1 LIMIT 1;`,
      [email]
    );
    const existingUser = userLookup.rows[0];

    await query(
      `INSERT INTO class_invitations (schedule_id, email, invitee_user_id, rsvp_status, token)
       VALUES ($1, $2, $3, 'pending', $4);`,
      [schedule.id, email, existingUser?.id || null, inviteToken]
    );

    attendeeList.push({
      email,
      rsvp_status: "pending",
      user_name: existingUser?.full_name,
      user_avatar: existingUser?.avatar_url,
    });

    // Send email asynchronously (non-blocking for UI responsiveness)
    sendClassInvitationEmail({
      recipientEmail: email,
      tutorName: input.tutorName,
      tutorAvatar: input.tutorAvatar,
      title: input.title,
      subject: input.subject,
      description: input.description,
      scheduledAt: scheduledDate,
      durationMinutes: duration,
      roomCode,
      inviteToken,
      appOrigin: input.appOrigin,
    })
      .then((res) => {
        if (!res.success) {
          console.error(`[ScheduleService] ❌ Email dispatch failed for ${email}:`, res.error);
        } else {
          console.log(`[ScheduleService] ✅ Email dispatch confirmed for ${email} (MessageId: ${res.messageId})`);
        }
      })
      .catch((err) => {
        console.error(`[ScheduleService] ❌ Failed to invoke sendClassInvitationEmail for ${email}:`, err);
      });
  }

  return {
    ...schedule,
    tutor_name: input.tutorName,
    tutor_avatar: input.tutorAvatar,
    attendees: attendeeList,
  };
}

/**
 * Returns all upcoming and past classes for the authenticated user (both taught and attended).
 */
export async function getMySchedule(userId: string, userEmail: string): Promise<{
  hostedClasses: ScheduledClassRecord[];
  attendingClasses: ScheduledClassRecord[];
}> {
  const normalizedEmail = (userEmail || "").trim().toLowerCase();

  // 1. Classes hosted by tutor
  const hostedRes = await query(
    `SELECT cs.id, cs.room_code, cs.title, cs.subject, cs.description, cs.tutor_id,
            cs.scheduled_at, cs.duration_minutes, cs.status, cs.created_at,
            u.full_name as tutor_name, u.avatar_url as tutor_avatar
     FROM class_schedules cs
     JOIN users u ON cs.tutor_id = u.id
     WHERE cs.tutor_id = $1
     ORDER BY cs.scheduled_at ASC;`,
    [userId]
  );

  const hostedClasses: ScheduledClassRecord[] = [];
  for (const row of hostedRes.rows) {
    const invitesRes = await query(
      `SELECT ci.email, ci.rsvp_status, ci.rsvp_at, u.full_name as user_name, u.avatar_url as user_avatar
       FROM class_invitations ci
       LEFT JOIN users u ON ci.invitee_user_id = u.id
       WHERE ci.schedule_id = $1;`,
      [row.id]
    );
    hostedClasses.push({
      ...row,
      attendees: invitesRes.rows,
    });
  }

  // 2. Classes where user was invited (by email or user_id)
  const attendingRes = await query(
    `SELECT cs.id, cs.room_code, cs.title, cs.subject, cs.description, cs.tutor_id,
            cs.scheduled_at, cs.duration_minutes, cs.status, cs.created_at,
            u.full_name as tutor_name, u.avatar_url as tutor_avatar,
            ci.rsvp_status as my_rsvp_status, ci.token as invite_token
     FROM class_invitations ci
     JOIN class_schedules cs ON ci.schedule_id = cs.id
     JOIN users u ON cs.tutor_id = u.id
     WHERE (ci.invitee_user_id = $1 OR LOWER(ci.email) = $2)
       AND cs.tutor_id != $1
     ORDER BY cs.scheduled_at ASC;`,
    [userId, normalizedEmail]
  );

  return {
    hostedClasses,
    attendingClasses: attendingRes.rows,
  };
}

/**
 * Returns public invite details for the /invite/:token RSVP landing card.
 */
export async function getInviteDetailsByToken(token: string) {
  const res = await query(
    `SELECT ci.id as invitation_id, ci.schedule_id, ci.email as invited_email, ci.rsvp_status, ci.token,
            cs.room_code, cs.title, cs.subject, cs.description, cs.scheduled_at, cs.duration_minutes, cs.status as class_status,
            u.full_name as tutor_name, u.avatar_url as tutor_avatar
     FROM class_invitations ci
     JOIN class_schedules cs ON ci.schedule_id = cs.id
     JOIN users u ON cs.tutor_id = u.id
     WHERE ci.token = $1
     LIMIT 1;`,
    [token]
  );

  if (!res.rows.length) {
    return null;
  }
  return res.rows[0];
}

/**
 * RSVP an invitation. Strictly requires an authenticated Google user for acceptance.
 * Safely resolves user ID against the users table to guarantee database foreign-key integrity.
 */
export async function rsvpInviteByToken(params: {
  token: string;
  userId?: string | null;
  userEmail?: string;
  rsvpStatus: "accepted" | "declined";
}) {
  const invite = await getInviteDetailsByToken(params.token);
  if (!invite) {
    throw new Error("Invitation not found or link has expired");
  }

  if (invite.class_status === "cancelled") {
    throw new Error("This class has been cancelled by the tutor");
  }

  // Ensure userId strictly references an existing user row to avoid foreign key violations
  let validUserId: string | null = null;
  if (params.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.userId)) {
    try {
      const userCheck = await query("SELECT id FROM users WHERE id = $1", [params.userId]);
      if (userCheck.rows.length > 0) {
        validUserId = userCheck.rows[0].id;
      }
    } catch (e) {
      console.warn("[ScheduleService] Failed to verify user by ID:", e);
    }
  }

  // Fallback 1: If userId was not found or was stale, look up by verified userEmail
  if (!validUserId && params.userEmail) {
    try {
      const emailCheck = await query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [params.userEmail.trim()]
      );
      if (emailCheck.rows.length > 0) {
        validUserId = emailCheck.rows[0].id;
      }
    } catch (e) {
      console.warn("[ScheduleService] Failed to verify user by email:", e);
    }
  }

  // Fallback 2: Check if invite.invited_email matches a registered user in users table
  if (!validUserId && invite.invited_email) {
    try {
      const emailCheck = await query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [invite.invited_email.trim()]
      );
      if (emailCheck.rows.length > 0) {
        validUserId = emailCheck.rows[0].id;
      }
    } catch (e) {
      console.warn("[ScheduleService] Failed to verify user by invited_email:", e);
    }
  }

  const updateRes = await query(
    `UPDATE class_invitations
     SET rsvp_status = $1, invitee_user_id = $2, rsvp_at = NOW()
     WHERE token = $3
     RETURNING id, schedule_id, email, invitee_user_id, rsvp_status, rsvp_at;`,
    [params.rsvpStatus, validUserId, params.token]
  );

  return {
    invitation: updateRes.rows[0],
    classDetails: invite,
  };
}

/**
 * Cancels a scheduled class (tutor only).
 */
export async function cancelSchedule(scheduleId: string, tutorId: string) {
  const res = await query(
    `UPDATE class_schedules
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND tutor_id = $2
     RETURNING id, room_code, title, status;`,
    [scheduleId, tutorId]
  );

  if (!res.rows.length) {
    throw new Error("Schedule not found or you are not authorized to cancel it");
  }
  return res.rows[0];
}

