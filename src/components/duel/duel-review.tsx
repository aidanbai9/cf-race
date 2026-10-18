"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReplayEditor } from "@/components/replay/replay-editor";
import {
  ReplayBadges,
  ReplayStatement,
  type ScrollEvent,
} from "@/components/replay/replay-player";
import { ShareButton } from "@/components/shell/share-button";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout,
} from "@/components/ui/resizable";
import { formatMsPrecise } from "@/lib/templates";
import { TouristPlayer, type TouristLog, type TouristEvent } from "@/lib/tourist";
import type { SessionReplayResponse } from "@/lib/session-log";
import { cn } from "@/lib/utils";
import { Ban, FileText, Pause, Play, Radio, RotateCcw, Trophy } from "lucide-react";
import { toast } from "sonner";

const SPEEDS = [1, 2, 4, 8];

/** How far behind wall-clock the live view runs, covering the players' event flush cadence. */
const LIVE_LAG_MS = 5000;
const LIVE_POLL_MS = 2500;
/** After the match ends, keep polling this long for webcam uploads to land. */
const POST_MATCH_POLL_MS = 3 * 60 * 1000;

type ReviewPlayer = {
  userId: string;
  sessionId: string;
  name: string;
  avatarUrl: string | null;
  isWinner: boolean;
  replay: SessionReplayResponse | null;
};

type ReviewData = {
  match: {
    id: string;
    roomId: string;
    problemId: string;
    startedAt: string;
    finishedAt: string | null;
    winnerUserId: string | null;
    totalTimeSec: number | null;
    graceAfterAcSec: number | null;
  };
  invalidated: boolean;
  invalidReason: string | null;
  players: ReviewPlayer[];
  /** Present on the live (spectator) endpoint. */
  serverNow?: number;
};

/** One player's synced pane: webcam + replay editor + verdict badges. */
function ReviewPane({
  player,
  clockMs,
  playing,
  speed,
  live,
}: {
  player: ReviewPlayer;
  clockMs: number;
  playing: boolean;
  speed: number;
  live: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const replay = player.replay;
  const log: TouristLog | null = useMemo(
    () =>
      replay
        ? {
            problemId: replay.problemId,
            lang: replay.lang,
            solveMs: replay.solveMs ?? 0,
            events: replay.events as TouristEvent[],
          }
        : null,
    [replay]
  );
  // A live log grows at the tail on every poll; extending the existing player
  // keeps Monaco's document (and the viewer's scroll) instead of re-seeking.
  const playerRef = useRef<TouristPlayer | null>(null);
  const touristPlayer = useMemo(() => {
    if (!log) return null;
    const cur = playerRef.current;
    if (cur?.extend(log.events)) return cur;
    const next = new TouristPlayer(log.events);
    playerRef.current = next;
    return next;
  }, [log]);

  const offsetMs = replay?.recordingOffsetMs ?? 0;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, speed, replay?.recordingUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const target = (clockMs - offsetMs) / 1000;
    if (target < 0) {
      if (v.currentTime !== 0) v.currentTime = 0;
      return;
    }
    if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target;
  }, [clockMs, offsetMs]);

  const solved =
    replay?.solveMs != null && replay.solveMs !== 0 && clockMs >= replay.solveMs;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border/60 last:border-r-0">
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border/60 px-3 py-2",
          player.isWinner ? "bg-green-500/10" : "bg-card/40"
        )}
      >
        {player.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.avatarUrl}
            alt=""
            className="h-6 w-6 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="text-sm font-semibold">{player.name}</span>
        {player.isWinner && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
        {log && <ReplayBadges log={{ ...log, solveMs: replay?.solveMs ?? null }} clockMs={clockMs} />}
        <span className="ml-auto font-mono text-xs tabular-nums">
          {replay?.solveMs != null && solved ? (
            <span className="font-bold text-green-400">
              AC {formatMsPrecise(replay.solveMs)}
            </span>
          ) : replay?.outcome ? (
            <span className="text-muted-foreground">{replay.outcome}</span>
          ) : null}
        </span>
      </div>
      {replay?.recordingUrl ? (
        <video
          ref={videoRef}
          src={replay.recordingUrl}
          muted
          playsInline
          preload="auto"
          className="aspect-video w-full shrink-0 border-b border-border/60 bg-black object-cover"
        />
      ) : live ? null : (
        <div className="flex aspect-video w-full shrink-0 items-center justify-center border-b border-border/60 bg-black/50">
          <p className="font-mono text-xs text-muted-foreground">
            No webcam recording
          </p>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {touristPlayer && log ? (
          <ReplayEditor
            player={touristPlayer}
            clockMs={clockMs}
            fallbackLang={log.lang}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-xs text-muted-foreground">
              No replay data
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Problem statement beside the review, scroll-synced to one player's recorded
 * view (switchable) until the viewer scrolls it themselves.
 */
function ReviewStatement({
  players,
  clockMs,
}: {
  players: ReviewPlayer[];
  clockMs: number;
}) {
  const withProblem = players.filter((p) => p.replay?.problem);
  const [followId, setFollowId] = useState(withProblem[0]?.userId ?? null);
  const followed = withProblem.find((p) => p.userId === followId) ?? withProblem[0];
  const scrollEvents = useMemo(
    () =>
      (followed?.replay?.events ?? []).filter(
        (ev): ev is ScrollEvent & { type: "scroll" } => ev.type === "scroll"
      ),
    [followed]
  );
  const problem = followed?.replay?.problem;
  if (!followed || !problem) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {withProblem.length > 1 && (
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1.5">
          <span className="mr-1 font-mono text-xs text-muted-foreground">
            follow
          </span>
          {withProblem.map((p) => (
            <Button
              key={p.userId}
              size="sm"
              variant={p.userId === followed.userId ? "secondary" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setFollowId(p.userId)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ReplayStatement
          key={followed.userId}
          problem={problem}
          events={scrollEvents}
          clockMs={clockMs}
        />
      </div>
    </div>
  );
}

/** Mounted only once review data has loaded: the persisted layout reads localStorage. */
function ReviewPanels({
  players,
  clockMs,
  playing,
  speed,
  showStatement,
  live,
}: {
  players: ReviewPlayer[];
  clockMs: number;
  playing: boolean;
  speed: number;
  showStatement: boolean;
  live: boolean;
}) {
  const layout = useResizableLayout("cfr-duel-review-h");
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      {showStatement && (
        <>
          <ResizablePanel id="statement" defaultSize="28%" minSize="15%">
            <ReviewStatement players={players} clockMs={clockMs} />
          </ResizablePanel>
          <ResizableHandle />
        </>
      )}
      <ResizablePanel id="players" minSize="40%" className="flex min-h-0 min-w-0">
        {players.map((p) => (
          <ReviewPane
            key={p.sessionId}
            player={p}
            clockMs={clockMs}
            playing={playing}
            speed={speed}
            live={live}
          />
        ))}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * Side-by-side duel review: both players' editor replays and webcams driven
 * by ONE shared clock/scrubber with play/pause, speeds, and jump-to-event.
 *
 * With `live`, the same screen spectates a match in progress: the data is
 * polled, the clock follows wall time (a few seconds behind, so events have
 * landed), scrubbing back works like a DVR, and the match rolls into the
 * ordinary review once it ends.
 */
export function DuelReview({
  matchId,
  apiUrl,
  readOnly = false,
  live = false,
  onExit,
  exitLabel = "← lobby",
}: {
  matchId?: string;
  /** Override the review data endpoint (e.g. public share tokens). */
  apiUrl?: string;
  /** Public share view: no invalidate/share controls. */
  readOnly?: boolean;
  /** Spectate a match in progress (apiUrl must return `serverNow`). */
  live?: boolean;
  /** Embedded in another screen: render a back control that calls this. */
  onExit?: () => void;
  exitLabel?: string;
}) {
  const [data, setData] = useState<ReviewData | null | undefined>(undefined);
  const [clockMs, setClockMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [following, setFollowing] = useState(live);
  const [invalidating, setInvalidating] = useState(false);
  const [showStatement, setShowStatement] = useState(true);
  const raf = useRef<number>();
  const last = useRef<number>(0);
  const clockRef = useRef(0);
  clockRef.current = clockMs;
  const clockOffset = useRef(0);
  const startAtRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    fetch(apiUrl ?? `/api/duel/review?matchId=${matchId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ReviewData | null) => {
        // A live match that hasn't produced data yet keeps loading (and polling).
        if (d === null && live) return;
        if (d?.serverNow != null) clockOffset.current = d.serverNow - Date.now();
        if (d) startAtRef.current = new Date(d.match.startedAt).getTime();
        setData(d);
      })
      .catch(() => {
        if (!live) setData(null);
      });
  }, [matchId, apiUrl, live]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isLive = live && data != null && data.match.finishedAt === null;

  // Live polling: fast while racing; slower after the finish until both
  // webcam uploads have landed (or long enough that they won't).
  useEffect(() => {
    if (!live || data === null) return;
    let every = LIVE_POLL_MS;
    if (data?.match.finishedAt) {
      const sinceFinish = Date.now() - new Date(data.match.finishedAt).getTime();
      const allUploaded = data.players.every((p) => p.replay?.recordingUrl);
      if (allUploaded || sinceFinish > POST_MATCH_POLL_MS) return;
      every = 10_000;
    }
    const iv = setInterval(refresh, every);
    return () => clearInterval(iv);
  }, [live, data, refresh]);

  /** Where "now" is on the replay clock for a live match. */
  const liveEdge = useCallback(() => {
    const startAt = startAtRef.current;
    if (startAt === null) return 0;
    return Math.max(0, Date.now() + clockOffset.current - startAt - LIVE_LAG_MS);
  }, []);

  // Autoplay once the replay data is actually loaded (not against the
  // placeholder duration).
  const startedRef = useRef(false);
  useEffect(() => {
    if (data && !startedRef.current) {
      startedRef.current = true;
      setPlaying(true);
    }
  }, [data]);

  const durationMs = useMemo(() => {
    if (!data) return 1000;
    let max = 1000;
    for (const p of data.players) {
      if (!p.replay) continue;
      if (p.replay.solveMs != null) max = Math.max(max, p.replay.solveMs);
      const evs = p.replay.events;
      if (evs.length > 0) max = Math.max(max, evs[evs.length - 1].t);
    }
    return max;
  }, [data]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) * speed;
      last.current = now;
      if (isLive && following) {
        setClockMs(liveEdge());
      } else {
        const cap = isLive ? liveEdge() : durationMs;
        const next = clockRef.current + dt;
        if (next >= cap) {
          // Catching up to the live edge resumes following; a finished
          // replay simply stops at the end.
          if (isLive) setFollowing(true);
          else setPlaying(false);
          setClockMs(cap);
        } else {
          setClockMs(next);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, durationMs, isLive, following, liveEdge]);

  // Shared jump-to-event markers: submits/verdicts/ACs from both players.
  const markers = useMemo(() => {
    if (!data) return [];
    const items: { t: number; label: string; color: string }[] = [];
    for (const p of data.players) {
      if (!p.replay) continue;
      for (const ev of p.replay.events) {
        if (ev.type === "submit") {
          items.push({
            t: ev.t,
            label: `${p.name} submitted`,
            color: "bg-amber-400",
          });
        } else if (ev.type === "verdict") {
          items.push({
            t: ev.t,
            label: `${p.name}: ${ev.verdict}`,
            color: ev.verdict === "AC" ? "bg-green-400" : "bg-red-400",
          });
        } else if (ev.type === "run") {
          items.push({
            t: ev.t,
            label: `${p.name} ran samples`,
            color: "bg-sky-400",
          });
        }
      }
    }
    return items.sort((a, b) => a.t - b.t);
  }, [data]);

  const toggleInvalid = async () => {
    if (!data) return;
    setInvalidating(true);
    try {
      let reason: string | null = null;
      if (!data.invalidated) {
        reason = window.prompt("Reason for invalidating (optional):") ?? null;
      }
      const res = await fetch("/api/duel/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          data.invalidated
            ? { problemId: data.match.problemId, revoke: true }
            : { problemId: data.match.problemId, reason }
        ),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setInvalidating(false);
    }
  };

  if (data === undefined) {
    return (
      <main className="flex h-full items-center justify-center">
        <p className="animate-pulse font-mono text-sm text-muted-foreground">
          Loading review…
        </p>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-mono text-sm text-muted-foreground">
          Match not found.
        </p>
        <Button asChild size="sm" variant="secondary">
          <Link href="/duels">Back to duels</Link>
        </Button>
      </main>
    );
  }

  const winner = data.players.find((p) => p.isWinner) ?? null;
  const hasStatement = data.players.some((p) => p.replay?.problem?.statement_html);
  // Live: the scrubber ends at the (lagged) present, so the thumb is pinned
  // right while following; events already stored past that point stay hidden
  // until the clock reaches them.
  const endMs = isLive ? Math.max(1000, liveEdge()) : durationMs;
  const goLive = () => {
    setFollowing(true);
    setSpeed(1);
    setPlaying(true);
  };

  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3">
        {onExit ? (
          <button
            onClick={onExit}
            className="font-mono text-xs text-primary hover:underline"
          >
            {exitLabel}
          </button>
        ) : (
          !readOnly && (
            <Link href="/duels" className="font-mono text-xs text-primary hover:underline">
              ← duels
            </Link>
          )
        )}
        <span className="font-mono text-sm text-primary">
          {data.match.problemId}
        </span>
        <span className="text-sm font-semibold">
          {data.players.map((p) => p.name).join(" vs ")}
        </span>
        {data.invalidated ? (
          <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono text-xs text-red-400">
            problem invalidated{data.invalidReason ? `: ${data.invalidReason}` : ""}
            {" — result void"}
          </span>
        ) : winner ? (
          <span className="flex items-center gap-1.5 rounded bg-green-500/15 px-2 py-0.5 font-mono text-xs text-green-400">
            <Trophy className="h-3 w-3 text-amber-400" />
            {winner.name} won
            {winner.replay?.solveMs != null &&
              ` · ${formatMsPrecise(winner.replay.solveMs)}`}
          </span>
        ) : isLive ? (
          <span className="flex items-center gap-1.5 rounded bg-red-500/15 px-2 py-0.5 font-mono text-xs text-red-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            live
          </span>
        ) : (
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            both DNF
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {hasStatement && (
            <Button
              size="sm"
              variant={showStatement ? "secondary" : "ghost"}
              onClick={() => setShowStatement((v) => !v)}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Statement
            </Button>
          )}
          {!readOnly && matchId && <ShareButton matchId={matchId} />}
          {!readOnly && (
            <Button
              size="sm"
              variant="ghost"
              disabled={invalidating}
              onClick={() => void toggleInvalid()}
            >
              {data.invalidated ? (
                <>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Restore problem
                </>
              ) : (
                <>
                  <Ban className="mr-1.5 h-3.5 w-3.5" />
                  Invalidate problem
                </>
              )}
            </Button>
          )}
          <span className="font-mono text-xl tabular-nums">
            {formatMsPrecise(clockMs)}
          </span>
        </span>
      </header>

      <ReviewPanels
        players={data.players}
        clockMs={clockMs}
        playing={playing}
        speed={speed}
        showStatement={hasStatement && showStatement}
        live={isLive}
      />

      <footer className="flex items-center gap-3 border-t border-border/60 px-5 py-3">
        <Button
          size="icon"
          variant="secondary"
          onClick={() => {
            if (!isLive && clockMs >= durationMs) setClockMs(0);
            if (playing) setFollowing(false);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            setFollowing(false);
            setClockMs(0);
            setPlaying(true);
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          <input
            type="range"
            className="w-full accent-primary"
            value={clockMs}
            min={0}
            max={endMs}
            step={100}
            onChange={(e) => {
              setFollowing(false);
              setClockMs(Number(e.target.value));
            }}
          />
          {markers.filter((m) => m.t <= endMs).map((m, i) => (
            <button
              key={i}
              title={`${m.label} · ${formatMsPrecise(m.t)}`}
              onClick={() => {
                setFollowing(false);
                setClockMs(m.t);
              }}
              className={cn(
                "absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                m.color
              )}
              style={{ left: `${(m.t / endMs) * 100}%` }}
            />
          ))}
        </div>
        {isLive && following ? (
          <span className="flex items-center gap-1.5 px-2 font-mono text-xs text-red-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            LIVE
          </span>
        ) : (
          <div className="flex gap-1">
            {SPEEDS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={speed === s ? "default" : "ghost"}
                className="font-mono"
                onClick={() => setSpeed(s)}
              >
                {s}×
              </Button>
            ))}
            {isLive && (
              <Button size="sm" variant="secondary" className="font-mono" onClick={goLive}>
                <Radio className="mr-1.5 h-3.5 w-3.5" />
                Go live
              </Button>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}
