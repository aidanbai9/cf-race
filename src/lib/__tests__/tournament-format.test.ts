import { describe, expect, it } from "vitest";
import {
  bracketSize,
  evaluateSeries,
  formatForRound,
  nextMatch,
  normalizeCode,
  planBracket,
  roundLabel,
  seedOrder,
  thirdPlaceSide,
} from "../tournament-format";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe("bracket layout", () => {
  it("rounds up to a power of two", () => {
    expect([2, 3, 4, 5, 8, 9].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16]);
  });

  it("uses standard seeding", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("gives byes to top seeds and never pairs two byes", () => {
    for (let n = 2; n <= 64; n++) {
      const r1 = planBracket(ids(n)).filter((m) => m.round === 1 && m.bracket === "main");
      expect(r1.every((m) => m.a !== null || m.b !== null)).toBe(true);
      const players = r1.flatMap((m) => [m.a, m.b]).filter(Boolean);
      expect(new Set(players).size).toBe(n);
    }
    const r1 = planBracket(ids(5)).filter((m) => m.round === 1);
    expect(r1.filter((m) => m.b === null).map((m) => m.a)).toEqual(["p1", "p2", "p3"]);
  });

  it("assigns formats per round and adds a 3rd place match", () => {
    const plan = planBracket(ids(8));
    expect(plan.filter((m) => m.round === 1).every((m) => m.format === "single" && m.gameSec === 300)).toBe(true);
    expect(plan.filter((m) => m.round === 2 && m.bracket === "main").every((m) => m.format === "bo3")).toBe(true);
    expect(plan.find((m) => m.round === 3 && m.bracket === "main")?.format).toBe("final");
    expect(plan.find((m) => m.bracket === "third")).toMatchObject({ round: 3, format: "bo3", gameSec: 180 });
  });

  it("two players is just a final, no 3rd place match", () => {
    const plan = planBracket(ids(2));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ format: "final", a: "p1", b: "p2" });
    expect(formatForRound(1, 1)).toBe("final");
  });

  it("routes winners and semifinal losers", () => {
    expect(nextMatch(1, 3, 3)).toEqual({ round: 2, slot: 1, side: "b" });
    expect(nextMatch(3, 0, 3)).toBeNull();
    expect(thirdPlaceSide(2, 1, 3)).toBe("b");
    expect(thirdPlaceSide(1, 1, 3)).toBeNull();
  });

  it("labels rounds", () => {
    expect([1, 2, 3, 4].map((r) => roundLabel(r, 4))).toEqual([
      "Round of 16",
      "Quarterfinals",
      "Semifinals",
      "Final",
    ]);
  });
});

const g = (winner: "a" | "b" | null, suddenDeath = false) => ({ winner, suddenDeath });

describe("series resolution", () => {
  it("single game ends on any decided game", () => {
    expect(evaluateSeries("single", []).next).toEqual({ gameNo: 1, suddenDeath: false });
    expect(evaluateSeries("single", [g("b")])).toMatchObject({ done: true, winner: "b" });
  });

  it("bo3 ends at two wins", () => {
    expect(evaluateSeries("bo3", [g("a"), g("a")])).toMatchObject({ done: true, winner: "a" });
    expect(evaluateSeries("bo3", [g("a"), g("b")]).next?.gameNo).toBe(3);
  });

  it("bo3 counts unsolved games as draws and leads after 3 win", () => {
    expect(evaluateSeries("bo3", [g(null), g("b"), g(null)])).toMatchObject({ done: true, winner: "b" });
  });

  it("bo3 level after 3 needs a coin flip", () => {
    const s = evaluateSeries("bo3", [g("a"), g(null), g("b")]);
    expect(s).toMatchObject({ done: false, needsCoinflip: true, next: null });
    expect(evaluateSeries("bo3", [g(null), g(null), g(null)]).needsCoinflip).toBe(true);
  });

  it("final goes to sudden death until someone solves", () => {
    const level = [g("a"), g("b"), g(null)];
    expect(evaluateSeries("final", level).next).toEqual({ gameNo: 4, suddenDeath: true });
    expect(evaluateSeries("final", [...level, g(null, true)]).next).toEqual({ gameNo: 5, suddenDeath: true });
    expect(evaluateSeries("final", [...level, g(null, true), g("b", true)])).toMatchObject({
      done: true,
      winner: "b",
    });
  });
});

describe("codes", () => {
  it("normalizes user input", () => {
    expect(normalizeCode(" ab-c 12d9 ")).toBe("ABC12D");
  });
});
