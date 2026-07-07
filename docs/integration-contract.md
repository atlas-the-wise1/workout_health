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
- Store a provenance block with repository URL, full commit SHA, import timestamp, and source-plan checksum.
- Generate plan, log, tracker, dashboard, and week-specific signal snapshot from the importer.
- Keep weekly snapshots immutable unless `--force` is explicitly passed.
- Preserve existing execution logs on re-import unless a separate reset flow is used.

## Recommended Weekly Shape

```json
{
  "schema_version": 1,
  "week_id": "2026-07-week1",
  "source_repo": "atlas-the-wise1/recipe_list",
  "source_commit": "067c6090d994ff0124d55e1f6a47f8ba99c284f3",
  "source": {
    "repository": "atlas-the-wise1/recipe_list",
    "repository_url": "https://github.com/atlas-the-wise1/recipe_list",
    "commit": "067c6090d994ff0124d55e1f6a47f8ba99c284f3",
    "imported_at": "2026-07-07T03:58:33.726Z",
    "plan_path": "../recipe-list/meal-plans/2026-07-week1.md",
    "plan_checksum": "sha256:03c090e3d3d2608c6d31cb1ee10f31326e22aba624068ee7416ac52a5b80db71"
  },
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

## Snapshot Rule

- Weekly snapshots are immutable by default.
- Use `--force` to replace an existing snapshot.
- Use a separate reset flow if execution history must be cleared.

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
