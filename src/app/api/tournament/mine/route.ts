import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEffectiveUser } from "@/lib/impersonation";

export const dynamic = "force-dynamic";

/** Tournaments the signed-in user hosts or has joined (for the Tournaments tab). */
export async function GET() {
  const user = await getEffectiveUser();
  if (!user) return NextResponse.json({ tournaments: [] });
  const { data: seats } = await db()
    .from("tournament_members")
    .select("tournament_id, is_admin, role")
    .eq("user_id", user.id)
    .is("kicked_at", null);
  const ids = Array.from(new Set((seats ?? []).map((s) => s.tournament_id as string)));
  if (!ids.length) return NextResponse.json({ tournaments: [] });
  const [{ data: ts }, { data: counts }] = await Promise.all([
    db()
      .from("tournaments")
      .select("id, code, name, status, created_at, created_by")
      .in("id", ids)
      .order("created_at", { ascending: false })
      .limit(30),
    db()
      .from("tournament_members")
      .select("tournament_id")
      .in("tournament_id", ids)
      .eq("role", "participant")
      .is("kicked_at", null),
  ]);
  const n = new Map<string, number>();
  for (const c of counts ?? []) n.set(c.tournament_id, (n.get(c.tournament_id) ?? 0) + 1);
  return NextResponse.json({
    tournaments: (ts ?? []).map((t) => ({
      code: t.code,
      name: t.name,
      status: t.status,
      createdAt: t.created_at,
      isHost: t.created_by === user.id,
      players: n.get(t.id) ?? 0,
    })),
  });
}
