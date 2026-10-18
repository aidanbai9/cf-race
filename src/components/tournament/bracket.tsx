"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Coins, Crosshair, Maximize2, Minus, Play, Plus, Radio, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLabel, roundLabel } from "@/lib/tournament-format";
import { memberMap, scoreOf, type MatchView, type TournamentStateView } from "./shared";

const CARD_W = 232;
const CARD_H = 84;
const COL_GAP = 72;
const ROW_GAP = 22;
const HEADER = 56;
const PAD = 32;

type Pos = { x: number; y: number };

function layout(state: TournamentStateView) {
  const rounds = state.rounds;
  const main = state.matches.filter((m) => m.bracket === "main");
  const firstCount = main.filter((m) => m.round === 1).length;
  const unit = CARD_H + ROW_GAP;
  const pos = new Map<string, Pos>();
  for (const m of main) {
    const span = 2 ** (m.round - 1);
    pos.set(m.id, {
      x: PAD + (m.round - 1) * (CARD_W + COL_GAP),
      y: HEADER + (m.slot + 0.5) * span * unit - CARD_H / 2,
    });
  }
  const height = HEADER + firstCount * unit;
  const third = state.matches.find((m) => m.bracket === "third");
  const final = main.find((m) => m.round === rounds);
  let thirdY = 0;
  if (third && final) {
    const fp = pos.get(final.id)!;
    thirdY = Math.max(fp.y + CARD_H + 90, height - CARD_H - 10);
    pos.set(third.id, { x: fp.x, y: thirdY });
  }
  const width = PAD * 2 + rounds * CARD_W + (rounds - 1) * COL_GAP;
  return { pos, width, height: Math.max(height, third ? thirdY + CARD_H + 20 : 0), rounds };
}

/**
 * Challonge-style bracket: drag to pan, wheel / buttons to zoom, cards show
 * live status and per-game replay chips. Click a card for details.
 */
export function BracketView({
  state,
  selectedId,
  onSelect,
  onOpenGame,
  focusId,
}: {
  state: TournamentStateView;
  selectedId: string | null;
  onSelect: (matchId: string) => void;
  onOpenGame: (gameId: string, live: boolean) => void;
  focusId: string | null;
}) {
  const { pos, width, height, rounds } = useMemo(() => layout(state), [state]);
  const names = useMemo(() => memberMap(state), [state]);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const fitted = useRef(false);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const k = Math.min(1.1, Math.max(0.35, Math.min(el.clientWidth / width, el.clientHeight / (height + 20))));
    setView({ k, x: (el.clientWidth - width * k) / 2, y: Math.max(0, (el.clientHeight - height * k) / 2) });
  }, [width, height]);

  const focus = useCallback(
    (id: string | null) => {
      const el = wrap.current;
      const p = id ? pos.get(id) : null;
      if (!el || !p) return;
      setView((v) => {
        const k = Math.max(v.k, 0.8);
        return { k, x: el.clientWidth / 2 - (p.x + CARD_W / 2) * k, y: el.clientHeight / 2 - (p.y + CARD_H / 2) * k };
      });
    },
    [pos]
  );

  useLayoutEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(2, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (f: number) => {
    const el = wrap.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(2, Math.max(0.3, v.k * f));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  const main = state.matches.filter((m) => m.bracket === "main");
  const lines: string[] = [];
  for (const m of main) {
    if (m.round >= rounds) continue;
    const next = main.find((n) => n.round === m.round + 1 && n.slot === m.slot >> 1);
    const a = pos.get(m.id);
    const b = next && pos.get(next.id);
    if (!a || !b) continue;
    const x1 = a.x + CARD_W;
    const y1 = a.y + CARD_H / 2;
    const x2 = b.x;
    const y2 = b.y + CARD_H / 2;
    const mx = x1 + COL_GAP / 2;
    lines.push(`M${x1},${y1} H${mx} V${y2} H${x2}`);
  }

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-border/60 bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border)/0.6)_1px,transparent_0)] [background-size:22px_22px]">
      <div
        ref={wrap}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => {
            const fmt = main.find((m) => m.round === r)?.format ?? "single";
            return (
              <div
                key={r}
                className="absolute top-0 text-center"
                style={{ left: PAD + (r - 1) * (CARD_W + COL_GAP), width: CARD_W }}
              >
                <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-primary">
                  {roundLabel(r, rounds)}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{formatLabel(fmt)}</p>
              </div>
            );
          })}
          <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height}>
            {lines.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="hsl(var(--border))" strokeWidth={2} />
            ))}
          </svg>
          {state.matches.map((m) => {
            const p = pos.get(m.id);
            if (!p) return null;
            return (
              <div key={m.id} className="absolute" style={{ left: p.x, top: p.y, width: CARD_W }}>
                {m.bracket === "third" && (
                  <p className="absolute -top-6 left-0 font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-500">
                    3rd place match
                  </p>
                )}
                <MatchCard
                  match={m}
                  nameOf={(id) => (id ? names.get(id)?.name ?? "—" : null)}
                  seedOf={(id) => (id ? names.get(id)?.seed ?? null : null)}
                  mine={m.id === state.myMatchId}
                  meId={state.me?.id ?? null}
                  selected={m.id === selectedId}
                  champion={state.tournament.champion}
                  isFinal={m.bracket === "main" && m.round === rounds}
                  serverNow={state.serverNow}
                  onSelect={() => !drag.current?.moved && onSelect(m.id)}
                  onOpenGame={onOpenGame}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex gap-1 rounded-lg border border-border/60 bg-card/90 p-1 shadow-lg backdrop-blur">
        <IconBtn label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Fit bracket" onClick={fit}>
          <Maximize2 className="h-4 w-4" />
        </IconBtn>
        {focusId && (
          <IconBtn label="Find my match" onClick={() => focus(focusId)}>
            <Crosshair className="h-4 w-4" />
          </IconBtn>
        )}
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-muted-foreground">
        drag to pan · scroll to zoom · click a match for details
      </p>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function MatchCard({
  match: m,
  nameOf,
  seedOf,
  mine,
  meId,
  selected,
  champion,
  isFinal,
  serverNow,
  onSelect,
  onOpenGame,
}: {
  match: MatchView;
  nameOf: (id: string | null) => string | null;
  seedOf: (id: string | null) => number | null;
  mine: boolean;
  meId: string | null;
  selected: boolean;
  champion: string | null;
  isFinal: boolean;
  serverNow: number;
  onSelect: () => void;
  onOpenGame: (gameId: string, live: boolean) => void;
}) {
  const live = m.status === "live";
  const ready = m.status === "ready";
  const row = (side: "a" | "b") => {
    const id = side === "a" ? m.a : m.b;
    const won = m.status === "done" && m.winner !== null && m.winner === id;
    const lost = m.status === "done" && m.winner !== null && id !== null && m.winner !== id;
    const name = nameOf(id);
    const isReady = side === "a" ? m.aReady : m.bReady;
    return (
      <div
        className={cn(
          "flex h-7 items-center gap-2 px-2 text-sm",
          won && "font-semibold text-foreground",
          lost && "text-muted-foreground/60 line-through decoration-muted-foreground/30",
          id && id === meId && "bg-primary/10"
        )}
      >
        <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{seedOf(id) ?? ""}</span>
        <span className={cn("min-w-0 flex-1 truncate", !name && "italic text-muted-foreground/60")}>
          {name ?? (m.decidedBy === "bye" ? "bye" : "TBD")}
        </span>
        {ready && id && (
          <span className={cn("h-2 w-2 rounded-full", isReady ? "bg-green-400" : "bg-muted-foreground/40")} />
        )}
        {isFinal && champion && champion === id && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
        <span className={cn("w-5 text-right font-mono text-xs tabular-nums", won && "text-green-400")}>
          {scoreOf(m, side)}
        </span>
      </div>
    );
  };
  const coinDecided = m.decidedBy === "coinflip";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-left shadow-sm transition hover:border-primary/60",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/70",
        mine && !selected && "ring-2 ring-amber-400/60",
        live && "shadow-[0_0_24px_rgba(239,68,68,0.25)]"
      )}
      style={{ height: CARD_H }}
    >
      <div className="divide-y divide-border/50">
        {row("a")}
        {row("b")}
      </div>
      <div className="flex h-[26px] items-center gap-1 border-t border-border/50 bg-muted/30 px-2">
        {live && (
          <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-red-400">
            <Radio className="h-3 w-3 animate-pulse" /> LIVE
          </span>
        )}
        {ready && (
          <span className="font-mono text-[10px] font-bold text-amber-400">
            READY-UP {m.readyDeadlineMs ? `${Math.max(0, Math.ceil((m.readyDeadlineMs - serverNow) / 1000))}s` : ""}
          </span>
        )}
        {m.status === "pending" && <span className="font-mono text-[10px] text-muted-foreground">waiting</span>}
        {m.decidedBy === "bye" && <span className="font-mono text-[10px] text-muted-foreground">bye</span>}
        {m.decidedBy === "forfeit" && <span className="font-mono text-[10px] text-muted-foreground">forfeit</span>}
        {m.decidedBy === "admin" && <span className="font-mono text-[10px] text-muted-foreground">admin call</span>}
        {coinDecided && <Coins className="h-3 w-3 text-amber-400" aria-label="decided by coin flip" />}
        <div className="ml-auto flex gap-1">
          {m.games.map((g) => {
            const isLive = !g.finishedAtMs;
            return (
              <button
                key={g.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenGame(g.id, isLive);
                }}
                title={isLive ? "Watch live" : `Replay game ${g.gameNo}${g.problemName ? ` · ${g.problemName}` : ""}`}
                className={cn(
                  "flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                  isLive ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-primary/15 text-primary hover:bg-primary/25"
                )}
              >
                <Play className="h-2.5 w-2.5" />
                {g.suddenDeath ? "SD" : `G${g.gameNo}`}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
