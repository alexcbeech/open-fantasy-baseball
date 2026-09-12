import { PlayerAvatar } from "./player-avatar";

/** Shared roster selection row for trades and add/drop transactions. */
export function RosterPickRow({ player, selected, onSelect, type = "checkbox", name }: {
  player: { id: string; name: string; positions: string[]; mlbTeam?: string; mlbPlayerId?: number | null };
  selected: boolean;
  onSelect: () => void;
  type?: "checkbox" | "radio";
  name?: string;
}) {
  return (
    <label className="trade-pick-row">
      <input type={type} name={name} checked={selected} onChange={onSelect} />
      <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
      <span className="player-main">
        <span className="player-name">{player.name}</span>
        <span className="player-meta">
          {player.mlbTeam ? `${player.mlbTeam} – ` : ""}{player.positions.join(", ")}
        </span>
      </span>
    </label>
  );
}
