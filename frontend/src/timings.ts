// ============================================================================
//  timings.ts
//  ---------------------------------------------------------------------------
//  Single source of truth for every time-based setting on the frontend.
//  Tune cadence/feel here — no consumer file should hold a literal duration.
//
//  Conventions:
//    • All values are milliseconds.
//    • Names use `_MS` suffix where ambiguity is possible; legacy names
//      without the suffix (POLL_INTERVAL) are kept as-is to avoid churn.
//
//  Each entry is annotated with two things:
//    1. WHAT IT DOES
//    2. HOW THE DATA IS FETCHED — either:
//         • DELTA SYNC: server takes a `?since=<lastSeen>` query param and
//           returns only rows updated since the last tick (via the
//           `useDeltaSync` hook). Cheap; safe to set low.
//         • FULL FETCH: every tick re-runs the entire request and replaces
//           local state. More expensive — bigger payload, more SQL work.
//           Be conservative when lowering.
// ============================================================================

/**
 * Default poll cadence for everything that auto-refreshes on the page.
 * Lower = faster propagation of cross-tab/cross-user changes; higher = less
 * server + DB load.
 *
 *   DELTA SYNC consumers (cheap, only changed rows):
 *     • Spaces list                  Spaces.tsx
 *     • Friends list                 Friends.tsx
 *     • Members list                 useSpaceView.ts
 *     • Notifications                Notifications.tsx
 *     • Invite-modal member search   InviteModal.tsx
 *     • Space feed                   SpaceFeed.tsx
 *     • Explorer items               SpaceExplorer.tsx
 *     • Explorer folders             SpaceExplorer.tsx
 *
 *   FULL-FETCH consumers (every tick re-downloads the resource):
 *     • Space role                   useSpaceView.ts — small row; keeps
 *                                    the current user's role + canWrite
 *                                    gates fresh when an admin promotes
 *                                    or demotes them.
 *     • Notifications unread count   Navbar.tsx — single COUNT(*) query.
 *     • Friend search results        Friends.tsx — search re-run.
 *     • Friend suggestions           Friends.tsx — list re-run.
 */
export const POLL_INTERVAL = 5_000;

/**
 * Fallback used by `useDeltaSync` when a call site forgets to pass an
 * explicit `interval`. Every current consumer passes POLL_INTERVAL, so this
 * is a safety net only — bumped a bit higher to penalize accidental misuse.
 *
 *   DATA FETCH: DELTA SYNC (only kicks in if a caller doesn't override).
 */
export const DELTA_SYNC_FALLBACK_INTERVAL_MS = 15_000;

/**
 * How long a gentle in-app toast stays on screen before fading.
 *   • Permission-denied / "select something first" toasts in the explorer
 *     toolbar (SpaceExplorer.tsx).
 *   • "You can't change an admin's role" / etc. in the members list
 *     (MembersList.tsx).
 *
 *   DATA FETCH: n/a — purely UI timing.
 */
export const TOAST_DURATION_MS = 2_400;

/**
 * Duration of the "Link copied!" pill in the invite modal after the user
 * clicks the copy-link button. Slightly longer than TOAST_DURATION_MS
 * because the user typically pastes elsewhere then glances back to confirm.
 *
 *   DATA FETCH: n/a — purely UI timing.
 */
export const COPY_CONFIRM_DURATION_MS = 2_500;

/**
 * Delay between the "Upload complete" success message appearing and the
 * upload modal auto-dismissing. Long enough to register success, short
 * enough to feel responsive.
 *
 *   DATA FETCH: n/a — purely UI timing.
 */
export const UPLOAD_SUCCESS_DISMISS_MS = 700;
