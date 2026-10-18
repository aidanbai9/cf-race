import { db } from "./db";
import type { Problem } from "./types";
import {
  activeMembers,
  currentMatchFor,
  mainRounds,
  type CoinFlip,
  type TournamentMemberRow,
  type TournamentSnapshot,
} from "./tournament";
import type { Bracket, MatchFormat, Side } from "./tournament-format";

const ONLINE_MS = 15_000;
const ms = (s: string | null) => (s ? new Date(s).getTime() : null);
const coinView = (c: CoinFlip | null) => (c ? { winner: c.winner, atMs: Date.parse(c.at) } : null);

export type MemberView = {
  id: string;
  name: string;
  role: "participant" | "spectator";
  isAdmin: boolean;
  isOwner: boolean;
  seed: number | null;
  online: boolean;
  signedIn: boolean;
};

export type GameView = {
  id: string;
  gameNo: number;
  problemId: string | null;
  problemName: string | null;
  startAtMs: number;
  endsAtMs: number;
  suddenDeath: boolean;
  winner: string | null;
  decidedBy: string | null;
  coin: { winner: Side; atMs: number } | null;
  finishedAtMs: number | null;
  firstAcAtMs: number | null;
};

export type MatchView = {
  id: string;
  bracket: Bracket;
  round: number;
  slot: number;
  format: MatchFormat;
  gameSec: number;
  a: string | null;
  b: string | null;
  aWins: number;
  bWins: number;
  status: "pending" | "ready" | "live" | "done";
  readyDeadlineMs: number | null;
  aReady: boolean;
  bReady: boolean;
  winner: string | null;
  loser: string | null;
  decidedBy: string | null;
  coin: { winner: Side; atMs: number } | null;
  finishedAtMs: number | null;
  games: GameView[];
};

export type MyGameView = {
  gameId: string;
  matchId: string;
  sessionId: string;
  side: Side;
  startAtMs: number;
  endsAtMs: number;
  problem: Problem | null;
  outcome: "solved" | "timeout" | "abandoned" | null;
  solveMs: number | null;
};

export type TournamentStateView = {
  serverNow: number;
  tournament: {
    id: string;
    code: string;
    name: string;
    status: "lobby" | "running" | "finished";
    startedAtMs: number | null;
    finishedAtMs: number | null;
    champion: string | null;
  };
  me: MemberView | null;
  kicked: boolean;
  signedIn: boolean;
  members: MemberView[];
  rounds: number;
  matches: MatchView[];
  myMatchId: string | null;
  myGame: MyGameView | null;
};

function memberView(m: TournamentMemberRow, now: number): MemberView {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    isAdmin: m.is_admin,
    isOwner: m.is_owner,
    seed: m.seed,
    online: now - Date.parse(m.last_seen_at) < ONLINE_MS,
    signedIn: m.user_id !== null,
  };
}

export async function buildStateView(
  snap: TournamentSnapshot,
  me: TournamentMemberRow | null,
  extra: { kicked: boolean; signedIn: boolean }
): Promise<TournamentStateView> {
  const now = Date.now();
  // Problems stay secret until GO, even from spectators.
  const revealedIds = Array.from(
    new Set(snap.games.filter((g) => Date.parse(g.started_at) <= now).map((g) => g.problem_id))
  );
  const { data: problems } = revealedIds.length
    ? await db().from("problems").select("id, name").in("id", revealedIds)
    : { data: [] };
  const names = new Map((problems ?? []).map((p) => [p.id as string, p.name as string]));

  const matches: MatchView[] = snap.matches.map((m) => ({
    id: m.id,
    bracket: m.bracket,
    round: m.round,
    slot: m.slot,
    format: m.format,
    gameSec: m.game_sec,
    a: m.member_a,
    b: m.member_b,
    aWins: m.a_wins,
    bWins: m.b_wins,
    status: m.status,
    readyDeadlineMs: ms(m.ready_deadline),
    aReady: m.a_ready_at !== null,
    bReady: m.b_ready_at !== null,
    winner: m.winner_member_id,
    loser: m.loser_member_id,
    decidedBy: m.decided_by,
    coin: coinView(m.coin),
    finishedAtMs: ms(m.finished_at),
    games: snap.games
      .filter((g) => g.match_id === m.id)
      .map((g) => {
        const revealed = Date.parse(g.started_at) <= now;
        return {
          id: g.id,
          gameNo: g.game_no,
          problemId: revealed ? g.problem_id : null,
          problemName: revealed ? names.get(g.problem_id) ?? g.problem_id : null,
          startAtMs: Date.parse(g.started_at),
          endsAtMs: Date.parse(g.ends_at),
          suddenDeath: g.sudden_death,
          winner: g.winner_member_id,
          decidedBy: g.decided_by,
          coin: coinView(g.coin),
          finishedAtMs: ms(g.finished_at),
          firstAcAtMs: ms(g.first_ac_at),
        };
      }),
  }));

  let myMatchId: string | null = null;
  let myGame: MyGameView | null = null;
  if (me && me.role === "participant" && snap.tournament.status !== "lobby") {
    const cur = currentMatchFor(snap, me.id);
    myMatchId = cur?.id ?? null;
    const game = cur
      ? snap.games
          .filter((g) => g.match_id === cur.id && !g.finished_at)
          .sort((x, y) => y.game_no - x.game_no)[0]
      : undefined;
    if (cur && game) {
      const side: Side = cur.member_a === me.id ? "a" : "b";
      const sessionId = side === "a" ? game.session_a : game.session_b;
      if (sessionId) {
        const startAtMs = Date.parse(game.started_at);
        const [{ data: session }, problem] = await Promise.all([
          db().from("sessions").select("outcome, solve_ms").eq("id", sessionId).maybeSingle(),
          startAtMs <= now
            ? db().from("problems").select("*").eq("id", game.problem_id).maybeSingle<Problem>()
            : Promise.resolve({ data: null }),
        ]);
        myGame = {
          gameId: game.id,
          matchId: cur.id,
          sessionId,
          side,
          startAtMs,
          endsAtMs: Date.parse(game.ends_at),
          problem: problem.data ?? null,
          outcome: (session?.outcome as MyGameView["outcome"]) ?? null,
          solveMs: (session?.solve_ms as number | null) ?? null,
        };
      }
    }
  }

  return {
    serverNow: now,
    tournament: {
      id: snap.tournament.id,
      code: snap.tournament.code,
      name: snap.tournament.name,
      status: snap.tournament.status,
      startedAtMs: ms(snap.tournament.started_at),
      finishedAtMs: ms(snap.tournament.finished_at),
      champion: snap.tournament.champion_member_id,
    },
    me: me ? memberView(me, now) : null,
    kicked: extra.kicked,
    signedIn: extra.signedIn,
    members: activeMembers(snap.members).map((m) => memberView(m, now)),
    rounds: mainRounds(snap.matches),
    matches,
    myMatchId,
    myGame,
  };
}
