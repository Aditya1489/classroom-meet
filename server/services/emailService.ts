import nodemailer, { Transporter } from "nodemailer";

export interface ClassEmailInvitePayload {
  recipientEmail: string;
  tutorName: string;
  tutorAvatar?: string;
  title: string;
  subject?: string;
  description?: string;
  scheduledAt: Date;
  durationMinutes: number;
  roomCode: string;
  inviteToken: string;
  appOrigin: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  previewUrl?: string | false;
  error?: string;
}

/**
 * Generates an RFC 5545 compliant iCalendar (.ics) string.
 * This triggers automatic calendar event detection in Google Calendar, Apple Calendar, and Outlook.
 */
export function generateIcsCalendarEvent(payload: {
  title: string;
  description?: string;
  scheduledAt: Date;
  durationMinutes: number;
  tutorName: string;
  joinUrl: string;
  roomCode: string;
}): string {
  const dtStart = payload.scheduledAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const effectiveDuration = payload.durationMinutes > 0 ? payload.durationMinutes : 60; // 1-hour placeholder block on calendar for open-ended classes
  const endDate = new Date(payload.scheduledAt.getTime() + effectiveDuration * 60000);
  const dtEnd = endDate
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

  const uid = `mathsy-class-${payload.roomCode}-${payload.scheduledAt.getTime()}@mathsy.in`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mathsy Meet//Class Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${payload.title.replace(/[,;]/g, " ")}`,
    `DESCRIPTION:${(payload.description || "Live Interactive Mathsy Meet Classroom").replace(/[\r\n]+/g, " ")} - Join: ${payload.joinUrl}`,
    `URL:${payload.joinUrl}`,
    `LOCATION:${payload.joinUrl}`,
    `ORGANIZER;CN=${payload.tutorName.replace(/[,;]/g, " ")}:mailto:classes@mathsy.in`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder: Mathsy Meet Class starts in 15 minutes",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

let cachedTransporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (host && user && pass) {
    if (process.env.SMTP_SERVICE === "gmail" || host === "smtp.gmail.com") {
      cachedTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
      });
      return cachedTransporter;
    }

    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: process.env.NODE_ENV === "production" }
    });
    return cachedTransporter;
  }

  // Development / Staging Test Account Fallback
  if (process.env.NODE_ENV !== "production") {
    try {
      const testAccount = await nodemailer.createTestAccount();
      cachedTransporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log("[EmailService] Using Ethereal test mailer credentials:", testAccount.user);
      return cachedTransporter;
    } catch {
      // Stream transport fallback if network blocks test account creation
      cachedTransporter = nodemailer.createTransport({
        jsonTransport: true,
      });
      return cachedTransporter;
    }
  }

  throw new Error("SMTP credentials are not configured in environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS).");
}

/**
 * Sends a rich, branded Mathsy Meet class invitation email with an .ics calendar file attachment.
 */
export async function sendClassInvitationEmail(
  payload: ClassEmailInvitePayload
): Promise<EmailSendResult> {
  const rsvpUrl = `${payload.appOrigin.replace(/\/$/, "")}/invite/${payload.inviteToken}`;
  const formattedDate = payload.scheduledAt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = payload.scheduledAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const icsContent = generateIcsCalendarEvent({
    title: payload.title,
    description: payload.description,
    scheduledAt: payload.scheduledAt,
    durationMinutes: payload.durationMinutes,
    tutorName: payload.tutorName,
    joinUrl: rsvpUrl,
    roomCode: payload.roomCode,
  });

  const htmlContent = buildClassInvitationEmailHtml({
    payload,
    formattedDate,
    formattedTime,
    rsvpUrl,
  });

  try {
    const transporter = await getTransporter();
    const fromAddress = process.env.SMTP_FROM || `"Mathsy Meet" <${process.env.SMTP_USER || "classes@mathsy.in"}>`;

    console.log(`[EmailService] 🚀 Dispatching class invite to ${payload.recipientEmail} (Host: ${payload.tutorName}, Title: "${payload.title}")...`);

    const textContent =
      `Hi,\n\n` +
      `${payload.tutorName} invited you to join a live class on Mathsy Meet:\n\n` +
      `Class: ${payload.title}\n` +
      (payload.subject ? `Subject: ${payload.subject}\n` : "") +
      `Date: ${formattedDate}\n` +
      `Time: ${formattedTime}\n` +
      (payload.durationMinutes > 0 ? `Duration: ${payload.durationMinutes} Minutes\n` : "Duration: Unlimited ♾️\n") +
      `Host: ${payload.tutorName}\n\n` +
      (payload.description ? `Agenda & Notes:\n${payload.description}\n\n` : "") +
      `Accept Invitation & RSVP:\n${rsvpUrl}?action=accept\n\n` +
      `Decline Invitation:\n${rsvpUrl}?action=decline\n\n` +
      `Mathsy Meet — Interactive Live Tutoring`;

    const info = await transporter.sendMail({
      from: fromAddress,
      to: payload.recipientEmail,
      replyTo: process.env.SMTP_USER || fromAddress,
      subject: `Class Invitation: ${payload.title} with ${payload.tutorName}`,
      text: textContent,
      html: htmlContent,
      attachments: [
        {
          filename: "invite.ics",
          content: icsContent,
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
        },
      ],
    });

    console.log(`[EmailService] ✅ Email DELIVERED to ${payload.recipientEmail}! MessageId: ${info.messageId}, Response: ${info.response}`);

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[EmailService] Preview URL for ${payload.recipientEmail}: ${previewUrl}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl,
    };
  } catch (err: any) {
    console.error(`[EmailService] ❌ FAILED to send email to ${payload.recipientEmail}:`, err);
    return {
      success: false,
      error: err.message || "Failed to send email",
    };
  }
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Builds responsive HTML content for class invitation email with both Accept and Decline buttons.
 */
export function buildClassInvitationEmailHtml(params: {
  payload: Pick<ClassEmailInvitePayload, "title" | "subject" | "durationMinutes" | "tutorName"> & { description?: string };
  formattedDate: string;
  formattedTime: string;
  rsvpUrl: string;
}): string {
  const { payload, formattedDate, formattedTime, rsvpUrl } = params;
  const safeTitle = escapeHtml(payload.title);
  const safeTutor = escapeHtml(payload.tutorName);
  const safeSubject = payload.subject ? escapeHtml(payload.subject) : "";
  const safeDesc = payload.description ? escapeHtml(payload.description) : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Class Invitation: ${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0e0d0b; color: #f3eee6; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 30px auto; background-color: #161512; border: 1px solid rgba(243, 238, 230, 0.12); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .header { padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid rgba(243, 238, 230, 0.08); }
    .brand-logo { display: inline-flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; color: #f3eee6; text-decoration: none; }
    .brand-accent { color: #f59e0b; }
    .body { padding: 32px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; color: #f3eee6; margin: 0 0 12px; line-height: 1.25; }
    p { font-size: 14px; line-height: 1.6; color: #a39e94; margin: 0 0 20px; }
    .card { background-color: #1f1d18; border: 1px solid rgba(243, 238, 230, 0.1); border-radius: 14px; padding: 20px; margin: 24px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(243, 238, 230, 0.06); font-size: 13px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #a39e94; }
    .detail-value { color: #f3eee6; font-weight: 600; text-align: right; }
    .cta-container { text-align: center; margin: 32px 0 24px; }
    .cta-button { display: inline-block; background-color: #f59e0b; color: #0e0d0b; font-size: 14px; font-weight: 700; padding: 14px 28px; border-radius: 9999px; text-decoration: none; box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3); }
    .cta-decline-button { display: inline-block; background-color: #221f1a; border: 1px solid rgba(243, 238, 230, 0.25); color: #d1ccc2; font-size: 13px; font-weight: 600; padding: 13px 22px; border-radius: 9999px; text-decoration: none; }
    .footer { padding: 24px 32px; background-color: #12110e; text-align: center; font-size: 11px; color: #736e65; border-top: 1px solid rgba(243, 238, 230, 0.06); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand-logo">
        <span>Mathsy<span class="brand-accent">Meet</span></span>
      </div>
    </div>
    <div class="body">
      <span class="badge">Live Class Invitation</span>
      <h1>${safeTutor} invited you to join a live class</h1>
      <p>You have been invited to attend <strong>${safeTitle}</strong> on Mathsy Meet. Confirm your attendance to reserve your seat and add this session to your schedule.</p>
      
      <div class="card">
        <div class="detail-row">
          <span class="detail-label">Class Title:</span>
          <span class="detail-value">${safeTitle}</span>
        </div>
        ${safeSubject ? `
        <div class="detail-row">
          <span class="detail-label">Subject:</span>
          <span class="detail-value">${safeSubject}</span>
        </div>` : ""}
        <div class="detail-row">
          <span class="detail-label">Date:</span>
          <span class="detail-value">${formattedDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Time:</span>
          <span class="detail-value">${formattedTime}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">${payload.durationMinutes > 0 ? `${payload.durationMinutes} Minutes` : "Unlimited (No Time Limit) ♾️"}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Host:</span>
          <span class="detail-value">${safeTutor}</span>
        </div>
      </div>

      ${safeDesc ? `
      <div style="background-color: rgba(245, 158, 11, 0.06); border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 700; color: #f59e0b; text-transform: uppercase; margin-bottom: 4px;">Agenda & Notes</div>
        <div style="font-size: 12px; color: #f3eee6; line-height: 1.5;">${safeDesc}</div>
      </div>` : ""}

      <div class="cta-container">
        <!-- Responsive action buttons: Accept (Primary) & Decline (Secondary) -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td align="center" style="padding: 6px 8px;">
              <a href="${rsvpUrl}?action=accept" class="cta-button" style="display: inline-block; background-color: #f59e0b; color: #0e0d0b; font-size: 14px; font-weight: 700; padding: 14px 28px; border-radius: 9999px; text-decoration: none; box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);">
                ✓ Accept Invitation & RSVP
              </a>
            </td>
            <td align="center" style="padding: 6px 8px;">
              <a href="${rsvpUrl}?action=decline" class="cta-decline-button" style="display: inline-block; background-color: #221f1a; border: 1px solid rgba(243, 238, 230, 0.25); color: #d1ccc2; font-size: 13px; font-weight: 600; padding: 13px 22px; border-radius: 9999px; text-decoration: none;">
                ✕ Decline
              </a>
            </td>
          </tr>
        </table>
      </div>

      <p style="font-size: 12px; text-align: center; color: #736e65;">
        A Google account is required to verify your attendance and enter the interactive whiteboard classroom. An .ics calendar file is attached for automatic Google/Apple calendar syncing.
      </p>
    </div>
    <div class="footer">
      Mathsy Meet • Interactive Stem Video Instruction & Collaboration<br>
      If you did not expect this invitation, you can safely ignore this email.
    </div>
  </div>
</body>
</html>
  `.trim();
}
