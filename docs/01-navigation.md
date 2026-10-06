# Phase 1: Navigation, Sidebar & Project Persistence

> **Prerequisites:** Read `00-context.md` first.

---

## Goal

Restructure the app navigation to match the target screen architecture. Sidebar with 4 items, project persistence via localStorage, view toggle in All Tasks, and status editor accessible from Kanban.

---

## Before you write code

1. Read `00-context.md` for the full screen architecture
2. Examine the existing layout/sidebar in `apps/task-manager-web/src/`:
   - Is there already a sidebar or navigation component? **Extend it, don't replace it.**
   - How is the current layout structured? (layout.tsx, shared wrappers, etc.)
   - What existing pages/routes exist? List them all.
3. Check how the app currently handles routing inside the MFE (`/mfe/tasks/...`)
4. Check if the old Project view (`/mfe/tasks/projects/[id]`) exists and what it contains — we're replacing it

---

## Feature 1: Sidebar

### Structure

Persistent sidebar on the left side of every page:

```
┌─────────────────┐
│  Dashboard       │  ← active state: highlighted
│  All tasks       │
│  Initiatives     │
│  Archive         │
└─────────────────┘
```

- Sidebar is always visible on all screens (including drill-down screens like Task detail and Initiative detail)
- Active item highlighted based on current route
- For drill-down routes (`/mfe/tasks/t/[id]`, `/mfe/tasks/initiatives/[id]`): highlight the parent sidebar item. Task detail → highlight "All tasks". Initiative detail → highlight "Initiatives".

### Data attributes

```
data-testid="sidebar"                    — sidebar wrapper
data-testid="sidebar-dashboard"          — Dashboard link
data-testid="sidebar-all-tasks"          — All tasks link
data-testid="sidebar-initiatives"        — Initiatives link
data-testid="sidebar-archive"            — Archive link
```

---

## Feature 2: All Tasks screen (`/mfe/tasks/all`)

This replaces the old Project view. It combines project selection + view mode toggle.

### Project selector

- Dropdown at the top of the content area
- Fetches project list from Settings API (same source the existing views use)
- **Persistence:** selected project saved to `localStorage` key `task-manager:selected-project`
- On mount:
  1. URL param `?project=xxx` → use it, save to localStorage
  2. Else localStorage → use it, set URL param
  3. Else show selector with placeholder "Select a project"
- On change: update URL param + localStorage

### View mode toggle

Below the project selector:

```
[ List ] | [ Kanban ] | [ Eisenhower ]
```

- Store in URL param: `?view=list` (default) / `?view=kanban` / `?view=eisenhower`
- **List** — existing task list with filters and sort. Requires project to be selected.
- **Kanban** — existing Kanban board. Requires project. Shows "Customize columns" link/gear icon.
- **Eisenhower** — existing 2×2 matrix. Requires project.

If no project is selected and user clicks Kanban or Eisenhower, show a message: "Select a project to use this view."

If no project is selected and user is on List view, also show the prompt to select a project. All views are project-scoped.

### Status schema editor access

When Kanban view is active, show a gear icon or "Customize columns" link near the view toggle or column headers. Clicking it navigates to the status schema editor. Options:
- Navigate to `/mfe/tasks/all?project=xxx&view=kanban&settings=statuses` (inline panel)
- Or navigate to a modal/slide-over for editing
- Or keep the existing `/mfe/tasks/settings/project/[id]/statuses` route — just make it reachable from here

Pick whichever approach best matches existing patterns. The key requirement: the user can access the status editor without leaving the Kanban context mentally.

### Data attributes

```
data-testid="project-selector"           — project dropdown
data-testid="view-toggle"                — view mode toggle wrapper
data-testid="view-toggle-list"           — List button
data-testid="view-toggle-kanban"         — Kanban button
data-testid="view-toggle-eisenhower"     — Eisenhower button
data-testid="kanban-settings-link"       — "Customize columns" link (visible in Kanban only)
data-testid="project-required-message"   — "Select a project" prompt
```

---

## Feature 3: Initiatives screen (`/mfe/tasks/initiatives`)

A new page that lists initiatives for a selected project.

### Project selector

- Same persistence logic as All Tasks (localStorage key `task-manager:selected-project` — shared between screens)
- When user switches project in All Tasks, it's reflected in Initiatives too (and vice versa)

### Content

- Shows initiative list for the selected project
- "New Initiative" button (Phase 3 implements the modal — for now, just place the button and leave it non-functional or show a "Coming soon" state)
- Each initiative row: title (clickable → `/mfe/tasks/initiatives/[id]`), status badge
- Empty state when no project selected or no initiatives

### Data attributes

```
data-testid="initiatives-screen"         — screen wrapper
data-testid="initiative-list"            — list wrapper
data-testid="initiative-item"            — each row
data-testid="initiative-item-title"      — clickable title
data-testid="initiative-empty-state"     — empty state
```

---

## Feature 4: Route cleanup

### Old routes to redirect or remove

- `/mfe/tasks/projects/[id]` → redirect to `/mfe/tasks/all?project=[id]`
- `/mfe/tasks/settings/project/[id]/statuses` → keep the page but ensure it's reachable from Kanban view (see Feature 2)

### Ensure these routes work

- `/mfe/tasks` — Dashboard (existing)
- `/mfe/tasks/all` — All Tasks (new screen)
- `/mfe/tasks/initiatives` — Initiative list (new screen)
- `/mfe/tasks/initiatives/[id]` — Initiative detail (existing page, verify it works)
- `/mfe/tasks/t/[id]` — Task detail (existing page, verify it works)
- `/mfe/tasks/archive` — Archive (existing page, verify it works)

---

## E2E Tests

File: `apps/task-manager-e2e/specs/navigation.spec.ts`

### Setup (beforeEach)

1. Clean the test database
2. Clear localStorage (important for project persistence tests)
3. Seed via API:
   - 2 projects (to test switching)
   - A few tasks in each project
   - Trigger status schema init for both projects
4. Navigate to dashboard

### Test cases

#### Sidebar

```
test('sidebar is visible on all pages')
  1. Navigate to Dashboard → assert sidebar visible
  2. Navigate to All Tasks → assert sidebar visible
  3. Navigate to Initiatives → assert sidebar visible
  4. Navigate to Archive → assert sidebar visible

test('sidebar highlights active item')
  1. Navigate to Dashboard → assert Dashboard is highlighted
  2. Click "All tasks" → assert All tasks is highlighted
  3. Click "Initiatives" → assert Initiatives is highlighted

test('task detail highlights "All tasks" in sidebar')
  1. Navigate to a task detail page
  2. Assert: "All tasks" is highlighted in sidebar

test('initiative detail highlights "Initiatives" in sidebar')
  1. Navigate to an initiative detail page
  2. Assert: "Initiatives" is highlighted in sidebar
```

#### Project persistence

```
test('selected project persists in localStorage')
  1. Navigate to All Tasks
  2. Select "Project A" from dropdown
  3. Navigate to Dashboard (click sidebar)
  4. Navigate back to All Tasks
  5. Assert: "Project A" is still selected

test('project selection syncs between All Tasks and Initiatives')
  1. Navigate to All Tasks, select "Project A"
  2. Navigate to Initiatives
  3. Assert: "Project A" is selected

test('URL param overrides localStorage')
  1. Select "Project A" in All Tasks (saved to localStorage)
  2. Navigate directly to /mfe/tasks/all?project=[projectB_id]
  3. Assert: "Project B" is selected
  4. Navigate away and back (without URL param)
  5. Assert: "Project B" is selected (localStorage updated)

test('shows prompt when no project selected')
  1. Clear localStorage
  2. Navigate to All Tasks (no ?project param)
  3. Assert: "Select a project" message visible
```

#### View mode toggle

```
test('defaults to list view')
  1. Navigate to All Tasks with a project selected
  2. Assert: List view is active

test('switches to Kanban view')
  1. Select a project
  2. Click Kanban toggle
  3. Assert: Kanban board visible
  4. Assert: URL contains ?view=kanban

test('switches to Eisenhower view')
  1. Select a project
  2. Click Eisenhower toggle
  3. Assert: Eisenhower matrix visible

test('view persists on refresh')
  1. Select Kanban view
  2. Refresh the page
  3. Assert: Kanban is still active

test('Kanban shows "Customize columns" link')
  1. Switch to Kanban view
  2. Assert: "Customize columns" or gear icon is visible
  3. Click it
  4. Assert: status editor is accessible
```

#### Route redirects

```
test('old project route redirects to All Tasks')
  1. Navigate to /mfe/tasks/projects/[id]
  2. Assert: redirected to /mfe/tasks/all?project=[id]
  3. Assert: correct project is selected
```

---

## Acceptance criteria

- [ ] Sidebar with 4 items visible on every page
- [ ] Active sidebar item highlighted based on route
- [ ] All Tasks screen: project selector + view toggle (List/Kanban/Eisenhower)
- [ ] Project selection persisted to localStorage, shared between All Tasks and Initiatives
- [ ] URL param `?project=xxx` overrides localStorage on direct navigation
- [ ] View mode in URL param `?view=list|kanban|eisenhower`
- [ ] "Customize columns" accessible from Kanban view
- [ ] Initiatives screen: project selector + initiative list (creation is Phase 3)
- [ ] Old `/mfe/tasks/projects/[id]` redirects to All Tasks with project
- [ ] All E2E tests pass against the test database (in `apps/task-manager-e2e/`)
- [ ] No changes to API or Prisma schema
