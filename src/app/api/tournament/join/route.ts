import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEffectiveUser } from "@/lib/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { participants } from "@/lib/tournament";
import { mintToken, setMemberCookie } from "@/lib/tournament-auth";
import { MAX_PARTICIPANTS, cleanName } from "@/lib/tournament-format";
import { bad, nameTaken, readJson, tournamentFromCode } from "@/lib/tournament-route";

export const dynamic = "force-dynamic";

/** Join with just the code and a name — no account needed. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { name: "tournament-join", limit: 20 });
  if (limited) return limited;
  const body = await readJson(req);
  const found = await tournamentFromCode(body.code);
  if (!found.ok) return found.response;
  const { t, me } = found;
  if (me) return NextResponse.json({ ok: true, memberId: me.id });

  const name = cleanName(body.name);
  if (!name) return bad("Pick a name");
  if (await nameTaken(t.id, name)) return bad("That name is taken — try another");

  let role: "participant" | "spectator" = body.role === "spectator" ? "spectator" : "participant";
  if (t.status !== "lobby") role = "spectator";
  if (role === "participant") {
    const { data: members } = await db()
      .from("tournament_members")
      .select("*")
      .eq("tournament_id", t.id);
    if (participants(members ?? []).length >= MAX_PARTICIPANTS) {
      return bad(`This tournament is full (${MAX_PARTICIPANTS} players) — join as a spectator`);
    }
  }

  const user = await getEffectiveUser();
  const { token, hash } = mintToken();
  const { data, error } = await db()
    .from("tournament_members")
    .insert({ tournament_id: t.id, token_hash: hash, user_id: user?.id ?? null, name, role })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "join failed", 500);
  setMemberCookie(t.id, token);
  return NextResponse.json({ ok: true, memberId: data.id, role });
}
