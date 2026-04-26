# Known Bugs

_Last updated: 2026-04-26_

This page tracks currently known issues in **Insti-Spaces** so contributors and testers have a single place to check before filing duplicates.

## How to read this page

- **Severity**: Critical / High / Medium / Low
- **Status**: Open / In Progress / Needs Discussion / Planned
- **Workaround**: Temporary user/developer workaround if available

---

## 1) Empty folders are not included in ZIP downloads

- **Area**: Downloading Items
- **Severity**: Medium
- **Status**: Open
- **Description**: Empty directories are skipped when exporting/downloading content as ZIP.
- **Impact**: Folder structure is incomplete after download.
- **Workaround**: Add a placeholder file before download.
- **Suggested fix**: Ensure ZIP generation explicitly writes empty directory entries.

## 2) Duplicate folder names create UI duplication/confusion

- **Area**: Folder Management / UI Rendering
- **Severity**: Medium
- **Status**: Open
- **Description**: Multiple folders with the same name can be created, causing confusing duplicate entries in the UI.
- **Impact**: Users cannot reliably distinguish folders by name alone.
- **Workaround**: Use unique folder names manually.
- **Suggested fix**: Add disambiguation (ID/path hints) in UI and/or enforce uniqueness per parent folder.

## 3) Photos sometimes appear in root folder incorrectly

- **Area**: File Listing / Root View
- **Severity**: High
- **Status**: Open
- **Description**: Photos occasionally appear in the root folder even when root should be empty.
- **Impact**: Misleading file visibility and potential accidental actions on misplaced items.
- **Workaround**: Refresh and navigate into target folder to verify true location.
- **Suggested fix**: Audit folder filtering/query logic and cache invalidation for root listing.

## 4) "Select and move to trash" flow is incomplete

- **Area**: Selection Actions / Trash
- **Severity**: Medium
- **Status**: Planned
- **Description**: Multi-select to trash is not fully implemented.
- **Impact**: Slower bulk cleanup and inconsistent UX.
- **Workaround**: Trash items one by one.

## 5) Drag-and-drop move between folders is missing

- **Area**: Item Movement / UX
- **Severity**: Low
- **Status**: Planned
- **Description**: Drag-to-move items between folders is not available.
- **Impact**: Lower usability for organizing content.
- **Workaround**: Use existing move action flow (if available).

## 6) `deleted` flag is not set to `true` after trashing an item

- **Area**: Backend Schema (`space_items`)
- **Severity**: Critical
- **Status**: Open
- **Description**: Trashed items do not always update the `deleted` field in `space_items`.
- **Impact**: Data inconsistency; trashed items may still appear or behave as active.
- **Workaround**: None reliable.
- **Suggested fix**: Verify trash handler write path and transaction/ORM update logic.

## 7) Deletion lifecycle policy is undefined (items/spaces/etc.)

- **Area**: Product/Data Lifecycle
- **Severity**: Medium
- **Status**: Needs Discussion
- **Description**: There is no finalized policy for retention/purge of soft-deleted entities.
- **Impact**: Unbounded storage growth and unclear restore/purge behavior.
- **Workaround**: Manual cleanup.
- **Suggested direction**: Define retention window (e.g., 30/60/90 days), restore rules, and scheduled hard-delete jobs.

## 8) Upload error handling is not comprehensive

- **Area**: Uploading Items / Error UX
- **Severity**: Medium
- **Status**: In Progress (monitoring)
- **Description**: Team has not encountered many upload failures yet, but robust error handling is incomplete.
- **Impact**: Poor resilience when network/storage errors occur.
- **Workaround**: Retry upload.
- **Suggested fix**: Add retry strategy, error toasts, and server-side error mapping.

---

## Triage notes

- Please convert each bug above into a tracked GitHub issue (one bug = one issue) with steps to reproduce.
- Add labels such as: `bug`, `backend`, `frontend`, `needs-repro`, `priority:<level>`.
- Keep this document synced with issue status changes.
