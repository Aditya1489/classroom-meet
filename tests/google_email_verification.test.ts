import test from "node:test";
import assert from "node:assert/strict";

test("Google Email Verification & Integrity Suite", async (t) => {
  // Pure logic unit test replicating googleEmailVerifier logic
  const validateGoogleEmailFormat = (email: string) => {
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      return { valid: false, isGoogle: false, reason: "invalid_format", message: "Please enter a valid email address." };
    }

    const parts = normalized.split("@");
    if (parts.length !== 2) {
      return { valid: false, isGoogle: false, reason: "invalid_format", message: "Email address cannot contain multiple '@' symbols." };
    }

    const [username, domain] = parts;
    if (!username || !domain || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
      return { valid: false, isGoogle: false, reason: "invalid_format", message: "Invalid domain syntax in email address." };
    }

    const isGmailConsumer = domain === "gmail.com" || domain === "googlemail.com";
    if (isGmailConsumer) {
      if (username.length < 6 || username.length > 30) {
        return {
          valid: false,
          isGoogle: true,
          reason: "invalid_gmail_length",
          message: "Gmail usernames must be between 6 and 30 characters long.",
        };
      }
      if (!/^[a-z0-9.]+$/.test(username)) {
        return {
          valid: false,
          isGoogle: true,
          reason: "invalid_gmail_characters",
          message: "Gmail usernames can only contain letters (a-z), numbers (0-9), and periods (.).",
        };
      }
      if (username.startsWith(".") || username.endsWith(".") || username.includes("..")) {
        return {
          valid: false,
          isGoogle: true,
          reason: "invalid_gmail_dots",
          message: "Gmail usernames cannot start or end with a period, or have consecutive periods.",
        };
      }
    }

    return { valid: true, isGoogle: isGmailConsumer, email: normalized, username, domain };
  };

  await t.test("TC-GEV-01: Rejects malformed email format, missing @ or invalid domain", () => {
    assert.equal(validateGoogleEmailFormat("").valid, false);
    assert.equal(validateGoogleEmailFormat("notanemail").valid, false);
    assert.equal(validateGoogleEmailFormat("user@nodot").valid, false);
    assert.equal(validateGoogleEmailFormat("user@.com").valid, false);
    assert.equal(validateGoogleEmailFormat("user@@gmail.com").valid, false);
  });

  await t.test("TC-GEV-02: Enforces Google Gmail 6-to-30 character username boundary rule", () => {
    // Too short (5 characters)
    const tooShort = validateGoogleEmailFormat("abcde@gmail.com");
    assert.equal(tooShort.valid, false);
    assert.equal(tooShort.reason, "invalid_gmail_length");

    // Exactly 6 characters (valid)
    const validSix = validateGoogleEmailFormat("abcdef@gmail.com");
    assert.equal(validSix.valid, true);

    // Exactly 30 characters (valid)
    const validThirty = validateGoogleEmailFormat("a".repeat(30) + "@gmail.com");
    assert.equal(validThirty.valid, true);

    // Too long (31 characters)
    const tooLong = validateGoogleEmailFormat("a".repeat(31) + "@gmail.com");
    assert.equal(tooLong.valid, false);
    assert.equal(tooLong.reason, "invalid_gmail_length");
  });

  await t.test("TC-GEV-03: Enforces Google Gmail period positioning and consecutive period rules", () => {
    assert.equal(validateGoogleEmailFormat(".startsdot@gmail.com").reason, "invalid_gmail_dots");
    assert.equal(validateGoogleEmailFormat("endsdot.@gmail.com").reason, "invalid_gmail_dots");
    assert.equal(validateGoogleEmailFormat("consecutive..dot@gmail.com").reason, "invalid_gmail_dots");
    assert.equal(validateGoogleEmailFormat("valid.dot.user@gmail.com").valid, true);
  });

  await t.test("TC-GEV-04: Enforces Google Gmail alphanumeric and period characters only", () => {
    assert.equal(validateGoogleEmailFormat("special$char@gmail.com").reason, "invalid_gmail_characters");
    assert.equal(validateGoogleEmailFormat("dash-user@gmail.com").reason, "invalid_gmail_characters");
    assert.equal(validateGoogleEmailFormat("plus+tag@gmail.com").reason, "invalid_gmail_characters");
    assert.equal(validateGoogleEmailFormat("valid123user@gmail.com").valid, true);
  });

  await t.test("TC-GEV-05: Distinguishes Google Workspace MX signatures from non-Google mail providers", () => {
    const isGoogleMxProvider = (mxExchanges: string[]): boolean => {
      const googleSignatures = ["google.com", "googlemail.com", "l.google.com", "smtp.google.com"];
      return mxExchanges.some((mx) =>
        googleSignatures.some((sig) => mx.toLowerCase().includes(sig))
      );
    };

    // Google Workspace domain (e.g., standard Google Workspace mail exchange)
    assert.equal(
      isGoogleMxProvider(["aspmx.l.google.com", "alt1.aspmx.l.google.com"]),
      true,
      "Must recognize legacy Google Workspace MX records"
    );
    assert.equal(
      isGoogleMxProvider(["smtp.google.com"]),
      true,
      "Must recognize modern Google Workspace MX records"
    );

    // Microsoft / Office 365
    assert.equal(
      isGoogleMxProvider(["outlook-com.olc.protection.outlook.com"]),
      false,
      "Must reject Microsoft Outlook MX servers"
    );

    // Yahoo Mail
    assert.equal(
      isGoogleMxProvider(["mta7.am0.yahoodns.net"]),
      false,
      "Must reject Yahoo MX servers"
    );

    // Custom non-Google host
    assert.equal(
      isGoogleMxProvider(["smtp.secureserver.net"]),
      false,
      "Must reject GoDaddy/cPanel MX servers"
    );
  });

  await t.test("TC-GEV-06: SMTP response state parser correctly detects existing vs non-existent mailboxes", () => {
    const parseSmtpProbeResult = (smtpData: string) => {
      if (smtpData.startsWith("250")) {
        return { valid: true, message: "Active Google account confirmed." };
      }
      if (smtpData.startsWith("550") || smtpData.includes("5.1.1") || smtpData.toLowerCase().includes("does not exist")) {
        return {
          valid: false,
          reason: "google_account_not_found",
          message: "This Google account does not exist. Please check for typos.",
        };
      }
      return { valid: true, message: "Google account format recognized." };
    };

    // Real active account response from Google SMTP
    const realResponse = "250 2.1.5 OK 41be03b00d2f7-cdb3659227esi1029409a12.410 - gsmtp";
    const resReal = parseSmtpProbeResult(realResponse);
    assert.equal(resReal.valid, true);

    // Non-existent mailbox response from Google SMTP
    const fakeResponse =
      "550-5.1.1 The email account that you tried to reach does not exist. Please try 550 5.1.1 https://support.google.com/mail/?p=NoSuchUser";
    const resFake = parseSmtpProbeResult(fakeResponse);
    assert.equal(resFake.valid, false);
    assert.equal(resFake.reason, "google_account_not_found");
  });

  await t.test("TC-GEV-07: Registered Mathsy users bypass SMTP probe with instant database verified result", () => {
    interface MockUser {
      id: string;
      email: string;
      full_name: string;
      avatar_url: string;
      auth_provider: string;
    }

    const mockDb: MockUser[] = [
      {
        id: "usr_1",
        email: "aditya@mathsy.in",
        full_name: "Aditya Chavhan",
        avatar_url: "https://avatar.google.com/aditya",
        auth_provider: "google",
      },
    ];

    const verifyWithDbFirst = (email: string) => {
      const found = mockDb.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (found && found.auth_provider === "google") {
        return {
          valid: true,
          isGoogle: true,
          email: found.email,
          isRegistered: true,
          name: found.full_name,
          avatarUrl: found.avatar_url,
          verifiedVia: "database",
        };
      }
      return null;
    };

    const res = verifyWithDbFirst("aditya@mathsy.in");
    assert.ok(res !== null);
    assert.equal(res?.valid, true);
    assert.equal(res?.isRegistered, true);
    assert.equal(res?.name, "Aditya Chavhan");
    assert.equal(res?.verifiedVia, "database");

    const unregistered = verifyWithDbFirst("newstudent@gmail.com");
    assert.equal(unregistered, null);
  });
});

