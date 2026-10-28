import { Router, Request, Response } from "express";
import { query } from "../db";
import { authorizeRoomAccess } from "../middleware/roomAuth";
import { requireAuth } from "./auth";

export const pollsRouter = Router();

/**
 * GET /api/rooms/:roomCode/polls
 * Fetches polls and aggregated vote counts for the room.
 * Requires authenticated participant membership.
 */
pollsRouter.get(
  "/:roomCode/polls",
  authorizeRoomAccess({ requireParticipant: true }),
  async (req: Request, res: Response) => {
    try {
      const room = (req as any).room;
      const roomCode = room.room_code;

      const pollsRes = await query(
        `SELECT id, room_code, created_by, question, poll_type, correct_option_index, timer_seconds, is_active, created_at, ended_at
         FROM polls
         WHERE room_code = $1
         ORDER BY created_at DESC;`,
        [roomCode]
      );

      if (pollsRes.rows.length === 0) {
        return res.json({ polls: [] });
      }

      const pollIds = pollsRes.rows.map((p) => p.id);

      // Fetch options
      const optionsRes = await query(
        `SELECT id, poll_id, option_index, option_text
         FROM poll_options
         WHERE poll_id = ANY($1)
         ORDER BY poll_id, option_index ASC;`,
        [pollIds]
      );

      // Fetch votes count grouped by option
      const votesRes = await query(
        `SELECT poll_id, option_id, COUNT(*)::int as count
         FROM poll_votes
         WHERE poll_id = ANY($1)
         GROUP BY poll_id, option_id;`,
        [pollIds]
      );

      const polls = pollsRes.rows.map((p) => {
        const opts = optionsRes.rows.filter((o) => o.poll_id === p.id);
        const pollVotes = votesRes.rows.filter((v) => v.poll_id === p.id);

        const votesMap: Record<number, number> = {};
        let total = 0;
        opts.forEach((o) => {
          const v = pollVotes.find((pv) => pv.option_id === o.id);
          const c = v ? v.count : 0;
          votesMap[o.option_index] = c;
          total += c;
        });

        return {
          id: p.id,
          room_code: p.room_code,
          question: p.question,
          pollType: p.poll_type,
          options: opts.map((o) => o.option_text),
          optionsDetailed: opts,
          correctOptionIndex: p.correct_option_index,
          timerSeconds: p.timer_seconds,
          isActive: p.is_active,
          votes: votesMap,
          totalVotes: total,
          created_at: p.created_at,
        };
      });

      return res.json({ polls });
    } catch (err: any) {
      console.error("[Polls GET Error]:", err.message);
      return res.status(500).json({ error: "Failed to fetch polls", details: err.message });
    }
  }
);

/**
 * POST /api/rooms/:roomCode/polls
 * Creates a new poll.
 * Strictly requires tutor/host authorization.
 */
pollsRouter.post(
  "/:roomCode/polls",
  authorizeRoomAccess({ requireTutor: true }),
  async (req: Request, res: Response) => {
    try {
      const room = (req as any).room;
      const user = (req as any).user;
      const roomCode = room.room_code;
      const { question, options, poll_type = "mcq", correct_option_index = null, timer_seconds = null } = req.body;

      if (!question || !options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: "Question and non-empty options array are required" });
      }

      const validCreatorId =
        user.id && user.id.includes("-") && user.id.length === 36 ? user.id : null;

      // Insert poll
      const pollSql = `
        INSERT INTO polls (room_code, created_by, question, poll_type, correct_option_index, timer_seconds, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING *;
      `;
      const pollResult = await query(pollSql, [
        roomCode,
        validCreatorId,
        question.trim(),
        poll_type,
        correct_option_index,
        timer_seconds,
      ]);
      const poll = pollResult.rows[0];

      // Insert options
      const createdOptions = [];
      for (let i = 0; i < options.length; i++) {
        const optSql = `
          INSERT INTO poll_options (poll_id, option_index, option_text)
          VALUES ($1, $2, $3)
          RETURNING *;
        `;
        const optRes = await query(optSql, [poll.id, i, String(options[i]).trim()]);
        createdOptions.push(optRes.rows[0]);
      }

      return res.json({
        poll: {
          id: poll.id,
          room_code: poll.room_code,
          question: poll.question,
          pollType: poll.poll_type,
          options: createdOptions.map((o) => o.option_text),
          optionsDetailed: createdOptions,
          correctOptionIndex: poll.correct_option_index,
          timerSeconds: poll.timer_seconds,
          isActive: poll.is_active,
          votes: {},
          totalVotes: 0,
          created_at: poll.created_at,
        },
      });
    } catch (err: any) {
      console.error("[Polls POST Error]:", err.message);
      return res.status(500).json({ error: "Failed to create poll", details: err.message });
    }
  }
);

/**
 * POST /api/polls/:pollId/vote
 * Records an authorized participant's vote on an active poll.
 */
pollsRouter.post("/:pollId/vote", requireAuth, async (req: Request, res: Response) => {
  try {
    const { pollId } = req.params;
    const { option_index, duration_ms } = req.body;
    const user = (req as any).user;

    if (option_index === undefined || option_index === null) {
      return res.status(400).json({ error: "option_index is required" });
    }

    // Verify poll exists and fetch room_code
    const pollRes = await query(
      "SELECT id, room_code, is_active, correct_option_index FROM polls WHERE id = $1;",
      [pollId]
    );

    if (pollRes.rows.length === 0 || !pollRes.rows[0].is_active) {
      return res.status(404).json({ error: "Active poll not found" });
    }

    const poll = pollRes.rows[0];

    // Verify caller is an active participant or tutor in this room
    if (user.isParticipantToken) {
      if (user.room_code && user.room_code.toLowerCase() !== poll.room_code.toLowerCase()) {
        return res.status(403).json({ error: "Participant token is not valid for this poll's room" });
      }
    } else {
      const partRes = await query(
        `SELECT 1 FROM room_participants 
         WHERE room_code = $1 AND (user_id = $2 OR display_name = $3)
         LIMIT 1;`,
        [poll.room_code, user.id, user.full_name || ""]
      );
      if (partRes.rows.length === 0) {
        return res.status(403).json({ error: "Must be a participant in this meeting room to vote on polls" });
      }
    }

    // Find option ID for this poll and index
    const optRes = await query(
      "SELECT id FROM poll_options WHERE poll_id = $1 AND option_index = $2;",
      [pollId, option_index]
    );

    if (optRes.rows.length === 0) {
      return res.status(404).json({ error: "Poll option not found" });
    }

    const optionId = optRes.rows[0].id;
    const isUserUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(user.id));
    const validUserId = isUserUUID ? user.id : null;

    const isCorrect =
      poll.correct_option_index !== null
        ? poll.correct_option_index === option_index
        : null;

    // Insert or update vote
    const voteSql = `
      INSERT INTO poll_votes (poll_id, option_id, user_id, is_correct, duration_ms)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (poll_id, user_id) DO UPDATE SET
        option_id = EXCLUDED.option_id,
        is_correct = EXCLUDED.is_correct,
        duration_ms = EXCLUDED.duration_ms,
        voted_at = NOW()
      RETURNING *;
    `;

    const voteRes = await query(voteSql, [pollId, optionId, validUserId, isCorrect, duration_ms || null]);

    return res.json({ success: true, vote: voteRes.rows[0] });
  } catch (err: any) {
    console.error("[Poll Vote Error]:", err.message);
    return res.status(500).json({ error: "Failed to record vote", details: err.message });
  }
});

/**
 * POST /api/polls/:pollId/end
 * Ends an active poll.
 * Strictly requires tutor/host authorization for the poll's room.
 */
pollsRouter.post("/:pollId/end", requireAuth, async (req: Request, res: Response) => {
  try {
    const { pollId } = req.params;
    const user = (req as any).user;

    const pollRes = await query("SELECT id, room_code, is_active FROM polls WHERE id = $1;", [pollId]);
    if (pollRes.rows.length === 0) {
      return res.status(404).json({ error: "Poll not found" });
    }

    const poll = pollRes.rows[0];

    // Verify caller is room tutor/host
    const roomRes = await query(
      "SELECT id, room_code, tutor_id, metadata, organization_id FROM live_classes WHERE room_code = $1;",
      [poll.room_code]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];
    const isOwner = Boolean(
      (room.tutor_id && String(room.tutor_id) === String(user.id)) ||
      (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(user.id)) ||
      (user.isParticipantToken && user.role === "tutor" && Boolean(user.permissions?.isHost))
    );

    if (!isOwner) {
      return res.status(403).json({ error: "Only the meeting host can end polls", code: "FORBIDDEN_TUTOR_REQUIRED" });
    }

    await query("UPDATE polls SET is_active = FALSE, ended_at = NOW() WHERE id = $1;", [pollId]);

    return res.json({ success: true, pollId, isActive: false });
  } catch (err: any) {
    console.error("[Poll End Error]:", err.message);
    return res.status(500).json({ error: "Failed to end poll", details: err.message });
  }
});

