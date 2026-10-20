# S1 — Mail linking

Goal: connect tasks to messages without storing message content.

Read: `.ref/webext-docs/{menus,messages,messageDisplay,mailTabs}.rst`, `docs/SPEC.md` (Privacy). Plan mode first, and list the new permissions with a justification for each.

## Deliver
1. Permissions: `messagesRead` (and `accountsRead` only if folder mapping is included).
2. Message-list and message-display context menus:
   - **New task from message**: subject becomes the task name; project chosen in a small popup; link stored
   - **Track time to…**: pick a task, start its timer, link the message
   - **Link to task…**
3. Store `MessageLink` (headerMessageId, subject snapshot, date) through a new DB migration (v2) with a test.
4. Detail pane "Linked messages": open the message with `messageDisplay.open({headerMessageId})` (check the exact signature in the docs); unlink; show "not found" gracefully if the message was deleted.
5. Optional (ask first): folder → project mapping, with a hint bar "Start timer for <project>?" when you open a mapped folder. Never auto-start without consent.

## Verify
- Unit: migration v1→v2; link CRUD.
- Mock-based tests for the menu handlers.
- Manual in Thunderbird with a local folder of fictional test messages (generate an mbox in `dev/` with fake addresses `@example.invalid`).
