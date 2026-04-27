export const API_BASE = 'http://localhost:3000';
export const POLL_INTERVAL = 5000;

export const ROLE_RANK: Record<string, number> = { viewer: 1, contributor: 2, moderator: 3, admin: 4 };

export const INVITE_ROLES = ['viewer', 'contributor', 'moderator'] as const;
