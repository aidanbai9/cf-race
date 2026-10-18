"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { COIN_REVEAL_MS } from "@/lib/tournament-format";

export type CoinFlipShow = {
  key: string;
  title: string;
  aName: string;
  bName: string;
  winner: "a" | "b";
};

function Face({ name, side, back }: { name: string; side: "A" | "B"; back?: boolean }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center rounded-full border-[6px] border-amber-200/70 bg-[radial-gradient(circle_at_30%_25%,#fde68a,#f59e0b_45%,#b45309)] shadow-[inset_0_-10px_30px_rgba(0,0,0,0.35),0_0_60px_rgba(245,158,11,0.45)]"
      style={{ backfaceVisibility: "hidden", transform: back ? "rotateY(180deg)" : undefined }}
    >
      <span className="font-mono text-5xl font-black text-amber-950/80 drop-shadow">{side}</span>
      <span className="mt-1 max-w-[9rem] truncate px-2 text-center font-mono text-sm font-bold text-amber-950/80">
        {name}
      </span>
    </div>
  );
}

/**
 * Full-screen coin toss: a few seconds of tumbling gold with a drum-roll
 * caption, then the coin settles on the winner's face and the result lands.
 */
export function CoinFlipOverlay({ show, onDone }: { show: CoinFlipShow | null; onDone: () => void }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!show) return;
    setRevealed(false);
    const t = setTimeout(() => {
      setRevealed(true);
      confetti({ particleCount: 120, spread: 90, origin: { y: 0.55 }, colors: ["#f59e0b", "#fde68a", "#ffffff"] });
    }, COIN_REVEAL_MS);
    return () => clearTimeout(t);
  }, [show]);

  const spins = 9;
  const finalDeg = spins * 360 + (show?.winner === "b" ? 180 : 0);
  const winnerName = show ? (show.winner === "a" ? show.aName : show.bName) : "";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={show.key}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 bg-background/90 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="space-y-1 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">Coin flip</p>
            <h2 className="text-2xl font-bold">{show.title}</h2>
            <p className="font-mono text-sm text-muted-foreground">
              <span className="text-foreground">A · {show.aName}</span>
              <span className="mx-2">vs</span>
              <span className="text-foreground">B · {show.bName}</span>
            </p>
          </div>
          <div className="relative h-72 w-72" style={{ perspective: 1000 }}>
            <motion.div
              className="absolute bottom-0 left-1/2 h-6 w-40 -translate-x-1/2 rounded-full bg-black/50 blur-md"
              animate={{ scale: [1, 0.45, 1, 0.6, 1, 0.8, 1], opacity: [0.6, 0.2, 0.6, 0.3, 0.6, 0.45, 0.6] }}
              transition={{ duration: COIN_REVEAL_MS / 1000, ease: "easeOut" }}
            />
            <motion.div
              className="absolute left-1/2 top-6 h-48 w-48 -translate-x-1/2"
              style={{ transformStyle: "preserve-3d" }}
              initial={{ rotateY: 0, y: 0 }}
              animate={{ rotateY: finalDeg, y: [0, -150, 0, -70, 0, -22, 0] }}
              transition={{
                rotateY: { duration: COIN_REVEAL_MS / 1000, ease: [0.15, 0.6, 0.25, 1] },
                y: { duration: COIN_REVEAL_MS / 1000, ease: "easeOut", times: [0, 0.22, 0.45, 0.62, 0.78, 0.9, 1] },
              }}
            >
              <Face name={show.aName} side="A" />
              <Face name={show.bName} side="B" back />
            </motion.div>
          </div>
          <div className="h-20 text-center">
            {revealed ? (
              <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-3">
                <p className="text-3xl font-black text-amber-300">{winnerName} wins the flip!</p>
                <Button size="sm" onClick={onDone}>
                  Continue
                </Button>
              </motion.div>
            ) : (
              <p className="animate-pulse font-mono text-sm text-muted-foreground">Nobody solved it… the coin decides</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
