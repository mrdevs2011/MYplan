# MYPLAN — Product foundation

## Core entities (initial direction)

- **Activity**: user-owned activity definition, measurement type, target, and schedule.
- **Occurrence**: a specific scheduled period in which an activity is expected.
- **Progress event**: an immutable record of a progress increment or correction.
- **Completion**: derived from the occurrence target or explicit completion action.

## Scheduling rules

- Daily activities are evaluated by local calendar day.
- Weekly activities are evaluated by their configured weekly target/window.
- Monthly activities are evaluated by calendar month and configured target.
- Custom schedules are evaluated from explicit recurrence rules.
- One-time activities have one occurrence.
- Store timestamps in UTC and preserve the user's IANA timezone for calendar boundaries.
- Editing a schedule must not silently rewrite historical occurrences.

## MVP screens

1. Today — due activities and quick progress updates.
2. Activity editor — title, schedule, target, unit, and completion mode.
3. Calendar — occurrence and completion history.
4. Statistics — progress trends and completion rates.
5. Settings — profile, timezone, and preferences.

## Data integrity

- Enforce ownership with Supabase Row Level Security.
- Keep progress changes as append-only events where practical.
- Derive completion and streaks from occurrences and schedule rules; do not increment streak counters blindly.
- A brand-new user must not receive sample activities or seeded habits.
