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
- import history for the weekly plan source

## Contract Rules

- Use stable `recipe_id` values instead of repo-relative links.
- Use stable `workout_id` values instead of free-form workout names when possible.
- Keep planned and actual values separate.
- Treat `recipe_list` exports as read-only inputs.
- Write completion state only in `workout_health`.
- Populate `source_commit` from the exact `recipe_list` commit used during import.
- Generate plan, log, tracker, dashboard, and week-specific signal snapshot from the importer.

## Recommended Weekly Shape

```json
{
  "schema_version": 1,
  "week_id": "2026-07-week1",
  "source_commit": "067c609",
  "source_repo": "atlas-the-wise1/recipe_list",
  "days": {
    "monday": {
      "meals": {
        "breakfast": {
          "planned_recipe_id": "clovis-farms-organic-super-smoothie",
          "planned_title": "Clovis Farms Organic Super Smoothie"
        },
        "lunch": {
          "planned_recipe_id": "tuna-crunch-sandwiches",
          "planned_title": "Tuna Crunch Sandwiches"
        },
        "dinner": {
          "planned_recipe_id": "rotisserie-chicken-greens-pasta",
          "planned_title": "Rotisserie Chicken and Greens Pasta"
        }
      },
      "workout": {
        "planned_workout_id": null,
        "planned_workout_title": null
      }
    }
  }
}
```

## Recommended Weekly Log Shape

```json
{
  "schema_version": 1,
  "week_id": "2026-07-week1",
  "source_repo": "atlas-the-wise1/workout_health",
  "days": {
    "monday": {
      "meals": {
        "breakfast": {
          "planned_recipe_id": "clovis-farms-organic-super-smoothie",
          "planned_title": "Clovis Farms Organic Super Smoothie",
          "completed": false,
          "actual_meal": "DAVID protein bar + Jif To Go peanut butter + apple",
          "notes": "Planned smoothie was not eaten."
        }
      },
      "workout": {
        "completed": false,
        "duration_minutes": null,
        "effort": null,
        "equipment": null,
        "recovery_notes": null,
        "notes": null
      }
    }
  }
}
```
