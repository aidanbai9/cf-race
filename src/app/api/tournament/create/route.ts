import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEffectiveUser } from "@/lib/impersonation";
import { rateLimit } from "@/lib/rate-limit";
import { newTournamentCode } from "@/lib/tournament";
import { mintToken, setMemberCookie } from "@/lib/tournament-auth";
import { cleanName } from "@/lib/tournament-format";
import { bad, readJson } from "@/lib/tournament-route";

export const dynamic = "force-dynamic";

/** Signed-in users create a tournament and get the owner's admin seat. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { name: "tournament-create", limit: 10 });
  if (limited) return limited;
  const user = await getEffectiveUser();
  if (!user) return bad("Sign in to create a tournament", 401);

  const body = await readJson(req);
  const name = cleanName(body.name) ?? "Tournament";
  const fallback =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Host";
  const myName = cleanName(body.myName) ?? cleanName(fallback) ?? "Host";
  const role = body.role === "spectator" ? "spectator" : "participant";

  const code = await newTournamentCode();
  const { data: t, error } = await db()
    .from("tournaments")
    .insert({ code, name, created_by: user.id })
    .select("id, code")
    .single();
  if (error || !t) return bad(error?.message ?? "create failed", 500);

  const { token, hash } = mintToken();
  const { error: mErr } = await db().from("tournament_members").insert({
    tournament_id: t.id,
    token_hash: hash,
    user_id: user.id,
    name: myName,
    role,
    is_admin: true,
    is_owner: true,
  });
  if (mErr) return bad(mErr.message, 500);
  setMemberCookie(t.id, token);
  return NextResponse.json({ code: t.code });
}
