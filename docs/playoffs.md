# Championship and consolation playoffs

Head-to-head leagues seed both fields when the first playoff round starts.
Championship qualifiers always occupy the top finishing places. All remaining
teams, including bots excluded from championship qualification, enter consolation
placement brackets in regular-season standings order. Rotisserie has no playoffs.

In a four-team league with two playoff spots, seeds 1 and 2 play for first and
second, while seeds 3 and 4 play a separate consolation final for third and fourth.

Both fields use the existing playoff scoring periods, scoring rules, re-seeding,
and byes. The better original seed wins a tied playoff matchup. A consolation
bracket can contain at most `2 ^ playoffRounds` teams; larger fields are split into
successive seeded placement brackets. For example, with one playoff round, the
non-qualifiers play for 3rd/4th, 5th/6th, and so on. An unpaired team keeps its
place without a matchup. This preserves the league's existing season calendar.

Winners advance within their own bracket. Teams eliminated from the championship
do not enter consolation. Standings place later eliminations above earlier ones;
teams eliminated in the same round are ordered by their original seed. Records
and points remain regular-season totals. Finalized postseason results determine
the displayed ranks in the league table and team summaries.

Apply migration `0038_consolation_playoffs.sql` before deploying. Seeds persist on
teams and the consolation marker persists on matchups. Existing playoff brackets
already underway are not backfilled or reseeded; consolation begins with the
next first-round activation after migration and deployment.
