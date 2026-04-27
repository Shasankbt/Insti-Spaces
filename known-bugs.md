# Known Bugs

_Last updated: 2026-04-28_

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

## 7) Upload Model exploding with no of photoes

- **Area**: Uploading Items
- **Severity**: Medium
- **Status**: Working
- **Description**: upload page has no scroll , so upload button hindering beyond bottom borderline
- **Impact**: not user friendly.
- **Workaround**: use cntrl - to find upload button.
- **Suggested direction**: implement a scroll feature and or just don't display all photoes in the upload model

## 8) Video Seeking Delay Due to Full Blob Download

- **Area**: Media Playback (Video)
- **Severity**: High
- **Status**: Working 
- **Description**: Videos are fetched as full blobs using fetch() and URL.createObjectURL() instead of being streamed directly. This prevents native browser range requests, causing delays when seeking to later parts of large videos.
- **Impact**: Poor user experience for large videos (e.g., 300MB+), high bandwidth usage, and inefficient playback behavior.
- **Workaround**: Wait for the entire video to download before seeking (not practical).
- **Suggested direction**: Avoid blob-based playback. Use direct video URLs with signed URLs or cookie-based authentication so the browser can perform byte-range streaming (206 Partial Content).

## 9) Upload error handling is not comprehensive

- **Area**: Uploading Items / Error UX
- **Severity**: Medium
- **Status**: Will see in future
- **Description**: We have not encountered many upload failures yet, but robust error handling is incomplete.
- **Impact**: Poor resilience when network/storage errors occur.
- **Workaround**: Retry upload.
- **Suggested fix**: Add retry strategy, error toasts, and server-side error mapping.

---
