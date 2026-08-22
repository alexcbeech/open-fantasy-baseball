"use client";

import { useMemo, useState } from "react";
import type { LeagueTransactionCategory, LeagueTransactionItem } from "@/lib/fantasy/transaction-types";

type TransactionFilter = "all" | LeagueTransactionCategory;

const filters: Array<{ key: TransactionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "add", label: "Adds" },
  { key: "drop", label: "Drops" },
  { key: "waiver", label: "Waivers" },
  { key: "trade", label: "Trades" },
  { key: "draft", label: "Draft" },
  { key: "commissioner", label: "Commish" },
];

const categoryLabels: Record<LeagueTransactionCategory, string> = {
  add: "ADD",
  drop: "DROP",
  waiver: "WVR",
  trade: "TRADE",
  draft: "DRAFT",
  commissioner: "COMMISH",
};

function localDayKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (localDayKey(value) === localDayKey(today.toISOString())) return "Today";
  if (localDayKey(value) === localDayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function TransactionLog({ transactions }: { transactions: LeagueTransactionItem[] }) {
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [visibleCount, setVisibleCount] = useState(40);
  const filtered = useMemo(
    () => (filter === "all" ? transactions : transactions.filter((transaction) => transaction.category === filter)),
    [filter, transactions],
  );
  const visible = filtered.slice(0, visibleCount);
  const grouped = visible.reduce<Array<{ day: string; transactions: LeagueTransactionItem[] }>>((groups, transaction) => {
    const day = localDayKey(transaction.occurredAt);
    const current = groups.at(-1);
    if (current?.day === day) {
      current.transactions.push(transaction);
    } else {
      groups.push({ day, transactions: [transaction] });
    }
    return groups;
  }, []);

  function selectFilter(next: TransactionFilter) {
    setFilter(next);
    setVisibleCount(40);
  }

  return (
    <section className="panel transaction-panel" aria-labelledby="transactions-heading">
      <div className="transaction-heading-row">
        <div>
          <h2 id="transactions-heading">League Transactions</h2>
          <p className="transaction-subtitle">Adds, drops, waiver claims, draft picks, and completed trades across the league.</p>
        </div>
        <span className="transaction-count">{filtered.length}</span>
      </div>

      <div className="filter-chips transaction-filters" aria-label="Filter league transactions">
        {filters.map((option) => (
          <button
            className={filter === option.key ? "filter-chip active" : "filter-chip"}
            type="button"
            aria-pressed={filter === option.key}
            onClick={() => selectFilter(option.key)}
            key={option.key}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!filtered.length ? <div className="empty-state">No {filter === "all" ? "league" : filter} transactions yet.</div> : null}

      <div className="transaction-days">
        {grouped.map((group) => (
          <section className="transaction-day" key={group.day}>
            <h3 suppressHydrationWarning>{dayLabel(group.transactions[0].occurredAt)}</h3>
            <div className="transaction-list">
              {group.transactions.map((transaction) => (
                <article className="transaction-row" key={transaction.id}>
                  <span className={`transaction-badge transaction-badge-${transaction.category}`}>
                    {categoryLabels[transaction.category]}
                  </span>
                  <div className="transaction-copy">
                    <strong>{transaction.title}</strong>
                    {transaction.details.map((detail) => (
                      <span className="transaction-detail" key={detail}>
                        {detail}
                      </span>
                    ))}
                  </div>
                  <time dateTime={transaction.occurredAt} suppressHydrationWarning>
                    {new Date(transaction.occurredAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </time>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {visibleCount < filtered.length ? (
        <button className="secondary-button transaction-more" type="button" onClick={() => setVisibleCount((count) => count + 40)}>
          Show more
        </button>
      ) : null}
    </section>
  );
}
