import { NextResponse } from "next/server";
import { db } from "./db";
import { loadTournamentByCode, type TournamentMemberRow, type TournamentRow } from "./tournament";
import { currentMember } from "./tournament-auth";
import { MAX_PARTICIPANTS, normalizeCode } from "./tournament-format";

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** Resolve the tournament by code plus the caller's membership. */
export async function tournamentFromCode(
  raw: unknown
): Promise<
  | { ok: true; t: TournamentRow; me: TournamentMemberRow | null }
  | { ok: false; response: NextResponse }
> {
  const code = typeof raw === "string" ? normalizeCode(raw) : "";
  if (!code) return { ok: false, response: bad("missing code") };
  const t = await loadTournamentByCode(code);
  if (!t) return { ok: false, response: bad("No tournament with that code", 404) };
  const me = await currentMember(t.id);
  return { ok: true, t, me };
}

export async function nameTaken(
  tournamentId: string,
  name: string,
  exceptMemberId?: string
): Promise<boolean> {
  const { data } = await db()
    .from("tournament_members")
    .select("id, name")
    .eq("tournament_id", tournamentId)
    .is("kicked_at", null)
    .ilike("name", name.replace(/[%_\\]/g, "\\$&"));
  return (data ?? []).some((m) => m.id !== exceptMemberId);
}

/** Whether the player list is full (ignoring `exceptMemberId`'s own seat). */
export async function participantsFull(
  tournamentId: string,
  exceptMemberId: string
): Promise<boolean> {
  const { count } = await db()
    .from("tournament_members")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("role", "participant")
    .is("kicked_at", null)
    .neq("id", exceptMemberId);
  return (count ?? 0) >= MAX_PARTICIPANTS;
}
