import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { requireOrgRole } from "./apiKeys";
import { query } from "../db";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  validateWebhookUrl,
  dispatchWebhookEvent,
  dispatchTestWebhook,
  validateWebhookEvents,
  SUPPORTED_WEBHOOK_EVENTS,
} from "../services/webhookService";
import { logger } from "../services/logger";

export const webhooksRouter = Router();

/**
 * GET /api/organizations/:orgId/webhooks
 * List registered webhook endpoints for the organization
 */
webhooksRouter.get("/:orgId/webhooks", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "viewer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const endpoints = await listWebhookEndpoints(orgId);

    return res.json({ endpoints });
  } catch (err: any) {
    logger.error("Error listing webhook endpoints", { error: err.message });
    return res.status(500).json({ error: "Failed to list webhook endpoints" });
  }
});

/**
 * POST /api/organizations/:orgId/webhooks
 * Register a new webhook endpoint with one-time raw secret reveal
 */
webhooksRouter.post("/:orgId/webhooks", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const { url, events, description } = req.body;

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return res.status(400).json({ error: "url is required and must be a valid HTTP/HTTPS address" });
    }

    if (events !== undefined) {
      const eventValidation = validateWebhookEvents(events);
      if (!eventValidation.valid) {
        return res.status(400).json({ error: eventValidation.error });
      }
    }

    const { endpoint, rawSecret } = await createWebhookEndpoint({
      organizationId: orgId,
      url: url.trim(),
      events: events !== undefined ? (events as string[]) : undefined,
      description: typeof description === "string" ? description : undefined,
    });

    return res.status(201).json({
      message: "Webhook endpoint created successfully. Copy the raw secret now; it will not be shown again.",
      endpoint,
      secret: rawSecret,
    });
  } catch (err: any) {
    logger.error("Error creating webhook endpoint", { error: err.message });
    return res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /api/organizations/:orgId/webhooks/:endpointId
 * Update an existing webhook endpoint
 */
webhooksRouter.patch("/:orgId/webhooks/:endpointId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const endpointId = String(req.params.endpointId);
    const { url, events, isActive, description } = req.body;

    const currentRes = await query(
      "SELECT id, url, events, is_active, description FROM webhook_endpoints WHERE id = $1 AND organization_id = $2;",
      [endpointId, orgId]
    );

    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: "Webhook endpoint not found" });
    }

    const current = currentRes.rows[0];

    let targetUrl = current.url;
    if (url && typeof url === "string" && url.trim().length > 0) {
      const validation = await validateWebhookUrl(url.trim());
      if (!validation.valid) {
        return res.status(400).json({ error: `Invalid webhook URL: ${validation.reason}` });
      }
      targetUrl = url.trim();
    }

    let targetEvents = current.events;
    if (events !== undefined) {
      const eventValidation = validateWebhookEvents(events);
      if (!eventValidation.valid) {
        return res.status(400).json({ error: eventValidation.error });
      }
      targetEvents = eventValidation.events!;
    }

    const targetIsActive = typeof isActive === "boolean" ? isActive : current.is_active;
    const targetDesc = typeof description === "string" ? description.trim() : current.description;

    const updateSql = `
      UPDATE webhook_endpoints
      SET url = $1, events = $2, is_active = $3, description = $4, updated_at = NOW()
      WHERE id = $5 AND organization_id = $6
      RETURNING id, organization_id, url, secret_prefix, events, is_active, description, created_at, updated_at;
    `;

    const updateRes = await query(updateSql, [
      targetUrl,
      targetEvents,
      targetIsActive,
      targetDesc,
      endpointId,
      orgId,
    ]);

    const row = updateRes.rows[0];
    return res.json({
      message: "Webhook endpoint updated successfully",
      endpoint: {
        id: row.id,
        organizationId: row.organization_id,
        url: row.url,
        secretPrefix: row.secret_prefix,
        events: row.events,
        isActive: row.is_active,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    logger.error("Error updating webhook endpoint", { error: err.message });
    return res.status(500).json({ error: "Failed to update webhook endpoint", details: err.message });
  }
});

/**
 * DELETE /api/organizations/:orgId/webhooks/:endpointId
 * Delete a webhook endpoint
 */
webhooksRouter.delete("/:orgId/webhooks/:endpointId", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const endpointId = String(req.params.endpointId);

    const deleteRes = await query(
      "DELETE FROM webhook_endpoints WHERE id = $1 AND organization_id = $2 RETURNING id;",
      [endpointId, orgId]
    );

    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ error: "Webhook endpoint not found" });
    }

    return res.json({ success: true, message: "Webhook endpoint deleted successfully" });
  } catch (err: any) {
    logger.error("Error deleting webhook endpoint", { error: err.message });
    return res.status(500).json({ error: "Failed to delete webhook endpoint" });
  }
});

/**
 * GET /api/organizations/:orgId/webhooks/:endpointId/deliveries
 * List delivery logs for a specific webhook endpoint
 */
webhooksRouter.get("/:orgId/webhooks/:endpointId/deliveries", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer", "viewer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const endpointId = String(req.params.endpointId);

    const deliveriesRes = await query(
      `SELECT id, endpoint_id, organization_id, event_id, event_type, payload,
              response_status, response_body, attempt_count, status, error_message, delivered_at, created_at
       FROM webhook_deliveries
       WHERE endpoint_id = $1 AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT 50;`,
      [endpointId, orgId]
    );

    return res.json({
      deliveries: deliveriesRes.rows.map((row) => ({
        id: row.id,
        endpointId: row.endpoint_id,
        organizationId: row.organization_id,
        eventId: row.event_id,
        eventType: row.event_type,
        payload: row.payload,
        responseStatus: row.response_status,
        responseBody: row.response_body,
        attemptCount: row.attempt_count,
        status: row.status,
        errorMessage: row.error_message,
        deliveredAt: row.delivered_at,
        createdAt: row.created_at,
      })),
    });
  } catch (err: any) {
    logger.error("Error listing webhook deliveries", { error: err.message });
    return res.status(500).json({ error: "Failed to list webhook deliveries" });
  }
});

/**
 * POST /api/organizations/:orgId/webhooks/:endpointId/test
 * Dispatches an immediate test event to verify endpoint connectivity
 */
webhooksRouter.post("/:orgId/webhooks/:endpointId/test", requireAuth, async (req: Request, res: Response) => {
  try {
    const authorized = await requireOrgRole(req, res, ["owner", "admin", "developer"]);
    if (!authorized) return;

    const orgId = String(req.params.orgId);
    const endpointId = String(req.params.endpointId);

    const result = await dispatchTestWebhook(orgId, endpointId);
    if (!result.dispatched) {
      const statusCode = result.reason === "Webhook endpoint not found" ? 404 : 400;
      return res.status(statusCode).json({ error: result.reason || "Failed to dispatch test webhook" });
    }

    return res.json({
      success: true,
      message: "Test webhook dispatched successfully",
      eventId: result.eventId,
    });
  } catch (err: any) {
    logger.error("Error triggering test webhook", { error: err.message });
    return res.status(500).json({ error: "Failed to send test webhook" });
  }
});
