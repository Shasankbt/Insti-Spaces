// ============================================================================
//  commandParser.ts (frontend copy)
//  ---------------------------------------------------------------------------
//  Mirror of backend/src/command_parser.ts — keep in sync.
//  The frontend uses this for inline syntax-error feedback before submit.
//  The backend re-parses the raw line on every request, so this file is a
//  pure UX convenience, not the security boundary.
//  ---------------------------------------------------------------------------
//  Pure command parser for the terminal-style file manager.
//
//  Pipeline:
//      raw string  ──►  tokenize  ──►  classify  ──►  validate  ──►  ParsedCommand
//
//  ─── Pattern language (used by `select`) ───
//  Wildcards (all capturing, numbered in source order, all greedy):
//      ?      exactly one character
//      *      zero or more characters
//      +      one or more characters
//      \x     literal x (for matching filenames containing ?, *, +, or \)
//
//  Everything else — including '.', '[', '(', etc. — is literal.
//
//  ─── Path syntax (used by `ls`, `cd`, `move`, `copy`, `info`, `folder:`) ───
//      a/b/c     relative path — resolved against the executor's cwd
//      /a/b      absolute path — rooted at the space root
//      ..        parent folder (rejected if it would escape the absolute root)
//      .         current folder (no-op)
//      \/        literal slash inside a folder/file name
//      \\        literal backslash
//
//  Path segments are size-bounded and reject NULL bytes. Folder names are
//  *only* unique within a parent in the schema, so paths — not bare names —
//  are required for unambiguous, safe folder resolution.
//
//  ─── Rename placeholders (used by `rename`) ───
//      {n}    1-based batch index
//      {n:0K} zero-padded batch index, K digits
//      {N}    Nth capture from the active select (1-based)
//      \x     literal x
//
//  No I/O. No side effects. Safe for both React and Node.
// ============================================================================

// ─── Public types ───────────────────────────────────────────────────────────

export type CommandName =
  | "ls" | "cd" | "select" | "move" | "copy" | "delete"
  | "rename" | "info" | "clear" | "help" | "deselect";

/** A safely-tokenized slash path. */
export interface ParsedPath {
  raw: string;
  /** Canonical segments after resolving '.' and '..' against each other. */
  segments: string[];
  /** Leading '/' present in raw input. */
  isAbsolute: boolean;
  /** Unresolved '..' above the relative origin. Always 0 when isAbsolute. */
  upCount: number;
}

export interface SelectFilters {
  folder?: ParsedPath;
  type?: string;
  uploaded?: string;
  taken?: string;
  size?: SizeFilter;
  uploaded_by?: string;
}

export interface SizeFilter {
  op: ">" | "<" | ">=" | "<=" | "=";
  bytes: number;
}

/** Compiled select pattern: SQL prefilter + regex for capture extraction. */
export interface CompiledSelectPattern {
  raw: string;
  sqlLike: string;        // for ILIKE prefilter (cheap, indexable)
  regex: string;          // anchored, for capture extraction in PG
  captureCount: number;   // total number of captures the regex produces
}

/** Compiled rename pattern: ordered segments concatenated per file. */
export type RenameSegment =
  | { kind: "literal"; text: string }
  | { kind: "batchIndex"; pad: number }   // {n} or {n:0K}
  | { kind: "captureRef"; index: number }; // {N}

export interface CompiledRenamePattern {
  raw: string;
  segments: RenameSegment[];
  hasBatchIndex: boolean;
  maxCaptureRef: number;  // 0 if none
}

export type ParsedCommand =
  | { cmd: "ls"; path?: ParsedPath }
  | { cmd: "cd"; path: ParsedPath }
  | { cmd: "select"; pattern: CompiledSelectPattern; filters: SelectFilters }
  | { cmd: "move"; destination: ParsedPath }
  | { cmd: "copy"; destination: ParsedPath }
  | { cmd: "delete" }
  | { cmd: "rename"; pattern: CompiledRenamePattern }
  | { cmd: "info"; path: ParsedPath }
  | { cmd: "clear" }
  | { cmd: "help" }
  | { cmd: "deselect" };

export type ParseResult =
  | { ok: true; value: ParsedCommand }
  | { ok: false; error: string };

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_COMMANDS: ReadonlySet<CommandName> = new Set([
  "ls", "cd", "select", "move", "copy", "delete",
  "rename", "info", "clear", "help", "deselect",
]);

const VALID_FILTER_KEYS = new Set([
  "folder", "type", "uploaded", "taken", "size", "uploaded_by",
]);

const SIZE_UNITS: Record<string, number> = {
  b: 1, kb: 1_024, mb: 1_024 ** 2, gb: 1_024 ** 3,
};

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\\/]/;
const LIKE_SPECIALS  = /[%_\\]/;

// ─── Path parsing ───────────────────────────────────────────────────────────
//  Folder names in the schema are *only* unique within a parent, so any
//  command that references a folder must take a path, not a bare name. This
//  parser walks the input char-by-char (so '\/' can escape a slash inside a
//  folder name), splits on '/', and resolves '.' / '..' at parse time.
//
//  Hard limits — enforced here so untrusted input can't blow up downstream:
//      • each segment ≤ MAX_PATH_SEGMENT_LEN bytes (matches TEXT column reality)
//      • no NULL bytes anywhere
//      • no empty segments inside the path (//)
//      • '..' may not escape the absolute root

const MAX_PATH_SEGMENT_LEN = 255;

export function parsePath(raw: string): ParsedPath {
  if (raw.length === 0) throw new Error("Empty path");

  let isAbsolute = false;
  let i = 0;
  if (raw[0] === "/") { isAbsolute = true; i = 1; }

  const rawSegments: string[] = [];
  let buf = "";
  let started = false;

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) throw new Error("Trailing backslash in path");
      buf += next;
      started = true;
      i += 2;
      continue;
    }

    if (ch === "/") {
      if (!started) throw new Error("Empty path segment (use \\/ for literal slash)");
      rawSegments.push(buf);
      buf = "";
      started = false;
      i++;
      continue;
    }

    if (ch === "\0") throw new Error("Null byte not allowed in path");
    buf += ch;
    started = true;
    i++;
  }
  if (started) rawSegments.push(buf);

  // Resolve '.' and '..' against accumulated segments.
  const segments: string[] = [];
  let upCount = 0;
  for (const seg of rawSegments) {
    if (seg.length > MAX_PATH_SEGMENT_LEN) {
      throw new Error(`Path segment exceeds ${MAX_PATH_SEGMENT_LEN} chars`);
    }
    if (seg === ".") continue;
    if (seg === "..") {
      if (segments.length > 0) {
        segments.pop();
      } else if (isAbsolute) {
        throw new Error("Cannot traverse above root with '..'");
      } else {
        upCount++;
      }
      continue;
    }
    segments.push(seg);
  }

  return { raw, segments, isAbsolute, upCount };
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────
//  Splits on whitespace; respects double-quoted strings so filenames with
//  spaces survive as a single token.

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let inQuotes = false;

  for (const ch of input.trim()) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && /\s/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ""; }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

// ─── Filter parsing ─────────────────────────────────────────────────────────

function isFilterToken(token: string): boolean {
  return /^[a-z_]+:.+/i.test(token);
}

function parseSizeFilter(raw: string): SizeFilter | null {
  const m = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(raw);
  if (!m) return null;
  const op = (m[1] ?? "=") as SizeFilter["op"];
  const num = parseFloat(m[2]);
  const unit = (m[3] || "b").toLowerCase();
  const mult = SIZE_UNITS[unit];
  if (mult === undefined) return null;
  return { op, bytes: Math.round(num * mult) };
}

function parseFilters(tokens: string[]): { filters: SelectFilters; rest: string[] } {
  const filters: SelectFilters = {};
  const rest: string[] = [];

  for (const tok of tokens) {
    if (!isFilterToken(tok)) { rest.push(tok); continue; }

    const idx = tok.indexOf(":");
    const key = tok.slice(0, idx).toLowerCase();
    const value = tok.slice(idx + 1);

    if (!VALID_FILTER_KEYS.has(key)) { rest.push(tok); continue; }

    switch (key) {
      case "size": {
        const size = parseSizeFilter(value);
        if (!size) throw new Error(`Invalid size filter: "${value}"`);
        filters.size = size;
        break;
      }
      case "folder":
        filters.folder = parsePath(value);
        break;
      case "type":        filters.type = value;        break;
      case "uploaded":    filters.uploaded = value;    break;
      case "taken":       filters.taken = value;       break;
      case "uploaded_by": filters.uploaded_by = value; break;
    }
  }
  return { filters, rest };
}

// ─── Select pattern compiler ────────────────────────────────────────────────
//  Walks the pattern once, emitting SQL LIKE for prefilter and PG regex for
//  capture extraction. All wildcards capture into a single ordered list.

function compileSelectPattern(raw: string): CompiledSelectPattern {
  if (raw.length === 0) throw new Error("Empty select pattern");

  let sqlLike = "";
  let regex = "^";
  let captureCount = 0;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) throw new Error("Trailing backslash in pattern");
      sqlLike += LIKE_SPECIALS.test(next)  ? "\\" + next : next;
      regex   += REGEX_SPECIALS.test(next) ? "\\" + next : next;
      i += 2;
      continue;
    }

    if (ch === "?") {
      // exactly one character
      sqlLike += "_";
      regex   += "(.)";
      captureCount++;
      i++;
      continue;
    }

    if (ch === "*") {
      // zero or more characters
      sqlLike += "%";
      regex   += "(.*)";
      captureCount++;
      i++;
      continue;
    }

    if (ch === "+") {
      // one or more characters
      // SQL LIKE has no "one or more" — '%' allows zero. We over-match in
      // LIKE (cheap prefilter) and rely on the regex to enforce the
      // non-empty constraint exactly.
      sqlLike += "%";
      regex   += "(.+)";
      captureCount++;
      i++;
      continue;
    }

    sqlLike += LIKE_SPECIALS.test(ch)  ? "\\" + ch : ch;
    regex   += REGEX_SPECIALS.test(ch) ? "\\" + ch : ch;
    i++;
  }

  return { raw, sqlLike, regex: regex + "$", captureCount };
}

// ─── Rename pattern compiler ────────────────────────────────────────────────

function parsePlaceholder(inner: string): RenameSegment {
  if (inner === "n") return { kind: "batchIndex", pad: 0 };

  const padMatch = /^n:0(\d+)$/.exec(inner);
  if (padMatch) {
    const pad = parseInt(padMatch[1], 10);
    if (pad < 1 || pad > 9) throw new Error(`Invalid pad width in {n:0${pad}}`);
    return { kind: "batchIndex", pad };
  }

  const refMatch = /^(\d+)$/.exec(inner);
  if (refMatch) {
    const n = parseInt(refMatch[1], 10);
    if (n < 1) throw new Error(`Capture index must be >= 1 in {${n}}`);
    return { kind: "captureRef", index: n };
  }

  throw new Error(
    `Unknown placeholder {${inner}}. Use {n}, {n:0K}, or {N} where N is a capture index.`
  );
}

function compileRenamePattern(raw: string): CompiledRenamePattern {
  if (raw.length === 0) throw new Error("Empty rename pattern");

  const segments: RenameSegment[] = [];
  let literal = "";
  let hasBatchIndex = false;
  let maxCaptureRef = 0;
  let i = 0;

  const flushLiteral = () => {
    if (literal) { segments.push({ kind: "literal", text: literal }); literal = ""; }
  };

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) throw new Error("Trailing backslash in rename pattern");
      literal += next;
      i += 2;
      continue;
    }

    if (ch === "{") {
      const close = raw.indexOf("}", i);
      if (close === -1) throw new Error("Unclosed { in rename pattern");
      flushLiteral();
      const seg = parsePlaceholder(raw.slice(i + 1, close));
      segments.push(seg);
      if      (seg.kind === "batchIndex") hasBatchIndex = true;
      else if (seg.kind === "captureRef") maxCaptureRef = Math.max(maxCaptureRef, seg.index);
      i = close + 1;
      continue;
    }

    if (ch === "}") throw new Error("Unexpected } in rename pattern (use \\} for literal)");

    literal += ch;
    i++;
  }
  flushLiteral();

  return { raw, segments, hasBatchIndex, maxCaptureRef };
}

// ─── Per-command builders ───────────────────────────────────────────────────

const builders: Record<CommandName, (args: string[]) => ParsedCommand> = {
  ls: (args) => {
    if (args.length > 1) throw new Error("ls takes at most one path argument");
    return { cmd: "ls", path: args[0] !== undefined ? parsePath(args[0]) : undefined };
  },

  cd: (args) => {
    if (args.length > 1) throw new Error("cd takes at most one path argument");
    // bare `cd` jumps to the space root, matching shell convention.
    return { cmd: "cd", path: parsePath(args[0] ?? "/") };
  },

  select: (args) => {
    if (args.length === 0) throw new Error("select requires a pattern or filters");
    const { filters, rest } = parseFilters(args);
    if (rest.length > 1) throw new Error(`Unexpected tokens: ${rest.slice(1).join(" ")}`);
    const rawPattern = rest[0] ?? "*";
    return { cmd: "select", pattern: compileSelectPattern(rawPattern), filters };
  },

  move: (args) => {
    if (args.length !== 1) throw new Error("move requires exactly one destination");
    return { cmd: "move", destination: parsePath(args[0]) };
  },

  copy: (args) => {
    if (args.length !== 1) throw new Error("copy requires exactly one destination");
    return { cmd: "copy", destination: parsePath(args[0]) };
  },

  delete: (args) => {
    if (args.length > 0) throw new Error("delete takes no arguments (operates on current selection)");
    return { cmd: "delete" };
  },

  rename: (args) => {
    if (args.length !== 1) throw new Error("rename requires exactly one pattern");
    return { cmd: "rename", pattern: compileRenamePattern(args[0]) };
  },

  info: (args) => {
    if (args.length !== 1) throw new Error("info requires exactly one file path");
    const path = parsePath(args[0]);
    if (path.segments.length === 0) {
      throw new Error("info requires a file name (path cannot be empty / root)");
    }
    return { cmd: "info", path };
  },

  clear:    (args) => { if (args.length) throw new Error("clear takes no arguments");    return { cmd: "clear" }; },
  help:     (args) => { if (args.length) throw new Error("help takes no arguments");     return { cmd: "help" }; },
  deselect: (args) => { if (args.length) throw new Error("deselect takes no arguments"); return { cmd: "deselect" }; },
};

// ─── Core parser ────────────────────────────────────────────────────────────

function parseCommand(input: string): ParsedCommand {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Empty command");

  const head = tokens[0].toLowerCase() as CommandName;
  if (!VALID_COMMANDS.has(head)) {
    throw new Error(`Unknown command: "${tokens[0]}". Type 'help' to see available commands.`);
  }
  return builders[head](tokens.slice(1));
}

// ─── Public string-in / string-out API ──────────────────────────────────────

export function parse(input: string): string {
  try {
    return JSON.stringify({ ok: true, value: parseCommand(input) }, null, 2);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown parse error";
    return JSON.stringify({ ok: false, error }, null, 2);
  }
}

export function parseSafe(input: string): ParseResult {
  try {
    return { ok: true, value: parseCommand(input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown parse error" };
  }
}

// ─── Renderer (executor-side helper) ────────────────────────────────────────
//  Given a compiled rename pattern, the per-file batch index, and the file's
//  ordered captures from select, produce the new filename.
//  Executor is responsible for ensuring captures.length >= maxCaptureRef.

export function renderRename(
  pattern: CompiledRenamePattern,
  batchIndex: number,
  captures: string[],
): string {
  let out = "";
  for (const seg of pattern.segments) {
    switch (seg.kind) {
      case "literal":
        out += seg.text;
        break;
      case "batchIndex":
        out += seg.pad > 0
          ? String(batchIndex).padStart(seg.pad, "0")
          : String(batchIndex);
        break;
      case "captureRef": {
        const v = captures[seg.index - 1];
        if (v === undefined) throw new Error(`{${seg.index}} has no matching capture`);
        out += v;
        break;
      }
    }
  }
  return out;
}