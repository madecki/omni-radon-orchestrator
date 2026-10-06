# Prompt: Add missing creation flows

> Context: The task-manager app is already implemented — CRUD API, views, Task Detail, Dashboard, Kanban board all exist. What's missing is the **UI for creating entities**. The user can't create tasks, initiatives, or milestones from the frontend. Full spec is in `task-manager-mvp-spec-v2.md` in the project root — refer to it for domain model, API endpoints, and field definitions.

## Before you write any code

1. Read `task-manager-mvp-spec-v2.md` for the full domain model and API contract
2. Examine the existing frontend code — find how pages are structured, what components exist, how API calls are made, what patterns are used for forms and state management
3. Check existing API endpoints — the backend CRUD should already be there. You're only adding frontend components.

---

## What to implement

### 1. Task quick-add input

A single text input for rapid task creation. No modal, no separate page.

**Component:** `TaskQuickAdd` — text field + Enter to submit.

**Behavior:**
- User types a title, presses Enter
- POST to create task with: `title`, `project_id` (from context), default status. API handles position assignment.
- Optimistic UI — task appears in list immediately
- Empty input after submit, re-focus the field for rapid entry
- Escape clears input and blurs

**Place this component in:**
- **Project view (List mode)** — at the top of the task list. `project_id` comes from the current project.
- **Project view (Board/Kanban mode)** — at the bottom of each status column. Passes both `project_id` and `status_id` to the create call.
- **All Tasks view** — at the top, but with a small project selector dropdown inline (since there's no single project context). Project must be selected before Enter works.
- **Dashboard "Today" section** — quick-add with project selector. Sets `planned_date = today` on the created task.

**Do NOT add quick-add to:** Archive (read-only), Eisenhower Matrix (visualization only).

### 2. Initiative inline creation — in Project view

The Project view needs a way to see and create Initiatives for that project.

**What to add:**
- A tab, section, or toggle in the Project view to show the project's Initiatives list (fetch `GET /initiatives?projectId=...`)
- A "New Initiative" button at the top of that list
- Clicking it expands an **inline form** in-place (not a modal):
  - Title (text input, required)
  - Description (plain text textarea, optional — no Tiptap, keep it light)
  - "Create" button + "Cancel" link/button
  - Enter in title field submits, Escape cancels and collapses
- After creation, the new initiative appears in the list
- Each initiative in the list is clickable → navigates to Initiative view (`/mfe/tasks/initiatives/[id]`)

### 3. Milestone inline creation — in Initiative view

The Initiative view (`/mfe/tasks/initiatives/[id]`) should already show milestones. Add creation:

- "New Milestone" button at the top of the milestones list
- Inline form expands:
  - Title (text input, required)
  - Due date (date picker, optional)
  - "Create" button + "Cancel"
  - Enter submits, Escape cancels
- After creation, milestone appears in the list
- Milestone completion is toggled via checkbox directly in the list row (PATCH to `/milestones/:id` with `is_completed` toggle)

### 4. Navigation to Initiatives from Project view

Make sure the user can actually get to initiatives:
- Project view should have a clear tab/section switch: **Tasks** | **Initiatives**
- Default tab is Tasks (current behavior)
- Initiatives tab shows initiative list + inline creation
- Store active tab in URL query param (e.g. `?tab=initiatives`) so it survives refresh

---

## Patterns to follow

- **Look at existing form components** in the codebase. If there are input components, button styles, dropdown components — reuse them.
- **Look at existing API call patterns** — how are hooks or fetch calls structured? Use the same approach.
- **Optimistic UI** — match how the existing Kanban board or task list handles updates. If it refetches after mutation, do the same. If it uses optimistic cache updates, match that.
- **Styling** — use TailwindCSS, match the existing visual style exactly. Don't introduce new design patterns.
- **Error handling** — if the API call fails, revert optimistic update and show an error. Match existing error patterns.

## Do NOT

- Change existing API endpoints or Prisma schema — everything needed is already there
- Add modals or separate pages for creation — all creation is inline
- Add Tiptap editors to creation forms — creation is minimal (title only for tasks, title+description for initiatives, title+date for milestones). Full editing happens in detail views.
- Refactor existing components while adding these features
