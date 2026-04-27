export const API_BASE = 'http://localhost:3000';
export const POLL_INTERVAL = 5000;        // ms between delta-sync polls
export const EXPLORER_PAGE_SIZE = 50;     // items per page in the folder explorer
export const TRASH_LIMIT = 50;            // items per page in trash view

export const ROLE_RANK: Record<string, number> = { viewer: 1, contributor: 2, moderator: 3, admin: 4 };

export const INVITE_ROLES = ['viewer', 'contributor', 'moderator'] as const;
