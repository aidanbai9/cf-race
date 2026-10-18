import { NextResponse } from "next/server";
import { db } from "./db";
import { getEffectiveUser } from "./impersonation";
import { tournamentSessionSeat } from "./tournament-auth";
import type { SessionRow } from "./session-log";

export type SessionAccess =
  | { ok: true; session: SessionRow }
  | { ok: false; response: NextResponse };

/**
 * Load a session for a mutating request. Anonymous sessions are
 * capability-authorized by their unguessable id; sessions claimed by a
 * user (duels, signed-in solo runs) only accept their owner.
 */
export async function requireSessionAccess(
  sessionId: string
): Promise<SessionAccess> {
  const { data: session } = await db()
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unknown session" }, { status: 404 }),
    };
  }
  if (session.kind === "tournament") {
    // Tournament sessions are anonymous but their ids are visible to
    // spectators, so only the seat holder may write to them.
    if (!(await tournamentSessionSeat(session.id))) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "not your session" },
          { status: 403 }
        ),
      };
    }
    return { ok: true, session };
  }
  if (session.user_id !== null) {
    const user = await getEffectiveUser();
    if (user?.id !== session.user_id) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "not your session" },
          { status: 403 }
        ),
      };
    }
  }
  return { ok: true, session };
}
