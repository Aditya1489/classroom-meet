import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateStartupEnvironment,
  getParticipantJwtSecret,
  DEV_JWT_SECRET,
  DEV_PARTICIPANT_JWT_SECRET,
  DEV_WEBHOOK_ENCRYPTION_KEY,
} from "../server/services/envValidator";

describe("Phase 8 Remediation Checkpoint 1: Environment Validator & Participant JWT", () => {
  const validProductionEnv = {
    NODE_ENV: "production",
    JWT_SECRET: "a_valid_high_entropy_production_jwt_secret_32_characters_long",
    PARTICIPANT_JWT_SECRET: "a_valid_high_entropy_production_participant_jwt_secret_32_chars",
    WEBHOOK_ENCRYPTION_KEY: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", // 64 hex chars, non-default
    DATABASE_URL: "postgresql://postgres:dbsecret@postgres.prod.internal:5432/mathsy_meet",
    MONGODB_URI: "mongodb+srv://user:pass@cluster0.prod.mongodb.net/mathsy_meet_chat",
  };

  function withEnv(envOverrides: Record<string, string | undefined>, fn: () => void) {
    const originalEnv = { ...process.env };
    try {
      for (const [key, val] of Object.entries(envOverrides)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
      fn();
    } finally {
      process.env = originalEnv;
    }
  }

  // =========================================================================
  // Task 3: MongoDB Production Validation
  // =========================================================================
  describe("Task 3: MongoDB Production Validation", () => {
    it("should pass validation in production when valid MONGODB_URI is provided", () => {
      withEnv(validProductionEnv, () => {
        const result = validateStartupEnvironment({ nodeEnv: "production" });
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);
      });
    });

    it("should fail validation in production when MONGODB_URI is missing", () => {
      withEnv({ ...validProductionEnv, MONGODB_URI: undefined }, () => {
        assert.throws(
          () => validateStartupEnvironment({ nodeEnv: "production" }),
          /Missing required environment variable: MONGODB_URI/
        );
      });
    });

    it("should fail validation in production when MONGODB_URI has invalid protocol", () => {
      withEnv({ ...validProductionEnv, MONGODB_URI: "http://invalid-mongo-host:27017" }, () => {
        assert.throws(
          () => validateStartupEnvironment({ nodeEnv: "production" }),
          /MONGODB_URI must begin with/
        );
      });
    });

    it("should fail validation in production when MONGODB_URI points to localhost without ALLOW_LOCAL_DATABASE", () => {
      withEnv({ ...validProductionEnv, MONGODB_URI: "mongodb://localhost:27017/chat", ALLOW_LOCAL_DATABASE: undefined }, () => {
        assert.throws(
          () => validateStartupEnvironment({ nodeEnv: "production" }),
          /MONGODB_URI points to localhost in production/
        );
      });
    });

    it("should allow localhost MONGODB_URI in production when ALLOW_LOCAL_DATABASE=true", () => {
      withEnv(
        {
          ...validProductionEnv,
          MONGODB_URI: "mongodb://localhost:27017/chat",
          DATABASE_URL: "postgresql://postgres:pass@localhost:5432/mathsy_meet",
          ALLOW_LOCAL_DATABASE: "true",
        },
        () => {
          const result = validateStartupEnvironment({ nodeEnv: "production" });
          assert.strictEqual(result.valid, true);
        }
      );
    });

    it("should allow missing MONGODB_URI in production when DISABLE_MONGODB=true", () => {
      withEnv({ ...validProductionEnv, MONGODB_URI: undefined, DISABLE_MONGODB: "true" }, () => {
        const result = validateStartupEnvironment({ nodeEnv: "production" });
        assert.strictEqual(result.valid, true);
        assert.ok(result.warnings.some((w) => w.includes("explicitly disabled")));
      });
    });

    it("should allow unset MONGODB_URI in development mode with a warning", () => {
      withEnv({ NODE_ENV: "development", MONGODB_URI: undefined }, () => {
        const result = validateStartupEnvironment({ nodeEnv: "development" });
        assert.strictEqual(result.valid, true);
        assert.ok(result.warnings.some((w) => w.includes("MONGODB_URI is unset")));
      });
    });
  });

  // =========================================================================
  // Task 4: Participant JWT Configuration & Fallback Safety
  // =========================================================================
  describe("Task 4: Participant JWT Configuration", () => {
    it("should return explicit PARTICIPANT_JWT_SECRET in production", () => {
      withEnv(validProductionEnv, () => {
        const secret = getParticipantJwtSecret();
        assert.strictEqual(secret, validProductionEnv.PARTICIPANT_JWT_SECRET);
      });
    });

    it("should strictly reject fallback to JWT_SECRET in production when PARTICIPANT_JWT_SECRET is unset", () => {
      withEnv({ ...validProductionEnv, PARTICIPANT_JWT_SECRET: undefined }, () => {
        assert.throws(
          () => getParticipantJwtSecret(),
          /Missing required PARTICIPANT_JWT_SECRET in production/
        );
      });
    });

    it("should reject development default PARTICIPANT_JWT_SECRET in production", () => {
      withEnv({ ...validProductionEnv, PARTICIPANT_JWT_SECRET: DEV_PARTICIPANT_JWT_SECRET }, () => {
        assert.throws(
          () => getParticipantJwtSecret(),
          /Invalid PARTICIPANT_JWT_SECRET in production/
        );
      });
    });

    it("should reject short PARTICIPANT_JWT_SECRET in production", () => {
      withEnv({ ...validProductionEnv, PARTICIPANT_JWT_SECRET: "short_secret_under_32_chars" }, () => {
        assert.throws(
          () => getParticipantJwtSecret(),
          /Invalid PARTICIPANT_JWT_SECRET in production/
        );
      });
    });

    it("should permit fallback to JWT_SECRET in development mode", () => {
      withEnv(
        {
          NODE_ENV: "development",
          JWT_SECRET: "dev_custom_jwt_secret_value",
          PARTICIPANT_JWT_SECRET: undefined,
        },
        () => {
          const secret = getParticipantJwtSecret();
          assert.strictEqual(secret, "dev_custom_jwt_secret_value");
        }
      );
    });

    it("should permit fallback to DEV_PARTICIPANT_JWT_SECRET when both are unset in development", () => {
      withEnv(
        {
          NODE_ENV: "development",
          JWT_SECRET: undefined,
          PARTICIPANT_JWT_SECRET: undefined,
        },
        () => {
          const secret = getParticipantJwtSecret();
          assert.strictEqual(secret, DEV_PARTICIPANT_JWT_SECRET);
        }
      );
    });
  });
});
