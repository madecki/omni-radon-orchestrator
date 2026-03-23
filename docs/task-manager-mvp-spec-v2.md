# Task Manager — MVP Specification (v2, refined)

> Module `task-manager` in the OmniRadon stack.
> Next.js MFE (port 4480) + NestJS/Fastify API (port 4481) + Postgres (port 54322) + NATS JetStream (port 42221).
> Projects and Tags are owned by the `settings` service — task-manager consumes them read-only.

---

## 0. Scope & constraints

### Single-user system

MVP is single-user. There is no `user_id` on entities. Auth exists at the gateway level (RS256 JWT) to validate that requests come from the authenticated owner. All data belongs to one user. Multi-user (assignees, permissions, teams) is explicitly out of scope.

### What this module owns

- Tasks, Initiatives, Milestones, Comments
- Status schemas (per-project status configuration)
- Dashboard aggregation
- Archive lifecycle

### What this module reads (does not own)

- **Projects** — from `settings` service (via internal HTTP call to Settings API, following the pattern used by diary)
- **Tags** — from `settings` service (same mechanism)

> **Decision: internal API call, not shared DB read.** This keeps service boundaries clean and matches the existing diary→settings integration pattern. Task-manager-api calls Settings API with the gateway service token.

---

## 1. Domain model

### Hierarchy

```
Project (owned by settings)
  └── Initiative (optional)
        └── Milestone (optional, belongs to Initiative)
              └── Task
```

- **Task** must belong to a `Project`. Assignment to `Initiative` and `Milestone` is optional.
- **Initiative** belongs to a `Project`.
- **Milestone** belongs to an `Initiative`. There are no standalone project-level milestones in MVP. If you need a milestone without grouping, create a single initiative as a container.

### Task

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | cuid | ✅ | auto |
| `title` | string | ✅ | max 500 chars |
| `description` | Json | ❌ | Tiptap ProseMirror JSON document. Always stored as JSON, never raw HTML. |
| `status_id` | FK → TaskStatus | ✅ | Set to project's default status on creation |
| `priority` | enum: `LOW \| MEDIUM \| HIGH \| CRITICAL` | ❌ | null = unset (not displayed in Eisenhower) |
| `is_urgent` | boolean | ❌ | default `false` — Eisenhower axis |
| `is_important` | boolean | ❌ | default `false` — Eisenhower axis |
| `deadline` | date (no time) | ❌ | |
| `planned_date` | date (no time) | ❌ | **"Do today/this day" marker.** Allows manually scheduling a task for a specific day without setting a hard deadline. |
| `position` | int | ✅ | Sort order within the same status column. New tasks get `max(position) + 1000` within their status (gapped ordering for cheap reinserts). |
| `project_id` | string (FK → Project in settings) | ✅ | |
| `initiative_id` | FK → Initiative | ❌ | |
| `milestone_id` | FK → Milestone | ❌ | If set, `initiative_id` must also be set and milestone must belong to that initiative. Enforce in application layer. |
| `completed_at` | timestamp | ❌ | Set when task transitions to a terminal status. Cleared on restore or status change to non-terminal. |
| `archived_at` | timestamp | ❌ | Set by auto-archival cron or manual archive. `null` = active. |
| `deleted_at` | timestamp | ❌ | **Soft delete.** Separate from `archived_at`. `DELETE /tasks/:id` sets this. Deleted tasks are invisible everywhere including archive. |
| `created_at` | timestamp | ✅ | auto |
| `updated_at` | timestamp | ✅ | auto |

> **Key design decision:** `archived_at` and `deleted_at` are separate fields. Archiving is a lifecycle stage (completed → archived). Deletion is a user action meaning "I don't want this." This distinction matters for filtering, counts, and future restore UX.

### Task tags (join table)

| Field | Type | Required |
|-------|------|----------|
| `task_id` | FK → Task | ✅ |
| `tag_id` | string | ✅ | References Tag in settings service. No FK constraint (cross-service). |

Composite primary key: `(task_id, tag_id)`.

### Initiative

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | cuid | ✅ | auto |
| `title` | string | ✅ | max 300 chars |
| `description` | Json | ❌ | Tiptap JSON |
| `project_id` | string | ✅ | |
| `status` | enum: `ACTIVE \| COMPLETED \| ARCHIVED` | ✅ | default `ACTIVE` |
| `created_at` | timestamp | ✅ | auto |
| `updated_at` | timestamp | ✅ | auto |

### Milestone

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | cuid | ✅ | auto |
| `title` | string | ✅ | max 300 chars |
| `due_date` | date | ❌ | |
| `initiative_id` | FK → Initiative | ✅ | |
| `is_completed` | boolean | ✅ | default `false` |
| `created_at` | timestamp | ✅ | auto |
| `updated_at` | timestamp | ✅ | auto |

### TaskComment

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | cuid | ✅ | auto |
| `task_id` | FK → Task | ✅ | cascade delete with task |
| `body` | Json | ✅ | Tiptap JSON (lite — no headings, no code blocks) |
| `created_at` | timestamp | ✅ | auto |
| `updated_at` | timestamp | ✅ | auto |

---

## 2. Status configuration per project

### Schema (simplified — no indirection table)

```
TaskStatusSchema
  id            cuid
  project_id    string (unique) — one schema per project
  created_at    timestamp
  updated_at    timestamp

TaskStatus
  id            cuid
  label         string (max 50)
  color         string (hex, e.g. "#3B82F6")
  position      int          ← drag & drop ordering
  is_default    boolean      ← status assigned to new tasks (exactly one per schema)
  is_terminal   boolean      ← transition to this status sets completed_at
  schema_id     FK → TaskStatusSchema
```

> **Removed `task_project_config`.** It was a pointless indirection — both it and `TaskStatusSchema` had `project_id`. Now `TaskStatusSchema.project_id` is unique and that's the lookup.

### Default schema

Created automatically when task-manager first encounters a `project_id` that has no schema (lazy initialization on first task creation or when project config is requested):

| position | label | color | is_default | is_terminal |
|----------|-------|-------|------------|-------------|
| 0 | Todo | #6B7280 | ✅ | ❌ |
| 1 | In Progress | #3B82F6 | ❌ | ❌ |
| 2 | Done | #10B981 | ❌ | ✅ |

### Rules

- Exactly one status must be `is_default = true` per schema. Changing default unsets the previous one (transactional).
- A status can only be deleted if zero tasks reference it. API returns 409 with count of blocking tasks.
- At least one status must remain in the schema (cannot delete the last one).
- Reordering updates `position` values for all statuses in the schema (batch update, single transaction).

---

## 3. Eisenhower matrix

Two booleans on Task (`is_urgent`, `is_important`) define four quadrants:

| | Important | Not Important |
|---|---|---|
| **Urgent** | Do now | Delegate / limit |
| **Not urgent** | Schedule | Drop / skip |

The matrix is an **alternative view mode** for a task list, not a separate data structure. Filter applies first (project, tags, etc.), then tasks are placed into quadrants. Tasks with `is_urgent = false` and `is_important = false` (the default) appear in the "Drop/skip" quadrant — which can be visually de-emphasized.

---

## 4. Views

### 4.1 Dashboard (`/mfe/tasks`)

The command center. Structure from general to specific:

**"Today" section**
- Tasks where `planned_date = today` OR `deadline = today`
- Tasks completed today (`completed_at` is today) remain visible until midnight, then disappear into archive
- Counter: `X / Y completed today`

**"This Week" section**
- Tasks where `deadline` falls within current ISO week (Monday–Sunday)
- Counter: completed this week vs total due this week

**"AI Insights" section** *(placeholder in MVP)*
- Returns empty array from placeholder service
- UI renders a card saying "AI Insights coming soon" or shows insights when available
- Future: powered by llm-service via async call (non-blocking)

**"Projects Overview" section**
- Cards for each project (fetched from settings) showing:
  - Project name
  - Progress bar: completed active tasks / total active tasks (where active = `archived_at IS NULL AND deleted_at IS NULL`)
  - Count of overdue tasks (deadline < today, not completed)

### 4.2 Project view (`/mfe/tasks/projects/[id]`)

- View mode toggle: **List** | **Board (Kanban)** | **Eisenhower Matrix**
- **List**: tasks sorted by `position`, grouped by status optionally, filterable
- **Board**: columns = statuses (ordered by `position`), tasks within column sorted by `Task.position`. Drag & drop between columns changes status. Drag & drop within column changes position.
- **Eisenhower**: 2×2 grid, tasks placed by `is_urgent` × `is_important`
- All views share the same filter bar: status, priority, tags, deadline range, urgent/important toggles

### 4.3 Initiative view (`/mfe/tasks/initiatives/[id]`)

- Initiative metadata (title, description, status)
- Milestones list with due dates, completion toggle, and progress (tasks completed / total per milestone)
- Tasks list (all tasks in this initiative, optionally filtered to a specific milestone)

### 4.4 All Tasks (`/mfe/tasks/all`)

- Cross-project task list
- Filters: project, tag, status, priority, urgent, important, deadline range, has deadline (yes/no)
- Sort options: deadline, priority, created_at, updated_at
- Default sort: deadline ASC (nulls last), then priority DESC

### 4.5 Archive (`/mfe/tasks/archive`)

- Tasks where `archived_at IS NOT NULL AND deleted_at IS NULL`
- Read-only display. Single action: **Restore** (clears `archived_at`, clears `completed_at`, resets status to project default)
- Filterable by project

### 4.6 Status schema editor (`/mfe/tasks/settings/project/[id]/statuses`)

- List of statuses with color swatches, drag & drop reorder (@dnd-kit)
- Inline edit for label and color
- Add new status button
- Delete button (disabled with tooltip showing task count if status is in use)
- Visual indicator for default and terminal statuses

---

## 5. Task detail — full screen (`/mfe/tasks/t/[id]`)

Dedicated route, not a modal.

### Layout

```
[ ← Back ]  [ Project > Initiative > Milestone ]  (breadcrumb, clickable)  [ ⋯ menu: archive, delete ]

[ TITLE — inline editable, auto-save on blur ]

┌──────────────────────────────────────────────────┐
│ Status: [dropdown]    Priority: [dropdown]        │
│ Deadline: [datepicker] Planned: [datepicker]      │
│ Urgent: [toggle]      Important: [toggle]         │
│ Tags: [multi-select]                              │
│ Initiative: [select]  Milestone: [select]         │
└──────────────────────────────────────────────────┘

──────────────────────────────────────────────────
DESCRIPTION
[ Tiptap WYSIWYG editor — full width, auto-save debounced 1s ]

──────────────────────────────────────────────────
COMMENTS
[ Comment list — newest last ]
[ New comment — Tiptap lite (bold, italic, lists, links, inline code) ]
[ Submit button ]
```

### Field behavior

- **Status change to terminal** → sets `completed_at = now()`, shows visual indicator
- **Status change from terminal to non-terminal** → clears `completed_at`
- **Initiative select** → filters available milestones to that initiative. Clearing initiative also clears milestone.
- **All field changes auto-save** via PATCH (debounced, optimistic UI)

### WYSIWYG scope (Tiptap — description)

- Headings H1–H3
- Bold, italic, underline, strikethrough
- Bullet list, numbered list
- Inline code, code block (with syntax highlighting if trivial to add)
- Links
- Paragraph blocks (Enter = new paragraph)
- Placeholder text when empty

---

## 6. Archive lifecycle

| Event | Action |
|-------|--------|
| Task status changes to `is_terminal = true` | Set `completed_at = now()` |
| Task status changes from terminal to non-terminal | Clear `completed_at` |
| **Cron job (daily, 00:05 UTC)** | `UPDATE tasks SET archived_at = now() WHERE completed_at < CURRENT_DATE AND archived_at IS NULL AND deleted_at IS NULL` |
| Dashboard "Today" section | Shows tasks with `completed_at::date = CURRENT_DATE` alongside active today-tasks |
| Manual archive (from menu) | Sets `archived_at = now()` regardless of completion state |
| Restore from archive | Clears `archived_at`, clears `completed_at`, resets `status_id` to project's default status |
| `DELETE /tasks/:id` | Sets `deleted_at = now()`. Task becomes invisible everywhere. |

> **Cron runs at 00:05 local machine time**, not exactly midnight, to avoid contention. This is a single-user tool running on the developer's own machine — server time = user time. No timezone conversion needed.

---

## 7. API endpoints (NestJS)

All endpoints prefixed with `/tasks` at gateway level. Internal prefix in NestJS app is `/`.

### Tasks

```
GET    /                          → list tasks (query params below)
POST   /                          → create task
GET    /:id                       → get task by id
PATCH  /:id                       → update task (partial)
DELETE /:id                       → soft delete (sets deleted_at)
POST   /:id/archive               → manual archive (sets archived_at)
POST   /:id/restore               → restore from archive (clears archived_at, completed_at, resets status)
PATCH  /reorder                    → batch update positions [{ id, position, status_id? }]
```

**List query params:**
- `projectId` (string, optional)
- `initiativeId` (string, optional)
- `milestoneId` (string, optional)
- `statusId` (string, optional)
- `priority` (enum, optional)
- `isUrgent` (boolean, optional)
- `isImportant` (boolean, optional)
- `tagIds` (comma-separated string, optional)
- `deadlineFrom`, `deadlineTo` (date, optional)
- `plannedDate` (date, optional)
- `hasDeadline` (boolean, optional)
- `archived` (boolean, default false — if true, returns archived tasks only)
- `sort` (enum: `deadline`, `priority`, `createdAt`, `updatedAt`, `position` — default `position`)
- `order` (asc/desc, default asc)
- `cursor` (string, optional — cursor-based pagination, follow diary pattern)
- `limit` (int, default 50, max 100)

**Create request body:**
```json
{
  "title": "string (required)",
  "description": "Json (optional)",
  "projectId": "string (required)",
  "statusId": "string (optional — uses project default if omitted)",
  "priority": "LOW|MEDIUM|HIGH|CRITICAL (optional)",
  "isUrgent": "boolean (optional)",
  "isImportant": "boolean (optional)",
  "deadline": "date (optional)",
  "plannedDate": "date (optional)",
  "initiativeId": "string (optional)",
  "milestoneId": "string (optional)",
  "tagIds": "string[] (optional)"
}
```

### Comments

```
GET    /:taskId/comments           → list comments (cursor pagination)
POST   /:taskId/comments           → create comment
PATCH  /:taskId/comments/:id       → update comment
DELETE /:taskId/comments/:id       → hard delete (comments don't need soft delete)
```

### Initiatives

```
GET    /initiatives                 → list (query: projectId required)
POST   /initiatives                 → create
GET    /initiatives/:id             → get with milestone count + task count
PATCH  /initiatives/:id             → update
DELETE /initiatives/:id             → delete (only if no tasks reference it, else 409)
```

### Milestones

```
GET    /initiatives/:initiativeId/milestones    → list
POST   /initiatives/:initiativeId/milestones    → create
PATCH  /milestones/:id                          → update (including is_completed toggle)
DELETE /milestones/:id                          → delete (only if no tasks reference it, else 409)
```

### Status schema

```
GET    /project-config/:projectId/statuses           → get schema + all statuses (auto-creates default if missing)
POST   /project-config/:projectId/statuses           → add status
PATCH  /project-config/:projectId/statuses/:statusId → update label, color, is_default, is_terminal
DELETE /project-config/:projectId/statuses/:statusId → delete (409 if tasks use it)
PATCH  /project-config/:projectId/statuses/reorder   → body: [{ id, position }]
```

### Dashboard

```
GET    /dashboard                   → aggregated data
```

**Response shape:**
```json
{
  "today": {
    "tasks": "Task[]",
    "completedCount": "number",
    "totalCount": "number"
  },
  "thisWeek": {
    "tasks": "Task[]",
    "completedCount": "number",
    "totalCount": "number"
  },
  "projects": [
    {
      "projectId": "string",
      "projectName": "string",
      "totalActiveTasks": "number",
      "completedTasks": "number",
      "overdueTasks": "number"
    }
  ],
  "insights": "InsightItem[] (empty in MVP)"
}
```

> Dashboard endpoint calls Settings API internally to get project names. Cache project list for 60s in-memory (single-user, low traffic).

---

## 8. Validation

All request/response DTOs validated with **Zod** schemas in `packages/shared`. NestJS pipes transform and validate incoming requests. Follow the diary pattern for schema definitions.

Key validations:
- `title`: non-empty, max 500 chars (tasks), max 300 chars (initiatives, milestones)
- `milestoneId` requires `initiativeId` to also be set
- `milestone.initiative_id` must match task's `initiativeId` (if both set)
- Status transitions: any status → any status (no state machine in MVP, just record `completed_at` on terminal)
- `deadline` and `planned_date`: must be valid ISO date strings, no time component
- `color`: must match `/^#[0-9A-Fa-f]{6}$/`

---

## 9. NATS events (stubs only)

Stream: `TASK_MANAGER_EVENTS`

Subjects (not published in MVP — stubs and schema only):
- `task-manager.task.created`
- `task-manager.task.updated`
- `task-manager.task.deleted`
- `task-manager.task.archived`
- `task-manager.task.restored`

Envelope follows `TaskManagerEventPayloadSchema` from `packages/shared`. Outbox table (`OutboxEvent`) exists in Prisma schema. **No publisher implementation in MVP** — just the infrastructure.

---

## 10. Integration with llm-service (future, not MVP)

- Task-manager will publish events via NATS (after outbox publisher is implemented)
- llm-service consumes events and builds context
- Dashboard calls llm-service endpoint for insights (async, non-blocking)
- Planned MVP insights (for when integration is built):
  - High-priority tasks without deadlines, older than 7 days
  - Projects with no activity in 14+ days
  - Deadline clusters (3+ tasks due within 3 days)
- **For now:** `InsightsService` returns `[]`. UI shows placeholder.

---

## 11. Out of scope (MVP)

- Multi-user / assignees / permissions
- Recurring tasks
- File attachments
- Time tracking
- Notifications / reminders
- External integrations (GitHub, Slack, etc.)
- Calendar view
- Sub-tasks / checklists
- Task dependencies
- Bulk operations
- Import/export

---

## 12. Cursor implementation prompt

```
You are implementing features in the `task-manager` module of the OmniRadon stack. The repository is already bootstrapped — Turborepo structure, Docker Compose, base NestJS app, base Next.js app, and Prisma config all exist. You are adding domain logic, not scaffolding.

## Stack (already set up)

- Backend: NestJS + Fastify, Prisma 7 (with prisma.config.ts), Postgres on port 54322
- Frontend: Next.js 14 (App Router), TailwindCSS, embedded as MFE at /mfe/tasks via gateway
- Monorepo: Turborepo, pnpm workspaces
- Auth: RS256 JWT validated by gateway. User identity comes from `x-user-id` and `x-user-email` headers injected by gateway. This is a single-user system — no user_id stored on entities.
- Shared package: `packages/shared` — Zod schemas, constants, types
- Database package: `packages/database` — Prisma schema + client
- NATS JetStream on port 42221 (stubs exist, no publishers in this phase)
- Settings integration: call Settings API (http://localhost:4381) with service token for project and tag data. **Look at how the diary module calls the Settings API** — find the HTTP client setup, service token injection, and response handling. Replicate that pattern exactly.

## CRITICAL: Before writing any code, read existing patterns

Before implementing anything, examine:
1. `packages/database/prisma/schema.prisma` — see existing models and how relations are structured
2. `apps/task-manager-api/src/` — see existing module structure, how controllers/services are organized
3. `packages/shared/src/` — see existing schemas, constants, event definitions
4. The `diary` repository (if available in workspace) — it is the reference implementation for:
   - NestJS module structure and naming
   - Prisma repository pattern (if any abstraction exists)
   - Cursor-based pagination implementation
   - NATS outbox event model
   - Gateway auth header extraction
   - Error handling and HTTP exception patterns
   - Zod schema definitions in shared package
5. The `settings` repository — see how projects and tags API works, what endpoints are available, response shapes

Match the diary patterns exactly unless there is a technical reason not to.

## Prisma schema to add (in packages/database)

Add these models. Use @id @default(cuid()) for all IDs. Use @updatedAt for updated_at fields. Follow the existing schema conventions you find.

### Enums

```prisma
enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum InitiativeStatus {
  ACTIVE
  COMPLETED
  ARCHIVED
}
```

### Models

Task:
- id (cuid), title (String), description (Json?), status_id (FK → TaskStatus)
- priority (TaskPriority?), is_urgent (Boolean, default false), is_important (Boolean, default false)
- deadline (DateTime? — date only, store as DATE), planned_date (DateTime? — date only)
- position (Int) — sort order within status column
- project_id (String — no FK, references settings service), initiative_id (FK → Initiative?), milestone_id (FK → Milestone?)
- completed_at (DateTime?), archived_at (DateTime?), deleted_at (DateTime?)
- created_at (DateTime, default now), updated_at (DateTime, @updatedAt)
- Relations: status, initiative, milestone, comments (1:many), tags (many:many via TaskTag)
- Indexes: (project_id, archived_at, deleted_at), (status_id), (deadline), (planned_date), (initiative_id), (milestone_id)

TaskTag (join table):
- task_id (FK → Task), tag_id (String — no FK, references settings service)
- @@id([task_id, tag_id])

TaskComment:
- id, task_id (FK → Task, onDelete: Cascade), body (Json), created_at, updated_at

Initiative:
- id, title (String), description (Json?), project_id (String), status (InitiativeStatus, default ACTIVE)
- created_at, updated_at
- Relations: milestones (1:many), tasks (1:many)

Milestone:
- id, title (String), due_date (DateTime?), initiative_id (FK → Initiative, onDelete: Cascade)
- is_completed (Boolean, default false), created_at, updated_at
- Relations: initiative, tasks (1:many)

TaskStatusSchema:
- id, project_id (String, @unique), created_at, updated_at
- Relations: statuses (1:many → TaskStatus)

TaskStatus:
- id, label (String), color (String), position (Int), is_default (Boolean, default false), is_terminal (Boolean, default false)
- schema_id (FK → TaskStatusSchema, onDelete: Cascade)
- Relations: schema, tasks (1:many)

## NestJS modules to implement

Each module: Controller + Service + DTOs (Zod in packages/shared + NestJS DTOs in API app). Follow diary's pattern for file naming and folder structure.

### 1. ProjectConfigModule
- `GET /project-config/:projectId/statuses` — returns schema + statuses. If no schema exists for this project, create default schema (Todo, In Progress, Done) and return it. This is the lazy initialization point.
- `POST /project-config/:projectId/statuses` — add status to schema
- `PATCH /project-config/:projectId/statuses/:statusId` — update label, color, is_default, is_terminal. If changing is_default to true, unset previous default in same transaction.
- `DELETE /project-config/:projectId/statuses/:statusId` — 409 if any tasks use this status (return count in error body). 400 if it's the last status.
- `PATCH /project-config/:projectId/statuses/reorder` — body: { statuses: [{ id: string, position: number }] }. Batch update.

### 2. TasksModule
- CRUD with all query params for filtering (see spec section 7)
- On CREATE: if no statusId provided, look up project's default status (call ProjectConfigService). Set position = max position in that status + 1000 (or 0 if first task).
- On PATCH: if status_id changes, check is_terminal. If terminal → set completed_at. If moving away from terminal → clear completed_at.
- DELETE = set deleted_at. Add default query filter: `deleted_at: null` on all list/get queries.
- POST /:id/archive = set archived_at. POST /:id/restore = clear archived_at, clear completed_at, reset status_id to project default.
- PATCH /reorder = batch update [{id, position, status_id?}] — used by Kanban D&D.
- Cursor-based pagination following diary pattern.

### 3. CommentsModule
- CRUD for task comments. Nested under /tasks/:taskId/comments.
- Hard delete (no soft delete for comments).
- Cursor-based pagination for list.

### 4. InitiativesModule
- CRUD. List requires projectId query param.
- DELETE returns 409 with task count if tasks reference this initiative.

### 5. MilestonesModule
- CRUD nested under /initiatives/:initiativeId/milestones (for list and create).
- PATCH and DELETE use /milestones/:id directly.
- DELETE returns 409 if tasks reference this milestone.

### 6. DashboardModule
- Single GET /dashboard endpoint.
- Queries:
  - today: tasks where (planned_date = today OR deadline = today) AND deleted_at IS NULL AND archived_at IS NULL. Include tasks completed today (completed_at::date = today).
  - thisWeek: tasks where deadline is within current ISO week AND deleted_at IS NULL AND archived_at IS NULL.
  - projects: for each project (from settings API), count total active tasks, completed tasks, overdue tasks.
  - insights: return [] (placeholder).
- Response is a single JSON object (see spec section 7 for shape).
- Cache settings project list in-memory for 60 seconds to avoid redundant calls.

### 7. ArchiveCronService
- Use @nestjs/schedule (CronExpression).
- Runs daily at 00:05 local machine time (this is a personal tool, server time = user time).
- Query: tasks where completed_at IS NOT NULL AND completed_at < today AND archived_at IS NULL AND deleted_at IS NULL.
- Set archived_at = now() for all matching tasks.
- Log count of archived tasks.

## Frontend (Next.js, App Router)

### Important patterns
- Follow diary-web and settings-web patterns for: page structure, API client setup, auth token handling, MFE embedding
- Use fetch() with the gateway base URL and auth headers (check how diary-web does this)
- All data fetching via custom hooks or server components — match existing pattern
- TailwindCSS for all styling
- @dnd-kit for drag & drop (Kanban board, status reorder)
- Tiptap for WYSIWYG editors (description + comments)

### Pages to implement

1. **Dashboard** (`/mfe/tasks` or the app root page)
   - Fetch /dashboard endpoint on load
   - Four sections: Today, This Week, AI Insights (placeholder), Projects Overview
   - Task items are clickable → navigate to task detail
   - Today section shows completion counter

2. **Project View** (`/mfe/tasks/projects/[id]`)
   - Fetch project details from settings API (via backend proxy or direct)
   - View toggle: List | Board | Eisenhower (store in URL query param or localStorage)
   - List: rendered as table/list, sortable columns
   - Board: Kanban with columns from project statuses. Use @dnd-kit for card movement.
   - Eisenhower: 2x2 grid, tasks placed by is_urgent × is_important

3. **Task Detail** (`/mfe/tasks/t/[id]`)
   - Full-screen page, not a modal
   - Breadcrumb: Project > Initiative > Milestone (all clickable)
   - Inline-editable title (save on blur)
   - All metadata fields as form controls (dropdowns, toggles, date pickers)
   - Tiptap editor for description (auto-save debounced 1000ms)
   - Comments section below with Tiptap-lite for new comment input
   - Three-dot menu: Archive, Delete (with confirmation)

4. **All Tasks** (`/mfe/tasks/all`)
   - Filter bar: project, status, priority, tags, deadline range, urgent/important toggles
   - Sort dropdown
   - Infinite scroll or load-more pagination

5. **Initiative View** (`/mfe/tasks/initiatives/[id]`)
   - Initiative header with metadata
   - Milestones list with progress bars
   - Tasks list filtered to this initiative, optionally filtered by milestone

6. **Archive** (`/mfe/tasks/archive`)
   - Read-only task list with Restore button per task
   - Filter by project

7. **Status Editor** (`/mfe/tasks/settings/project/[id]/statuses`)
   - Sortable list with @dnd-kit
   - Inline editing for label and color
   - Visual badges for default and terminal statuses
   - Add/delete buttons with appropriate guards

## Validation

- Define Zod schemas in packages/shared for all request/response DTOs
- Use NestJS validation pipes to validate incoming requests
- Frontend: validate forms client-side before submission (can use same Zod schemas)

## Error handling

- Follow diary's HTTP exception patterns
- 400: validation errors (return field-level details)
- 404: entity not found
- 409: conflict (e.g., cannot delete status in use — return { message, taskCount })
- Log errors with NestJS Logger

## What NOT to implement

- NATS event publishers (stubs and outbox model exist, don't wire up publishing)
- AI insights logic (return empty array)
- Multi-user features
- File uploads
- Recurring tasks
- Any feature listed in "out of scope" in the spec

## Implementation order

1. Prisma schema + migration
2. ProjectConfigModule (status management — other modules depend on it)
3. TasksModule (core CRUD + filtering + archiving)
4. CommentsModule
5. InitiativesModule + MilestonesModule
6. DashboardModule + ArchiveCronService
7. Frontend: Task Detail page (most complex, validates the data model)
8. Frontend: Dashboard
9. Frontend: Project View (List → Board → Eisenhower)
10. Frontend: All Tasks, Archive, Initiative View
11. Frontend: Status Editor
```

---

## Appendix A: Decisions log

| Decision | Rationale |
|----------|-----------|
| Separate `deleted_at` from `archived_at` | Archive is a lifecycle stage. Delete is user intent. Mixing them makes filtering and counting wrong. |
| Removed `task_project_config` table | Pointless indirection. `TaskStatusSchema.project_id` (unique) is sufficient. |
| Added `planned_date` field | Spec described "manually mark as today" in dashboard but had no backing field. |
| Added `position` field on Task | Required for Kanban D&D ordering within columns. Gapped integers (increment by 1000) for cheap reinserts. |
| Added `deleted_at` field on Task | `DELETE` endpoint needs a soft delete separate from archiving. |
| Rich text = Tiptap JSON only | Spec said "JSON/HTML" — ambiguous. Tiptap natively produces JSON. Store one format. |
| Cron at 00:05 local time | Personal tool running on dev machine — server time is user time. No TZ conversion needed. |
| Lazy schema initialization | Don't create schemas for all projects upfront. Create on first access. Avoids syncing with settings service. |
| Restore resets status to default | A restored task was in terminal state. Putting it back in terminal makes no sense. Reset to project default. |
| Settings integration via HTTP | Not shared DB read. Cleaner service boundaries. Matches diary pattern. |
| `tag_id` has no FK constraint | Tags live in settings DB. Cross-database FK is impossible. Validate via API call on write. |
