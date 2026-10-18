"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Plus, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, PageShell } from "@/components/shell/page";
import { SoloAuthButton, useSoloAuth } from "@/components/solo/auth-button";
import { toast } from "sonner";
import { CODE_LENGTH, normalizeCode } from "@/lib/tournament-format";
import { RoleToggle } from "./lobby";
import { postJson } from "./shared";

type Mine = { code: string; name: string; status: string; createdAt: string; isHost: boolean; players: number };

export function TournamentsHome() {
  const auth = useSoloAuth();
  const { user, loading } = auth;
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [role, setRole] = useState<"participant" | "spectator">("participant");
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState<Mine[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const meta = user.user_metadata as { full_name?: string } | undefined;
    setMyName((v) => v || (meta?.full_name ?? user.email?.split("@")[0] ?? "").slice(0, 24));
    void fetch("/api/tournament/mine", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMine(d.tournaments ?? []))
      .catch(() => setMine([]));
  }, [user]);

  const create = async () => {
    setCreating(true);
    const res = await postJson("/api/tournament/create", { name: name || "Tournament", myName, role });
    if (!res.ok || !res.data?.code) {
      setCreating(false);
      toast.error(res.error ?? "Couldn't create tournament");
      return;
    }
    router.push(`/t/${res.data.code}`);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tournaments"
        title="Bracket battles"
        description="Single elimination 1v1 races. Players join with a code — no account needed."
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-primary/40 bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Join with a code</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === CODE_LENGTH) router.push(`/t/${code}`);
              }}
            >
              <Input
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
                placeholder="ABC123"
                aria-label="Join code"
                autoFocus
                className="h-14 text-center font-mono text-3xl font-bold uppercase tracking-[0.4em]"
              />
              <Button type="submit" className="w-full gap-2" disabled={code.length !== CODE_LENGTH}>
                Join <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Host a tournament</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !user ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Sign in to host. Joining never needs an account.</p>
                <SoloAuthButton {...auth} next="/tournaments" />
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="t-name">Tournament name</Label>
                  <Input id="t-name" value={name} maxLength={24} placeholder="Friday Night Speedrun" onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-me">Your display name</Label>
                  <Input id="t-me" value={myName} maxLength={24} onChange={(e) => setMyName(e.target.value)} />
                </div>
                <RoleToggle value={role} onChange={setRole} />
                <Button type="submit" className="w-full gap-2" disabled={creating || !myName.trim()}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create tournament
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      {mine && mine.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Your tournaments</h2>
          <ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card/40">
            {mine.map((t) => (
              <li key={t.code}>
                <Link href={`/t/${t.code}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  <span className="flex-1 truncate font-medium">{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.players} players</span>
                  {t.isHost && <Badge variant="outline">host</Badge>}
                  <Badge variant={t.status === "running" ? "default" : "secondary"}>{t.status === "lobby" ? "open" : t.status}</Badge>
                  <span className="font-mono text-sm tracking-widest">{t.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
