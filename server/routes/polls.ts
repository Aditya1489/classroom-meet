import { Router, Request, Response } from "express";
import { query } from "../db";

export const pollsRouter = Router();

/**
 * GET /api/rooms/:roomCode/polls
 */
pollsRouter.get("/:roomCode/polls", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;

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
});

/**
 * POST /api/rooms/:roomCode/polls
 */
pollsRouter.post("/:roomCode/polls", async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const { question, options, poll_type = "mcq", correct_option_index = null, timer_seconds = null, created_by } = req.body;

    if (!question || !options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ error: "Question and non-empty options array are required" });
    }

    // Ensure room exists
    await query(
      `INSERT INTO live_classes (room_code, title)
       VALUES ($1, $2)
       ON CONFLICT (room_code) DO NOTHING;`,
      [roomCode, `Class ${roomCode}`]
    );

    const validCreatorId = created_by && created_by.includes("-") && created_by.length === 36 ? created_by : null;

    // Insert poll
    const pollSql = `
      INSERT INTO polls (room_code, created_by, question, poll_type, correct_option_index, timer_seconds, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING *;
    `;
    const pollResult = await query(pollSql, [
      roomCode,
      validCreatorId,
      question,
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
      const optRes = await query(optSql, [poll.id, i, options[i]]);
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
});

/**
 * POST /api/polls/:pollId/vote
 */
pollsRouter.post("/:pollId/vote", async (req: Request, res: Response) => {
  try {
    const { pollId } = req.params;
    const { option_index, user_id, duration_ms } = req.body;

    // Find option ID for this poll and index
    const optRes = await query(
      "SELECT id FROM poll_options WHERE poll_id = $1 AND option_index = $2",
      [pollId, option_index]
    );

    if (optRes.rows.length === 0) {
      return res.status(404).json({ error: "Poll option not found" });
    }

    const optionId = optRes.rows[0].id;
    const validUserId = user_id && user_id.includes("-") && user_id.length === 36 ? user_id : null;

    // Check correctness
    const pollRes = await query("SELECT correct_option_index FROM polls WHERE id = $1", [pollId]);
    const isCorrect =
      pollRes.rows.length > 0 && pollRes.rows[0].correct_option_index !== null
        ? pollRes.rows[0].correct_option_index === option_index
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
