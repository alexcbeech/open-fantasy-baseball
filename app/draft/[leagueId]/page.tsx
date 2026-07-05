import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { getDraftLobby, getDraftState, listDraftPlayers } from "@/lib/data/draft";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";
import { DraftRoom } from "./draft-room";

export const dynamic = "force-dynamic";

type DraftPageProps = {
  params: Promise<{ leagueId: string }>;
};

export default async function DraftPage({ params }: DraftPageProps) {
  const { leagueId } = await params;
  const authEnabled = isNeonAuthConfigured();
  const currentUser = await getCurrentOfbUser();

  if (!currentUser && authEnabled) {
    redirect("/auth/sign-in");
  }

  // Same guard as the team page: with a real database a non-UUID league id
  // can never match a row, so 404 instead of falling back to mock data.
  if (isDatabaseConfigured() && !isUuid(leagueId)) {
    notFound();
  }

  const viewerUserId = currentUser?.userId ?? "demo-user";
  const lobby = await getDraftLobby(leagueId, viewerUserId);

  if (!lobby) {
    notFound();
  }

  const draft = await getDraftState(leagueId, viewerUserId);
  const players = draft ? await listDraftPlayers(leagueId) : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <div className="brand-lockup brand-lockup--clip">
          <span className="brand-kicker">{lobby.leagueName}</span>
          <span className="brand-title">Draft</span>
        </div>
        <div className="topbar-actions">
          <AuthControl enabled={authEnabled} />
        </div>
      </header>

      <section className="page">
        <DraftRoom lobby={lobby} initialDraft={draft} initialPlayers={players} />
      </section>
    </main>
  );
}
