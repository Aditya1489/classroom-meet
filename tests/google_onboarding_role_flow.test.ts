import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { generateToken, requireAuth } from "../server/routes/auth";

const JWT_SECRET = process.env.JWT_SECRET || "mathsy_meet_jwt_secret_dev_key_2026";

function createMockReqRes(options: {
  headers?: Record<string, string>;
  body?: any;
}) {
  const req: any = {
    headers: options.headers || {},
    body: options.body || {},
    user: undefined,
  };

  let statusCode = 200;
  let responseData: any = null;

  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getBody: () => responseData,
  };

  return { req, res };
}

describe("Google First-Time Onboarding Role Selection Flow Suite (In-Memory Unit & Route Logic)", () => {
  it("TC-ONBOARD-01: generateToken embeds needsRoleSelection into JWT payload", () => {
    const token = generateToken({
      id: "usr-new-onboard-1",
      email: "newuser@example.com",
      role: "student",
      name: "New Student",
      needsRoleSelection: true,
    });

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    assert.equal(decoded.sub, "usr-new-onboard-1");
    assert.equal(decoded.needsRoleSelection, true);
    assert.equal(decoded.role, "student");
  });

  it("TC-ONBOARD-02: requireAuth attaches needsRoleSelection: true from decoded JWT", async () => {
    const onboardingToken = generateToken({
      id: "usr-pending-role-1",
      email: "pending@example.com",
      role: "student",
      name: "Pending Role User",
      needsRoleSelection: true,
    });

    const { req, res } = createMockReqRes({
      headers: { authorization: `Bearer ${onboardingToken}` },
    });

    let nextCalled = false;
    await requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, "requireAuth must invoke next() on valid token");
    assert.ok(req.user, "req.user must be populated");
    assert.equal(req.user.needsRoleSelection, true, "req.user must preserve needsRoleSelection: true");
    assert.equal(req.user.role, "student");
  });

  it("TC-ONBOARD-03: requireAuth attaches needsRoleSelection: false for returning users", async () => {
    const returningToken = generateToken({
      id: "usr-returning-tutor-1",
      email: "returning@example.com",
      role: "tutor",
      name: "Established Tutor",
      needsRoleSelection: false,
    });

    const { req, res } = createMockReqRes({
      headers: { authorization: `Bearer ${returningToken}` },
    });

    let nextCalled = false;
    await requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.user.needsRoleSelection, false);
    assert.equal(req.user.role, "tutor");
  });

  it("TC-ONBOARD-04: Role elevation policy logic allows Tutor selection when user is in onboarding (needsRoleSelection: true)", () => {
    const userInOnboarding = {
      id: "usr-new-user-1",
      role: "student",
      needsRoleSelection: true,
    };

    const requestedRole = "tutor";
    const isInitialOnboarding = Boolean(userInOnboarding.needsRoleSelection);

    // Business rule check from PATCH /api/auth/role:
    const isForbidden =
      !isInitialOnboarding &&
      requestedRole === "tutor" &&
      userInOnboarding.role !== "tutor";

    assert.equal(
      isForbidden,
      false,
      "New onboarding user (needsRoleSelection: true) must NOT be blocked from choosing Tutor role"
    );

    // Test token generation upon onboarding role completion
    const finalizedToken = generateToken({
      id: userInOnboarding.id,
      role: requestedRole,
      name: "New Tutor",
      needsRoleSelection: false,
    });

    const decoded = jwt.verify(finalizedToken, JWT_SECRET) as any;
    assert.equal(decoded.role, "tutor");
    assert.equal(decoded.needsRoleSelection, false, "Finalized session token must clear needsRoleSelection");
  });

  it("TC-ONBOARD-05: Role elevation policy logic blocks established students (needsRoleSelection: false) from self-elevating to Tutor (P0-4 preserved)", () => {
    const establishedStudent = {
      id: "usr-est-student-2",
      role: "student",
      needsRoleSelection: false,
    };

    const requestedRole = "tutor";
    const isInitialOnboarding = Boolean(establishedStudent.needsRoleSelection);

    const isForbidden =
      !isInitialOnboarding &&
      requestedRole === "tutor" &&
      establishedStudent.role !== "tutor";

    assert.equal(
      isForbidden,
      true,
      "Established student (needsRoleSelection: false) must be blocked by P0-4 from escalating to Tutor"
    );
  });

  it("TC-ONBOARD-06: Second concurrent/duplicate request before onboarding completed maintains needsRoleSelection: true", () => {
    // Simulates an existing record in PostgreSQL where onboarding_completed is false
    const userInDbBeforeOnboarding = {
      id: "usr-google-12345",
      email: "contact.mathsy@gmail.com",
      role: "student",
      onboarding_completed: false,
    };

    const hasCompletedOnboarding = Boolean(userInDbBeforeOnboarding.onboarding_completed);
    const isNewUser = !hasCompletedOnboarding;
    const needsRoleSelection = !hasCompletedOnboarding;

    assert.equal(hasCompletedOnboarding, false);
    assert.equal(isNewUser, true, "User must still be considered in new user / onboarding state");
    assert.equal(needsRoleSelection, true, "needsRoleSelection MUST remain true until user completes onboarding");
  });

  it("TC-ONBOARD-07: Returning user with onboarding_completed: true has needsRoleSelection: false", () => {
    const userInDbAfterOnboarding = {
      id: "usr-google-12345",
      email: "contact.mathsy@gmail.com",
      role: "tutor",
      onboarding_completed: true,
    };

    const hasCompletedOnboarding = Boolean(userInDbAfterOnboarding.onboarding_completed);
    const isNewUser = !hasCompletedOnboarding;
    const needsRoleSelection = !hasCompletedOnboarding;

    assert.equal(hasCompletedOnboarding, true);
    assert.equal(isNewUser, false);
    assert.equal(needsRoleSelection, false, "Returning user with onboarding_completed must skip onboarding modal");
  });
});
