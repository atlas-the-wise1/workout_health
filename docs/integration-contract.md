# Integration Contract

`recipe_list` is the source of truth for:

- recipes
- nutrition
- healthy recipe scoring
- meal-plan generation
- shopping-list derivation

`workout_health` is the source of truth for:

- planned weeks
- actual meals
- workouts
- recovery
- adherence notes

## Contract Rules

- Use stable `recipe_id` values instead of repo-relative links.
- Use stable `workout_id` values instead of free-form workout names when possible.
- Keep planned and actual values separate.
- Treat `recipe_list` exports as read-only inputs.
- Write completion state only in `workout_health`.

## Recommended Weekly Shape

```json
{
  "schema_version": 1,
  "week_id": "2026-07-week1",
  "source_commit": "067c609",
  "days": {
    "monday": {
      "meals": {
        "breakfast": {
          "planned_recipe_id": "clovis-farms-organic-super-smoothie",
          "planned_title": "Clovis Farms Organic Super Smoothie",
          "completed": false,
          "actual_meal": "DAVID protein bar + Jif To Go peanut butter + apple"
        }
      },
      "workout": {
        "planned_workout_id": null,
        "completed": false,
        "duration_minutes": null,
        "effort": null,
        "recovery_notes": null
      }
    }
  }
}
```
