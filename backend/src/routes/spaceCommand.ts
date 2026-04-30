// ============================================================================
//  spaceCommand.ts — POST /spaces/:spaceId/cmd
//  ---------------------------------------------------------------------------
//  Stateless terminal endpoint. The client carries cwd / selection /
//  last-pattern / last-filters; the server re-parses the line, runs SQL in
//  a transaction, and returns the new state plus terminal output lines.
// ============================================================================

import { Router } from 'express';
import { authenticate, isMember } from '../middleware';
import { withTransaction } from '../db/pool';
import { executeCommandLine, type ExecContext, type SelectionEntry } from '../commandExecutor';
import type { CompiledSelectPattern, SelectFilters } from '../command_parser';
import { parseSpaceId } from './spacesHelpers';

const router = Router({ mergeParams: true });

// ─── Body validation ────────────────────────────────────────────────────────

const MAX_LINE_LEN = 4_000;
const MAX_SELECTION = 5_000;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function parseSelection(raw: unknown): SelectionEntry[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_SELECTION) return null;

  const out: SelectionEntry[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== 'object') return null;
    const obj = e as Record<string, unknown>;
    if (typeof obj.id !== 'string' || typeof obj.displayName !== 'string') return null;
    if (!isStringArray(obj.captures)) return null;
    out.push({ id: obj.id, displayName: obj.displayName, captures: obj.captures });
  }
  return out;
}

function parsePattern(raw: unknown): CompiledSelectPattern | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.raw !== 'string' ||
    typeof obj.sqlLike !== 'string' ||
    typeof obj.regex !== 'string' ||
    typeof obj.captureCount !== 'number'
  ) return null;
  // Bound the regex to keep ReDoS attempts from a malicious client at bay.
  if (obj.regex.length > 8_000) return null;
  return {
    raw: obj.raw,
    sqlLike: obj.sqlLike,
    regex: obj.regex,
    captureCount: obj.captureCount,
  };
}

function parseFiltersFromBody(raw: unknown): SelectFilters | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return null;
  // Trust the shape — `executeCommandLine` re-parses the command line itself,
  // so these stored filters are only used for state-display purposes.
  return raw as SelectFilters;
}

// ─── Route ──────────────────────────────────────────────────────────────────

router.post('/cmd', authenticate, isMember, async (req, res) => {
  const spaceId = parseSpaceId(req);
  if (!spaceId) {
    res.status(400).json({ ok: false, error: 'invalid spaceId' });
    return;
  }

  const body = req.body as {
    line?: unknown;
    cwdFolderId?: unknown;
    selection?: unknown;
    lastPattern?: unknown;
    lastFilters?: unknown;
  };

  if (typeof body.line !== 'string') {
    res.status(400).json({ ok: false, error: 'line is required' });
    return;
  }
  if (body.line.length > MAX_LINE_LEN) {
    res.status(400).json({ ok: false, error: `line exceeds ${MAX_LINE_LEN} chars` });
    return;
  }

  let cwdFolderId: number | null = null;
  if (body.cwdFolderId !== undefined && body.cwdFolderId !== null) {
    const n = Number(body.cwdFolderId);
    if (!Number.isInteger(n)) {
      res.status(400).json({ ok: false, error: 'cwdFolderId must be int or null' });
      return;
    }
    cwdFolderId = n;
  }

  const selection = parseSelection(body.selection);
  if (selection === null) {
    res.status(400).json({ ok: false, error: 'invalid selection payload' });
    return;
  }
  const lastPattern = parsePattern(body.lastPattern);
  const lastFilters = parseFiltersFromBody(body.lastFilters);

  const ctx: ExecContext = {
    spaceId,
    userId: req.user.id,
    role: req.member.role,
    cwdFolderId,
    selection,
    lastPattern,
    lastFilters,
  };

  try {
    const result = await withTransaction(async (client) => executeCommandLine(client, body.line as string, ctx));
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'cmd execution failed';
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
