import { NextRequest, NextResponse } from "next/server";
import { db, logDbError } from "@/lib/db";
import { judgeConfigured } from "@/lib/judge";
import { MAX_SOURCE_LEN } from "@/lib/limits";
import { rateLimit } from "@/lib/rate-limit";
import { judgeOfficialSubmission, submissionLimitReached } from "@/lib/submission-route";
import { SUBMIT_GRACE_MS, tick, type TournamentGameRow } from "@/lib/tournament";
import { tournamentSessionSeat } from "@/lib/tournament-auth";
import { TOURNAMENT_MAX_SUBMISSIONS } from "@/lib/tournament-format";

export const maxDuration = 120;

/** Official submission in a tournament game. First AC wins the game. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { name: "tournament-submit", limit: 60 });
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const lang = body?.lang === "cpp" || body?.lang === "py" ? body.lang : null;
  const source = typeof body?.source === "string" ? body.source : "";
  if (!sessionId || !lang || !source || source.length > MAX_SOURCE_LEN) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!judgeConfigured()) {
    return NextResponse.json({ error: "Judge service is not configured yet" }, { status: 503 });
  }

  const seat = await tournamentSessionSeat(sessionId);
  if (!seat) return NextResponse.json({ error: "not your session" }, { status: 403 });
  const [{ data: session }, { data: game }] = await Promise.all([
    db().from("sessions").select("*").eq("id", sessionId).maybeSingle(),
    db().from("tournament_games").select("*").eq("id", seat.gameId).maybeSingle<TournamentGameRow>(),
  ]);
  if (!session || !game) return NextResponse.json({ error: "unknown game" }, { status: 400 });
  if (session.outcome === "solved") {
    return NextResponse.json({ error: "already solved" }, { status: 400 });
  }
  const now = Date.now();
  const startMs = Date.parse(game.started_at);
  if (game.finished_at || game.first_ac_at || now > Date.parse(game.ends_at) + SUBMIT_GRACE_MS) {
    return NextResponse.json({ error: "game is over" }, { status: 400 });
  }
  if (now < startMs) {
    return NextResponse.json({ error: "game has not started" }, { status: 400 });
  }
  if (
    await submissionLimitReached(
      "session_submissions",
      { session_id: sessionId, kind: "submit" },
      TOURNAMENT_MAX_SUBMISSIONS
    )
  ) {
    return NextResponse.json({ error: "submission limit reached" }, { status: 400 });
  }

  const submittedAt = new Date().toISOString();
  const judged = await judgeOfficialSubmission({
    table: "session_submissions",
    insertRow: { session_id: sessionId, kind: "submit", submitted_at: submittedAt },
    lang,
    source,
    problemId: session.problem_id,
  });
  if (!judged.ok) return judged.response;

  const { error: markerErr } = await db().from("session_events").insert([
    {
      session_id: sessionId,
      t_ms: Math.max(0, Date.parse(submittedAt) - startMs),
      lang,
      kind: "submit",
      payload: { submissionId: judged.submissionId },
    },
    {
      session_id: sessionId,
      t_ms: Math.max(0, Date.now() - startMs),
      lang,
      kind: "verdict",
      payload: { submissionId: judged.submissionId, verdict: judged.result.verdict },
    },
  ]);
  logDbError(`tournament submit: replay markers ${sessionId}`, markerErr);

  let solveMs: number | null = null;
  let wonGame = false;
  if (judged.result.verdict === "AC") {
    solveMs = Math.max(0, Date.parse(submittedAt) - startMs);
    const { data: stamped, error: acErr } = await db().rpc("record_tournament_ac", {
      p_session_id: sessionId,
      p_game_id: game.id,
      p_member_id: seat.member.id,
      p_submitted_at: submittedAt,
      p_solve_ms: solveMs,
      p_lang: lang,
    });
    logDbError(`tournament submit: record_tournament_ac ${game.id}`, acErr);
    wonGame = stamped === true;
    await tick(game.tournament_id);
  }
  return NextResponse.json({ ...judged.result, submissionId: judged.submissionId, solveMs, wonGame });
}
