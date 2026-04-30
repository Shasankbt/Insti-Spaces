# Space Terminal

A bash-like, in-browser terminal for managing files inside a Space. Lives at the
bottom of the **Explorer** tab (VSCode-style), toggled from the toolbar.

```
┌────────────────────────────────────────────────────────────────┐
│  TERMINAL  /photos/2024   [3 selected] [pattern: *.png]    ✕   │
├────────────────────────────────────────────────────────────────┤
│  / ❯ select *.png type:image                                   │
│  selected 12 files                                             │
│  /photos/2024 ❯ move /archive/2024                             │
│  moved 12 files → /archive/2024                                │
│  /photos/2024 ❯                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Opening / closing

- Open: click the **terminal** icon in the explorer toolbar (`>_`).
- Close: click the **✕** in the panel header, or press the toolbar icon again.
- Resize: drag the top edge of the panel up or down.
- Clear screen: type `clear`, or press **⌘L** / **Ctrl-L**.
- History: **↑** / **↓** to scroll past commands.

---

## Commands

| Command | Args | Notes |
|---|---|---|
| `ls` | `[path]` | List the cwd (or a path). Folders first, then files. |
| `cd` | `[path]` | Change cwd. Bare `cd` returns to space root. |
| `select` | `<pattern> [filters]` | Mark files matching pattern + filters. Replaces any prior selection. |
| `move` | `<destination>` | Move the current selection into a folder. |
| `copy` | `<destination>` | Copy the current selection into a folder. |
| `delete` | — | Move the current selection to the trash. |
| `rename` | `<pattern>` | Rename each selected file using a template. |
| `info` | `<file-path>` | Show metadata (mime, size, uploader, captured/uploaded times). |
| `deselect` | — | Clear the current selection. (client-only) |
| `clear` | — | Clear the transcript. (client-only) |
| `help` | — | Show inline help. (client-only) |

---

## Path syntax

Used by `ls`, `cd`, `move`, `copy`, `info`, and the `folder:` filter.

| Form | Meaning |
|---|---|
| `a/b/c` | relative path — resolved against cwd |
| `/a/b` | absolute path — rooted at the space root |
| `..` | parent folder |
| `.` | current folder (no-op) |
| `\/` | literal slash inside a folder name |
| `\\` | literal backslash |

Hard limits enforced at parse time:

- Each segment ≤ 255 chars
- No NULL bytes
- No empty segments (`a//b` rejected)
- `..` may not escape the absolute root (`/..` rejected)

> **Folders aren't unique by name in the schema** — they're unique within their
> parent. So a path is the only unambiguous reference. Bare names like `photos`
> would collide if two folders share that name in different parents.

### Spaces in names

Tokenization respects double quotes. Backslash-space (`\ `) is **not** a
tokenizer-level escape today.

```
ls "my photos"          ✓
ls my\ photos           ✗  (tokenizer splits on space first)
```

---

## Select pattern

Wildcards are all **capturing** and **greedy**. Captures are numbered
left-to-right.

| Token | Matches |
|---|---|
| `?` | exactly one character |
| `*` | zero or more characters |
| `+` | one or more characters |
| `\?`, `\*`, `\+`, `\\` | the literal char |

Greediness example: pattern `+-+` against `a-b-c` captures `{1}=a-b`, `{2}=c`.

### Filters (used with `select`)

| Filter | Form | Example |
|---|---|---|
| `folder:` | path | `folder:/photos`  `folder:archive/2024` |
| `type:` | mime prefix | `type:image`, `type:video` |
| `uploaded:` | date or `yyyy-*` | `uploaded:2024-03-*` |
| `taken:` | date or `yyyy-*` | `taken:2024-03` |
| `size:` | `[op]N[unit]` | `size:>10mb`, `size:<=500kb`, `size:1gb` |
| `uploaded_by:` | username | `uploaded_by:alice` |

Size operators: `>`, `<`, `>=`, `<=`, `=` (default `=`). Units: `b`, `kb`, `mb`, `gb`.

Without a `folder:` filter, `select` is scoped to the current cwd.

---

## Rename pattern

Used by `rename`, applied per file.

| Token | Meaning |
|---|---|
| `{n}` | 1-based batch index |
| `{n:0K}` | zero-padded batch index, K digits (`{n:03}` → `001`) |
| `{N}` | the Nth capture from the active select pattern (1-based) |
| `\x` | literal x |

Guard: renaming N>1 files with a fully static pattern would create N duplicate
names — the parser rejects it. Add `{n}` or a `{N}` capture ref.

---

## Examples

```bash
# Browse
ls
cd photos/2024
ls /

# Find and move all PNGs uploaded in March 2024
select *.png type:image uploaded:2024-03-*
move /archive/2024-03

# Find big videos and trash them
select * type:video size:>500mb
delete

# Capture-based rename:
#   pattern '*-IMG-+.jpg' captures filename-prefix and the number,
#   then re-emits them in a different shape.
select *-IMG-+.jpg
rename {1}_{2}.jpg

# Batch-index zero-padded rename
select *.png
rename photo_{n:04}.png
# → photo_0001.png, photo_0002.png, …

# Inspect one file
info /photos/2024/sunset.png

# Drop the active selection without doing anything
deselect
```

---

## Permissions

The route runs through `authenticate` + `isMember`, then per-command RBAC:

| Command | Required role |
|---|---|
| `ls`, `cd`, `select`, `info` | any member |
| `move`, `copy`, `delete`, `rename` | `contributor`, `moderator`, `admin` |

Viewers can browse and select but can't mutate. The server returns
`{ ok: false, error: "'move' requires role contributor/moderator/admin" }`
on a permission failure — no rows touched.

---

## State model

The terminal is **stateless server-side**. The browser holds:

- `cwdFolderId` — current folder (`null` = space root)
- `cwdLabel` — display path, e.g. `/photos/2024`
- `selection` — `{ id, displayName, captures }[]` from the last `select`
- `lastPattern` / `lastFilters` — for rename context

Persistence:

- `cwdFolderId`, `cwdLabel`, `selection`, `lastPattern`, `lastFilters` →
  **`sessionStorage`** (survives panel close/reopen, lost on full reload)
- Command history → **`localStorage`** (survives reloads, ↑/↓ replays)

On every submit the client POSTs the full state alongside the command line.
The server returns the new state, which replaces the local copy.

> Selection can become stale if other users mutate the space between your
> `select` and your action. The server only operates on rows that are still
> present in *this* space and not trashed/deleted, so a stale selection is a
> no-op or partial-op, never a corruption.

---

## Architecture

```
┌─────────────────────────┐
│  SpaceExplorer toolbar  │      [terminal toggle button]
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│  SpaceTerminal          │  ← own state, sessionStorage + localStorage
│  (bottom-docked panel)  │
└────────────┬────────────┘
             │  POST /spaces/:spaceId/cmd
             │  { line, cwdFolderId, selection,
             │    lastPattern, lastFilters }
             ▼
┌─────────────────────────┐
│  spaceCommand route     │  authenticate + isMember + body validation
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│  executeCommandLine()   │  re-parses `line` (single source of truth)
│  in commandExecutor.ts  │  RBAC check, then dispatches to a handler
└────────────┬────────────┘
             ▼
        Postgres (in withTransaction)
        — recursive CTE resolves paths to folder_id
        — RETURNING photo_id, display_name on writes
             │
             ▼
{ ok, outputLines: string[],
  state: { cwdFolderId, selection, pattern, filters },
  mutated: boolean }
             │
             ▼
        Transcript renders;
        if mutated, explorer grid auto-refreshes
```

### Why the parser is in two places

`backend/src/command_parser.ts` is the **security boundary** — it always
re-parses the raw `line` before any SQL runs. A hand-crafted JSON payload to
the route can't sneak past it.

`frontend/src/commandParser.ts` is a **UX mirror** — used to flag syntax
errors inline as the user types, before submit. Keep the two files in sync;
the frontend copy carries a header comment to that effect.

### Path resolution SQL

Every command that touches a folder shares one recursive-CTE pattern:

```sql
WITH RECURSIVE
  up_walk AS (...)        -- walk up `..` count from cwd
  origin  AS (...)        -- the folder we start descending from
  folder_input AS (...)   -- segments[] with ordinality
  down_walk AS (...)      -- walk through each segment, joining space_folders
  resolved_folder AS (
    SELECT folder_id FROM down_walk
     WHERE depth = (SELECT count(*) FROM folder_input)
  )
```

`resolved_folder.folder_id` is `NULL` for the space root and an integer for any
nested folder. Empty result set means the path didn't resolve — actions then
no-op via `CROSS JOIN resolved_folder`.

---

## Limits

| What | Cap | Where |
|---|---|---|
| Command line length | 4 000 chars | route body validation |
| Selection size | 5 000 entries | route body validation |
| `select` LIMIT | 500 rows | `execSelect` query |
| Path segment length | 255 chars | parser |
| Compiled regex length | 8 000 chars | route body validation (ReDoS guard) |
| Transcript ring buffer | 500 lines | client (oldest dropped) |
| Command history | 200 entries | client (`localStorage`) |

---

## Files

| Path | Purpose |
|---|---|
| `backend/src/command_parser.ts` | Pure parser (line → `ParsedCommand`). Authoritative copy. |
| `backend/src/commandExecutor.ts` | Dispatches a `ParsedCommand` to SQL inside a transaction. |
| `backend/src/routes/spaceCommand.ts` | `POST /spaces/:spaceId/cmd` route. |
| `backend/src/routes/spaces.ts` | Mounts the sub-router. |
| `backend/src/repl.ts` | Local debug REPL — prints SQL without running it. |
| `frontend/src/commandParser.ts` | Mirror of the backend parser for inline validation. |
| `frontend/src/Api.ts` | `runSpaceCommand` axios wrapper. |
| `frontend/src/components/SpaceView/SpaceTerminal.tsx` | The panel. |
| `frontend/src/components/SpaceView/SpaceExplorer.tsx` | Toolbar toggle + grid refresh on `mutated`. |
| `frontend/src/components/SpaceView/Icons.tsx` | `IconTerminal`, `IconClose`. |
| `frontend/src/index.css` | `.space-terminal*`, `.explorer-toolbar__icon-btn--disabled`, `.space-explorer__toast`. |

---

## Adding a new command

1. **Parser** — extend `CommandName`, `VALID_COMMANDS`, `ParsedCommand`, and the `builders` table in `backend/src/command_parser.ts`. Mirror the change in `frontend/src/commandParser.ts`.
2. **Executor** — add an `execX(client, ctx, …)` handler in `backend/src/commandExecutor.ts` and wire it into the `switch` in `executeCommandLine`. Use `folderResolverCte()` for any folder-path arg. Return `{ outputLines, state, mutated }`.
3. **RBAC** — add an entry to `COMMAND_ROLES` in the executor.
4. **Help text** — update `HELP_TEXT` in `frontend/src/components/SpaceView/SpaceTerminal.tsx`.
5. **(Maybe)** — if it's purely cosmetic / state-only and needs no SQL, register it in `runLocal()` inside `SpaceTerminal.tsx` so it short-circuits the round trip (like `clear`, `help`, `deselect`).
