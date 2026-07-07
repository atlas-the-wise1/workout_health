#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_TITLES = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

function parseArgs(argv) {
  const args = {
    sourcePlan: null,
    sourceRepo: null,
    outputRoot: process.cwd(),
    existingLog: null,
    weekId: null,
    writeArtifacts: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--source-plan') {
      args.sourcePlan = argv[++i];
    } else if (token === '--source-repo') {
      args.sourceRepo = argv[++i];
    } else if (token === '--output-root') {
      args.outputRoot = argv[++i];
    } else if (token === '--existing-log') {
      args.existingLog = argv[++i];
    } else if (token === '--week-id') {
      args.weekId = argv[++i];
    } else if (token === '--no-artifacts') {
      args.writeArtifacts = false;
    } else if (token === '--help' || token === '-h') {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.sourcePlan) {
    throw new Error('Missing required argument: --source-plan');
  }

  if (!args.sourceRepo) {
    args.sourceRepo = '../recipe-list';
  }

  return args;
}

function printUsageAndExit() {
  process.stdout.write([
    'Usage:',
    '  node scripts/import-meal-plan.mjs --source-plan <path> [--source-repo <path>] [--output-root <path>] [--existing-log <path>] [--week-id <week_id>]',
    '',
    'Generates:',
    '  data/plans/<week_id>.json',
    '  data/logs/<week_id>.json',
    '  meal-plans/<week_id>-tracker.md',
    '  meal-plans/<week_id>-dashboard.html',
    '  meal-plans/health-signal-index.md',
    '',
  ].join('\n'));
  process.exit(0);
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripMealDecoration(value) {
  return value
    .replace(/^Leftover from [^:]+:\s*/i, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim();
}

function parseWeeklyPlanMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const plan = { days: {} };
  let currentDay = null;

  for (const line of lines) {
    const headerMatch = line.match(/^# Weekly Healthy Chef Plan - ([A-Za-z0-9-]+)\s*$/);
    if (headerMatch) {
      plan.weekId = headerMatch[1];
      continue;
    }

    const dayMatch = line.match(/^### (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*$/);
    if (dayMatch) {
      currentDay = dayMatch[1].toLowerCase();
      plan.days[currentDay] = {};
      continue;
    }

    if (!currentDay) {
      continue;
    }

    const mealMatch = line.match(/^- (Breakfast|Lunch|Dinner):\s*(.+)$/);
    if (mealMatch) {
      const mealKey = mealMatch[1].toLowerCase();
      const rawValue = stripMealDecoration(mealMatch[2]);
      plan.days[currentDay][mealKey] = rawValue;
    }
  }

  if (!plan.weekId) {
    throw new Error('Could not find week id in weekly plan markdown');
  }

  return plan;
}

function loadRecipeIndex(sourceRepo) {
  const indexPath = join(sourceRepo, 'indexes/recipes.json');
  const raw = JSON.parse(readFileSync(indexPath, 'utf8'));
  const byTitle = new Map();
  const byId = new Map();

  for (const recipe of raw) {
    byId.set(recipe.id, recipe);
    byTitle.set(normalizeText(recipe.title), recipe);
  }

  return { indexPath, recipes: raw, byTitle, byId };
}

function resolveRecipe(recipeIndex, title) {
  const normalized = normalizeText(title);
  const exact = recipeIndex.byTitle.get(normalized);
  if (exact) {
    return exact;
  }

  for (const recipe of recipeIndex.recipes) {
    const recipeTitle = normalizeText(recipe.title);
    if (recipeTitle === normalized || recipeTitle.includes(normalized) || normalized.includes(recipeTitle)) {
      return recipe;
    }
  }

  throw new Error(`Unable to resolve recipe title to stable id: ${title}`);
}

function cloneMealPlan(planMeal, recipe) {
  return {
    planned_recipe_id: recipe.id,
    planned_title: recipe.title,
  };
}

function buildPlannedPlan(sourcePlan, recipeIndex, sourceRepo, sourceCommit, sourcePlanPath) {
  const weekId = sourcePlan.weekId;
  const days = {};
  const selectedRecipes = new Map();

  for (const dayKey of DAY_KEYS) {
    const sourceDay = sourcePlan.days[dayKey] || {};
    const dayPlan = { meals: {} };

    for (const mealKey of ['breakfast', 'lunch', 'dinner']) {
      const title = sourceDay[mealKey] ?? null;
      if (title) {
        const recipe = resolveRecipe(recipeIndex, title);
        selectedRecipes.set(recipe.id, recipe);
        dayPlan.meals[mealKey] = cloneMealPlan(title, recipe);
      } else {
        dayPlan.meals[mealKey] = {
          planned_recipe_id: null,
          planned_title: null,
        };
      }
    }

    dayPlan.workout = {
      planned_workout_id: null,
      planned_workout_title: null,
    };

    days[dayKey] = dayPlan;
  }

  const breakfastAnchor = days.monday.meals.breakfast.planned_recipe_id;
  return {
    plan: {
      schema_version: 1,
      week_id: weekId,
      source_repo: sourceRepo,
      source_commit: sourceCommit,
      source_plan_path: sourcePlanPath,
      summary: {
        breakfast_anchor_recipe_id: breakfastAnchor,
        workout_sessions_planned: 3,
        mobility_sessions_planned: 2,
      },
      days,
    },
    selectedRecipes: [...selectedRecipes.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function loadExistingJson(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function buildExecutionLog(plan, existingLog) {
  const days = {};

  for (const dayKey of DAY_KEYS) {
    const planDay = plan.days[dayKey];
    const existingDay = existingLog?.days?.[dayKey] ?? {};

    const dayLog = { meals: {} };
    for (const mealKey of ['breakfast', 'lunch', 'dinner']) {
      const plannedMeal = planDay.meals[mealKey];
      const existingMeal = existingDay.meals?.[mealKey] ?? {};
      dayLog.meals[mealKey] = {
        planned_recipe_id: plannedMeal.planned_recipe_id,
        planned_title: plannedMeal.planned_title,
        completed: existingMeal.completed ?? false,
        actual_meal: Object.prototype.hasOwnProperty.call(existingMeal, 'actual_meal') ? existingMeal.actual_meal : null,
        notes: Object.prototype.hasOwnProperty.call(existingMeal, 'notes') ? existingMeal.notes : null,
      };
    }

    const existingWorkout = existingDay.workout ?? {};
    dayLog.workout = {
      completed: existingWorkout.completed ?? false,
      duration_minutes: Object.prototype.hasOwnProperty.call(existingWorkout, 'duration_minutes') ? existingWorkout.duration_minutes : null,
      effort: Object.prototype.hasOwnProperty.call(existingWorkout, 'effort') ? existingWorkout.effort : null,
      equipment: Object.prototype.hasOwnProperty.call(existingWorkout, 'equipment') ? existingWorkout.equipment : null,
      recovery_notes: Object.prototype.hasOwnProperty.call(existingWorkout, 'recovery_notes') ? existingWorkout.recovery_notes : null,
      notes: Object.prototype.hasOwnProperty.call(existingWorkout, 'notes') ? existingWorkout.notes : null,
    };

    days[dayKey] = dayLog;
  }

  return {
    schema_version: 1,
    week_id: plan.week_id,
    source_repo: 'atlas-the-wise1/workout_health',
    days,
  };
}

function countCompletedMeals(log) {
  let total = 0;
  for (const dayKey of DAY_KEYS) {
    for (const mealKey of ['breakfast', 'lunch', 'dinner']) {
      const entry = log.days?.[dayKey]?.meals?.[mealKey];
      if (entry && (entry.completed || entry.actual_meal)) {
        total += 1;
      }
    }
  }
  return total;
}

function countMealsWithActuals(log) {
  const meals = [];
  for (const dayKey of DAY_KEYS) {
    for (const mealKey of ['breakfast', 'lunch', 'dinner']) {
      const entry = log.days?.[dayKey]?.meals?.[mealKey];
      if (entry?.actual_meal) {
        meals.push({ dayKey, mealKey, ...entry });
      }
    }
  }
  return meals;
}

function renderTrackerMarkdown(plan, log, sourceMeta) {
  const lines = [];
  lines.push(`# Weekly Meal Prep Tracker - ${plan.week_id}`);
  lines.push('');
  lines.push(`**Goal:** keep the weekly meal-prep loop simple, repeatable, and easy to review`);
  lines.push(`**Source plan:** ${sourceMeta.sourcePlanPath}`);
  lines.push(`**Source commit:** \`${sourceMeta.sourceRepoName}@${sourceMeta.sourceCommit}\``);
  lines.push(`**Import note:** ${sourceMeta.sourceRepoName} owns recipes and indexes; \`workout_health\` owns actuals, workouts, and adherence.`);
  lines.push('');
  lines.push('## Weekly Prep Checklist');
  lines.push('');
  lines.push('- [ ] Pull smoothie pouches from freezer');
  lines.push('- [ ] Portion 7 servings of plain nonfat Greek yogurt');
  lines.push('- [ ] Portion 7 servings of Sofresco B-Tox beetroot & ginger juice');
  lines.push('- [ ] Restock ice, blender cups, or to-go containers if needed');
  lines.push('- [ ] Pick 2 lunch recipes for batch prep');
  lines.push('- [ ] Pick 2 dinner recipes for batch prep');
  lines.push('- [ ] Pick 2 snack recipes for grab-and-go support');
  lines.push('- [ ] Make shopping list from the chosen lunches, dinners, and snacks');
  lines.push('- [ ] Set prep day 1 and prep day 2 on the calendar');
  lines.push('');
  lines.push('## Weekly Workout Tracker');
  lines.push('');
  lines.push('- Goal: 3 workout sessions');
  lines.push('- Support days: 2 mobility / recovery sessions');
  lines.push('- Default effort: moderate, repeatable, and easy to recover from');
  lines.push('- Notes: keep this flexible until the exact workouts are chosen');
  lines.push('');
  lines.push('| Day | Planned Workout | Duration | Effort | Recovery | Check-in |');
  lines.push('|---|---|---|---|---|---|');
  for (const dayKey of DAY_KEYS) {
    const workout = plan.days[dayKey].workout;
    lines.push(`| ${DAY_TITLES[dayKey]} | ${workout.planned_workout_title ?? 'TBD'} | ${workout.duration_minutes ?? 'TBD'} | ${workout.effort ?? 'TBD'} | ${workout.recovery_notes ?? 'TBD'} | [ ] Completed [ ] Mobility done |`);
  }
  lines.push('');
  lines.push('## Daily Tracker');
  lines.push('');
  lines.push('| Day | Planned Breakfast | Planned Lunch | Planned Dinner | Actuals | Prep / Check-in |');
  lines.push('|---|---|---|---|---|---|');
  for (const dayKey of DAY_KEYS) {
    const dayPlan = plan.days[dayKey];
    const dayLog = log.days[dayKey];
    const actualMeals = ['breakfast', 'lunch', 'dinner']
      .map((mealKey) => {
        const entry = dayLog.meals[mealKey];
        return entry?.actual_meal ? `${mealKey}: ${entry.actual_meal}` : null;
      })
      .filter(Boolean)
      .join('<br />') || 'TBD';
    const prepChecks = ['Breakfast prepped', 'Lunch decided', 'Dinner decided']
      .map((label, index) => (index === 0
        ? `[ ] ${label}`
        : `[ ] ${label}`))
      .join(' ');
    lines.push(
      `| ${DAY_TITLES[dayKey]} | ${formatMealCell(dayPlan.meals.breakfast)} | ${formatMealCell(dayPlan.meals.lunch)} | ${formatMealCell(dayPlan.meals.dinner)} | ${actualMeals} | [ ] Breakfast prepped [ ] Lunch decided [ ] Dinner decided |`,
    );
  }
  lines.push('');
  lines.push('## Prep Sessions');
  lines.push('');
  lines.push('### Session 1');
  lines.push('- Focus: smoothies + first batch recipe');
  lines.push('- Target: freezer items, protein support, first shopping run');
  lines.push('- Finish line: 3-4 breakfasts ready to go');
  lines.push('');
  lines.push('### Session 2');
  lines.push('- Focus: second batch recipe + leftovers');
  lines.push('- Target: refill produce, proteins, and any missing pantry items');
  lines.push('- Finish line: the rest of the week is covered');
  lines.push('');
  lines.push('## Actual Meal Log');
  lines.push('');
  const actualMeals = countMealsWithActuals(log);
  if (actualMeals.length === 0) {
    lines.push('- No meals logged yet.');
  } else {
    for (const entry of actualMeals) {
      const day = DAY_TITLES[entry.dayKey];
      lines.push(`- ${day}: ${entry.actual_meal}`);
      if (entry.notes) {
        lines.push(`- ${day}: notes = ${entry.notes}`);
      }
    }
  }
  lines.push('');
  lines.push('## Review Notes');
  lines.push('');
  lines.push('- What worked:');
  lines.push('- What got skipped:');
  lines.push('- What to change next week:');
  lines.push('');
  return lines.join('\n');
}

function formatMealCell(meal) {
  if (!meal?.planned_title) {
    return 'TBD';
  }
  return `${meal.planned_title}`;
}

function renderDashboardHtml(plan, log, sourceMeta, selectedRecipes) {
  const data = {
    plan,
    log,
    selectedRecipes,
    sourceMeta,
    metrics: {
      plannedMeals: DAY_KEYS.length * 3,
      actualMeals: countCompletedMeals(log),
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(plan.week_id)} Meal Prep Dashboard</title>
  <style>
    :root {
      --bg: #0f1720;
      --panel: rgba(10, 18, 28, 0.82);
      --panel-strong: #101b27;
      --panel-soft: rgba(255, 255, 255, 0.05);
      --text: #f3f6fa;
      --muted: #a7b4c4;
      --line: rgba(255, 255, 255, 0.12);
      --accent: #84d6a5;
      --accent-2: #7fc9ff;
      --accent-3: #f2c94c;
      --danger: #ef7b7b;
      --shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      --radius: 22px;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(127, 201, 255, 0.18), transparent 35%),
        radial-gradient(circle at 85% 10%, rgba(132, 214, 165, 0.18), transparent 28%),
        radial-gradient(circle at 20% 85%, rgba(242, 201, 76, 0.16), transparent 30%),
        linear-gradient(145deg, #091018 0%, #0f1720 50%, #111c28 100%);
      color: var(--text);
      font-family: "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), transparent 92%);
      opacity: 0.55;
    }

    .shell {
      width: min(1180px, calc(100% - 32px));
      margin: 24px auto 40px;
      position: relative;
      z-index: 1;
    }

    .hero {
      background: linear-gradient(135deg, rgba(19, 29, 42, 0.96), rgba(14, 22, 33, 0.92));
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 28px;
      box-shadow: var(--shadow);
      overflow: hidden;
      position: relative;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto -70px -70px auto;
      width: 220px;
      height: 220px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(132, 214, 165, 0.28), transparent 66%);
      filter: blur(2px);
    }

    .eyebrow {
      color: var(--accent-2);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 0.74rem;
      font-weight: 700;
      margin-bottom: 10px;
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 3.6rem);
      line-height: 1.04;
      letter-spacing: -0.04em;
      max-width: 12ch;
    }

    .hero-copy {
      margin: 14px 0 0;
      max-width: 70ch;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.6;
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
      font-size: 0.92rem;
      text-decoration: none;
    }

    .pill strong { color: var(--accent); }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin: 16px 0 18px;
    }

    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: var(--shadow);
      min-height: 112px;
    }

    .stat-label {
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 12px;
    }

    .stat-value {
      font-size: 1.65rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 6px;
    }

    .stat-note {
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.45;
    }

    .content {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 26px;
      padding: 22px;
      box-shadow: var(--shadow);
    }

    .panel h2 {
      margin: 0 0 14px;
      font-size: 1.18rem;
      letter-spacing: -0.02em;
    }

    .subtle {
      color: var(--muted);
      font-size: 0.94rem;
      line-height: 1.55;
      margin: 0 0 16px;
    }

    .checklist {
      display: grid;
      gap: 10px;
      padding: 0;
      list-style: none;
      margin: 0;
    }

    .checklist li {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 13px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 16px;
      color: var(--text);
      line-height: 1.45;
    }

    .check {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      margin-top: 2px;
      border-radius: 5px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.02);
      box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.2);
    }

    .sessions {
      display: grid;
      gap: 12px;
      margin-top: 18px;
    }

    .session {
      padding: 16px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.025));
    }

    .session-title {
      font-weight: 700;
      margin-bottom: 8px;
    }

    .session-meta {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.5;
    }

    .week-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 14px;
    }

    .week-head .label {
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .day-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 12px;
    }

    .day-card {
      min-height: 260px;
      padding: 16px;
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .day-name {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 800;
      letter-spacing: -0.02em;
    }

    .day-badge {
      display: inline-flex;
      align-items: center;
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 0.74rem;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--muted);
      background: rgba(0, 0, 0, 0.16);
    }

    .meal {
      padding: 12px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      line-height: 1.45;
      min-height: 66px;
    }

    .meal .meal-label {
      display: block;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      margin-bottom: 6px;
    }

    .meal.breakfast { border-left: 3px solid var(--accent); }
    .meal.lunch { border-left: 3px solid var(--accent-2); }
    .meal.dinner { border-left: 3px solid var(--accent-3); }
    .meal.actual { border-left: 3px solid var(--danger); color: var(--muted); }
    .meal.workout { border-left: 3px solid #bf93ff; }

    .footer {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      color: var(--muted);
    }

    .foot-card {
      padding: 16px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
      line-height: 1.55;
    }

    .foot-card strong {
      color: var(--text);
      display: block;
      margin-bottom: 8px;
    }

    a { color: inherit; }

    @media (max-width: 1080px) {
      .stats,
      .day-grid,
      .footer,
      .content {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .shell { width: min(100% - 18px, 1180px); margin: 10px auto 24px; }
      .hero, .panel, .stat { border-radius: 22px; }
      .stats,
      .content,
      .day-grid,
      .footer {
        grid-template-columns: 1fr;
      }

      .hero { padding: 22px; }
      .day-card { min-height: auto; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <div class="eyebrow">Meal Prep Dashboard</div>
      <h1>${escapeHtml(plan.week_id)} plan, imported from recipe_list.</h1>
      <p class="hero-copy">
        The recipe plan is read from ${escapeHtml(sourceMeta.sourcePlanPath)} and the current execution log stays in
        workout_health. Planned activity lives in the plan, actuals live in the log, and the dashboard is rendered from both.
      </p>
      <div class="pill-row">
        <a class="pill" href="./${escapeHtml(sourceMeta.trackerFileName)}"><strong>Tracker</strong> Weekly planning sheet</a>
        <a class="pill" href="${escapeHtml(sourceMeta.breakfastRecipeUrl)}"><strong>Breakfast</strong> Clovis anchor</a>
        <a class="pill" href="${escapeHtml(sourceMeta.recipeIndexUrl)}"><strong>Index</strong> Source recipe index</a>
      </div>
    </header>

    <section class="stats" aria-label="plan summary">
      <div class="stat">
        <div class="stat-label">Breakfast anchor</div>
        <div class="stat-value">${escapeHtml(plan.days.monday.meals.breakfast.planned_title ?? 'TBD')}</div>
        <div class="stat-note">One stable breakfast anchor is imported for all seven days.</div>
      </div>
      <div class="stat">
        <div class="stat-label">Planned meals</div>
        <div class="stat-value">${data.metrics.plannedMeals}</div>
        <div class="stat-note">Breakfast, lunch, and dinner are imported per day from recipe_list.</div>
      </div>
      <div class="stat">
        <div class="stat-label">Workouts</div>
        <div class="stat-value">${plan.summary.workout_sessions_planned}</div>
        <div class="stat-note">${plan.summary.mobility_sessions_planned} mobility / recovery days are reserved in the week template.</div>
      </div>
      <div class="stat">
        <div class="stat-label">Logged actuals</div>
        <div class="stat-value">${data.metrics.actualMeals}</div>
        <div class="stat-note">Execution lives in the log so plan and actual state do not collide.</div>
      </div>
    </section>

    <section class="content">
      <aside class="panel">
        <h2>Weekly Prep Checklist</h2>
        <p class="subtle">The checklist stays close to the tracker so the dashboard reflects actual prep actions, not just a pretty plan.</p>
        <ul class="checklist">
          <li><span class="check"></span><span>Pull smoothie pouches from freezer</span></li>
          <li><span class="check"></span><span>Portion 7 servings of plain nonfat Greek yogurt</span></li>
          <li><span class="check"></span><span>Portion 7 servings of Sofresco B-Tox beetroot &amp; ginger juice</span></li>
          <li><span class="check"></span><span>Restock ice, blender cups, or to-go containers if needed</span></li>
          <li><span class="check"></span><span>Pick 2 lunch recipes for batch prep</span></li>
          <li><span class="check"></span><span>Pick 2 dinner recipes for batch prep</span></li>
          <li><span class="check"></span><span>Pick 2 snack recipes for grab-and-go support</span></li>
          <li><span class="check"></span><span>Make shopping list from chosen lunches, dinners, and snacks</span></li>
          <li><span class="check"></span><span>Set prep day 1 and prep day 2 on the calendar</span></li>
        </ul>

        <div class="sessions">
          <div class="session">
            <div class="session-title">Plan metadata</div>
            <div class="session-meta">
              Source commit: ${escapeHtml(sourceMeta.sourceRepoName)}@${escapeHtml(sourceMeta.sourceCommit)}<br />
              Source plan: ${escapeHtml(sourceMeta.sourcePlanPath)}<br />
              Source index: ${escapeHtml(sourceMeta.recipeIndexPath)}
            </div>
          </div>
          <div class="session">
            <div class="session-title">Import rule</div>
            <div class="session-meta">
              Planning state is rebuilt from source recipes, while completion state stays in the weekly log.
            </div>
          </div>
        </div>
      </aside>

      <section class="panel">
        <div class="week-head">
          <div>
            <div class="label">Daily schedule</div>
            <h2 style="margin: 6px 0 0;">7-day meal prep view</h2>
          </div>
          <div class="day-badge">Planned meals and actuals side by side</div>
        </div>
        <div class="day-grid" id="days"></div>

        <div class="footer">
          <div class="foot-card">
            <strong>Review notes</strong>
            The log captures what actually happened, including substitutions and skipped sessions.
          </div>
          <div class="foot-card">
            <strong>Planning rule</strong>
            Planned recipes and workouts stay in the plan, so the weekly log can stay honest and lean.
          </div>
          <div class="foot-card">
            <strong>Source files</strong>
            The tracker is generated from the plan and log JSON, which are derived from recipe_list.
          </div>
        </div>
      </section>
    </section>
  </div>

  <script>
    const DATA = ${JSON.stringify(data)};

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function mealText(meal) {
      if (!meal || !meal.planned_title) {
        return 'TBD';
      }
      return escapeHtml(meal.planned_title);
    }

    function actualText(day, mealKey) {
      const entry = DATA.log.days[day].meals[mealKey];
      if (!entry || !entry.actual_meal) {
        return 'TBD';
      }
      return escapeHtml(entry.actual_meal);
    }

    const root = document.getElementById('days');
    const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    root.innerHTML = dayKeys.map((dayKey) => {
      const planDay = DATA.plan.days[dayKey];
      const logDay = DATA.log.days[dayKey];
      const workout = planDay.workout;
      const actualMeals = ['breakfast', 'lunch', 'dinner']
        .filter((mealKey) => logDay.meals[mealKey].actual_meal)
        .map((mealKey) => \`<div class="meal actual"><span class="meal-label">Actual \${mealKey}</span>\${escapeHtml(logDay.meals[mealKey].actual_meal)}</div>\`)
        .join('');
      const workoutText = workout.planned_workout_title || 'TBD';
      return \`
        <article class="day-card">
          <div class="day-name">
            <span>\${escapeHtml(dayKey.charAt(0).toUpperCase() + dayKey.slice(1))}</span>
            <span class="day-badge">Week \${escapeHtml(DATA.plan.week_id)}</span>
          </div>
          <div class="meal breakfast">
            <span class="meal-label">Breakfast</span>
            \${mealText(planDay.meals.breakfast)}
          </div>
          <div class="meal lunch">
            <span class="meal-label">Lunch</span>
            \${mealText(planDay.meals.lunch)}
          </div>
          <div class="meal dinner">
            <span class="meal-label">Dinner</span>
            \${mealText(planDay.meals.dinner)}
          </div>
          <div class="meal workout">
            <span class="meal-label">Workout</span>
            \${escapeHtml(workoutText)}
          </div>
          \${actualMeals}
        </article>
      \`;
    }).join('');
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSignalSnapshot(selectedRecipes, recipeIndex, sourceMeta) {
  const lines = [];
  lines.push('# Weekly Health Signal Snapshot');
  lines.push('');
  lines.push(`Generated from \`${sourceMeta.recipeIndexPath}\` and the imported weekly plan.`);
  lines.push('');
  lines.push('| Recipe ID | Recipe | Category | Score | Source |');
  lines.push('|---|---|---|---|---|');
  for (const recipe of selectedRecipes) {
    lines.push(`| \`${recipe.id}\` | ${recipe.title} | ${recipe.category ?? 'n/a'} | ${recipe.health_score ?? 'TBD'} | [source](../${recipe.path}) |`);
  }
  lines.push('');
  lines.push('The full recipe index stays in `recipe_list`; this file is only the week-specific snapshot used by the tracker.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = resolve(args.outputRoot);
  const sourcePlanPath = resolve(process.cwd(), args.sourcePlan);
  const sourceRepoPath = resolve(process.cwd(), args.sourceRepo);
  const sourcePlanMarkdown = await readFile(sourcePlanPath, 'utf8');
  const sourcePlan = parseWeeklyPlanMarkdown(sourcePlanMarkdown);
  const recipeIndex = loadRecipeIndex(sourceRepoPath);
  const sourceCommit = execFileSync('git', ['-C', sourceRepoPath, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceRepoName = 'atlas-the-wise1/recipe_list';
  const sourceMeta = {
    sourcePlanPath: args.sourcePlan,
    sourceRepoName,
    sourceCommit,
    recipeIndexPath: recipeIndex.indexPath,
    trackerFileName: `${sourcePlan.weekId}-tracker.md`,
    breakfastRecipeUrl: `https://github.com/atlas-the-wise1/recipe_list/blob/main/recipes/breakfast/clovis-farms-organic-super-smoothie.md`,
  };

  const { plan, selectedRecipes } = buildPlannedPlan(
    sourcePlan,
    recipeIndex,
    sourceRepoName,
    sourceCommit,
    args.sourcePlan,
  );

  const existingLogPath = args.existingLog
    ? resolve(process.cwd(), args.existingLog)
    : resolve(outputRoot, 'data/logs', `${plan.week_id}.json`);
  const existingLog = await loadExistingJson(existingLogPath);
  const log = buildExecutionLog(plan, existingLog);

  const planPath = join(outputRoot, 'data/plans', `${plan.week_id}.json`);
  const logPath = join(outputRoot, 'data/logs', `${plan.week_id}.json`);
  const trackerPath = join(outputRoot, 'meal-plans', `${plan.week_id}-tracker.md`);
  const dashboardPath = join(outputRoot, 'meal-plans', `${plan.week_id}-dashboard.html`);
  const snapshotPath = join(outputRoot, 'meal-plans', 'health-signal-index.md');

  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });
  await mkdir(dirname(trackerPath), { recursive: true });

  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);

  if (args.writeArtifacts) {
    await writeFile(trackerPath, `${renderTrackerMarkdown(plan, log, sourceMeta)}\n`);
    await writeFile(dashboardPath, `${renderDashboardHtml(plan, log, sourceMeta, selectedRecipes)}\n`);
    await writeFile(snapshotPath, `${renderSignalSnapshot(selectedRecipes, recipeIndex, sourceMeta)}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
