# FinFlow Project TODO

This file tracks:
- open issues
- upcoming features
- completed tasks

## Working Rules
1. Break work into small tasks.
2. Prioritize in this order: `P0 Core Issues` -> `P1 Core Features` -> `P2 UI/Polish`.
3. For every code change, update this file and commit to `dev`.

## P0 Core Issues (Highest Priority)
- [ ] `ISSUE-001` Investigate and harden startup flow for post-build "Internal Server Error" cases.
- [ ] `ISSUE-002` Add a stable post-build health-check checklist (`/` and key API routes).

## P1 Core Features
- [x] `EXP-001` Add optional frequency in Actual Add Expense (daily/weekly/monthly/yearly/custom) with default one-time fallback.
- [ ] `EXP-002` Add edit support for existing expense frequency.
- [ ] `EXP-003` Add filtering/grouping in expense list by frequency.

## P2 UI/Polish
- [ ] `UI-001` Improve frequency selector helper text and tooltip clarity.
- [ ] `UI-002` Improve expense list badges/chips for cadence readability.

## Completed Tasks Log
| Date (IST) | Task ID | Summary | Commit |
|---|---|---|---|
| 2026-04-26 | EXP-001 | Added optional frequency in Actual Add Expense, kept one-time as default, and preserved old entries compatibility. | `feat(expense): add frequency options and add project todo tracker` |
