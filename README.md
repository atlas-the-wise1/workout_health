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

## Integration Contract

- Recipe links should point back to `recipe_list` with full GitHub URLs.
- Weekly plans should carry `recipe_id` and `workout_id` fields, not repo-relative paths.
- Actual completion should live in `workout_health`, not in the recipe source repo.
