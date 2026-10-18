import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildSessionReplay } from "@/lib/session-log";
import { currentMember } from "@/lib/tournament-auth";
import { tick, type TournamentGameRow, type TournamentMemberRow } from "@/lib/tournament";

export const dynamic = "force-dynamic";

/**
 * Review / live-spectate payload for one tournament game, in the duel review
 * shape so the DuelReview screen renders it. Members can watch live (except
 * the two players in it); once the tournament ends replays are public.
 * Nothing is returned before GO so the problem can't leak.
 */
export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get("gameId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  let { data: game } = await db()
    .from("tournament_games")
    .select("*, tournament_matches(member_a, member_b, game_sec)")
    .eq("id", gameId)
    .maybeSingle<
      TournamentGameRow & {
        tournament_matches: { member_a: string | null; member_b: string | null; game_sec: number } | null;
      }
    >();
  if (!game || Date.now() < Date.parse(game.started_at)) {
    return NextResponse.json({ error: "not started" }, { status: 404 });
  }
  const viewer = await currentMember(game.tournament_id);
  const { data: tour } = await db()
    .from("tournaments")
    .select("status")
    .eq("id", game.tournament_id)
    .maybeSingle<{ status: string }>();
  if (tour?.status !== "finished" && (!viewer || viewer.kicked_at)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!game.finished_at && Date.now() > Date.parse(game.ends_at)) {
    await tick(game.tournament_id);
    const again = await db().from("tournament_games").select("finished_at, winner_member_id").eq("id", gameId).maybeSingle();
    if (again.data) game = { ...game, ...again.data };
  }
  const seatMatch = game.tournament_matches;
  if (!game.finished_at && viewer && (viewer.id === seatMatch?.member_a || viewer.id === seatMatch?.member_b)) {
    return NextResponse.json({ error: "finish your own game first" }, { status: 403 });
  }
  const m = game.tournament_matches;
  const ids = [m?.member_a, m?.member_b].filter(Boolean) as string[];
  const { data: members } = ids.length
    ? await db().from("tournament_members").select("id, name").in("id", ids)
    : { data: [] };
  const nameOf = new Map((members as Pick<TournamentMemberRow, "id" | "name">[] | null ?? []).map((x) => [x.id, x.name]));

  const seats = [
    { memberId: m?.member_a ?? null, sessionId: game.session_a },
    { memberId: m?.member_b ?? null, sessionId: game.session_b },
  ].filter((s): s is { memberId: string; sessionId: string } => Boolean(s.memberId && s.sessionId));

  const players = await Promise.all(
    seats.map(async (s) => ({
      userId: s.memberId,
      sessionId: s.sessionId,
      name: nameOf.get(s.memberId) ?? "Player",
      avatarUrl: null,
      isWinner: game.winner_member_id === s.memberId,
      replay: await buildSessionReplay(s.sessionId),
    }))
  );

  return NextResponse.json({
    match: {
      id: game.id,
      roomId: game.tournament_id,
      problemId: game.problem_id,
      startedAt: game.started_at,
      finishedAt: game.finished_at,
      winnerUserId: game.winner_member_id,
      totalTimeSec: m?.game_sec ?? null,
      graceAfterAcSec: null,
    },
    invalidated: false,
    invalidReason: null,
    players,
    serverNow: Date.now(),
  });
}
