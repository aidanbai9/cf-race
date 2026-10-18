import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  forceMatchWinner,
  loadSnapshot,
  participants,
  startMatchNow,
  startTournament,
} from "@/lib/tournament";
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS, cleanName } from "@/lib/tournament-format";
import { bad, nameTaken, participantsFull, readJson, tournamentFromCode } from "@/lib/tournament-route";

export const dynamic = "force-dynamic";

/**
 * Admin actions. Admins can rename, change role, grant/revoke admin and kick
 * anyone except the owner, start the tournament, skip a ready window, and
 * decide a match by hand.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const found = await tournamentFromCode(body.code);
  if (!found.ok) return found.response;
  const { t, me } = found;
  if (!me?.is_admin) return bad("Admins only", 403);
  const snap = await loadSnapshot(t.id);
  if (!snap) return bad("not found", 404);

  const action = body.action;
  if (action === "start") {
    if (t.status !== "lobby") return bad("Already started");
    if (participants(snap.members).length < MIN_PARTICIPANTS) {
      return bad(`Need at least ${MIN_PARTICIPANTS} participants`);
    }
    if (participants(snap.members).length > MAX_PARTICIPANTS) {
      return bad(`At most ${MAX_PARTICIPANTS} participants — move some to spectators`);
    }
    const res = await startTournament(t, snap.members);
    if (!res.ok) return bad(res.error, res.status);
    return NextResponse.json({ ok: true });
  }

  if (action === "start_now" || action === "force_winner") {
    const matchId = typeof body.matchId === "string" ? body.matchId : "";
    if (!snap.matches.some((m) => m.id === matchId)) return bad("unknown match");
    if (action === "start_now") {
      await startMatchNow(t.id, matchId);
      return NextResponse.json({ ok: true });
    }
    const winner = body.winner === "a" || body.winner === "b" ? body.winner : null;
    if (!winner) return bad("pick a winner");
    const ok = await forceMatchWinner(t.id, matchId, winner);
    return ok ? NextResponse.json({ ok: true }) : bad("That match can't be decided now");
  }

  const target = snap.members.find(
    (m) => m.id === body.memberId && !m.kicked_at
  );
  if (!target) return bad("unknown member");
  if (target.is_owner && target.id !== me.id) return bad("The host can't be changed");

  let patch: Record<string, unknown> | null = null;
  if (action === "rename") {
    const name = cleanName(body.name);
    if (!name) return bad("Pick a name");
    if (await nameTaken(t.id, name, target.id)) return bad("That name is taken");
    patch = { name };
  } else if (action === "role") {
    if (t.status !== "lobby") return bad("Roles are locked once the tournament starts");
    const role = body.role === "spectator" ? "spectator" : "participant";
    if (role === "participant" && target.role !== "participant" && (await participantsFull(t.id, target.id))) {
      return bad(`The player list is full (${MAX_PARTICIPANTS})`);
    }
    patch = { role };
  } else if (action === "admin") {
    if (target.is_owner) return bad("The host is always an admin");
    patch = { is_admin: Boolean(body.isAdmin) };
  } else if (action === "kick") {
    if (target.is_owner) return bad("The host can't be removed");
    patch = { kicked_at: new Date().toISOString() };
  } else {
    return bad("unknown action");
  }
  const { error } = await db().from("tournament_members").update(patch).eq("id", target.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
