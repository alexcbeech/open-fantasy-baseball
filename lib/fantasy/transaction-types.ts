export type LeagueTransactionCategory = "add" | "drop" | "waiver" | "trade" | "draft" | "commissioner";

export type LeagueTransactionItem = {
  id: string;
  category: LeagueTransactionCategory;
  occurredAt: string;
  title: string;
  details: string[];
};
