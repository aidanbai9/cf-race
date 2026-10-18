import { TournamentRoom } from "@/components/tournament/room";

export const dynamic = "force-dynamic";

export default function TournamentPage({ params }: { params: { code: string } }) {
  return <TournamentRoom code={params.code.toUpperCase()} />;
}
