// ============================================================================
//  commandExecutor.ts
//  ---------------------------------------------------------------------------
//  Runs ParsedCommand objects against the database. The terminal route in
//  routes/spaceCommand.ts wraps this; the REPL in repl.ts is a separate
//  printer that does not share these builders (kept independent on purpose).
//
//  Stateless: the caller passes in (cwdFolderId, selection, lastPattern,
//  lastFilters), this returns the new state + textual output + a `mutated`
//  flag the frontend uses to decide whether to refresh the explorer grid.
// ============================================================================

import type { PoolClient } from 'pg';
import {
  parseSafe,
  renderRename,
  type ParsedCommand,
  type ParsedPath,
  type CompiledSelectPattern,
  type CompiledRenamePattern,
  type SelectFilters,
} from './command_parser';
import type { Role } from './types';

// ─── Public types ───────────────────────────────────────────────────────────

export interface SelectionEntry {
  id: string;             // photo_id (UUID)
  displayName: string;
  captures: string[];
}

export interface ExecContext {
  spaceId: number;
  userId: number;
  role: Role;
  cwdFolderId: number | null;
  selection: SelectionEntry[];
  lastPattern: CompiledSelectPattern | null;
  lastFilters: SelectFilters | null;
}

export interface ExecState {
  cwdFolderId: number | null;
  selection: SelectionEntry[];
  selectionCount: number;
  pattern: { set: boolean; raw: string | null; captureCount: number };
  filters: { set: boolean; summary: string | null };
}

export interface ExecResult {
  ok: true;
  outputLines: string[];
  state: ExecState;
  /** True when the command modified rows; the frontend should refresh the grid. */
  mutated: boolean;
}

export type CommandResponse = ExecResult | { ok: false; error: string };

// ─── RBAC ───────────────────────────────────────────────────────────────────

const WRITE_ROLES: Role[] = ['contributor', 'moderator', 'admin'];

const COMMAND_ROLES: Record<ParsedCommand['cmd'], Role[] | null> = {
  ls: null, cd: null, select: null, info: null,
  move: WRITE_ROLES, copy: WRITE_ROLES, delete: WRITE_ROLES, rename: WRITE_ROLES,
  clear: null, help: null, deselect: null,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ResolverInputs {
  startId: number | null;
  upCount: number;
  segments: string[];
}

function resolverInputs(path: ParsedPath, cwdFolderId: number | null): ResolverInputs {
  return {
    startId: path.isAbsolute ? null : cwdFolderId,
    upCount: path.upCount,
    segments: path.segments,
  };
}

/** Recursive CTE that produces `resolved_folder(folder_id)` (NULL = space root). */
function folderResolverCte(
  startSlot: number, upSlot: number, segsSlot: number, spaceSlot: number,
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

function summarizeFilters(f: SelectFilters): string {
  const parts: string[] = [];
  if (f.folder)      parts.push(`folder:${f.folder.raw}`);
  if (f.type)        parts.push(`type:${f.type}`);
  if (f.uploaded)    parts.push(`uploaded:${f.uploaded}`);
  if (f.taken)       parts.push(`taken:${f.taken}`);
  if (f.size)        parts.push(`size:${f.size.op}${f.size.bytes}`);
  if (f.uploaded_by) parts.push(`uploaded_by:${f.uploaded_by}`);
  return parts.join(' ');
}

function makeState(
  cwdFolderId: number | null,
  selection: SelectionEntry[],
  pattern: CompiledSelectPattern | null,
  filters: SelectFilters | null,
): ExecState {
  return {
    cwdFolderId,
    selection,
    selectionCount: selection.length,
    pattern: pattern
      ? { set: true, raw: pattern.raw, captureCount: pattern.captureCount }
      : { set: false, raw: null, captureCount: 0 },
    filters: filters && Object.keys(filters).length > 0
      ? { set: true, summary: summarizeFilters(filters) }
      : { set: false, summary: null },
  };
}

function carryState(ctx: ExecContext): ExecState {
  return makeState(ctx.cwdFolderId, ctx.selection, ctx.lastPattern, ctx.lastFilters);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// ─── ls ─────────────────────────────────────────────────────────────────────

async function execLs(client: PoolClient, ctx: ExecContext, path: ParsedPath | undefined): Promise<ExecResult> {
  const target = path ?? { raw: '.', segments: [], isAbsolute: false, upCount: 0 } as ParsedPath;
  const r = resolverInputs(target, ctx.cwdFolderId);

  const { rows } = await client.query<{
    kind: 'folder' | 'file';
    id: string;
    name: string;
    size_bytes: string | null;
    updated_at: Date;
  }>(
    `WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
SELECT 'folder' AS kind, sf.id::text AS id, sf.name, NULL::bigint AS size_bytes, sf.updated_at
  FROM space_folders sf
  JOIN resolved_folder rf
    ON ((rf.folder_id IS NULL AND sf.parent_id IS NULL)
     OR sf.parent_id = rf.folder_id)
 WHERE sf.space_id = $4 AND sf.deleted = false AND sf.trashed_at IS NULL
UNION ALL
SELECT 'file', si.photo_id::text, si.display_name, si.size_bytes, si.updated_at
  FROM space_items si
  JOIN resolved_folder rf
    ON ((rf.folder_id IS NULL AND si.folder_id IS NULL)
     OR si.folder_id = rf.folder_id)
 WHERE si.space_id = $4 AND si.deleted = false AND si.trashed_at IS NULL
 ORDER BY 1 DESC, 3 ASC`,
    [r.startId, r.upCount, r.segments, ctx.spaceId],
  );

  // If the path was provided and resolved nothing AND it wasn't the root, treat as not-found.
  // (root always resolves; depth-0 down_walk seed gives one row with folder_id=null)
  if (path && rows.length === 0) {
    // Not a hard error — empty folder vs not-found both yield 0 rows. Surface a hint.
    // Distinguish by re-running just the resolver.
    const exists = await client.query<{ folder_id: number | null }>(
      `WITH RECURSIVE\n${folderResolverCte(1, 2, 3, 4)}\nSELECT folder_id FROM resolved_folder`,
      [r.startId, r.upCount, r.segments, ctx.spaceId],
    );
    if (exists.rows.length === 0) {
      return { ok: true, outputLines: [`ls: '${path.raw}': no such folder`], state: carryState(ctx), mutated: false };
    }
  }

  const lines = rows.length === 0
    ? ['(empty)']
    : rows.map((row) =>
        row.kind === 'folder'
          ? `d  ${row.name}/`
          : `f  ${row.name.padEnd(40)}  ${formatBytes(Number(row.size_bytes))}`,
      );
  return { ok: true, outputLines: lines, state: carryState(ctx), mutated: false };
}

// ─── cd ─────────────────────────────────────────────────────────────────────

async function execCd(client: PoolClient, ctx: ExecContext, path: ParsedPath): Promise<ExecResult> {
  const r = resolverInputs(path, ctx.cwdFolderId);
  const { rows } = await client.query<{ folder_id: number | null }>(
    `WITH RECURSIVE\n${folderResolverCte(1, 2, 3, 4)}\nSELECT folder_id FROM resolved_folder`,
    [r.startId, r.upCount, r.segments, ctx.spaceId],
  );

  if (rows.length === 0) {
    return { ok: true, outputLines: [`cd: '${path.raw}': no such folder`], state: carryState(ctx), mutated: false };
  }

  const newCwd = rows[0].folder_id;
  return {
    ok: true,
    outputLines: [],   // bare cd is silent like a real shell; the prompt updates
    state: makeState(newCwd, ctx.selection, ctx.lastPattern, ctx.lastFilters),
    mutated: false,
  };
}

// ─── select ─────────────────────────────────────────────────────────────────

async function execSelect(
  client: PoolClient,
  ctx: ExecContext,
  pattern: CompiledSelectPattern,
  filters: SelectFilters,
): Promise<ExecResult> {
  const params: unknown[] = [ctx.spaceId, pattern.sqlLike, pattern.regex];
  const where: string[] = [
    'si.space_id = $1',
    'si.deleted = false',
    'si.trashed_at IS NULL',
    'si.display_name ILIKE $2',
    'regexp_match(si.display_name, $3) IS NOT NULL',
  ];

  let cteSql = '';
  if (filters.folder !== undefined) {
    const r = resolverInputs(filters.folder, ctx.cwdFolderId);
    const startSlot = params.length + 1;
    params.push(r.startId, r.upCount, r.segments);
    cteSql = `WITH RECURSIVE\n${folderResolverCte(startSlot, startSlot + 1, startSlot + 2, 1)}\n`;
    where.push('EXISTS (SELECT 1 FROM resolved_folder)');
    where.push(`((SELECT folder_id FROM resolved_folder) IS NULL AND si.folder_id IS NULL
              OR si.folder_id = (SELECT folder_id FROM resolved_folder))`);
  } else if (ctx.cwdFolderId !== null || filters.folder === undefined) {
    // Default: scope to cwd. If cwd is root, match folder_id IS NULL; else match cwd folder_id.
    if (ctx.cwdFolderId === null) {
      where.push('si.folder_id IS NULL');
    } else {
      params.push(ctx.cwdFolderId);
      where.push(`si.folder_id = $${params.length}`);
    }
  }

  if (filters.type !== undefined) {
    params.push(filters.type + '/%');
    where.push(`si.mime_type ILIKE $${params.length}`);
  }
  if (filters.uploaded !== undefined) {
    params.push(filters.uploaded.replace(/\*/g, '%'));
    where.push(`to_char(si.uploaded_at, 'YYYY-MM-DD') ILIKE $${params.length}`);
  }
  if (filters.taken !== undefined) {
    params.push(filters.taken.replace(/\*/g, '%'));
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

  const { rows } = await client.query<{ photo_id: string; display_name: string; captures: string[] | null }>(
    `${cteSql}SELECT si.photo_id, si.display_name,
       regexp_match(si.display_name, $3) AS captures
  FROM space_items si
 WHERE ${where.join('\n   AND ')}
 ORDER BY si.uploaded_at DESC
 LIMIT 500`,
    params,
  );

  const selection: SelectionEntry[] = rows.map((row) => ({
    id: row.photo_id,
    displayName: row.display_name,
    captures: row.captures ?? [],
  }));

  // Terse — just the count. `ls` is for browsing, `select` is for marking.
  const lines = [`selected ${selection.length} file${selection.length === 1 ? '' : 's'}`];

  return { ok: true, outputLines: lines, state: makeState(ctx.cwdFolderId, selection, pattern, filters), mutated: false };
}

// ─── move / copy / delete ───────────────────────────────────────────────────

async function execMove(client: PoolClient, ctx: ExecContext, dest: ParsedPath): Promise<ExecResult> {
  if (ctx.selection.length === 0) {
    return { ok: true, outputLines: ['nothing selected — run `select <pattern>` first'], state: carryState(ctx), mutated: false };
  }
  const r = resolverInputs(dest, ctx.cwdFolderId);
  const ids = ctx.selection.map((s) => s.id);

  const { rows } = await client.query<{ photo_id: string; display_name: string; new_folder_id: number | null }>(
    `WITH RECURSIVE
${folderResolverCte(1, 2, 3, 4)}
UPDATE space_items si
   SET folder_id = rf.folder_id, updated_at = NOW()
  FROM resolved_folder rf
 WHERE si.space_id = $4
   AND si.photo_id = ANY($5::uuid[])
   AND si.deleted = false
   AND si.trashed_at IS NULL
RETURNING si.photo_id, si.display_name, rf.folder_id AS new_folder_id`,
    [r.startId, r.upCount, r.segments, ctx.spaceId, ids],
  );

  if (rows.length === 0) {
    return { ok: true, outputLines: [`move: '${dest.raw}': no such folder, or selection already gone`], state: carryState(ctx), mutated: false };
  }

  return {
    ok: true,
    outputLines: [
      `moved ${rows.length} file${rows.length === 1 ? '' : 's'} → ${dest.raw}`,
      ...rows.slice(0, 20).map((r) => `  ${r.display_name}`),
      ...(rows.length > 20 ? [`  … and ${rows.length - 20} more`] : []),
    ],
    // Selection cleared — they've been moved.
    state: makeState(ctx.cwdFolderId, [], ctx.lastPattern, ctx.lastFilters),
    mutated: true,
  };
}

async function execCopy(client: PoolClient, ctx: ExecContext, dest: ParsedPath): Promise<ExecResult> {
  if (ctx.selection.length === 0) {
    return { ok: true, outputLines: ['nothing selected — run `select <pattern>` first'], state: carryState(ctx), mutated: false };
  }
  const r = resolverInputs(dest, ctx.cwdFolderId);
  const ids = ctx.selection.map((s) => s.id);

  const { rows } = await client.query<{ photo_id: string; display_name: string }>(
    `WITH RECURSIVE
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
RETURNING photo_id, display_name`,
    [r.startId, r.upCount, r.segments, ctx.spaceId, ids, ctx.userId],
  );

  if (rows.length === 0) {
    return { ok: true, outputLines: [`copy: '${dest.raw}': no such folder, or selection already gone`], state: carryState(ctx), mutated: false };
  }

  return {
    ok: true,
    outputLines: [
      `copied ${rows.length} file${rows.length === 1 ? '' : 's'} → ${dest.raw}`,
      ...rows.slice(0, 20).map((r) => `  ${r.display_name}`),
      ...(rows.length > 20 ? [`  … and ${rows.length - 20} more`] : []),
    ],
    state: carryState(ctx),
    mutated: true,
  };
}

async function execDelete(client: PoolClient, ctx: ExecContext): Promise<ExecResult> {
  if (ctx.selection.length === 0) {
    return { ok: true, outputLines: ['nothing selected — run `select <pattern>` first'], state: carryState(ctx), mutated: false };
  }
  const ids = ctx.selection.map((s) => s.id);

  const { rows } = await client.query<{ photo_id: string; display_name: string }>(
    `UPDATE space_items
        SET trashed_at = NOW(), updated_at = NOW()
      WHERE space_id = $1
        AND photo_id = ANY($2::uuid[])
        AND trashed_at IS NULL
        AND deleted = false
      RETURNING photo_id, display_name`,
    [ctx.spaceId, ids],
  );

  return {
    ok: true,
    outputLines: [
      `trashed ${rows.length} file${rows.length === 1 ? '' : 's'}`,
      ...rows.slice(0, 20).map((r) => `  ${r.display_name}`),
      ...(rows.length > 20 ? [`  … and ${rows.length - 20} more`] : []),
    ],
    state: makeState(ctx.cwdFolderId, [], ctx.lastPattern, ctx.lastFilters),
    mutated: rows.length > 0,
  };
}

// ─── rename ─────────────────────────────────────────────────────────────────

async function execRename(
  client: PoolClient,
  ctx: ExecContext,
  pattern: CompiledRenamePattern,
): Promise<ExecResult> {
  if (ctx.selection.length === 0) {
    return { ok: true, outputLines: ['nothing selected — run `select <pattern>` first'], state: carryState(ctx), mutated: false };
  }
  if (ctx.selection.length > 1 && !pattern.hasBatchIndex && pattern.maxCaptureRef === 0) {
    return {
      ok: false,
      error: `static rename pattern would create ${ctx.selection.length} duplicate names — add {n} or {N}`,
    } as unknown as ExecResult;
  }

  const renamed: { id: string; from: string; to: string }[] = [];
  for (let i = 0; i < ctx.selection.length; i++) {
    const f = ctx.selection[i];
    if (f.captures.length < pattern.maxCaptureRef) {
      return {
        ok: false,
        error: `{${pattern.maxCaptureRef}} referenced but '${f.displayName}' has only ${f.captures.length} captures`,
      } as unknown as ExecResult;
    }
    const newName = renderRename(pattern, i + 1, f.captures);
    if (newName === f.displayName) continue;
    const { rowCount } = await client.query(
      `UPDATE space_items
          SET display_name = $3, updated_at = NOW()
        WHERE space_id = $1
          AND photo_id = $2
          AND deleted = false
          AND trashed_at IS NULL`,
      [ctx.spaceId, f.id, newName],
    );
    if (rowCount && rowCount > 0) {
      renamed.push({ id: f.id, from: f.displayName, to: newName });
    }
  }

  return {
    ok: true,
    outputLines: [
      `renamed ${renamed.length} file${renamed.length === 1 ? '' : 's'}`,
      ...renamed.slice(0, 20).map((r) => `  ${r.from}  →  ${r.to}`),
      ...(renamed.length > 20 ? [`  … and ${renamed.length - 20} more`] : []),
    ],
    // Selection becomes stale (display names changed). Easiest: clear it.
    state: makeState(ctx.cwdFolderId, [], ctx.lastPattern, ctx.lastFilters),
    mutated: renamed.length > 0,
  };
}

// ─── info ───────────────────────────────────────────────────────────────────

async function execInfo(client: PoolClient, ctx: ExecContext, path: ParsedPath): Promise<ExecResult> {
  const fileName = path.segments[path.segments.length - 1];
  const folderPath: ParsedPath = {
    raw: path.raw,
    segments: path.segments.slice(0, -1),
    isAbsolute: path.isAbsolute,
    upCount: path.upCount,
  };
  const r = resolverInputs(folderPath, ctx.cwdFolderId);
  const { rows } = await client.query<{
    photo_id: string;
    display_name: string;
    mime_type: string;
    size_bytes: string;
    captured_at: Date | null;
    uploaded_at: Date;
    uploader: string | null;
  }>(
    `WITH RECURSIVE\n${folderResolverCte(1, 2, 3, 4)}
SELECT si.photo_id, si.display_name, si.mime_type, si.size_bytes::text,
       si.captured_at, si.uploaded_at,
       (SELECT username FROM users WHERE id = si.uploader_id) AS uploader
  FROM space_items si
  JOIN resolved_folder rf
    ON ((rf.folder_id IS NULL AND si.folder_id IS NULL)
     OR si.folder_id = rf.folder_id)
 WHERE si.space_id = $4 AND si.display_name = $5
   AND si.deleted = false AND si.trashed_at IS NULL
 LIMIT 1`,
    [r.startId, r.upCount, r.segments, ctx.spaceId, fileName],
  );

  if (rows.length === 0) {
    return { ok: true, outputLines: [`info: '${path.raw}': not found`], state: carryState(ctx), mutated: false };
  }
  const row = rows[0];
  return {
    ok: true,
    outputLines: [
      `name      ${row.display_name}`,
      `id        ${row.photo_id}`,
      `mime      ${row.mime_type}`,
      `size      ${formatBytes(Number(row.size_bytes))}`,
      `uploaded  ${row.uploaded_at.toISOString()}`,
      ...(row.captured_at ? [`taken     ${row.captured_at.toISOString()}`] : []),
      `uploader  ${row.uploader ?? '?'}`,
    ],
    state: carryState(ctx),
    mutated: false,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

export async function executeCommandLine(
  client: PoolClient,
  line: string,
  ctx: ExecContext,
): Promise<CommandResponse> {
  // Single source of truth: parse on the server even if the client also did,
  // so a hand-crafted JSON payload can't sneak past validation.
  const parsed = parseSafe(line);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const cmd = parsed.value;
  const allowed = COMMAND_ROLES[cmd.cmd];
  if (allowed && !allowed.includes(ctx.role)) {
    return { ok: false, error: `'${cmd.cmd}' requires role ${allowed.join('/')}` };
  }

  switch (cmd.cmd) {
    case 'ls':       return execLs(client, ctx, cmd.path);
    case 'cd':       return execCd(client, ctx, cmd.path);
    case 'select':   return execSelect(client, ctx, cmd.pattern, cmd.filters);
    case 'move':     return execMove(client, ctx, cmd.destination);
    case 'copy':     return execCopy(client, ctx, cmd.destination);
    case 'delete':   return execDelete(client, ctx);
    case 'rename':   return execRename(client, ctx, cmd.pattern);
    case 'info':     return execInfo(client, ctx, cmd.path);
    case 'clear':
    case 'help':
    case 'deselect':
      // Frontend handles these; return current state untouched.
      return { ok: true, outputLines: [], state: carryState(ctx), mutated: false };
  }
}
