# SRS addendum: decisions made with Farha (1 Oct 2026)

Where this table and the SRS disagree, this table wins. Each row says what changed and why.

| # | Topic | SRS / design said | We do | Why |
|---|---|---|---|---|
| 1 | Review visibility | FR-16: reviews only for finishers | Same inside the room. The writer may tick **Make public**: then it shows on their profile and share card, behind a "May contain spoilers" tap for anyone who hasn't finished. The review form asks writers to keep spoilers out. | Farha: finished-book reviews can be shared, with a spoiler prompt. |
| 1b | Ratings on profiles | FR-18 shows ratings | Shown only to viewers who also finished that book, or when the review is public. | A low rating can hint at the plot (PRD risk table). |
| 2 | "Who will see this" | Design names every friend | Readers who hide their position are never named. | FR-20 wins. |
| 3 | "+1 star" on finishing | Design shows it at finish | Shown only once stars are actually earned (first rating, ≥ 3 days in the room). | FR-17 wins. |
| 4 | Review length | Design: "50 characters or more" | Any length up to 5,000 saves; the hint reads "50+ characters earns a star". | FR-15/17. |
| 5 | Bookmark control | PRD: fixed bar on every screen | The ribbon on the contents list (design), plus **Move bookmark here** on the chapter screen. Every move is confirmed first. | Design wins for look; a confirm step stops an accidental tap from unlocking spoilers. |
| 6 | Rooms per club | FR-4: one current room | One on the free plan; unlimited on Club Plus (Phase 3). Set in `plans.ts`. | Business requirement. |
| 7 | Payments | Out of scope | Phase 3, behind a provider interface. App is free until then. | Farha: free for now. |
| 8 | API location | Express → Next route handlers in week 9 | API stays a separate Node service. | Socket.IO needs a long-lived server. |
| 9 | Availability | NFR-4: 99% | Target, not a promise, on one free server. | Honest for a solo launch. |
| 10 | Naming | "Dogear" in doc tabs | BookMarker everywhere. | Farha. |
| 11 | Chapter edits | FR-5: locked once a chapter has posts | Host confirms the list. After that, add/remove/reorder only above the furthest point anyone has **reached or posted at**; renaming is always allowed. Bookmarks can't move until the host confirms. | Bookmarks store a position; shifting chapters under readers would silently unlock posts. |
| 12 | Finished readers posting | Not covered | An **After the book** section after the last chapter; only Finished readers can read or post there. | Farha. |
| 13 | Hiding posts | `posts.hidden` | No hide. Hosts delete (soft delete, kept for the moderation log). | Farha. |
| 14 | Missing tables | — | Added `sessions`, `magic_tokens`, `reports`, `room_events`, and `rooms.event_seq`. | Needed by SEC-1, SEC-3, FR-19, socket replay. |
| 15 | Screens not designed | Six phone screens | Home, clubs, club, sign-in, join, room setup, reviews, letters list and settings built in the same look. | — |
| 16 | Hosts and reports | Not covered | Hosts are gated too. A report on a post beyond the host's bookmark shows only the chapter number; the host can delete it blind via the report (`POST /moderation/reports/:id`). | Found by the AT-1 sweep: the list leaked the post's id. |
| 17 | Profile tabs | Design: Shelf · Reviews · Thoughts | Shelf and Reviews. "Thoughts" left out for now. | A list of someone's thoughts across books needs its own gate design; parked for v1.1. |

## API additions to SRS section 6

- `GET /auth/providers`: which sign-in methods are on.
- `GET /invites/:token`: club name for the join page (signed out).
- `PATCH /clubs/:clubId/me` `{ positionHidden }`; `PATCH /clubs/:clubId/members/:userId` `{ role }`.
- `GET /clubs/:clubId/invites`, `GET /clubs/:clubId/reports`.
- `POST /rooms/:roomId/close`: move the room to the shelf.
- `GET /posts/:postId`; `POST /notifications/read-all`.
- `POST /moderation/reports/:reportId` `{ action: delete | dismiss }`.
- `GET /me/export`, `DELETE /me` (SEC-11).
- Socket event `room:changed` (chapter list changed) and `notification:new`.

## Found in the Phase 1 self-review

- **Hidden readers finishing (FR-20).** A reader who hides their position no longer triggers the
  "finished" socket event or "Anu finished the book" letters, and the club's current book stays
  off their shelf for others until the room closes.
