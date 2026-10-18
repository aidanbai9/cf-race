import { randomInt } from "node:crypto";
import { db, logDbError } from "./db";
import {
  COUNTDOWN_MS,
  READY_WINDOW_MS,
  evaluateSeries,
  nextMatch,
  planBracket,
  randomCode,
  thirdPlaceSide,
  type Bracket,
  type GameOutcome,
  type MatchFormat,
  type Side,
} from "./tournament-format";

export type TournamentStatus = "lobby" | "running" | "finished";

export type TournamentRow = {
  id: string;
  code: string;
  name: string;
  created_by: string | null;
  status: TournamentStatus;
  champion_member_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type TournamentMemberRow = {
  id: string;
  tournament_id: string;
  token_hash: string;
  user_id: string | null;
  name: string;
  role: "participant" | "spectator";
  is_admin: boolean;
  is_owner: boolean;
  seed: number | null;
  kicked_at: string | null;
  joined_at: string;
  last_seen_at: string;
};

export type CoinFlip = { winner: Side; at: string };

export type TournamentMatchRow = {
  id: string;
  tournament_id: string;
  bracket: Bracket;
  round: number;
  slot: number;
  format: MatchFormat;
  game_sec: number;
  member_a: string | null;
  member_b: string | null;
  a_wins: number;
  b_wins: number;
  status: "pending" | "ready" | "live" | "done";
  ready_deadline: string | null;
  a_ready_at: string | null;
  b_ready_at: string | null;
  winner_member_id: string | null;
  loser_member_id: string | null;
  decided_by: "games" | "coinflip" | "bye" | "forfeit" | "admin" | null;
  coin: CoinFlip | null;
  finished_at: string | null;
};

export type TournamentGameRow = {
  id: string;
  match_id: string;
  tournament_id: string;
  game_no: number;
  problem_id: string;
  started_at: string;
  ends_at: string;
  sudden_death: boolean;
  session_a: string | null;
  session_b: string | null;
  first_ac_at: string | null;
  winner_member_id: string | null;
  decided_by: "solve" | "coinflip" | "draw" | "forfeit" | "admin" | null;
  coin: CoinFlip | null;
  finished_at: string | null;
};

export type TournamentSnapshot = {
  tournament: TournamentRow;
  members: TournamentMemberRow[];
  matches: TournamentMatchRow[];
  games: TournamentGameRow[];
};

/** Submissions are accepted for this long after a game's clock hits zero. */
export const SUBMIT_GRACE_MS = 3000;

const flip = (): Side => (randomInt(2) === 0 ? "a" : "b");
const iso = (ms: number) => new Date(ms).toISOString();

export async function newTournamentCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode(randomInt);
    const { data } = await db()
      .from("tournaments")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error("could not allocate a tournament code");
}

export async function loadTournamentByCode(code: string): Promise<TournamentRow | null> {
  const { data } = await db()
    .from("tournaments")
    .select("*")
    .eq("code", code)
    .maybeSingle<TournamentRow>();
  return data ?? null;
}

export async function loadSnapshot(tournamentId: string): Promise<TournamentSnapshot | null> {
  const [t, m, mt, g] = await Promise.all([
    db().from("tournaments").select("*").eq("id", tournamentId).maybeSingle<TournamentRow>(),
    db()
      .from("tournament_members")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("joined_at", { ascending: true }),
    db()
      .from("tournament_matches")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("round", { ascending: true })
      .order("slot", { ascending: true }),
    db()
      .from("tournament_games")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("game_no", { ascending: true }),
  ]);
  if (!t.data) return null;
  return {
    tournament: t.data,
    members: (m.data ?? []) as TournamentMemberRow[],
    matches: (mt.data ?? []) as TournamentMatchRow[],
    games: (g.data ?? []) as TournamentGameRow[],
  };
}

export function activeMembers(members: TournamentMemberRow[]) {
  return members.filter((m) => !m.kicked_at);
}

export function participants(members: TournamentMemberRow[]) {
  return activeMembers(members).filter((m) => m.role === "participant");
}

export function mainRounds(matches: TournamentMatchRow[]): number {
  return matches.reduce((r, m) => (m.bracket === "main" ? Math.max(r, m.round) : r), 0);
}

function sideOf(match: TournamentMatchRow, memberId: string | null): Side | null {
  if (!memberId) return null;
  if (match.member_a === memberId) return "a";
  if (match.member_b === memberId) return "b";
  return null;
}

function memberOn(match: TournamentMatchRow, side: Side): string | null {
  return side === "a" ? match.member_a : match.member_b;
}

function gameOutcomes(match: TournamentMatchRow, games: TournamentGameRow[]): GameOutcome[] {
  return games
    .filter((g) => g.match_id === match.id && g.finished_at)
    .sort((x, y) => x.game_no - y.game_no)
    .map((g) => ({ winner: sideOf(match, g.winner_member_id), suddenDeath: g.sudden_death }));
}

/**
 * Seed the bracket from the current participants (random order) and open
 * round 1. Guarded on status so a double click can't build two brackets.
 */
export async function startTournament(
  t: TournamentRow,
  members: TournamentMemberRow[]
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const players = participants(members);
  const { data: claimed } = await db()
    .from("tournaments")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", t.id)
    .eq("status", "lobby")
    .select("id");
  if (!claimed?.length) return { ok: false, error: "already started", status: 409 };

  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  await Promise.all(
    shuffled.map((m, i) =>
      db().from("tournament_members").update({ seed: i + 1 }).eq("id", m.id)
    )
  );
  const plan = planBracket(shuffled.map((m) => m.id));
  const { error } = await db()
    .from("tournament_matches")
    .insert(
      plan.map((p) => ({
        tournament_id: t.id,
        bracket: p.bracket,
        round: p.round,
        slot: p.slot,
        format: p.format,
        game_sec: p.gameSec,
        member_a: p.a,
        member_b: p.b,
      }))
    );
  if (error) {
    await db().from("tournaments").update({ status: "lobby", started_at: null }).eq("id", t.id);
    return { ok: false, error: error.message, status: 500 };
  }
  await tick(t.id);
  return { ok: true };
}

/** Close a match and route its winner (and a semifinal loser) onward. */
async function finishMatch(
  snap: TournamentSnapshot,
  match: TournamentMatchRow,
  winner: Side | null,
  decidedBy: NonNullable<TournamentMatchRow["decided_by"]>,
  extra: Partial<TournamentMatchRow> = {}
): Promise<boolean> {
  // A null winner (both players removed) leaves the next slot empty.
  const winnerId = winner ? memberOn(match, winner) : null;
  const loserId = winner ? memberOn(match, winner === "a" ? "b" : "a") : null;
  const { data: claimed } = await db()
    .from("tournament_matches")
    .update({
      ...extra,
      status: "done",
      winner_member_id: winnerId,
      loser_member_id: loserId,
      decided_by: decidedBy,
      finished_at: new Date().toISOString(),
    })
    .eq("id", match.id)
    .neq("status", "done")
    .select("id");
  if (!claimed?.length) return false;

  if (match.bracket === "main") {
    const rounds = mainRounds(snap.matches);
    const dest = nextMatch(match.round, match.slot, rounds);
    if (dest) {
      const target = snap.matches.find(
        (m) => m.bracket === "main" && m.round === dest.round && m.slot === dest.slot
      );
      if (target) {
        const { error } = await db()
          .from("tournament_matches")
          .update(dest.side === "a" ? { member_a: winnerId } : { member_b: winnerId })
          .eq("id", target.id);
        logDbError(`tournament: advance ${match.id}`, error);
      }
    }
    const thirdSide = thirdPlaceSide(match.round, match.slot, rounds);
    const third = snap.matches.find((m) => m.bracket === "third");
    if (thirdSide && third) {
      const { error } = await db()
        .from("tournament_matches")
        .update(thirdSide === "a" ? { member_a: loserId } : { member_b: loserId })
        .eq("id", third.id);
      logDbError(`tournament: drop to 3rd ${match.id}`, error);
    }
  }
  return true;
}

async function pickProblem(snap: TournamentSnapshot): Promise<string | null> {
  const { data: problems } = await db()
    .from("problems")
    .select("id, tags")
    .neq("id", "warmup-sum");
  const used = new Set(snap.games.map((g) => g.problem_id));
  const pool = (problems ?? [])
    .filter((p) => !((p.tags as string[] | null) ?? []).includes("hidden"))
    .map((p) => p.id as string);
  const fresh = pool.filter((id) => !used.has(id));
  const from = fresh.length ? fresh : pool;
  return from.length ? from[randomInt(from.length)] : null;
}

/** Ready window over (or both ready): create the game + both sessions. */
async function startGame(snap: TournamentSnapshot, match: TournamentMatchRow): Promise<boolean> {
  const { data: claimed } = await db()
    .from("tournament_matches")
    .update({ status: "live" })
    .eq("id", match.id)
    .eq("status", "ready")
    .select("id");
  if (!claimed?.length) return false;

  const series = evaluateSeries(match.format, gameOutcomes(match, snap.games));
  const problemId = await pickProblem(snap);
  if (!series.next || !problemId) {
    await db().from("tournament_matches").update({ status: "ready" }).eq("id", match.id);
    return false;
  }
  const startMs = Date.now() + COUNTDOWN_MS;
  const sessions = await Promise.all(
    [0, 1].map(() =>
      db()
        .from("sessions")
        .insert({
          kind: "tournament",
          user_id: null,
          problem_id: problemId,
          started_at: iso(startMs),
          timer_sec: match.game_sec,
        })
        .select("id")
        .single()
    )
  );
  const [sa, sb] = sessions.map((s) => s.data?.id as string | undefined);
  if (!sa || !sb) {
    logDbError(`tournament: create sessions ${match.id}`, sessions.find((s) => s.error)?.error ?? null);
    const made = [sa, sb].filter(Boolean) as string[];
    if (made.length) await db().from("sessions").delete().in("id", made);
    await db().from("tournament_matches").update({ status: "ready" }).eq("id", match.id).eq("status", "live");
    return false;
  }
  const { error } = await db()
    .from("tournament_games")
    .insert({
      match_id: match.id,
      tournament_id: match.tournament_id,
      game_no: series.next.gameNo,
      problem_id: problemId,
      started_at: iso(startMs),
      ends_at: iso(startMs + match.game_sec * 1000),
      sudden_death: series.next.suddenDeath,
      session_a: sa,
      session_b: sb,
    });
  if (error) {
    logDbError(`tournament: start game ${match.id}`, error);
    await db().from("sessions").delete().in("id", [sa, sb]);
    await db().from("tournament_matches").update({ status: "ready" }).eq("id", match.id).eq("status", "live");
    return false;
  }
  return true;
}

function openReady(nowMs: number) {
  return {
    status: "ready" as const,
    ready_deadline: iso(nowMs + READY_WINDOW_MS),
    a_ready_at: null,
    b_ready_at: null,
  };
}

/** A game is over: settle it, then either close the match or queue the next game. */
async function settleGame(
  snap: TournamentSnapshot,
  match: TournamentMatchRow,
  game: TournamentGameRow,
  forced?: { winner: Side | null; decidedBy: "forfeit" | "admin" }
): Promise<boolean> {
  const now = Date.now();
  let winnerId = game.winner_member_id;
  let decidedBy = game.decided_by;
  let coin: CoinFlip | null = null;
  if (forced) {
    winnerId = forced.winner ? memberOn(match, forced.winner) : null;
    decidedBy = forced.decidedBy;
  } else if (!winnerId) {
    if (match.format === "single") {
      coin = { winner: flip(), at: iso(now) };
      winnerId = memberOn(match, coin.winner);
      decidedBy = "coinflip";
    } else {
      decidedBy = "draw";
    }
  }
  let settle = db()
    .from("tournament_games")
    .update({
      finished_at: iso(now),
      winner_member_id: winnerId,
      decided_by: decidedBy,
      coin,
    })
    .eq("id", game.id)
    .is("finished_at", null);
  // A timeout/draw loses to an AC that landed after our snapshot.
  if (!forced && !game.first_ac_at) settle = settle.is("first_ac_at", null);
  const { data: claimed } = await settle.select("id");
  if (!claimed?.length) return false;

  const unsolved = [game.session_a, game.session_b].filter(Boolean) as string[];
  if (unsolved.length) {
    const { error } = await db()
      .from("sessions")
      .update({ outcome: "timeout" })
      .in("id", unsolved)
      .is("outcome", null);
    logDbError(`tournament: close sessions ${game.id}`, error);
  }

  const settled: TournamentGameRow = {
    ...game,
    finished_at: iso(now),
    winner_member_id: winnerId,
    decided_by: decidedBy,
    coin,
  };
  const games = snap.games.map((g) => (g.id === game.id ? settled : g));
  snap.games = games;
  if (forced) {
    return finishMatch(snap, match, forced.winner, forced.decidedBy);
  }
  const series = evaluateSeries(match.format, gameOutcomes(match, games));
  const scores = { a_wins: series.aWins, b_wins: series.bWins };
  if (series.done && series.winner) {
    return finishMatch(snap, match, series.winner, coin ? "coinflip" : "games", scores);
  }
  if (series.needsCoinflip) {
    const c: CoinFlip = { winner: flip(), at: iso(now) };
    return finishMatch(snap, match, c.winner, "coinflip", { ...scores, coin: c });
  }
  // Next game of the series: a fresh ready window (after any coin reveal).
  const { error } = await db()
    .from("tournament_matches")
    .update({ ...scores, ...openReady(now) })
    .eq("id", match.id)
    .eq("status", "live");
  logDbError(`tournament: next game ${match.id}`, error);
  return true;
}

function feedersDone(snap: TournamentSnapshot, match: TournamentMatchRow): boolean {
  const done = (m?: TournamentMatchRow) => m?.status === "done";
  const rounds = mainRounds(snap.matches);
  const seated = (who: string | null, side: Side | null) =>
    !who || !side || (side === "a" ? match.member_a : match.member_b) === who;
  if (match.bracket === "third") {
    const semis = snap.matches.filter((m) => m.bracket === "main" && m.round === rounds - 1);
    return semis.every(
      (m) => done(m) && seated(m.loser_member_id, thirdPlaceSide(m.round, m.slot, rounds))
    );
  }
  if (match.round === 1) return true;
  // Rounds run together: wait for the whole previous round, and for this
  // match's feeders to have actually written their winners into our slots.
  const prev = snap.matches.filter((m) => m.bracket === "main" && m.round === match.round - 1);
  return (
    prev.every(done) &&
    prev
      .filter((m) => m.slot >> 1 === match.slot)
      .every((m) => seated(m.winner_member_id, nextMatch(m.round, m.slot, rounds)?.side ?? null))
  );
}

/**
 * Advance the tournament: byes and forfeits, ready windows, game starts,
 * timeouts / coin flips, series results, and the finish. Idempotent and
 * race-safe (every transition is a guarded update), so it runs lazily on
 * every state poll and after every mutation.
 */
export async function tick(tournamentId: string): Promise<void> {
  // One ticker at a time per tournament; a crashed holder's lease expires.
  const nowIso = new Date().toISOString();
  const { data: lease } = await db()
    .from("tournaments")
    .update({ tick_lease: new Date(Date.now() + TICK_LEASE_MS).toISOString() })
    .eq("id", tournamentId)
    .or(`tick_lease.is.null,tick_lease.lt.${nowIso}`)
    .select("id");
  if (!lease?.length) return;
  try {
    for (let pass = 0; pass < 8; pass++) {
      const snap = await loadSnapshot(tournamentId);
      if (!snap || snap.tournament.status !== "running") return;
      const changed = await tickOnce(snap);
      if (!changed) return;
    }
  } finally {
    await db().from("tournaments").update({ tick_lease: null }).eq("id", tournamentId);
  }
}

const TICK_LEASE_MS = 15_000;

async function tickOnce(snap: TournamentSnapshot): Promise<boolean> {
  const now = Date.now();
  const kicked = new Set(snap.members.filter((m) => m.kicked_at).map((m) => m.id));
  let changed = false;

  for (const match of snap.matches) {
    if (match.status === "done") continue;
    const currentGame = snap.games
      .filter((g) => g.match_id === match.id && !g.finished_at)
      .sort((x, y) => y.game_no - x.game_no)[0];

    // Removed players forfeit.
    const aGone = match.member_a !== null && kicked.has(match.member_a);
    const bGone = match.member_b !== null && kicked.has(match.member_b);
    if ((aGone || bGone) && (match.status !== "pending" || feedersDone(snap, match))) {
      const aLive = match.member_a !== null && !aGone;
      const bLive = match.member_b !== null && !bGone;
      const winner: Side | null = aLive ? "a" : bLive ? "b" : null;
      if (currentGame) {
        changed = (await settleGame(snap, match, currentGame, { winner, decidedBy: "forfeit" })) || changed;
      } else {
        changed = (await finishMatch(snap, match, winner, "forfeit")) || changed;
      }
      continue;
    }

    if (match.status === "pending") {
      if (!feedersDone(snap, match)) continue;
      if (match.member_a && match.member_b) {
        const { data } = await db()
          .from("tournament_matches")
          .update(openReady(now))
          .eq("id", match.id)
          .eq("status", "pending")
          .select("id");
        changed = Boolean(data?.length) || changed;
      } else if (match.member_a || match.member_b) {
        changed = (await finishMatch(snap, match, match.member_a ? "a" : "b", "bye")) || changed;
      } else {
        const { data } = await db()
          .from("tournament_matches")
          .update({ status: "done", decided_by: "bye", finished_at: iso(now) })
          .eq("id", match.id)
          .eq("status", "pending")
          .select("id");
        changed = Boolean(data?.length) || changed;
      }
      continue;
    }

    if (match.status === "ready") {
      const deadline = match.ready_deadline ? new Date(match.ready_deadline).getTime() : 0;
      if ((match.a_ready_at && match.b_ready_at) || now >= deadline) {
        changed = (await startGame(snap, match)) || changed;
      }
      continue;
    }

    if (match.status === "live" && currentGame) {
      const endMs = new Date(currentGame.ends_at).getTime();
      if (currentGame.first_ac_at || now >= endMs) {
        changed = (await settleGame(snap, match, currentGame)) || changed;
      }
    }
  }

  const final = snap.matches.find(
    (m) => m.bracket === "main" && m.round === mainRounds(snap.matches)
  );
  const allDone = snap.matches.every((m) => m.status === "done");
  if (final?.status === "done" && allDone) {
    const { data } = await db()
      .from("tournaments")
      .update({
        status: "finished",
        finished_at: iso(now),
        champion_member_id: final.winner_member_id,
      })
      .eq("id", snap.tournament.id)
      .eq("status", "running")
      .select("id");
    changed = Boolean(data?.length) || changed;
  }
  return changed;
}

/** Admin override: decide a match (ending any game in progress). */
export async function forceMatchWinner(
  tournamentId: string,
  matchId: string,
  winner: Side
): Promise<boolean> {
  const snap = await loadSnapshot(tournamentId);
  const match = snap?.matches.find((m) => m.id === matchId);
  if (!snap || !match || match.status === "done" || !memberOn(match, winner)) return false;
  const game = snap.games.find((g) => g.match_id === match.id && !g.finished_at);
  const ok = game
    ? await settleGame(snap, match, game, { winner, decidedBy: "admin" })
    : await finishMatch(snap, match, winner, "admin");
  await tick(tournamentId);
  return ok;
}

/** Admin: skip the rest of a ready window. */
export async function startMatchNow(tournamentId: string, matchId: string): Promise<void> {
  await db()
    .from("tournament_matches")
    .update({ ready_deadline: new Date().toISOString() })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId)
    .eq("status", "ready");
  await tick(tournamentId);
}

export async function setReady(match: TournamentMatchRow, memberId: string): Promise<boolean> {
  const side = sideOf(match, memberId);
  if (!side || match.status !== "ready") return false;
  const { error } = await db()
    .from("tournament_matches")
    .update(side === "a" ? { a_ready_at: new Date().toISOString() } : { b_ready_at: new Date().toISOString() })
    .eq("id", match.id)
    .eq("status", "ready");
  return !error;
}

/** The match a member is currently seated in (not done), if any. */
export function currentMatchFor(
  snap: TournamentSnapshot,
  memberId: string
): TournamentMatchRow | null {
  return (
    snap.matches.find(
      (m) =>
        m.status !== "done" &&
        m.status !== "pending" &&
        (m.member_a === memberId || m.member_b === memberId)
    ) ??
    snap.matches.find(
      (m) => m.status === "pending" && (m.member_a === memberId || m.member_b === memberId)
    ) ??
    null
  );
}
