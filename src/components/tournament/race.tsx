"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { CountdownOverlay } from "@/components/station/countdown-overlay";
import { RaceScreen } from "@/components/race/race-screen";
import { createEditorRecorder, type RecordedEditorEvent } from "@/lib/replay-recorder";
import { summarizeRun } from "@/lib/tourist";
import { TOURNAMENT_MAX_SUBMISSIONS } from "@/lib/tournament-format";
import type { Contestant, Lang, RunResult } from "@/lib/types";
import type { MyGameView } from "@/lib/tournament-view";

const CONTESTANT: Contestant = {
  id: "tournament",
  event_id: "tournament",
  station_role: "station1",
  name: "Tournament",
  country: null,
  retired_at: null,
  ready_at: null,
};

/** One tournament game for the seated player: countdown, then the race screen. */
export function TournamentRace({
  game,
  myName,
  label,
  serverNow,
  onSolved,
}: {
  game: MyGameView;
  myName: string;
  label: string;
  serverNow: () => number;
  onSolved: (solveMs: number | null) => void;
}) {
  const startRef = useRef(game.startAtMs);
  startRef.current = game.startAtMs;
  const sessionRef = useRef(game.sessionId);
  sessionRef.current = game.sessionId;
  const buffer = useRef<RecordedEditorEvent[]>([]);

  const tNow = useCallback(() => Math.max(0, serverNow() - startRef.current), [serverNow]);
  const recorder = useMemo(
    () => createEditorRecorder({ now: () => tNow(), push: (ev) => buffer.current.push(ev) }),
    [tNow]
  );

  const flush = useCallback(() => {
    const events = buffer.current;
    if (events.length === 0) return;
    buffer.current = [];
    void fetch("/api/tournament/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionRef.current, events }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(flush, 2000);
    return () => {
      clearInterval(id);
      flush();
    };
  }, [flush, game.sessionId]);

  const push = useCallback(
    (kind: RecordedEditorEvent["kind"], lang: Lang, payload?: Record<string, unknown>) =>
      buffer.current.push({ t: tNow(), code: "", lang, kind, payload } as RecordedEditorEvent),
    [tNow]
  );

  const started = serverNow() >= game.startAtMs && game.problem;
  if (!started || !game.problem) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <CountdownOverlay startAtMs={game.startAtMs} serverNow={serverNow} />
        <p className="animate-pulse font-mono text-sm text-muted-foreground">
          {serverNow() >= game.startAtMs ? "Loading problem…" : "Problem revealed at GO…"}
        </p>
      </main>
    );
  }
  return (
    <>
      {serverNow() < game.startAtMs + 1200 && <CountdownOverlay startAtMs={game.startAtMs} serverNow={serverNow} />}
      <RaceScreen
        key={game.sessionId}
        eventId=""
        problem={game.problem}
        contestant={{ ...CONTESTANT, name: myName }}
        raceId={game.sessionId}
        endAtMs={game.endsAtMs}
        serverNow={serverNow}
        warmup={false}
        solo
        apiBase="/api/tournament"
        label={label}
        maxSubmissions={TOURNAMENT_MAX_SUBMISSIONS}
        onEditorDelta={recorder.delta}
        onEditorSnapshot={recorder.snapshot}
        onRun={(lang) => push("run", lang)}
        onRunResult={(result: RunResult, target, lang) => push("run_result", lang, summarizeRun(result, target) as Record<string, unknown>)}
        onTabChange={(tab, lang) => push("tab", lang, { tab })}
        onStatementScroll={(frac, lang) => push("scroll", lang, { frac })}
        onSubmitAccepted={(ms) => {
          flush();
          onSolved(ms);
        }}
      />
    </>
  );
}
