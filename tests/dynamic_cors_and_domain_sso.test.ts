import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool, query } from "../server/db";
import { app } from "../server/index";
import {
  isOriginAllowed,
  normalizeDomain,
  invalidateOriginCache,
} from "../server/services/originValidationService";

describe("Dynamic Multi-Tenant CORS & Domain Normalization Suite", () => {
  let server: http.Server;
  let testPort: number;
  let apiBase: string;

  let testOrgId: string;
  let suspendedOrgId: string;
  const testDomain = `test-client-${Date.now()}.com`;

  before(async () => {
    // 1. Create active test organization with allowed domain and SSO domain
    const orgRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Dynamic CORS Test Org', $1, 'active', '{}')
       RETURNING id;`,
      [`dynamic-cors-${Date.now()}`]
    );
    testOrgId = orgRes.rows[0].id;

    // Add SSO domain with 'www.' prefix to verify normalization
    await query(
      `INSERT INTO organization_sso_domains (organization_id, domain, is_verified)
       VALUES ($1, $2, TRUE);`,
      [testOrgId, `www.${testDomain}`]
    );

    // Create a customer app with an allowed domain
    await query(
      `INSERT INTO customer_apps (organization_id, app_name, allowed_domains)
       VALUES ($1, 'Test Portal', ARRAY[$2]);`,
      [testOrgId, `https://portal-${testDomain}`]
    );

    // Create suspended organization
    const suspRes = await query(
      `INSERT INTO organizations (name, slug, status, settings)
       VALUES ('Suspended Org', $1, 'suspended', '{}')
       RETURNING id;`,
      [`suspended-cors-${Date.now()}`]
    );
    suspendedOrgId = suspRes.rows[0].id;
    await query(
      `INSERT INTO organization_sso_domains (organization_id, domain, is_verified)
       VALUES ($1, $2, TRUE);`,
      [suspendedOrgId, `blocked-${testDomain}`]
    );

    invalidateOriginCache();

    // Start ephemeral HTTP server
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const addr = server.address() as any;
        testPort = addr.port;
        apiBase = `http://localhost:${testPort}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Cleanup test data
    if (testOrgId) {
      await query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);
    }
    if (suspendedOrgId) {
      await query("DELETE FROM organizations WHERE id = $1;", [suspendedOrgId]);
    }
    await pool.end();
    process.exit(0);
  });

  it("TC-NORM-01: normalizeDomain cleans protocols, www, slashes and whitespace", () => {
    assert.equal(normalizeDomain("https://www.mathsy.in/"), "mathsy.in");
    assert.equal(normalizeDomain("http://mathsy.in"), "mathsy.in");
    assert.equal(normalizeDomain("www.mathsy.in"), "mathsy.in");
    assert.equal(normalizeDomain("mathsy.in"), "mathsy.in");
    assert.equal(normalizeDomain("@mathsy.in"), "mathsy.in");
    assert.equal(normalizeDomain("https://www.sub.school.edu/path"), "sub.school.edu");
  });

  it("TC-CORS-01: Dynamically allows CORS for tenant customer_apps allowed domain", async () => {
    const allowed = await isOriginAllowed(`https://portal-${testDomain}`);
    assert.equal(allowed, true);
  });

  it("TC-CORS-02: Dynamically allows CORS for verified SSO domain (both apex and www)", async () => {
    const apexAllowed = await isOriginAllowed(`https://${testDomain}`);
    const wwwAllowed = await isOriginAllowed(`https://www.${testDomain}`);
    assert.equal(apexAllowed, true);
    assert.equal(wwwAllowed, true);
  });

  it("TC-CORS-03: Rejects arbitrary unapproved origins", async () => {
    const allowed = await isOriginAllowed("https://malicious-attacker-site.xyz");
    assert.equal(allowed, false);
  });

  it("TC-CORS-04: Rejects domains belonging to suspended organizations", async () => {
    const allowed = await isOriginAllowed(`https://blocked-${testDomain}`);
    assert.equal(allowed, false);
  });

  it("TC-CORS-05: Responds to browser OPTIONS preflights with 204 and CORS headers without 401", async () => {
    const res = await fetch(`${apiBase}/v1/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: `https://www.${testDomain}`,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), `https://www.${testDomain}`);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  });

  it("TC-CORS-06: Preflight for unauthorized origin does not return allow-origin header", async () => {
    const res = await fetch(`${apiBase}/v1/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://unknown-unregistered-origin.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    // CORS middleware should not reflect unauthorized origin
    assert.notEqual(res.headers.get("access-control-allow-origin"), "https://unknown-unregistered-origin.com");
  });
});
