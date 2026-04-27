// ── Rate limiting ─────────────────────────────────────────────────────────────

export const RATE = {
  GLOBAL_WINDOW_MS:   60_000,          // 1 min — floor for all routes
  GLOBAL_MAX:         200,

  LOGIN_WINDOW_MS:    15 * 60_000,     // 15 min — bcrypt at cost=10 is ~100ms/call
  LOGIN_MAX:          10,

  REGISTER_WINDOW_MS: 60 * 60_000,     // 1 hr
  REGISTER_MAX:       5,

  UPLOAD_WINDOW_MS:   60 * 60_000,     // 1 hr — each request triggers ffmpeg/sharp
  UPLOAD_MAX:         20,
} as const;

// ── Upload ────────────────────────────────────────────────────────────────────

export const UPLOAD = {
  MAX_FILES:       200,                 // files per request
  MAX_FILE_BYTES:  500 * 1024 * 1024,  // 500 MB per file
  THUMB_PX:        320,               // thumbnail bounding box (px)
  THUMB_QUALITY:   80,                // WebP quality 0-100
} as const;

// ── Pagination ────────────────────────────────────────────────────────────────

export const PAGE = {
  ITEMS_DEFAULT:          50,
  ITEMS_MAX:              200,
  TRASH_DEFAULT:          50,
  TRASH_MAX:              200,
  FRIENDS_DEFAULT:        200,
  FRIENDS_MAX:            500,
  NOTIFICATIONS_DEFAULT:  50,
  NOTIFICATIONS_MAX:      200,
  USER_SEARCH_MAX:        20,
} as const;

// ── Trash ─────────────────────────────────────────────────────────────────────

export const TRASH = {
  EXPIRY_DAYS:         7,
  CLEANUP_INTERVAL_MS: 60 * 60_000,   // 1 hr
} as const;

// ── Auth ──────────────────────────────────────────────────────────────────────

export const AUTH = {
  BCRYPT_COST: 10,
  JWT_EXPIRY:  '7d',
} as const;

// ── Input validation ─────────────────────────────────────────────────────────

export const VALIDATION = {
  USERNAME_MIN: 1,
  USERNAME_MAX: 50,
  EMAIL_MAX: 255,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  SPACENAME_MIN: 1,
  SPACENAME_MAX: 50,
  CONTENT_HASH_HEX_LEN: 64,
} as const;
