import { NextRequest, NextResponse } from "next/server";
import { currentMatchFor, loadSnapshot, setReady, tick } from "@/lib/tournament";
import { bad, readJson, tournamentFromCode } from "@/lib/tournament-route";

export const dynamic = "force-dynamic";

/** Ready up for my next game; the game starts once both players are ready. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const found = await tournamentFromCode(body.code);
  if (!found.ok) return found.response;
  const { t, me } = found;
  if (!me) return bad("Join the tournament first", 403);
  const snap = await loadSnapshot(t.id);
  const match = snap ? currentMatchFor(snap, me.id) : null;
  if (!match || match.status !== "ready") return bad("Your match isn't waiting on you");
  await setReady(match, me.id);
  await tick(t.id);
  return NextResponse.json({ ok: true });
}
