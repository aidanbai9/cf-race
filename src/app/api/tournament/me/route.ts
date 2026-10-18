import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cleanName } from "@/lib/tournament-format";
import { bad, nameTaken, readJson, tournamentFromCode } from "@/lib/tournament-route";

export const dynamic = "force-dynamic";

/** Members change their own name / role while the tournament is in the lobby. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const found = await tournamentFromCode(body.code);
  if (!found.ok) return found.response;
  const { t, me } = found;
  if (!me) return bad("Join the tournament first", 403);
  if (t.status !== "lobby") return bad("The tournament has started");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return bad("Pick a name");
    if (await nameTaken(t.id, name, me.id)) return bad("That name is taken — try another");
    patch.name = name;
  }
  if (body.role === "participant" || body.role === "spectator") patch.role = body.role;
  if (Object.keys(patch).length === 0) return bad("nothing to change");
  const { error } = await db().from("tournament_members").update(patch).eq("id", me.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
