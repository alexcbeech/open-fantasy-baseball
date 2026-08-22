import { query, withDemoFallback } from "@/lib/db/client";
import type { LeagueTransactionCategory, LeagueTransactionItem } from "@/lib/fantasy/transaction-types";

export type FantasyTransactionRow = {
  id: string;
  team_id: string | null;
  team_name: string | null;
  type: "add" | "drop" | "trade" | "waiver" | "commissioner_edit";
  payload: Record<string, unknown> | null;
  occurred_at: Date | string;
};

type PlayerNameRow = {
  id: string;
  full_name: string;
};

const MAX_TRANSACTION_ROWS = 250;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function payloadFor(row: FantasyTransactionRow): Record<string, unknown> {
  return row.payload && typeof row.payload === "object" ? row.payload : {};
}

function playerIdsFor(row: FantasyTransactionRow): string[] {
  const payload = payloadFor(row);
  return [
    stringValue(payload.playerId),
    stringValue(payload.addPlayerId),
    stringValue(payload.dropPlayerId),
    ...stringArray(payload.incoming),
    ...stringArray(payload.outgoing),
    ...stringArray(payload.dropped),
  ].filter((id): id is string => id !== null);
}

function occurredAt(row: FantasyTransactionRow): string {
  return new Date(row.occurred_at).toISOString();
}

function playerName(id: string | null, names: Map<string, string>): string {
  return id ? names.get(id) ?? "Unknown player" : "Unknown player";
}

function playerNames(ids: string[], names: Map<string, string>): string {
  return ids.map((id) => playerName(id, names)).join(", ") || "no players";
}

function teamName(row: FantasyTransactionRow): string {
  return row.team_name ?? "League office";
}

function transactionTime(rows: FantasyTransactionRow[]): string {
  return rows.reduce((latest, row) => {
    const candidate = occurredAt(row);
    return candidate > latest ? candidate : latest;
  }, occurredAt(rows[0]));
}

function tradeItem(tradeId: string, rows: FantasyTransactionRow[], names: Map<string, string>): LeagueTransactionItem {
  const distinctTeams = [...new Set(rows.map(teamName))];
  const title =
    distinctTeams.length > 1
      ? `${distinctTeams[0]} and ${distinctTeams[1]} completed a trade`
      : `${distinctTeams[0]} completed a trade`;

  const details = rows.map((row) => {
    const payload = payloadFor(row);
    const parts = [
      `acquired ${playerNames(stringArray(payload.incoming), names)}`,
      `sent ${playerNames(stringArray(payload.outgoing), names)}`,
    ];
    const dropped = stringArray(payload.dropped);
    if (dropped.length) {
      parts.push(`dropped ${playerNames(dropped, names)}`);
    }
    return `${teamName(row)} ${parts.join(" · ")}`;
  });

  return {
    id: `trade:${tradeId}`,
    category: "trade",
    occurredAt: transactionTime(rows),
    title,
    details,
  };
}

/** Convert audit rows into display-ready, league-wide transaction events. */
export function buildLeagueTransactionItems(
  rows: FantasyTransactionRow[],
  playerNamesById: Map<string, string>,
): LeagueTransactionItem[] {
  const tradeRows = new Map<string, FantasyTransactionRow[]>();

  for (const row of rows) {
    if (row.type !== "trade") continue;
    const tradeId = stringValue(payloadFor(row).tradeId) ?? row.id;
    tradeRows.set(tradeId, [...(tradeRows.get(tradeId) ?? []), row]);
  }

  const emittedTrades = new Set<string>();
  const items: LeagueTransactionItem[] = [];

  for (const row of rows) {
    const payload = payloadFor(row);

    if (row.type === "trade") {
      const tradeId = stringValue(payload.tradeId) ?? row.id;
      if (!emittedTrades.has(tradeId)) {
        items.push(tradeItem(tradeId, tradeRows.get(tradeId) ?? [row], playerNamesById));
        emittedTrades.add(tradeId);
      }
      continue;
    }

    const team = teamName(row);
    const item = {
      id: row.id,
      occurredAt: occurredAt(row),
      details: [] as string[],
    };

    if (row.type === "add") {
      const player = playerName(stringValue(payload.playerId), playerNamesById);
      const draftPick = Number(payload.draftPick);
      if (Number.isFinite(draftPick) && draftPick > 0) {
        items.push({ ...item, category: "draft", title: `${team} drafted ${player}`, details: [`Pick ${draftPick}`] });
      } else {
        items.push({ ...item, category: "add", title: `${team} added ${player}` });
      }
      continue;
    }

    if (row.type === "drop") {
      items.push({
        ...item,
        category: "drop",
        title: `${team} dropped ${playerName(stringValue(payload.playerId), playerNamesById)}`,
      });
      continue;
    }

    if (row.type === "waiver") {
      const details: string[] = [];
      const dropId = stringValue(payload.dropPlayerId);
      const bid = Number(payload.bidAmount);
      if (dropId) details.push(`Dropped ${playerName(dropId, playerNamesById)}`);
      if (Number.isFinite(bid) && bid > 0) details.push(`Winning FAAB bid: $${bid}`);
      items.push({
        ...item,
        category: "waiver",
        title: `${team} claimed ${playerName(stringValue(payload.addPlayerId), playerNamesById)} off waivers`,
        details,
      });
      continue;
    }

    items.push({ ...item, category: "commissioner", title: `${team} was updated by the commissioner` });
  }

  return items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/** Latest public roster transactions for a league. Page-level access checks ensure only league members call this read. */
export async function listLeagueTransactions(leagueId: string): Promise<LeagueTransactionItem[]> {
  return withDemoFallback(
    async () => {
      const transactions = await query<FantasyTransactionRow>(
        `select
           tx.id,
           tx.team_id,
           ft.name as team_name,
           tx.type,
           tx.payload,
           coalesce(tx.processed_at, tx.created_at) as occurred_at
         from fantasy_transaction tx
         left join fantasy_team ft on ft.id = tx.team_id
         where tx.league_id = $1
           and tx.status = 'processed'
           and tx.type <> 'lineup_change'
         order by coalesce(tx.processed_at, tx.created_at) desc, tx.id
         limit ${MAX_TRANSACTION_ROWS}`,
        [leagueId],
      );

      const playerIds = [...new Set(transactions.rows.flatMap(playerIdsFor))];
      const players = playerIds.length
        ? await query<PlayerNameRow>(`select id, full_name from player where id = any($1::uuid[])`, [playerIds])
        : { rows: [] as PlayerNameRow[] };

      return buildLeagueTransactionItems(
        transactions.rows,
        new Map(players.rows.map((player) => [player.id, player.full_name])),
      );
    },
    () => mockLeagueTransactions(),
  );
}

function mockLeagueTransactions(): LeagueTransactionItem[] {
  const now = Date.now();
  return [
    {
      id: "mock-waiver",
      category: "waiver",
      occurredAt: new Date(now - 45 * 60_000).toISOString(),
      title: "Golden Sombreros claimed Andres Munoz off waivers",
      details: ["Winning FAAB bid: $7"],
    },
    {
      id: "mock-add",
      category: "add",
      occurredAt: new Date(now - 3 * 60 * 60_000).toISOString(),
      title: "Launch Angle Lab added Corbin Carroll",
      details: [],
    },
    {
      id: "mock-trade",
      category: "trade",
      occurredAt: new Date(now - 26 * 60 * 60_000).toISOString(),
      title: "Golden Sombreros and Warning Track Power completed a trade",
      details: ["Golden Sombreros acquired Freddie Freeman · sent Julio Rodriguez"],
    },
  ];
}
