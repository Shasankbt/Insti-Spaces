// ============================================================================
//  repl.ts
//  ---------------------------------------------------------------------------
//  Interactive shell for testing parser.ts.
//
//  Reads commands from stdin, parses them, and prints the SQL + parameters
//  that the backend would send to Postgres. No actual DB connection.
//
//  Run:    npx tsx repl.ts
//  Quit:   .exit  or  Ctrl-D
// ============================================================================

import * as readline from "readline";
import {
  parseSafe,
  renderRename,
  type ParsedCommand,
  type CompiledSelectPattern,
  type SelectFilters,
  type ParsedPath,
} from "./command_parser";

// ─── Mock session state ─────────────────────────────────────────────────────

interface SelectionEntry {
  id: string;            // pretend UUID
  displayName: string;
  captures: string[];    // single ordered list, regardless of wildcard type
}

interface Session {
  userId: number;
  spaceId: number;
  cwdFolderId: number | null;   // null = space root; updated by `cd`
  cwdLabel: string;             // display-only breadcrumb
  selection: SelectionEntry[] | null;
  lastSelectPattern: CompiledSelectPattern | null;
}

const session: Session = {
  userId: 1,
  spaceId: 42,
  cwdFolderId: null,
  cwdLabel: "/",
  selection: null,
  lastSelectPattern: null,
};

/** SQL inputs needed by the recursive folder resolver. */
interface ResolverInputs {
  startId: number | null;
  upCount: number;
  segments: string[];
}

function resolverInputs(path: ParsedPath): ResolverInputs {
  return {
    startId: path.isAbsolute ? null : session.cwdFolderId,
    upCount: path.upCount,
    segments: path.segments,
  };
}

/**
 * Builds the recursive CTE chain that resolves a ParsedPath to a single
 * `resolved_folder(folder_id)` row (folder_id is NULL if path points at the
 * space root). Param slots: startId, upCount, segments[], spaceId.
 *
 * If the path doesn't resolve, `resolved_folder` is empty — callers should
 * either CROSS JOIN against it (so an empty resolution skips the operation)
 * or check `EXISTS (SELECT 1 FROM resolved_folder)` explicitly.
 */
function folderResolverCte(
  startSlot: number,
  upSlot: number,
  segsSlot: number,
  spaceSlot: number,
): string {
  return `up_walk AS (
  SELECT 0 AS step, $${startSlot}::int AS folder_id
  UNION ALL
  SELECT u.step + 1, sf.parent_id
    FROM up_walk u
    LEFT JOIN space_folders sf ON sf.id = u.folder_id
   WHERE u.step < $${upSlot}
),
origin AS (
  SELECT folder_id FROM up_walk WHERE step = $${upSlot}
),
folder_input AS (
  SELECT seg, ord
    FROM unnest($${segsSlot}::text[]) WITH ORDINALITY AS t(seg, ord)
),
down_walk AS (
  SELECT 0::bigint AS depth, folder_id FROM origin
  UNION ALL
  SELECT d.depth + 1, sf.id
    FROM down_walk d
    JOIN folder_input fi ON fi.ord = d.depth + 1
    JOIN space_folders sf
      ON sf.space_id = $${spaceSlot}
     AND ((d.folder_id IS NULL AND sf.parent_id IS NULL)
       OR sf.parent_id = d.folder_id)
     AND sf.name = fi.seg
     AND sf.deleted = false
     AND sf.trashed_at IS NULL
),
resolved_folder AS (
  SELECT folder_id FROM down_walk
   WHERE depth = (SELECT count(*) FROM folder_input)
)`;
}

/** Cosmetic prompt-only path bookkeeping. */
function updateLabel(currentLabel: string, path: ParsedPath): string {
  if (path.isAbsolute) {
    return "/" + path.segments.join("/");
  }
  const stack = currentLabel.split("/").filter(Boolean);
  for (let i = 0; i < path.upCount; i++) stack.pop();
  for (const seg of path.segments) stack.push(seg);
  return "/" + stack.join("/");
}

// ─── ANSI colors (cosmetic) ─────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  bold:   "\x1b[1m",
};

const ok    = (s: string) => `${C.green}✓${C.reset} ${s}`;
const err   = (s: string) => `${C.red}✗${C.reset} ${s}`;
const warn  = (s: string) => `${C.yellow}⚠${C.reset} ${s}`;
const info  = (s: string) => `${C.cyan}ℹ${C.reset} ${s}`;
const sql   = (q: string, p: unknown[]) =>
  `${C.dim}── SQL ─────────${C.reset}\n${q.trim()}\n${C.dim}── params ──────${C.reset}\n${formatParams(p)}\n${C.dim}────────────────${C.reset}`;

function formatParams(params: unknown[]): string {
  return params.map((p, i) => `  $${i + 1} = ${JSON.stringify(p)}`).join("\n");
}

// ─── SQL builders ───────────────────────────────────────────────────────────

function buildLs(path: ParsedPath | undefined): { query: string; params: unknown[] } {
  // Default: list cwd. Empty path arg is canonicalized to "current cwd".
  const r = resolverInputs(path ?? { raw: ".", segments: [], isAbsolute: false, upCount: 0 });
  // params: $1=startId, $2=upCount, $3=segments[], $4=spaceId
  return {
    query: `
WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
SELECT 'folder' AS kind, sf.id::text AS id, sf.name, NULL::bigint AS size_bytes, sf.updated_at
  FROM space_folders sf
  JOIN resolved_folder rf
    ON ((rf.folder_id IS NULL AND sf.parent_id IS NULL)
     OR sf.parent_id = rf.folder_id)
 WHERE sf.space_id = $4
   AND sf.deleted = false
   AND sf.trashed_at IS NULL
UNION ALL
SELECT 'file' AS kind, si.photo_id::text AS id, si.display_name AS name, si.size_bytes, si.updated_at
  FROM space_items si
  JOIN resolved_folder rf
    ON ((rf.folder_id IS NULL AND si.folder_id IS NULL)
     OR si.folder_id = rf.folder_id)
 WHERE si.space_id = $4
   AND si.deleted = false
   AND si.trashed_at IS NULL
 ORDER BY 1 DESC, 3 ASC;`,
    params: [r.startId, r.upCount, r.segments, session.spaceId],
  };
}

function buildCd(path: ParsedPath): { query: string; params: unknown[] } {
  const r = resolverInputs(path);
  // Returns one row if the path is valid (folder_id may be NULL = root),
  // zero rows otherwise. Frontend reads `folder_id` to know where it landed.
  return {
    query: `
WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
SELECT rf.folder_id,
       sf.name AS folder_name,
       sf.parent_id
  FROM resolved_folder rf
  LEFT JOIN space_folders sf
    ON sf.id = rf.folder_id
   AND sf.deleted = false
   AND sf.trashed_at IS NULL
 WHERE sf.id IS NOT NULL OR rf.folder_id IS NULL;`,
    params: [r.startId, r.upCount, r.segments, session.spaceId],
  };
}

function buildSelect(
  pattern: CompiledSelectPattern,
  filters: SelectFilters,
): { query: string; params: unknown[] } {
  // Base params: $1=spaceId, $2=sqlLike, $3=regex
  const params: unknown[] = [session.spaceId, pattern.sqlLike, pattern.regex];
  const where: string[] = [
    "si.space_id = $1",
    "si.deleted = false",
    "si.trashed_at IS NULL",
    "si.display_name ILIKE $2",
    "regexp_match(si.display_name, $3) IS NOT NULL",
  ];

  // The path-resolver CTE is only emitted if the user supplied folder:.
  let cteSql = "";
  if (filters.folder !== undefined) {
    const r = resolverInputs(filters.folder);
    const startSlot = params.length + 1;
    params.push(r.startId, r.upCount, r.segments);
    // ($1 already = spaceId — reuse it as the spaceSlot)
    cteSql = `WITH RECURSIVE\n${folderResolverCte(startSlot, startSlot + 1, startSlot + 2, 1)}\n`;
    where.push(`EXISTS (SELECT 1 FROM resolved_folder)`);
    where.push(`((SELECT folder_id FROM resolved_folder) IS NULL AND si.folder_id IS NULL
              OR si.folder_id = (SELECT folder_id FROM resolved_folder))`);
  }
  if (filters.type !== undefined) {
    params.push(filters.type + "/%");
    where.push(`si.mime_type ILIKE $${params.length}`);
  }
  if (filters.uploaded !== undefined) {
    params.push(filters.uploaded.replace(/\*/g, "%"));
    where.push(`to_char(si.uploaded_at, 'YYYY-MM-DD') ILIKE $${params.length}`);
  }
  if (filters.taken !== undefined) {
    params.push(filters.taken.replace(/\*/g, "%"));
    where.push(`to_char(si.captured_at, 'YYYY-MM-DD') ILIKE $${params.length}`);
  }
  if (filters.size !== undefined) {
    params.push(filters.size.bytes);
    where.push(`si.size_bytes ${filters.size.op} $${params.length}`);
  }
  if (filters.uploaded_by !== undefined) {
    params.push(filters.uploaded_by);
    where.push(`si.uploader_id = (SELECT id FROM users WHERE username = $${params.length})`);
  }

  return {
    query: `
${cteSql}SELECT si.photo_id, si.display_name,
       regexp_match(si.display_name, $3) AS captures
  FROM space_items si
 WHERE ${where.join("\n   AND ")}
 ORDER BY si.uploaded_at DESC;`,
    params,
  };
}

function buildMove(destPath: ParsedPath, ids: string[]): { query: string; params: unknown[] } {
  // params: $1=startId, $2=upCount, $3=segments[], $4=spaceId, $5=ids[], $6=userId
  const r = resolverInputs(destPath);
  return {
    query: `
WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
UPDATE space_items si
   SET folder_id = rf.folder_id,
       updated_at = NOW()
  FROM resolved_folder rf
 WHERE si.space_id = $4
   AND si.photo_id = ANY($5::uuid[])
   AND si.deleted = false
   AND si.trashed_at IS NULL
   AND EXISTS (
     SELECT 1 FROM following
      WHERE userid = $6 AND spaceid = $4
        AND deleted = false
        AND role IN ('admin', 'moderator', 'contributor')
   )
RETURNING si.photo_id, si.display_name, rf.folder_id AS new_folder_id;`,
    params: [r.startId, r.upCount, r.segments, session.spaceId, ids, session.userId],
  };
}

function buildCopy(destPath: ParsedPath, ids: string[]): { query: string; params: unknown[] } {
  const r = resolverInputs(destPath);
  return {
    query: `
WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
INSERT INTO space_items (
  space_id, uploader_id, folder_id, file_path, thumbnail_path,
  content_hash, perceptual_hash, mime_type, size_bytes,
  display_name, captured_at
)
SELECT si.space_id, $6, rf.folder_id, si.file_path, si.thumbnail_path,
       si.content_hash, si.perceptual_hash, si.mime_type, si.size_bytes,
       si.display_name, si.captured_at
  FROM space_items si
  CROSS JOIN resolved_folder rf
 WHERE si.space_id = $4
   AND si.photo_id = ANY($5::uuid[])
   AND si.deleted = false
   AND si.trashed_at IS NULL
   AND EXISTS (
     SELECT 1 FROM following
      WHERE userid = $6 AND spaceid = $4
        AND deleted = false
        AND role IN ('admin', 'moderator', 'contributor')
   )
RETURNING photo_id, display_name, folder_id AS new_folder_id;`,
    params: [r.startId, r.upCount, r.segments, session.spaceId, ids, session.userId],
  };
}

function buildDelete(ids: string[]): { query: string; params: unknown[] } {
  return {
    query: `
UPDATE space_items
   SET trashed_at = NOW(),
       updated_at = NOW()
 WHERE space_id = $1
   AND photo_id = ANY($2::uuid[])
   AND trashed_at IS NULL
   AND deleted = false
   AND EXISTS (
     SELECT 1 FROM following
      WHERE userid = $3 AND spaceid = $1
        AND deleted = false
        AND role IN ('admin', 'moderator', 'contributor')
   )
RETURNING photo_id, display_name;`,
    params: [session.spaceId, ids, session.userId],
  };
}

function buildRenameOne(id: string, newName: string): { query: string; params: unknown[] } {
  return {
    query: `
UPDATE space_items
   SET display_name = $3,
       updated_at = NOW()
 WHERE space_id = $1
   AND photo_id = $2
   AND deleted = false
   AND trashed_at IS NULL
RETURNING photo_id, display_name;`,
    params: [session.spaceId, id, newName],
  };
}

function buildInfo(filePath: ParsedPath): { query: string; params: unknown[] } {
  // The last segment is the filename; everything before it is the folder path.
  // Parser already enforced segments.length >= 1.
  const fileName = filePath.segments[filePath.segments.length - 1];
  const folderPath: ParsedPath = {
    raw: filePath.raw,
    segments: filePath.segments.slice(0, -1),
    isAbsolute: filePath.isAbsolute,
    upCount: filePath.upCount,
  };
  const r = resolverInputs(folderPath);
  // params: $1=startId, $2=upCount, $3=segments[], $4=spaceId, $5=fileName
  return {
    query: `
WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
SELECT si.photo_id, si.display_name, si.mime_type, si.size_bytes,
       si.captured_at, si.uploaded_at, si.updated_at,
       si.file_path, si.thumbnail_path,
       (SELECT username FROM users WHERE id = si.uploader_id) AS uploader
  FROM space_items si
  JOIN resolved_folder rf
    ON ((rf.folder_id IS NULL AND si.folder_id IS NULL)
     OR si.folder_id = rf.folder_id)
 WHERE si.space_id = $4
   AND si.display_name = $5
   AND si.deleted = false
   AND si.trashed_at IS NULL
 LIMIT 1;`,
    params: [r.startId, r.upCount, r.segments, session.spaceId, fileName],
  };
}

// ─── Mock data for testing rename rendering ─────────────────────────────────

function mockSelectionFor(pattern: CompiledSelectPattern): SelectionEntry[] {
  const fixtures: Record<string, SelectionEntry[]> = {
    "*.png": [
      { id: "11111111-1111-1111-1111-111111111111", displayName: "vacation.png", captures: ["vacation"] },
      { id: "22222222-2222-2222-2222-222222222222", displayName: "beach.png",    captures: ["beach"] },
      { id: "33333333-3333-3333-3333-333333333333", displayName: "sunset.png",   captures: ["sunset"] },
    ],
    "IMG_+-?.png": [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", displayName: "IMG_vacation-3.png", captures: ["vacation", "3"] },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", displayName: "IMG_beach-7.png",    captures: ["beach",    "7"] },
    ],
    "+-+.png": [
      { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", displayName: "vacation-2024.png",   captures: ["vacation",       "2024"] },
      { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", displayName: "beach-summer-2023.png", captures: ["beach-summer", "2023"] },
    ],
  };
  if (fixtures[pattern.raw]) return fixtures[pattern.raw];
  return [
    { id: "00000000-0000-0000-0000-000000000001", displayName: "file_one", captures: Array(pattern.captureCount).fill("X") },
    { id: "00000000-0000-0000-0000-000000000002", displayName: "file_two", captures: Array(pattern.captureCount).fill("Y") },
  ];
}

// ─── Command dispatcher ─────────────────────────────────────────────────────

function dispatch(cmd: ParsedCommand): void {
  switch (cmd.cmd) {
    case "ls": {
      const { query, params } = buildLs(cmd.path);
      console.log(sql(query, params));
      break;
    }

    case "cd": {
      const { query, params } = buildCd(cmd.path);
      console.log(sql(query, params));
      // The real backend reads `folder_id` + `folder_name` from the row and
      // ships it to the frontend so the explorer can mount the new cwd. Here
      // we just reflect the parsed intent for prompt feedback.
      session.cwdLabel = updateLabel(session.cwdLabel, cmd.path);
      console.log(info(`cwd → ${session.cwdLabel}  (executor returns folder_id for frontend nav)`));
      break;
    }

    case "select": {
      const { query, params } = buildSelect(cmd.pattern, cmd.filters);
      console.log(sql(query, params));
      const mock = mockSelectionFor(cmd.pattern);
      session.selection = mock;
      session.lastSelectPattern = cmd.pattern;
      console.log(ok(`Found ${mock.length} files (mocked).`));
      // Show captures inline so users see the greedy split.
      if (cmd.pattern.captureCount > 0) {
        for (const m of mock) {
          const caps = m.captures.map((c, i) => `${C.dim}{${i + 1}}=${C.reset}${c}`).join("  ");
          console.log(`  ${m.displayName.padEnd(28)} ${caps}`);
        }
      } else {
        console.log(C.dim + "  preview: " + mock.map(m => m.displayName).join(", ") + C.reset);
      }
      break;
    }

    case "move": {
      if (!session.selection?.length) {
        console.log(err("Nothing selected. Run 'select <pattern>' first."));
        return;
      }
      const ids = session.selection.map(s => s.id);
      const { query, params } = buildMove(cmd.destination, ids);
      console.log(sql(query, params));
      break;
    }

    case "copy": {
      if (!session.selection?.length) {
        console.log(err("Nothing selected. Run 'select <pattern>' first."));
        return;
      }
      const ids = session.selection.map(s => s.id);
      const { query, params } = buildCopy(cmd.destination, ids);
      console.log(sql(query, params));
      break;
    }

    case "delete": {
      if (!session.selection?.length) {
        console.log(err("Nothing selected. Run 'select <pattern>' first."));
        return;
      }
      const ids = session.selection.map(s => s.id);
      console.log(warn(`This will trash ${ids.length} files.`));
      const { query, params } = buildDelete(ids);
      console.log(sql(query, params));
      break;
    }

    case "rename": {
      if (!session.selection?.length) {
        console.log(err("Nothing selected. Run 'select <pattern>' first."));
        return;
      }
      const sel = session.selection;
      // Semantic checks the parser couldn't do.
      if (sel.length > 1 && !cmd.pattern.hasBatchIndex && cmd.pattern.maxCaptureRef === 0) {
        console.log(err(
          `Renaming ${sel.length} files with a static pattern would create duplicate names. ` +
          `Add {n} or {N} (capture ref) to differentiate.`
        ));
        return;
      }
      for (const f of sel) {
        if (f.captures.length < cmd.pattern.maxCaptureRef) {
          console.log(err(
            `{${cmd.pattern.maxCaptureRef}} referenced but file "${f.displayName}" ` +
            `has only ${f.captures.length} captures.`
          ));
          return;
        }
      }
      console.log(info(`Rendering ${sel.length} new names:`));
      for (let i = 0; i < sel.length; i++) {
        const f = sel[i];
        const newName = renderRename(cmd.pattern, i + 1, f.captures);
        console.log(`  ${C.dim}${f.displayName.padEnd(28)}${C.reset} → ${C.green}${newName}${C.reset}`);
        const { query, params } = buildRenameOne(f.id, newName);
        console.log(sql(query, params));
      }
      break;
    }

    case "info": {
      const { query, params } = buildInfo(cmd.path);
      console.log(sql(query, params));
      break;
    }

    case "deselect": {
      session.selection = null;
      session.lastSelectPattern = null;
      console.log(ok("Selection cleared."));
      break;
    }

    case "clear": {
      console.clear();
      break;
    }

    case "help": {
      console.log(`
${C.bold}Commands${C.reset}
  ls [path]                    list contents (defaults to cwd)
  cd [path]                    change cwd; bare 'cd' jumps to / (space root)
  select <pattern> [filters]   match files by name + filters
  move <destination-path>      move current selection
  copy <destination-path>      copy current selection
  delete                       trash current selection
  rename <pattern>             rename current selection
  info <file-path>             show file metadata
  deselect                     clear current selection
  clear                        clear screen
  help                         this message

${C.bold}Path syntax${C.reset}
  a/b/c       relative path (resolved against cwd)
  /a/b        absolute path (rooted at the space)
  ..          parent folder      .   current folder
  \\/          literal slash inside a folder name

${C.bold}Pattern syntax (select)${C.reset}
  ?           match exactly one char    (capturing)
  *           match zero or more chars  (capturing)
  +           match one or more chars   (capturing)
  \\x          literal x

${C.bold}Pattern syntax (rename)${C.reset}
  {n}         1-based batch index
  {n:0K}      zero-padded batch index, K digits
  {N}         Nth capture from select (1-based, source order)
  \\x          literal x

${C.bold}Filters (select)${C.reset}
  folder:PATH      type:image       uploaded:2024-*
  taken:2024-03    size:>10mb       uploaded_by:USER

${C.bold}Note${C.reset}
  cd returns folder_id (frontend nav). Action commands (move, copy,
  delete, rename) RETURN photo_id + display_name of every row touched.
  Wildcards are greedy and numbered left-to-right. Pattern '+-+' against
  'a-b-c' captures {1}='a-b', {2}='c'.
`);
      break;
    }
  }
}

// ─── Prompt / loop ──────────────────────────────────────────────────────────

function promptString(): string {
  const tag = session.selection?.length
    ? `${C.yellow}[${session.selection.length} selected]${C.reset} `
    : "";
  return `${tag}${C.cyan}${session.cwdLabel}${C.reset} ${C.blue}>${C.reset} `;
}

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  prompt: promptString(),
});

console.log(C.bold + "Terminal REPL — prints SQL, no DB connection." + C.reset);
console.log(C.dim + "Type 'help' for commands, '.exit' or Ctrl-D to quit." + C.reset);
console.log();
rl.prompt();

rl.on("line", (line) => {
  const input = line.trim();
  if (input === ".exit" || input === ".quit") { rl.close(); return; }
  if (input === "") { rl.prompt(); return; }

  const result = parseSafe(input);
  if (!result.ok) {
    console.log(err(result.error));
  } else {
    try {
      dispatch(result.value);
    } catch (e) {
      console.log(err(e instanceof Error ? e.message : String(e)));
    }
  }
  console.log();
  rl.setPrompt(promptString());
  rl.prompt();
});

rl.on("close", () => {
  console.log(C.dim + "\nbye." + C.reset);
  process.exit(0);
});