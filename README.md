# workout_health

Weekly workout and meal tracking workspace.

## Source Of Truth

- `recipe_list` publishes recipes, nutrition, meal plans, and healthy recipe indexes.
- `workout_health` records planned weeks, actual meals, workouts, recovery, and adherence.
- Stable recipe IDs should be used for all cross-repo references.

## Current Week

- [Tracker](meal-plans/2026-07-week1-tracker.md)
- [Dashboard](meal-plans/2026-07-week1-dashboard.html)
- [Machine-readable plan](data/plans/2026-07-week1.json)
- [Weekly log](data/logs/2026-07-week1.json)
- [Health signal snapshot](meal-plans/health-signal-index.md)
- [Importer](scripts/import-meal-plan.mjs)

## Integration Contract

- `recipe_list` is imported as read-only source data.
- `source_commit` is the exact full `recipe_list` commit used during import.
- The importer writes a provenance block with repository URL, full commit SHA, import timestamp, and plan checksum.
- Plans keep only intended meals/workouts.
- Logs keep completion, actual meals, effort, recovery, and notes.
- The dashboard and tracker are generated from the imported plan + log pair.
- Weekly snapshots are immutable unless `--force` is explicitly passed.
