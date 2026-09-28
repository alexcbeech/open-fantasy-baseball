import { IdentityImage } from "@/app/identity-image";
import type { LeagueChampion } from "@/lib/fantasy/types";

export function LeagueChampionBanner({ champion, wide = false }: { champion: LeagueChampion; wide?: boolean }) {
  return <section className={`panel league-champion${wide ? " league-champion-wide" : ""}`} aria-label={`${champion.seasonYear} league champion`}>
    <span className="league-champion-icon" aria-hidden="true">🏆</span>
    <div>
      <p className="league-champion-label">{champion.seasonYear} League Champion</p>
      <p className="league-champion-name team-image-name"><IdentityImage url={champion.logoUrl} name={champion.teamName} />{champion.teamName}</p>
    </div>
  </section>;
}
