/**
 * Pure tournament rules: bracket layout, per-round formats and series
 * resolution. No I/O, so the engine in tournament.ts and the UI agree.
 */

export type MatchFormat = "single" | "bo3" | "final";
export type Side = "a" | "b";
export type Bracket = "main" | "third";

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 64;
export const READY_WINDOW_MS = 60_000;
export const COUNTDOWN_MS = 5_000;
export const SINGLE_GAME_SEC = 5 * 60;
export const SERIES_GAME_SEC = 3 * 60;
/** How long the coin-flip reveal plays before the result is shown. */
export const COIN_REVEAL_MS = 4_500;
export const SERIES_GAMES = 3;
export const TOURNAMENT_MAX_SUBMISSIONS = 10;

export function bracketSize(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

export function roundCount(n: number): number {
  return Math.log2(bracketSize(n));
}

/**
 * Standard seeding order: slot i of round 1 holds seed order[i]. Top seeds
 * are spread apart and byes (seeds > n) always face a top seed, so every
 * first-round match has at least one real player.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function formatForRound(round: number, rounds: number): MatchFormat {
  if (round === rounds) return "final";
  if (round === rounds - 1) return "bo3";
  return "single";
}

export function gameSecFor(format: MatchFormat): number {
  return format === "single" ? SINGLE_GAME_SEC : SERIES_GAME_SEC;
}

export function roundLabel(round: number, rounds: number, bracket: Bracket = "main"): string {
  if (bracket === "third") return "3rd place";
  if (round === rounds) return "Final";
  if (round === rounds - 1) return "Semifinals";
  if (round === rounds - 2) return "Quarterfinals";
  return `Round of ${2 ** (rounds - round + 1)}`;
}

export function formatLabel(format: MatchFormat): string {
  if (format === "single") return "1 game · 5 min · coin flip if unsolved";
  if (format === "bo3") return "Best of 3 · 3 min games · coin flip if tied";
  return "Best of 3 · 3 min games · sudden death if tied";
}

export type PlannedMatch = {
  bracket: Bracket;
  round: number;
  slot: number;
  format: MatchFormat;
  gameSec: number;
  a: string | null;
  b: string | null;
};

/** Every match of the bracket. `seeded[0]` is seed 1. */
export function planBracket(seeded: string[]): PlannedMatch[] {
  const size = bracketSize(seeded.length);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const at = (seed: number) => (seed <= seeded.length ? seeded[seed - 1] : null);
  const out: PlannedMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const format = formatForRound(round, rounds);
    const count = size / 2 ** round;
    for (let slot = 0; slot < count; slot++) {
      out.push({
        bracket: "main",
        round,
        slot,
        format,
        gameSec: gameSecFor(format),
        a: round === 1 ? at(order[slot * 2]) : null,
        b: round === 1 ? at(order[slot * 2 + 1]) : null,
      });
    }
  }
  if (rounds >= 2) {
    out.push({
      bracket: "third",
      round: rounds,
      slot: 0,
      format: "bo3",
      gameSec: SERIES_GAME_SEC,
      a: null,
      b: null,
    });
  }
  return out;
}

/** Where the winner of a main-bracket match goes (null after the final). */
export function nextMatch(
  round: number,
  slot: number,
  rounds: number
): { round: number; slot: number; side: Side } | null {
  if (round >= rounds) return null;
  return { round: round + 1, slot: slot >> 1, side: slot % 2 === 0 ? "a" : "b" };
}

/** Semifinal losers drop into the 3rd place match. */
export function thirdPlaceSide(round: number, slot: number, rounds: number): Side | null {
  if (rounds < 2 || round !== rounds - 1) return null;
  return slot % 2 === 0 ? "a" : "b";
}

/** A finished game: the winning side, or null for an unsolved draw. */
export type GameOutcome = { winner: Side | null; suddenDeath: boolean };

export type SeriesState = {
  aWins: number;
  bWins: number;
  done: boolean;
  winner: Side | null;
  /** Series is level after regulation and must be settled by a coin. */
  needsCoinflip: boolean;
  /** The next game to play when not done. */
  next: { gameNo: number; suddenDeath: boolean } | null;
};

/**
 * Resolve a series from its finished games.
 * - single: one game; an unsolved game is settled by coin before it gets
 *   here, so any decided game ends the match.
 * - bo3: first to 2 wins; unsolved games are draws; level after 3 → coin.
 * - final: like bo3, but level after 3 → sudden-death games until a solve.
 */
export function evaluateSeries(format: MatchFormat, games: GameOutcome[]): SeriesState {
  const aWins = games.filter((g) => g.winner === "a").length;
  const bWins = games.filter((g) => g.winner === "b").length;
  const base = { aWins, bWins, needsCoinflip: false };
  const done = (winner: Side): SeriesState => ({ ...base, done: true, winner, next: null });
  const next = (suddenDeath: boolean): SeriesState => ({
    ...base,
    done: false,
    winner: null,
    next: { gameNo: games.length + 1, suddenDeath },
  });

  if (format === "single") {
    const decided = games.find((g) => g.winner !== null);
    return decided?.winner ? done(decided.winner) : next(false);
  }

  const need = Math.floor(SERIES_GAMES / 2) + 1;
  if (aWins >= need) return done("a");
  if (bWins >= need) return done("b");
  const regulation = games.filter((g) => !g.suddenDeath).length;
  if (regulation < SERIES_GAMES) return next(false);
  if (aWins !== bWins) return done(aWins > bWins ? "a" : "b");
  if (format === "bo3") {
    return { ...base, done: false, winner: null, needsCoinflip: true, next: null };
  }
  const sd = games.find((g) => g.suddenDeath && g.winner !== null);
  return sd?.winner ? done(sd.winner) : next(true);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

export function randomCode(rand: (n: number) => number): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return s;
}

export const NAME_MAX = 24;

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return name.length >= 1 ? name : null;
}
