"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import confetti from "canvas-confetti";
import { Check, Coins, Copy, Crown, Eye, Link2, Loader2, Medal, Play, Radio, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Navbar } from "@/components/shell/navbar";
import { DuelReview } from "@/components/duel/duel-review";
import { supabase } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { formatLabel, roundLabel } from "@/lib/tournament-format";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { BracketView } from "./bracket";
import { CoinFlipOverlay, type CoinFlipShow } from "./coin-flip";
import { RoleToggle, TournamentLobby } from "./lobby";
import { MemberRow } from "./member-actions";
import { TournamentRace } from "./race";
import { chime, fmtClock, memberMap, notify, postJson, type MatchView, type TournamentStateView } from "./shared";

const COIN_FRESH_MS = 30_000;

export function TournamentRoom({ code }: { code: string }) {
  const [state, setState] = useState<TournamentStateView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tickN, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [watching, setWatching] = useState<{ gameId: string; live: boolean } | null>(null);
  const [coinQueue, setCoinQueue] = useState<CoinFlipShow[]>([]);
  const [solvedGame, setSolvedGame] = useState<string | null>(null);
  const clockOffset = useRef(0);
  const serverNow = useCallback(() => Date.now() + clockOffset.current, []);
  const channel = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournament/state?code=${code}`, { cache: "no-store" });
      if (res.status === 404) return setNotFound(true);
      if (!res.ok) return;
      const d: TournamentStateView = await res.json();
      clockOffset.current = d.serverNow - Date.now();
      setState(d);
    } catch {}
  }, [code]);

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(iv);
  }, []);

  // At GO the problem is only revealed by the next state fetch; don't wait for the 2s poll.
  const awaitingProblem = Boolean(state?.myGame && !state.myGame.problem);
  useEffect(() => {
    if (awaitingProblem && state?.myGame && serverNow() >= state.myGame.startAtMs) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickN, awaitingProblem]);

  const tid = state?.tournament.id;
  useEffect(() => {
    if (!tid) return;
    const ch = supabase().channel(`tournament-${tid}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "sync" }, () => void refresh());
    ch.subscribe();
    channel.current = ch;
    return () => {
      void ch.unsubscribe();
      channel.current = null;
    };
  }, [tid, refresh]);

  /** Refresh now and nudge everyone else's page. */
  const changed = useCallback(() => {
    void refresh();
    void channel.current?.send({ type: "broadcast", event: "sync", payload: {} });
  }, [refresh]);

  const names = useMemo(() => memberMap(state), [state]);
  const nameOf = useCallback((id: string | null) => (id ? names.get(id)?.name ?? "—" : "TBD"), [names]);
  const myMatch = state?.matches.find((m) => m.id === state.myMatchId) ?? null;
  const me = state?.me ?? null;

  // ── Reminders: my match is ready / my next opponent is set ───────────────
  const lastReminder = useRef<string | null>(null);
  useEffect(() => {
    if (!myMatch || !me) return;
    const opp = myMatch.a === me.id ? myMatch.b : myMatch.a;
    let key: string | null = null;
    if (myMatch.status === "ready") key = `ready:${myMatch.id}:${myMatch.games.length}`;
    else if (myMatch.status === "pending" && opp) key = `opp:${myMatch.id}`;
    if (!key || key === lastReminder.current) return;
    lastReminder.current = key;
    if (myMatch.status === "ready") {
      chime();
      notify("Your match is ready", `Ready up vs ${nameOf(opp)}`);
      toast("Your match is ready — ready up!", {
        description: `vs ${nameOf(opp)} · ${myMatch.games.length ? `Game ${myMatch.games.length + 1}` : formatLabel(myMatch.format)}`,
        duration: 10_000,
        action: { label: "Ready", onClick: () => void ready() },
      });
    } else {
      toast(`Your next opponent: ${nameOf(opp)}`, { description: "The match starts when the round opens." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMatch?.id, myMatch?.status, myMatch?.games.length, myMatch?.a, myMatch?.b, me?.id]);

  // Flash the tab title while my ready-up is pending.
  const needReady = Boolean(
    myMatch && me && myMatch.status === "ready" && !(myMatch.a === me.id ? myMatch.aReady : myMatch.bReady)
  );
  useEffect(() => {
    if (!needReady) return;
    const base = document.title;
    let on = false;
    const iv = setInterval(() => {
      on = !on;
      document.title = on ? "● Your match is ready!" : base;
    }, 1000);
    return () => {
      clearInterval(iv);
      document.title = base;
    };
  }, [needReady]);

  // ── Game results for me ───────────────────────────────────────────────────
  const lastGame = useRef<string | null>(null);
  useEffect(() => {
    const cur = state?.myGame?.gameId ?? null;
    const prev = lastGame.current;
    lastGame.current = cur;
    if (!prev || prev === cur || !state || !me) return;
    const g = state.matches.flatMap((m) => m.games).find((x) => x.id === prev);
    if (!g?.finishedAtMs) return;
    if (g.decidedBy === "coinflip") return; // the coin overlay tells the story
    if (g.winner === me.id) {
      confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 } });
      toast.success(`You won game ${g.gameNo}!`);
    } else if (g.winner) toast(`${nameOf(g.winner)} won game ${g.gameNo}`);
    else toast(`Game ${g.gameNo} drawn — nobody solved it`);
  }, [state, me, nameOf]);

  // ── Coin flips ────────────────────────────────────────────────────────────
  const seenCoins = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state) return;
    if (!seenCoins.current) {
      try {
        seenCoins.current = new Set(JSON.parse(sessionStorage.getItem(`cfr-coins-${code}`) ?? "[]"));
      } catch {
        seenCoins.current = new Set();
      }
    }
    const seen = seenCoins.current;
    const fresh: CoinFlipShow[] = [];
    for (const m of state.matches) {
      const flips = [
        ...m.games.filter((g) => g.coin).map((g) => ({ key: `g:${g.id}`, coin: g.coin! })),
        ...(m.coin ? [{ key: `m:${m.id}`, coin: m.coin }] : []),
      ];
      for (const f of flips) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        if (state.serverNow - f.coin.atMs > COIN_FRESH_MS) continue;
        const involved = me && (m.a === me.id || m.b === me.id);
        const show: CoinFlipShow = {
          key: f.key,
          title: `${roundLabel(m.round, state.rounds, m.bracket)}${f.key.startsWith("m:") ? " · series tiebreak" : ""}`,
          aName: nameOf(m.a),
          bName: nameOf(m.b),
          winner: f.coin.winner,
        };
        if (involved || me?.isAdmin || me?.role === "spectator") fresh.push(show);
        else
          toast(`Coin flip: ${f.coin.winner === "a" ? show.aName : show.bName} advances`, {
            description: `${show.aName} vs ${show.bName}`,
            action: { label: "Watch flip", onClick: () => setCoinQueue((q) => [...q, show]) },
          });
      }
    }
    sessionStorage.setItem(`cfr-coins-${code}`, JSON.stringify(Array.from(seen)));
    if (fresh.length) setCoinQueue((q) => [...q, ...fresh]);
  }, [state, me, nameOf, code]);

  const ready = useCallback(async () => {
    const res = await postJson("/api/tournament/ready", { code });
    if (!res.ok) toast.error(res.error);
    changed();
  }, [code, changed]);

  // Celebrate the champion once.
  const celebrated = useRef(false);
  useEffect(() => {
    if (state?.tournament.status !== "finished" || celebrated.current) return;
    celebrated.current = true;
    if (state.serverNow - (state.tournament.finishedAtMs ?? 0) < 60_000) {
      confetti({ particleCount: 220, spread: 120, origin: { y: 0.4 } });
    }
  }, [state]);

  const coin = <CoinFlipOverlay show={coinQueue[0] ?? null} onDone={() => setCoinQueue((q) => q.slice(1))} />;

  if (notFound) {
    return (
      <>
        <Navbar />
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <p className="font-mono text-sm text-muted-foreground">No tournament with code {code}.</p>
          <Button asChild variant="secondary" size="sm">
            <Link href="/tournaments">Back to tournaments</Link>
          </Button>
        </main>
      </>
    );
  }
  if (!state) {
    return (
      <>
        <Navbar />
        <main className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      </>
    );
  }

  const t = state.tournament;
  const game = state.myGame;
  if (me && game && solvedGame !== game.gameId && game.outcome !== "solved") {
    const m = state.matches.find((x) => x.id === game.matchId);
    const label = m
      ? `${roundLabel(m.round, state.rounds, m.bracket)}${m.format !== "single" ? ` · G${m.games.length}` : ""}`
      : "Tournament";
    return (
      <>
        {coin}
        <TournamentRace
          game={game}
          myName={me.name}
          label={label}
          serverNow={serverNow}
          onSolved={() => {
            setSolvedGame(game.gameId);
            changed();
          }}
        />
      </>
    );
  }

  const isMember = me !== null;
  const selectedMatch = state.matches.find((m) => m.id === selected) ?? null;
  const liveMatches = state.matches.filter((m) => m.status === "live");

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      {coin}
      {watching && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          {needReady && myMatch && <ReadyStrip match={myMatch} state={state} nameOf={nameOf} onGo={() => setWatching(null)} />}
          <div className="min-h-0 flex-1">
            <DuelReview
              key={watching.gameId}
              apiUrl={`/api/tournament/game?gameId=${watching.gameId}`}
              readOnly
              live={watching.live}
              onExit={() => setWatching(null)}
              exitLabel="← bracket"
            />
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-5 px-4 py-6 md:px-6">
        <Header state={state} />
        {!isMember && t.status !== "finished" ? (
          <JoinCard state={state} onJoined={changed} />
        ) : t.status === "lobby" ? (
          <TournamentLobby state={state} onChanged={changed} />
        ) : (
          <>
            {t.status === "finished" && <Podium state={state} nameOf={nameOf} />}
            {me && t.status === "running" && (
              <MyMatchCard state={state} match={myMatch} nameOf={nameOf} onReady={ready} serverNow={serverNow} />
            )}
            <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
              <div className="h-[68vh]">
                <BracketView
                  state={state}
                  selectedId={selected}
                  onSelect={(id) => setSelected((s) => (s === id ? null : id))}
                  onOpenGame={(gameId, live) => setWatching({ gameId, live })}
                  focusId={state.myMatchId}
                />
              </div>
              <aside className="space-y-4">
                {selectedMatch ? (
                  <MatchDetails
                    match={selectedMatch}
                    state={state}
                    nameOf={nameOf}
                    onClose={() => setSelected(null)}
                    onWatch={(gameId, live) => setWatching({ gameId, live })}
                    onCoin={(show) => setCoinQueue((q) => [...q, show])}
                    onChanged={changed}
                  />
                ) : (
                  <LiveList matches={liveMatches} state={state} nameOf={nameOf} onWatch={(gameId) => setWatching({ gameId, live: true })} />
                )}
                <RosterCard state={state} onChanged={changed} />
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Header({ state }: { state: TournamentStateView }) {
  const t = state.tournament;
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = (what: "code" | "link") => {
    void navigator.clipboard.writeText(what === "code" ? t.code : `${window.location.origin}/t/${t.code}`);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const players = state.members.filter((m) => m.role === "participant").length;
  return (
    <header className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Tournament</p>
        <h1 className="truncate text-3xl font-bold tracking-tight">{t.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={t.status === "running" ? "default" : "secondary"}>
            {t.status === "lobby" ? "Lobby — open to join" : t.status === "running" ? "In progress" : "Finished"}
          </Badge>
          <span>{players} players · {state.members.length - players} spectators</span>
          {state.me && (
            <span>
              · you are {state.me.role === "participant" ? "competing" : "spectating"}
              {state.me.isAdmin ? " (admin)" : ""}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => copy("code")}
          className="group flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-left hover:bg-primary/15"
          title="Copy join code"
        >
          <span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Join code</span>
            <span className="block font-mono text-2xl font-black tracking-[0.3em]">{t.code}</span>
          </span>
          {copied === "code" ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />}
        </button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => copy("link")}>
          {copied === "link" ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} Invite link
        </Button>
      </div>
    </header>
  );
}

function JoinCard({ state, onJoined }: { state: TournamentStateView; onJoined: () => void }) {
  const running = state.tournament.status !== "lobby";
  const [name, setName] = useState("");
  const [role, setRole] = useState<"participant" | "spectator">(running ? "spectator" : "participant");
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    const res = await postJson("/api/tournament/join", { code: state.tournament.code, name, role });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(role === "participant" ? "You're in! Waiting for the host to start." : "Joined as a spectator");
    onJoined();
  };
  return (
    <Card className="mx-auto max-w-md border-primary/40 bg-card/60">
      <CardHeader>
        <CardTitle className="text-lg">Join {state.tournament.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          {state.kicked && <p className="text-sm text-red-400">An admin removed you. You can rejoin below.</p>}
          <Input autoFocus value={name} maxLength={24} placeholder="Your name" onChange={(e) => setName(e.target.value)} className="h-11 text-base" />
          <RoleToggle value={role} onChange={setRole} participantDisabled={running} />
          {running && <p className="text-xs text-muted-foreground">The bracket is already drawn — you can still watch every match.</p>}
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">No account needed.</p>
        </form>
      </CardContent>
    </Card>
  );
}

function ReadyStrip({ match, state, nameOf, onGo }: { match: MatchView; state: TournamentStateView; nameOf: (id: string | null) => string; onGo: () => void }) {
  const opp = match.a === state.me?.id ? match.b : match.a;
  const left = (match.readyDeadlineMs ?? 0) - state.serverNow;
  return (
    <div className="flex items-center gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950">
      <Radio className="h-4 w-4 animate-pulse" />
      Your match vs {nameOf(opp)} is ready — {fmtClock(left)} to ready up
      <Button size="sm" variant="secondary" className="ml-auto" onClick={onGo}>
        Go to my match
      </Button>
    </div>
  );
}

function MyMatchCard({
  state,
  match,
  nameOf,
  onReady,
  serverNow,
}: {
  state: TournamentStateView;
  match: MatchView | null;
  nameOf: (id: string | null) => string;
  onReady: () => void;
  serverNow: () => number;
}) {
  const me = state.me!;
  if (me.role !== "participant") return null;
  const lostIn = state.matches.find((m) => m.status === "done" && m.loser === me.id && m.bracket === "main");
  if (!match) {
    if (!lostIn) return null;
    return (
      <div className="rounded-xl border border-border/60 bg-card/60 px-5 py-4 text-sm">
        You were knocked out in the {roundLabel(lostIn.round, state.rounds).toLowerCase()}. Keep watching — click any{" "}
        <span className="font-mono text-red-300">LIVE</span> match to spectate.
      </div>
    );
  }
  const side = match.a === me.id ? "a" : "b";
  const opp = side === "a" ? match.b : match.a;
  const iReady = side === "a" ? match.aReady : match.bReady;
  const oppReady = side === "a" ? match.bReady : match.aReady;
  const title = `${roundLabel(match.round, state.rounds, match.bracket)} vs ${opp ? nameOf(opp) : "TBD"}`;
  const score = match.format !== "single" ? ` · series ${side === "a" ? match.aWins : match.bWins}–${side === "a" ? match.bWins : match.aWins}` : "";

  if (match.status === "ready") {
    const left = (match.readyDeadlineMs ?? 0) - serverNow();
    const nextNo = match.games.length + 1;
    return (
      <div className={cn("flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4", iReady ? "border-green-500/50 bg-green-500/10" : "border-amber-400/70 bg-amber-400/10")}>
        <div className="flex-1">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-amber-400">Your match · {match.format === "single" ? "1 game" : `game ${nextNo}`}{score}</p>
          <p className="text-xl font-bold">{title}</p>
          <p className="text-sm text-muted-foreground">
            {formatLabel(match.format)} · {oppReady ? `${nameOf(opp)} is ready` : `waiting for ${nameOf(opp)}`}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-black tabular-nums">{fmtClock(left)}</p>
          <p className="text-xs text-muted-foreground">auto-start</p>
        </div>
        <Button size="lg" onClick={onReady} disabled={iReady} className="min-w-36 gap-2">
          {iReady ? <><Check className="h-4 w-4" /> Ready</> : <><Play className="h-4 w-4" /> Ready up</>}
        </Button>
      </div>
    );
  }
  if (match.status === "live") {
    return (
      <div className="rounded-xl border border-border/60 bg-card/60 px-5 py-4 text-sm">
        <span className="font-semibold">{title}</span>
        {score} — waiting for the game to finish…
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 px-5 py-4 text-sm">
      <span className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Up next · </span>
      <span className="font-semibold">{title}</span>
      <span className="text-muted-foreground"> — starts when the current round finishes. Watch a live match meanwhile; we&apos;ll ping you.</span>
    </div>
  );
}

function LiveList({ matches, state, nameOf, onWatch }: { matches: MatchView[]; state: TournamentStateView; nameOf: (id: string | null) => string; onWatch: (gameId: string) => void }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-red-400" /> Live now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {matches.length === 0 && <p className="text-sm text-muted-foreground">No games in progress.</p>}
        {matches.map((m) => {
          const g = m.games.find((x) => !x.finishedAtMs);
          return (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {nameOf(m.a)} <span className="text-muted-foreground">vs</span> {nameOf(m.b)}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {roundLabel(m.round, state.rounds, m.bracket)}
                  {g ? ` · ${fmtClock(g.endsAtMs - state.serverNow)} left` : ""}
                </p>
              </div>
              {g && (
                <Button size="sm" variant="secondary" className="gap-1" onClick={() => onWatch(g.id)}>
                  <Eye className="h-3.5 w-3.5" /> Watch
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MatchDetails({
  match: m,
  state,
  nameOf,
  onClose,
  onWatch,
  onCoin,
  onChanged,
}: {
  match: MatchView;
  state: TournamentStateView;
  nameOf: (id: string | null) => string;
  onClose: () => void;
  onWatch: (gameId: string, live: boolean) => void;
  onCoin: (show: CoinFlipShow) => void;
  onChanged: () => void;
}) {
  const admin = state.me?.isAdmin;
  const label = roundLabel(m.round, state.rounds, m.bracket);
  const act = async (body: Record<string, unknown>) => {
    const res = await postJson("/api/tournament/admin", { code: state.tournament.code, matchId: m.id, ...body });
    if (!res.ok) toast.error(res.error);
    onChanged();
  };
  const coinShow = (key: string, winner: "a" | "b", title: string): CoinFlipShow => ({ key: `${key}:${Date.now()}`, title, aName: nameOf(m.a), bName: nameOf(m.b), winner });
  return (
    <Card className="border-primary/40 bg-card/60">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{label}</CardTitle>
          <p className="text-xs text-muted-foreground">{formatLabel(m.format)}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          {(["a", "b"] as const).map((s) => {
            const id = s === "a" ? m.a : m.b;
            return (
              <div key={s} className={cn("flex items-center justify-between", m.winner && m.winner === id && "font-semibold text-green-400")}>
                <span>{id ? nameOf(id) : m.decidedBy === "bye" ? "bye" : "TBD"}</span>
                <span className="font-mono">{m.format === "single" ? "" : s === "a" ? m.aWins : m.bWins}</span>
              </div>
            );
          })}
        </div>
        {m.games.length > 0 && (
          <ul className="space-y-1.5">
            {m.games.map((g) => {
              const live = !g.finishedAtMs;
              const result = live
                ? "in progress"
                : g.decidedBy === "solve"
                  ? `${nameOf(g.winner)} solved it`
                  : g.decidedBy === "coinflip"
                    ? `coin flip → ${nameOf(g.winner)}`
                    : g.decidedBy === "draw"
                      ? "draw (unsolved)"
                      : `${nameOf(g.winner)} (${g.decidedBy})`;
              return (
                <li key={g.id} className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5">
                  <span className="w-8 font-mono text-xs font-bold">{g.suddenDeath ? "SD" : `G${g.gameNo}`}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{g.problemName ?? "—"}</span>
                    <span className="block text-[11px] text-muted-foreground">{result}</span>
                  </span>
                  {g.coin && (
                    <button title="Replay coin flip" onClick={() => onCoin(coinShow(g.id, g.coin!.winner, label))} className="text-amber-400 hover:text-amber-300">
                      <Coins className="h-4 w-4" />
                    </button>
                  )}
                  <Button size="sm" variant={live ? "default" : "secondary"} className="h-7 gap-1 px-2 text-xs" onClick={() => onWatch(g.id, live)}>
                    {live ? <Eye className="h-3 w-3" /> : <Play className="h-3 w-3" />} {live ? "Watch" : "Replay"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {m.coin && (
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => onCoin(coinShow(m.id, m.coin!.winner, `${label} · series tiebreak`))}>
            <Coins className="h-4 w-4 text-amber-400" /> Replay tiebreak coin flip
          </Button>
        )}
        {m.games.some((g) => g.finishedAtMs) && (
          <p className="text-[11px] text-muted-foreground">Replays have shareable links — open one and copy the URL.</p>
        )}
        {admin && m.status !== "done" && m.a && m.b && (
          <div className="space-y-2 border-t border-border/50 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Admin</p>
            {m.status === "ready" && (
              <Button size="sm" variant="secondary" className="w-full" onClick={() => void act({ action: "start_now" })}>
                Start game now (skip ready-up)
              </Button>
            )}
            <div className="flex gap-2">
              {(["a", "b"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  className="flex-1 truncate"
                  onClick={() => {
                    const n = nameOf(s === "a" ? m.a : m.b);
                    if (confirm(`Advance ${n}? This ends the match immediately.`)) void act({ action: "force_winner", winner: s });
                  }}
                >
                  Advance {nameOf(s === "a" ? m.a : m.b)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RosterCard({ state, onChanged }: { state: TournamentStateView; onChanged: () => void }) {
  const me = state.me;
  if (!me) return null;
  const sorted = [...state.members].sort((x, y) => (x.role === y.role ? (x.seed ?? 99) - (y.seed ?? 99) : x.role === "participant" ? -1 : 1));
  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <CardTitle className="text-base">People</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {sorted.map((m) => (
            <MemberRow key={m.id} member={m} code={state.tournament.code} isMe={m.id === me.id} canAdmin={me.isAdmin} locked onChanged={onChanged} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Podium({ state, nameOf }: { state: TournamentStateView; nameOf: (id: string | null) => string }) {
  const final = state.matches.find((m) => m.bracket === "main" && m.round === state.rounds);
  const third = state.matches.find((m) => m.bracket === "third");
  const places = [
    { label: "Champion", id: final?.winner ?? null, icon: <Crown className="h-6 w-6 text-amber-400" />, cls: "border-amber-400/60 bg-amber-400/10 md:order-2 md:scale-105" },
    { label: "2nd place", id: final?.loser ?? null, icon: <Medal className="h-5 w-5 text-slate-300" />, cls: "border-slate-300/40 bg-slate-300/5 md:order-1" },
    { label: "3rd place", id: third?.winner ?? null, icon: <Medal className="h-5 w-5 text-orange-400" />, cls: "border-orange-400/40 bg-orange-400/5 md:order-3" },
  ].filter((p) => p.id);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {places.map((p) => (
        <div key={p.label} className={cn("flex items-center gap-3 rounded-xl border px-5 py-4", p.cls)}>
          {p.icon}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{p.label}</p>
            <p className="text-xl font-bold">{nameOf(p.id)}</p>
          </div>
          {p.label === "Champion" && <Trophy className="ml-auto h-8 w-8 text-amber-400/70" />}
        </div>
      ))}
    </div>
  );
}
