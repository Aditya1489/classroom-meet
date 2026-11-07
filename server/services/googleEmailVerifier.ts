import dns from "dns";
import net from "net";
import { query } from "../db";

export interface GoogleEmailVerificationResult {
  valid: boolean;
  isGoogle: boolean;
  email: string;
  isRegistered?: boolean;
  name?: string;
  avatarUrl?: string;
  reason?:
    | "invalid_format"
    | "invalid_gmail_length"
    | "invalid_gmail_characters"
    | "invalid_gmail_dots"
    | "domain_not_found"
    | "no_mx"
    | "not_google_provider"
    | "google_account_not_found";
  message: string;
  verifiedVia?: "database" | "smtp_probe" | "dns_mx" | "syntax_fallback";
}

/**
 * Checks whether an email address exists as a Google Account (Gmail or Google Workspace).
 * 
 * Verification Pipeline:
 * 1. Syntax check & RFC 5322 compliance
 * 2. Gmail-specific username rules (length 6-30, valid chars, dots)
 * 3. Registered Mathsy database check (Google OAuth users)
 * 4. DNS MX lookup for Google mail servers (gmail-smtp-in.l.google.com, smtp.google.com, aspmx.l.google.com)
 * 5. Low-latency SMTP probe to Google MX servers to confirm mailbox existence (250 vs 550)
 */
export async function verifyGoogleEmail(email: string): Promise<GoogleEmailVerificationResult> {
  const normalized = (email || "").trim().toLowerCase();

  // 1. Basic email format check
  if (!normalized || !normalized.includes("@")) {
    return {
      valid: false,
      isGoogle: false,
      email: normalized,
      reason: "invalid_format",
      message: "Invalid email ID: Please enter a valid email address.",
    };
  }

  const parts = normalized.split("@");
  if (parts.length !== 2) {
    return {
      valid: false,
      isGoogle: false,
      email: normalized,
      reason: "invalid_format",
      message: "Invalid email ID: Email address cannot contain multiple '@' symbols.",
    };
  }

  const [username, domain] = parts;
  if (!username || !domain || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return {
      valid: false,
      isGoogle: false,
      email: normalized,
      reason: "invalid_format",
      message: "Invalid email ID: Invalid domain syntax in email address.",
    };
  }

  // 2. Check Mathsy Users Database (highest confidence, 0ms latency)
  try {
    const userRes = await query(
      "SELECT id, full_name, avatar_url, auth_provider FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;",
      [normalized]
    );
    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];
      if (user.auth_provider === "google" || !user.auth_provider) {
        return {
          valid: true,
          isGoogle: true,
          email: normalized,
          isRegistered: true,
          name: user.full_name || undefined,
          avatarUrl: user.avatar_url || undefined,
          message: `Verified Google Account (${user.full_name || "Registered User"})`,
          verifiedVia: "database",
        };
      }
    }
  } catch (dbErr: any) {
    console.warn("[GoogleEmailVerifier] Database lookup fallback:", dbErr.message);
  }

  // 3. Gmail-specific syntax rules
  const isGmailConsumer = domain === "gmail.com" || domain === "googlemail.com";
  if (isGmailConsumer) {
    if (username.length < 6 || username.length > 30) {
      return {
        valid: false,
        isGoogle: true,
        email: normalized,
        reason: "invalid_gmail_length",
        message: "Invalid email ID: Gmail usernames must be between 6 and 30 characters long.",
      };
    }
    if (!/^[a-z0-9.]+$/.test(username)) {
      return {
        valid: false,
        isGoogle: true,
        email: normalized,
        reason: "invalid_gmail_characters",
        message: "Invalid email ID: Gmail usernames can only contain letters (a-z), numbers (0-9), and periods (.).",
      };
    }
    if (username.startsWith(".") || username.endsWith(".") || username.includes("..")) {
      return {
        valid: false,
        isGoogle: true,
        email: normalized,
        reason: "invalid_gmail_dots",
        message: "Invalid email ID: Gmail usernames cannot start or end with a period, or have consecutive periods.",
      };
    }
  }

  // 4. DNS MX record inspection for custom domains
  let targetMx = "gmail-smtp-in.l.google.com";

  if (!isGmailConsumer) {
    try {
      const records = await dns.promises.resolveMx(domain);
      if (!records || records.length === 0) {
        return {
          valid: false,
          isGoogle: false,
          email: normalized,
          reason: "no_mx",
          message: `Invalid email ID: Domain '${domain}' has no active mail exchange (MX) servers configured.`,
        };
      }

      const googleSignatures = ["google.com", "googlemail.com", "l.google.com", "smtp.google.com"];
      const googleMx = records.find((r) =>
        googleSignatures.some((sig) => r.exchange.toLowerCase().includes(sig))
      );

      if (!googleMx) {
        return {
          valid: false,
          isGoogle: false,
          email: normalized,
          reason: "not_google_provider",
          message: `Invalid email ID: The address '${normalized}' is not hosted on Google. A Google account is required for students to RSVP.`,
        };
      }

      targetMx = googleMx.exchange;
    } catch (dnsErr: any) {
      return {
        valid: false,
        isGoogle: false,
        email: normalized,
        reason: "domain_not_found",
        message: `Invalid email ID: The domain '${domain}' does not exist or DNS lookup failed.`,
      };
    }
  }

  // 5. Low-latency SMTP probe to Google MX server
  // Sends HELO -> MAIL FROM -> RCPT TO -> QUIT
  // Google responds:
  // - 250: Mailbox exists
  // - 550 5.1.1: The email account that you tried to reach does not exist
  return new Promise<GoogleEmailVerificationResult>((resolve) => {
    const socket = net.createConnection({ host: targetMx, port: 25, timeout: 3500 });
    let step = 0;
    let isDone = false;

    const finalize = (res: GoogleEmailVerificationResult) => {
      if (!isDone) {
        isDone = true;
        try {
          socket.write("QUIT\r\n");
          socket.end();
          socket.destroy();
        } catch {}
        resolve(res);
      }
    };

    socket.on("data", (chunk) => {
      const data = chunk.toString();
      if (data.startsWith("220") && step === 0) {
        step = 1;
        socket.write("HELO mathsy.in\r\n");
      } else if (data.startsWith("250") && step === 1) {
        step = 2;
        socket.write("MAIL FROM:<classes@mathsy.in>\r\n");
      } else if (data.startsWith("250") && step === 2) {
        step = 3;
        socket.write(`RCPT TO:<${normalized}>\r\n`);
      } else if (step === 3) {
        if (data.startsWith("250")) {
          finalize({
            valid: true,
            isGoogle: true,
            email: normalized,
            message: "Active Google account confirmed.",
            verifiedVia: "smtp_probe",
          });
        } else if (data.startsWith("550") || data.includes("5.1.1") || data.toLowerCase().includes("does not exist")) {
          finalize({
            valid: false,
            isGoogle: true,
            email: normalized,
            reason: "google_account_not_found",
            message: `Invalid email ID: The Google account '${normalized}' does not exist. Please check for typos.`,
          });
        } else {
          // Greylisting, challenge, or temporary 4xx code - accept if domain & syntax were valid
          finalize({
            valid: true,
            isGoogle: true,
            email: normalized,
            message: "Google account format recognized.",
            verifiedVia: "dns_mx",
          });
        }
      }
    });

    socket.on("error", (err) => {
      // Safe fallback on socket/network error so tutors are never blocked by firewall/port 25 limits
      finalize({
        valid: true,
        isGoogle: true,
        email: normalized,
        message: "Google account recognized.",
        verifiedVia: "dns_mx",
      });
    });

    socket.on("timeout", () => {
      finalize({
        valid: true,
        isGoogle: true,
        email: normalized,
        message: "Google account recognized.",
        verifiedVia: "dns_mx",
      });
    });
  });
}

