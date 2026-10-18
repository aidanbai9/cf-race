"use client";

import { useEffect, useState } from "react";
import { Bell, Eye, Loader2, Play, Swords, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MIN_PARTICIPANTS, bracketSize, formatLabel, formatForRound, roundCount, roundLabel } from "@/lib/tournament-format";
import { MemberRow } from "./member-actions";
import { postJson, type TournamentStateView } from "./shared";

export function RoleToggle({
  value,
  onChange,
  participantDisabled,
}: {
  value: "participant" | "spectator";
  onChange: (v: "participant" | "spectator") => void;
  participantDisabled?: boolean;
}) {
  const opt = (v: "participant" | "spectator", icon: React.ReactNode, label: string, sub: string) => (
    <button
      type="button"
      disabled={v === "participant" && participantDisabled}
      onClick={() => onChange(v)}
      className={cn(
        "flex flex-1 items-start gap-2 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
        value === v ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/50"
      )}
    >
      {icon}
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="flex gap-2">
      {opt("participant", <Swords className="mt-0.5 h-4 w-4 text-primary" />, "Compete", "Play in the bracket")}
      {opt("spectator", <Eye className="mt-0.5 h-4 w-4 text-muted-foreground" />, "Spectate", "Watch every match")}
    </div>
  );
}

/** Pre-start room: roster with admin controls, my seat, format preview, start. */
export function TournamentLobby({ state, onChanged }: { state: TournamentStateView; onChanged: () => void }) {
  const me = state.me!;
  const code = state.tournament.code;
  const [name, setName] = useState(me.name);
  const [starting, setStarting] = useState(false);
  const [notifyOk, setNotifyOk] = useState(true);
  useEffect(() => setName(me.name), [me.name]);
  useEffect(() => {
    setNotifyOk(typeof Notification === "undefined" || Notification.permission !== "default");
  }, []);

  const players = state.members.filter((m) => m.role === "participant");
  const spectators = state.members.filter((m) => m.role === "spectator");
  const n = players.length;
  const rounds = n >= 2 ? roundCount(n) : 0;
  const byes = n >= 2 ? bracketSize(n) - n : 0;

  const saveMe = async (body: Record<string, unknown>) => {
    const res = await postJson("/api/tournament/me", { code, ...body });
    if (!res.ok) toast.error(res.error);
    onChanged();
  };
  const start = async () => {
    setStarting(true);
    const res = await postJson("/api/tournament/admin", { code, action: "start" });
    setStarting(false);
    if (!res.ok) toast.error(res.error);
    else toast.success("Bracket drawn — round 1 is up!");
    onChanged();
  };

  const roster = (list: typeof players) => (
    <ul className="space-y-0.5">
      {list.map((m) => (
        <MemberRow key={m.id} member={m} code={code} isMe={m.id === me.id} canAdmin={me.isAdmin} locked={false} onChanged={onChanged} />
      ))}
      {list.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Nobody yet</li>}
    </ul>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="h-4 w-4 text-primary" /> Participants
              <span className="font-mono text-sm text-muted-foreground">{n}</span>
            </CardTitle>
            {me.isAdmin && (
              <Button onClick={start} disabled={starting || n < MIN_PARTICIPANTS} className="gap-2">
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start tournament
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {roster(players)}
            {me.isAdmin && n < MIN_PARTICIPANTS && (
              <p className="mt-3 text-xs text-muted-foreground">Need at least {MIN_PARTICIPANTS} participants to start.</p>
            )}
            {!me.isAdmin && (
              <p className="mt-3 animate-pulse font-mono text-xs text-muted-foreground">Waiting for an admin to start…</p>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-muted-foreground" /> Spectators
              <span className="font-mono text-sm text-muted-foreground">{spectators.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>{roster(spectators)}</CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">You</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== me.name) void saveMe({ name });
              }}
            >
              <Input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
              <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === me.name}>
                Save
              </Button>
            </form>
            <RoleToggle value={me.role} onChange={(role) => role !== me.role && void saveMe({ role })} />
            <p className="text-xs text-muted-foreground">You can change your name and role until the tournament starts.</p>
            {!notifyOk && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => void Notification.requestPermission().then(() => setNotifyOk(true))}
              >
                <Bell className="h-4 w-4" /> Notify me when my match is ready
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Format</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Single elimination, random seeding. Matches in a round run at the same time. You get 1 minute to ready up —
              the game starts when both players are ready or the minute is up.
            </p>
            {rounds > 0 ? (
              <ul className="space-y-1.5">
                {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
                  <li key={r} className="flex justify-between gap-3">
                    <span className="font-medium">{roundLabel(r, rounds)}</span>
                    <span className="text-right text-xs text-muted-foreground">{formatLabel(formatForRound(r, rounds))}</span>
                  </li>
                ))}
                {rounds >= 2 && (
                  <li className="flex justify-between gap-3">
                    <span className="font-medium">3rd place</span>
                    <span className="text-right text-xs text-muted-foreground">{formatLabel("bo3")}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">The round plan appears once 2+ people are competing.</p>
            )}
            {byes > 0 && (
              <p className="text-xs text-muted-foreground">
                {byes} bye{byes > 1 ? "s" : ""} in round 1 (top seeds advance automatically).
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
