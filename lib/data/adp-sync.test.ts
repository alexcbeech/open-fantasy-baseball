import { describe, expect, it } from "vitest";
import { matchAdpToPlayers, normalizePlayerName, parseEspnToMlbamCsv, type AdpEntry, type KnownPlayer } from "./adp-sync";

describe("normalizePlayerName", () => {
  it("strips accents, punctuation, and suffixes", () => {
    expect(normalizePlayerName("Julio Rodríguez")).toBe("julio rodriguez");
    expect(normalizePlayerName("Ronald Acuña Jr.")).toBe("ronald acuna");
    expect(normalizePlayerName("J.T. Realmuto")).toBe("jt realmuto");
    expect(normalizePlayerName("Luis García III")).toBe("luis garcia");
  });
});

describe("parseEspnToMlbamCsv", () => {
  it("maps ESPNID to MLBID, skipping incomplete rows", () => {
    const csv = [
      "IDPLAYER,PLAYERNAME,MLBID,ESPNID",
      "a,Shohei Ohtani,660271,39832",
      'b,"Acuna, Ronald",660670,36185',
      "c,No Espn,592450,",
      "d,No Mlb,,12345",
    ].join("\n");
    const map = parseEspnToMlbamCsv(csv);
    expect(map.get(39832)).toBe(660271);
    expect(map.get(36185)).toBe(660670);
    expect(map.size).toBe(2);
  });

  it("returns an empty map when expected columns are missing", () => {
    expect(parseEspnToMlbamCsv("A,B\n1,2").size).toBe(0);
  });
});

describe("matchAdpToPlayers", () => {
  const players: KnownPlayer[] = [
    { id: "p-ohtani", mlbPlayerId: 660271, fullName: "Shohei Ohtani" },
    { id: "p-acuna", mlbPlayerId: 660670, fullName: "Ronald Acuña Jr." },
    { id: "p-jrod", mlbPlayerId: 677594, fullName: "Julio Rodríguez" },
  ];
  const idMap = new Map([[39832, 660271]]);

  it("matches by espn id crosswalk first, then normalized name, carrying ownership", () => {
    const entries: AdpEntry[] = [
      { espnPlayerId: 39832, fullName: "S. Ohtani (DH)", adp: 1.5, rosteredPercent: 100 }, // id match despite odd name
      { espnPlayerId: 99999, fullName: "Ronald Acuna Jr.", adp: 2.4, rosteredPercent: 98 }, // name match without id
    ];
    const matched = matchAdpToPlayers(entries, players, idMap);
    expect(matched.map((m) => m.playerId)).toEqual(["p-ohtani", "p-acuna"]);
    expect(matched.map((m) => m.rosteredPercent)).toEqual([100, 98]);
  });

  it("assigns dense ranks by ascending adp regardless of entry order", () => {
    const entries: AdpEntry[] = [
      { espnPlayerId: null, fullName: "Julio Rodriguez", adp: 9.9, rosteredPercent: 55 },
      { espnPlayerId: 39832, fullName: "Shohei Ohtani", adp: 1.2, rosteredPercent: 100 },
    ];
    const matched = matchAdpToPlayers(entries, players, idMap);
    expect(matched[0]).toMatchObject({ playerId: "p-ohtani", adpRank: 1 });
    expect(matched[1]).toMatchObject({ playerId: "p-jrod", adpRank: 2 });
  });

  it("skips unmatched entries and duplicate players", () => {
    const entries: AdpEntry[] = [
      { espnPlayerId: null, fullName: "Somebody Unknown", adp: 3, rosteredPercent: null },
      { espnPlayerId: 39832, fullName: "Shohei Ohtani", adp: 1, rosteredPercent: 100 },
      { espnPlayerId: null, fullName: "Shohei Ohtani", adp: 2, rosteredPercent: 100 }, // duplicate via name
    ];
    const matched = matchAdpToPlayers(entries, players, idMap);
    expect(matched).toHaveLength(1);
    expect(matched[0].playerId).toBe("p-ohtani");
  });
});
