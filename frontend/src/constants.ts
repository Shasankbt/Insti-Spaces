export const API_BASE = import.meta.env.VITE_API_URL;
// Time-related constants (POLL_INTERVAL, toast durations, etc.) live in
// `./timings.ts` — keep that file as the single place to tune cadence.
export const EXPLORER_PAGE_SIZE = 50;     // items per page in the folder explorer
export const TRASH_LIMIT = 50;            // items per page in trash view

export const ROLE_RANK: Record<string, number> = { viewer: 1, contributor: 2, moderator: 3, admin: 4 };

export const INVITE_ROLES = ['viewer', 'contributor', 'moderator'] as const;
