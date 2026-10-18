import { db } from "./db";
import { buildReplayEvents, fetchEditorEventRows } from "./editor-events";
import type { Lang, Problem } from "./types";
import type { TouristEvent } from "./tourist";

export type SessionKind = "solo" | "duel" | "event" | "tournament";

/** Shape of GET /api/solo/replay responses (client + server share this). */
export type SessionReplayResponse = {
  problemId: string;
  lang: Lang;
  solveMs: number | null;
  events: TouristEvent[];
  outcome: "solved" | "timeout" | "abandoned" | null;
  timerSec: number;
  startedAt: string;
  problemName: string;
  touristTimeMs: number | null;
  problem: Problem | null;
  recordingUrl: string | null;
  recordingOffsetMs: number;
};

export type SessionRow = {
  id: string;
  kind: SessionKind;
  user_id: string | null;
  browser_id: string | null;
  problem_id: string;
  lang: Lang | null;
  started_at: string;
  timer_sec: number | null;
  solve_ms: number | null;
  outcome: "solved" | "timeout" | "abandoned" | null;
  recording_path: string | null;
  recording_offset_ms: number | null;
};

/**
 * Build the tourist-format event log for a session (any kind) from the
 * single session_events playback stream (editor snapshots/deltas, runs,
 * tabs, scroll, submit + verdict moments).
 */
export async function buildSessionLog(
  sessionId: string,
  preloaded?: SessionRow
): Promise<{
  session: SessionRow;
  log: {
    problemId: string;
    lang: Lang;
    solveMs: number | null;
    events: TouristEvent[];
  };
} | null> {
  const session =
    preloaded ??
    (
      await db()
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle<SessionRow>()
    ).data;
  if (!session) return null;

  const snaps = await fetchEditorEventRows("session_events", {
    session_id: sessionId,
  });
  const { events, lang } = buildReplayEvents(snaps, session.lang ?? "cpp");

  return {
    session,
    log: {
      problemId: session.problem_id,
      lang,
      solveMs: session.solve_ms,
      events,
    },
  };
}

/** A session's replay payload with a signed webcam URL, shared by surfaces. */
export async function buildSessionReplay(
  sessionId: string,
  preloaded?: SessionRow
): Promise<SessionReplayResponse | null> {
  const session =
    preloaded ??
    (
      await db()
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle<SessionRow>()
    ).data;
  if (!session) return null;

  const [built, signed, { data: problem }] = await Promise.all([
    buildSessionLog(sessionId, session),
    session.recording_path
      ? db().storage.from("recordings").createSignedUrl(session.recording_path, 3600)
      : Promise.resolve({ data: null }),
    db().from("problems").select("*").eq("id", session.problem_id).maybeSingle(),
  ]);
  if (!built) return null;
  const { log } = built;

  const recordingUrl = signed.data?.signedUrl ?? null;

  return {
    ...log,
    outcome: session.outcome,
    timerSec: session.timer_sec ?? 0,
    startedAt: session.started_at,
    problemName: problem?.name ?? session.problem_id,
    touristTimeMs: problem?.tourist_time_ms ?? null,
    problem: problem ?? null,
    recordingUrl,
    recordingOffsetMs: session.recording_offset_ms ?? 0,
  };
}
