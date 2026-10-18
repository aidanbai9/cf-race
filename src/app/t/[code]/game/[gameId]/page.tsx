"use client";

import { useRouter } from "next/navigation";
import { DuelReview } from "@/components/duel/duel-review";
import { Navbar } from "@/components/shell/navbar";

/** Shareable replay of one tournament game. */
export default function TournamentGamePage({ params }: { params: { code: string; gameId: string } }) {
  const router = useRouter();
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      <div className="min-h-0 flex-1">
        <DuelReview
          apiUrl={`/api/tournament/game?gameId=${params.gameId}`}
          readOnly
          onExit={() => router.push(`/t/${params.code}`)}
          exitLabel="← bracket"
        />
      </div>
    </div>
  );
}
