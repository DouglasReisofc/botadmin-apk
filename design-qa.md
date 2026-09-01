# Design QA — Transmissões, destinatários e migração do Autodivulgador

final result: passed

## Grounding

- Visual source: user-provided 1920 × 1080 screenshot of the existing BotAdmin welcome-message phone editor.
- Existing design system reused: `WaTheme`, the production conversation composer, existing interactive-message button types, existing media uploader, and the group welcome-message editor's phone-preview structure.
- Browser selected by the user: Google Chrome.
- Production route: `https://botadmin.shop/dashboard/user`.

## Captures

- Clean broadcast conversation: `/tmp/broadcast-live-clean.png` — 1920 × 1053.
- Saved-message list modal: `/tmp/broadcast-saved-list.png` — 1920 × 1053.
- Shared create/edit phone editor: `/tmp/broadcast-phone-editor.png` — 1920 × 1053.
- Combined three-state comparison: `/tmp/broadcast-qa-combined.png` — 1920 × 1053.
- Final production state left open for inspection: `/tmp/broadcast-final-open2.png` — 1920 × 1053.
- Production lists after migration: `/tmp/botadmin-broadcast-qa-4.png` — 1920 × 1080.
- Mixed-recipient import modal: `/tmp/botadmin-broadcast-qa-6.png` — 1920 × 1080.
- Real instance group picker: `/tmp/botadmin-broadcast-qa-7.png` — 1920 × 1080.
- Group mention controls: `/tmp/botadmin-broadcast-qa-8.png` — 1920 × 1080.
- Corrected participant moderation contrast: `/tmp/botadmin-modal-qa-3.png` — 1920 × 1080.
- Selected message with the new inline send controls: `/tmp/broadcast-inline-panel-desktop_000.png` — 1920 × 1053.
- Responsive selected-message state: `/tmp/broadcast-inline-mobile-controls.png` — 400 × 845 emulated mobile viewport.
- Responsive mention controls: `/tmp/broadcast-inline-mobile-mention-on.png` — 400 × 845 emulated mobile viewport.
- Cancel-selection result: `/tmp/broadcast-inline-mobile-cancel-final2.png` — 400 × 845 emulated mobile viewport.
- Full recurring history bubble: `/tmp/broadcast-v2-history-open.png` — 400 × 845 emulated mobile viewport.
- Floating send modal with full message preview: `/tmp/broadcast-v2-send-modal-mobile.png` — 400 × 845 emulated mobile viewport.
- Floating send modal controls: `/tmp/broadcast-v2-send-modal-mobile-controls_000.png` — 400 × 845 emulated mobile viewport.
- Live recurring countdown after elapsed time: `/tmp/broadcast-v2-countdown-later.png` — 400 × 845 emulated mobile viewport.
- Final desktop history without the redundant progress card: `/tmp/botadmin-broadcast-detail-new.png` — 1440 × 1000.
- Message overflow menu with the progress action: `/tmp/botadmin-broadcast-message-menu.png` — 1440 × 1000.
- Schedule overflow menu with progress/edit/delete actions: `/tmp/botadmin-broadcast-schedule-menu.png` — 1440 × 1000.
- Final responsive history and compact delivery count: `/tmp/botadmin-broadcast-mobile-detail-new.png` — 400 × 845 emulated mobile viewport.
- Responsive message progress menu: `/tmp/botadmin-broadcast-mobile-menu-new.png` — 400 × 845 emulated mobile viewport.
- Historical message with direct section-edit pencils: `/tmp/broadcast-new-history-edit.png` — desktop viewport.
- Reusable full editor opened from history: `/tmp/broadcast-new-quick-editor.png` — desktop viewport.
- Rich variable editor and type cards: `/tmp/broadcast-new-variables-dialog.png` and `/tmp/broadcast-new-variable-card.png` — desktop viewport.
- Send dialog with per-section edit actions and quiet-hours controls: `/tmp/broadcast-new-send-settings.png` — desktop viewport.
- Enabled 23:00–06:00 pause window: `/tmp/broadcast-new-quiet-enabled.png` — 1440 × 1000.
- Responsive stacked send dialog: `/tmp/broadcast-mobile-quiet.png` — 400 × 845 emulated mobile viewport.
- Responsive quiet-hours controls and scroll behavior: `/tmp/broadcast-mobile-quiet-enabled.png` — 400 × 845 emulated mobile viewport.

## Visual comparison

| Check | Result |
| --- | --- |
| Saved templates removed from the conversation canvas | Passed — the center shows only empty/send/progress/history states. |
| Saved templates accessible beside composer | Passed — compact bookmark control opens the modal. |
| Modal presents a title list instead of cards | Passed — each row has select, pencil, and trash actions. |
| Create and edit share one phone-shaped editor | Passed. |
| Editor structure matches the established welcome editor | Passed — status bar, WhatsApp-green header, editable name, media control, message body, editable button rows, add-button action, and check-to-save. |
| Dark-theme contrast | Passed — labels, dividers, controls, modal surface, and chat card remain legible. |
| 1920 px desktop alignment and overflow | Passed — no clipped controls or horizontal overflow. |
| Interaction smoke test | Passed — open list, edit, open text editor, cancel, select template, create/update/delete API lifecycle. |
| Contact import regression | Passed — the previously failing real contact returned HTTP 200; no undefined conversion. |
| Mixed contacts and groups | Passed — one real contact and one real group were imported together, read back with distinct recipient types, then removed. |
| Group configuration | Passed — real groups are searchable and selected groups expose “Mencionar todos” and “Não mencionar administradores”. |
| Autodivulgador migration | Passed — one legacy recurring group campaign became one list, one group recipient, one saved message and one 200-minute recurrence. |
| Migrated CTA parity | Passed — the legacy `groupId` reference was resolved to the current full WhatsApp invite URL in both the saved template and recurring schedule. |
| Shared Status safety | Passed — six active Status campaigns remained present; migration only selected legacy targets of type `group`. |
| Participant modal dark contrast | Passed — all titles, subtitles and moderation actions use `WaTheme` foreground/surface tokens. |
| Selected-message placement | Passed — the complete WhatsApp-style bubble is rendered in the conversation history, with normal media, full caption and vertically stacked buttons. |
| Inline send configuration | Passed — now, scheduled and recurring modes, delay range, typing status and group-mention controls are editable directly below the selected bubble; the old start modal is no longer invoked. |
| Cancel selected message | Passed — both the close action and bottom Cancel action clear the draft and restore the normal conversation history. |
| Mobile responsiveness | Passed — the bubble and send controls fit the 400 × 845 viewport without horizontal clipping; the page remains vertically scrollable above the bottom navigation. |
| Mention persistence | Passed — mention-all and exclude-admin settings were toggled in the UI, persisted through the PATCH route, read back through the detail route, and reset after QA. |
| Historical WhatsApp bubble fidelity | Passed — sent media is rendered at full width, the complete caption is visible, action buttons are stacked exactly as message actions and the timestamp/check metadata is retained. |
| Floating selected-message workflow | Passed — selecting a saved message opens a dedicated responsive dialog; the preview and delivery configuration share the available viewport and no draft is injected into history. |
| Recurring progress semantics | Passed — a completed occurrence remains labelled “Recorrência ativa” and shows the live HH:MM:SS countdown, next dispatch timestamp, occurrence count and last-cycle delivery count instead of “1/1 concluído”. |
| Recurring live refresh | Passed — the visible countdown decreased from 02:16:00 to 02:14:41 without a page reload, while the detail endpoint exposed the schedule/run association needed for subsequent cycles. |
| Redundant progress card removal | Passed — the area below the WhatsApp bubble is clean; only the schedule card remains above it. |
| Compact delivery result | Passed — `1/1` is displayed beside the bubble timestamp/checks on desktop and mobile. |
| Progress discoverability | Passed — “Ver progresso” is available from both the bubble and schedule three-dot menus. |
| Quiet-hours configuration | Passed — the transmission dialog exposes an optional pause window, defaults to 23:00–06:00, and shows both editable time controls when enabled. |
| Quiet-hours mobile layout | Passed — the message preview, delivery settings, switch and time controls stack and scroll correctly at 400 × 845 without horizontal overflow. |
| Durable quiet pause | Passed — active runs retain their next-recipient position, become queued during the pause and are reclaimed by the 15-second dispatcher at the calculated resume instant. |
| Schedule quiet deferral | Passed — scheduled and recurring dispatches due during the blocked window move to the exact resume time instead of being marked failed or sent overnight. |
| Historical quick editing | Passed — media, body and each button expose a pencil; editing creates a reusable copy while retaining the immutable record of what was actually sent. |
| Full message editing | Passed — the shared editor replaces/removes media, edits body, adds/edits/removes buttons and updates the saved title. |
| Rich variables | Passed — contact/sheet, fixed, greeting, date/time and JSON API variables can be configured and inserted from the `{}` picker at the body cursor. |
| Variable preview | Passed — the authenticated preview route rendered greeting, contact name, local time and a JSON-path API value against the first recipient before saving/sending. |
| JSON variable safety | Passed — URLs are restricted to HTTP(S), private/loopback/link-local destinations are rejected after DNS resolution, redirects are revalidated, and response size/time are bounded. |

## Iteration history

1. Removed the wide horizontal saved-message card library from the chat canvas.
2. Added a compact saved-message picker next to the composer.
3. Replaced preview cards with a title-first list and direct edit/delete controls.
4. Rebuilt create/edit as the same phone-preview editor used by the product's established interaction pattern.
5. Removed the instructional bubble from the chat canvas so it remains dedicated to sends and progress.
6. Corrected the production deployment path and base href, hard-refreshed Chrome, and repeated visual QA on the published build.
7. Generalized list members into typed recipients while keeping the established conversation layout.
8. Added group discovery, search, selection and per-group mention controls inside the existing recipient modal.
9. Migrated the live recurring group campaign and removed the standalone Autodivulgador navigation entry.
10. Replaced hard-coded light-mode participant-action colors with the active WhatsApp theme tokens.
11. Moved the selected template into the history as a complete adaptive WhatsApp-style bubble.
12. Replaced the start-transmission modal with an inline preparation panel attached to the selected message.
13. Added direct cancel/trocar actions and editable scheduling, recurrence, delay, typing and group-mention controls.
14. Repeated visual QA at desktop and 400 × 845 mobile widths, including persistence and cancellation checks.
15. Replaced the compact historical summary with the same full adaptive WhatsApp message component used by previews.
16. Moved selected-message preparation out of history into a large floating responsive dialog.
17. Associated schedules with their generated runs and added a second-by-second recurring countdown plus automatic background refresh.
18. Reflowed the recurring progress footer on narrow screens so its summary and progress action do not clip.
19. Removed the standalone run/progress card below sent messages and reduced delivery state to a compact count in the bubble footer.
20. Moved detailed progress into the existing three-dot menus and repeated desktop/mobile production QA.
21. Added optional quiet hours to immediate, scheduled and recurring transmissions, with exact pause/resume calculation and crash-safe queued-run recovery.
22. Added section-level edit actions to historical and selected message previews while keeping already-sent history immutable.
23. Expanded variables into typed sources, added cursor insertion and a live first-recipient preview backed by the same renderer used during dispatch.
24. Repeated production visual QA at desktop and 400 × 845 mobile widths for the editor, variable modal and enabled quiet-hours state.
