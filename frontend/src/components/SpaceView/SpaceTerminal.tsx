import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSafe, type ParsedPath } from '../../commandParser';
import {
  runSpaceCommand,
  type TerminalSelectionEntry,
  type TerminalState,
} from '../../Api';
import { IconClose, IconTerminal } from './Icons';

interface SpaceTerminalProps {
  spaceId: number;
  token: string;
  onClose: () => void;
  onMutated: () => void;
}

interface TranscriptEntry {
  kind: 'prompt' | 'output' | 'error' | 'info';
  text: string;
}

const STORAGE_KEY = (spaceId: number) => `space-terminal:${spaceId}`;
const HISTORY_KEY = (spaceId: number) => `space-terminal-history:${spaceId}`;
const MAX_HISTORY = 200;
const MAX_TRANSCRIPT = 500;

interface PersistedState {
  cwdFolderId: number | null;
  cwdLabel: string;
  selection: TerminalSelectionEntry[];
  lastPattern: unknown;
  lastFilters: unknown;
  pattern: TerminalState['pattern'];
  filters: TerminalState['filters'];
}

const INITIAL_STATE: PersistedState = {
  cwdFolderId: null,
  cwdLabel: '/',
  selection: [],
  lastPattern: null,
  lastFilters: null,
  pattern: { set: false, raw: null, captureCount: 0 },
  filters: { set: false, summary: null },
};

function loadState(spaceId: number): PersistedState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(spaceId));
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return { ...INITIAL_STATE, ...parsed };
  } catch {
    return INITIAL_STATE;
  }
}

function saveState(spaceId: number, state: PersistedState) {
  try {
    sessionStorage.setItem(STORAGE_KEY(spaceId), JSON.stringify(state));
  } catch {
    /* quota exceeded — ignore */
  }
}

function loadHistory(spaceId: number): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY(spaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(spaceId: number, history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY(spaceId), JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

/** Apply a parsed cd path to the current label so the prompt updates locally. */
function applyCdToLabel(currentLabel: string, path: ParsedPath): string {
  if (path.isAbsolute) return '/' + path.segments.join('/');
  const stack = currentLabel.split('/').filter(Boolean);
  for (let i = 0; i < path.upCount; i++) stack.pop();
  for (const seg of path.segments) stack.push(seg);
  return '/' + stack.join('/');
}

const HELP_TEXT = [
  'Commands:',
  '  ls [path]                    list contents of cwd or path',
  '  cd [path]                    change cwd (bare cd → /)',
  '  select <pattern> [filters]   match files by name + filters',
  '  move <destination>           move current selection',
  '  copy <destination>           copy current selection',
  '  delete                       trash current selection',
  '  rename <pattern>             rename current selection',
  '  info <file-path>             show file metadata',
  '  deselect                     clear current selection',
  '  clear                        clear screen',
  '  help                         this message',
  '',
  'Path syntax:  a/b/c (relative)   /a/b (absolute)   ..   .   \\/ (literal slash)',
  'Pattern:      ? (one char, capturing)   * (zero+, capturing)   + (one+, capturing)',
  'Filters:      folder:PATH  type:image  uploaded:2024-*  taken:2024-03',
  '              size:>10mb  uploaded_by:USER',
  'Rename:       {n}, {n:0K} batch index   {N} Nth select capture',
];

export default function SpaceTerminal({ spaceId, token, onClose, onMutated }: SpaceTerminalProps) {
  const [state, setState] = useState<PersistedState>(() => loadState(spaceId));
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    { kind: 'info', text: 'terminal — type `help` for commands' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory(spaceId));
  const [parseError, setParseError] = useState<string | null>(null);
  const [height, setHeight] = useState<number>(320);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist state and history.
  useEffect(() => { saveState(spaceId, state); }, [spaceId, state]);
  useEffect(() => { saveHistory(spaceId, history); }, [spaceId, history]);

  // Auto-scroll transcript on append.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end' });
  }, [transcript]);

  // Inline parse for early error feedback.
  useEffect(() => {
    if (input.trim() === '') { setParseError(null); return; }
    const r = parseSafe(input);
    setParseError(r.ok ? null : r.error);
  }, [input]);

  // Resize drag handle.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = drag.startHeight + (drag.startY - e.clientY);
      setHeight(Math.max(140, Math.min(window.innerHeight - 120, next)));
    };
    const onUp = () => { dragStateRef.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragStateRef.current = { startY: e.clientY, startHeight: height };
    document.body.style.cursor = 'ns-resize';
  };

  const append = (entries: TranscriptEntry[]) => {
    setTranscript((prev) => {
      const next = [...prev, ...entries];
      return next.length > MAX_TRANSCRIPT ? next.slice(next.length - MAX_TRANSCRIPT) : next;
    });
  };

  const runLocal = (line: string): boolean => {
    // Returns true if the command was handled locally (no backend call).
    const head = line.trim().split(/\s+/)[0]?.toLowerCase();
    if (head === 'clear') {
      setTranscript([]);
      return true;
    }
    if (head === 'help') {
      append(HELP_TEXT.map((t) => ({ kind: 'output' as const, text: t })));
      return true;
    }
    if (head === 'deselect') {
      setState((prev) => ({
        ...prev,
        selection: [],
        lastPattern: null,
        lastFilters: null,
        pattern: { set: false, raw: null, captureCount: 0 },
        filters: { set: false, summary: null },
      }));
      append([{ kind: 'info', text: 'selection cleared' }]);
      return true;
    }
    return false;
  };

  const submit = async () => {
    const line = input;
    if (!line.trim() || busy) return;

    setHistory((prev) => {
      const next = [...prev, line];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setHistoryIdx(null);
    setInput('');
    append([{ kind: 'prompt', text: `${state.cwdLabel} ❯ ${line}` }]);

    if (parseError) {
      append([{ kind: 'error', text: parseError }]);
      return;
    }
    if (runLocal(line)) return;

    // Pre-compute the new label if this is a cd, so the prompt updates instantly
    // on the round trip's success.
    const parsed = parseSafe(line);
    let pendingLabel: string | null = null;
    if (parsed.ok && parsed.value.cmd === 'cd') {
      pendingLabel = applyCdToLabel(state.cwdLabel, parsed.value.path);
    }

    setBusy(true);
    try {
      const { data } = await runSpaceCommand({
        spaceId,
        token,
        line,
        cwdFolderId: state.cwdFolderId,
        selection: state.selection,
        lastPattern: state.lastPattern,
        lastFilters: state.lastFilters,
      });
      if (!data.ok) {
        append([{ kind: 'error', text: data.error }]);
        return;
      }
      append(data.outputLines.map((t) => ({ kind: 'output' as const, text: t })));

      // Update state from server response.
      setState((prev) => ({
        cwdFolderId: data.state.cwdFolderId,
        cwdLabel: pendingLabel != null && data.state.cwdFolderId !== prev.cwdFolderId
          ? pendingLabel
          : data.state.cwdFolderId === null
            ? '/'
            : prev.cwdLabel,
        selection: data.state.selection,
        // Keep raw pattern/filters around: the server only returns the summary,
        // but for re-execution context we send back what we last sent.
        lastPattern: data.state.pattern.set ? prev.lastPattern : null,
        lastFilters: data.state.filters.set ? prev.lastFilters : null,
        pattern: data.state.pattern,
        filters: data.state.filters,
      }));

      // If this round set a new pattern (select), capture it from the parsed input.
      if (parsed.ok && parsed.value.cmd === 'select') {
        setState((prev) => ({
          ...prev,
          lastPattern: parsed.value.cmd === 'select' ? parsed.value.pattern : prev.lastPattern,
          lastFilters: parsed.value.cmd === 'select' ? parsed.value.filters : prev.lastFilters,
        }));
      }

      if (data.mutated) onMutated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err as Error)?.message
        ?? 'request failed';
      append([{ kind: 'error', text: msg }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(history[next] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === null) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        setInput('');
      } else {
        setHistoryIdx(next);
        setInput(history[next] ?? '');
      }
      return;
    }
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setTranscript([]);
    }
  };

  const statusBadges = useMemo(() => {
    const badges: string[] = [];
    if (state.selection.length > 0) badges.push(`${state.selection.length} selected`);
    if (state.pattern.set && state.pattern.raw) badges.push(`pattern: ${state.pattern.raw}`);
    if (state.filters.set && state.filters.summary) badges.push(state.filters.summary);
    return badges;
  }, [state.selection.length, state.pattern, state.filters]);

  return (
    <div className="space-terminal" style={{ height: `${height}px` }}>
      <div className="space-terminal__resize-handle" onMouseDown={startDrag} aria-label="Resize terminal" />
      <header className="space-terminal__header">
        <span className="space-terminal__title">
          <IconTerminal className="space-terminal__title-icon" />
          terminal
          <span className="space-terminal__cwd">{state.cwdLabel}</span>
        </span>
        <span className="space-terminal__badges">
          {statusBadges.map((b, i) => (
            <span key={i} className="space-terminal__badge">{b}</span>
          ))}
        </span>
        <button
          type="button"
          className="space-terminal__close"
          onClick={onClose}
          aria-label="Close terminal"
        >
          <IconClose />
        </button>
      </header>

      <div className="space-terminal__transcript" onClick={() => inputRef.current?.focus()}>
        {transcript.map((entry, i) => (
          <div key={i} className={`space-terminal__line space-terminal__line--${entry.kind}`}>
            {entry.text || ' '}
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      <form
        className="space-terminal__prompt-row"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <span className="space-terminal__prompt-cwd">{state.cwdLabel}</span>
        <span className="space-terminal__prompt-caret">❯</span>
        <input
          ref={inputRef}
          autoFocus
          className={`space-terminal__input${parseError ? ' space-terminal__input--error' : ''}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? 'running…' : 'type a command'}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
        />
        {parseError && <span className="space-terminal__inline-error" title={parseError}>⚠</span>}
      </form>
    </div>
  );
}
