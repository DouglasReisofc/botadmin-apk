import assert from "node:assert/strict";
import { test } from "node:test";

import { getContactActions } from "../web_panel/src/contact-actions";

test("admin group member actions include moderation and recent-message cleanup", () => {
  const actions = getContactActions({
    isGroup: true,
    canManage: true,
    isSelf: false,
    isBot: false,
  });

  assert.deepEqual(actions.map((action) => action.key), [
    "start",
    "warn",
    "reset_infractions",
    "promote",
    "demote",
    "remove",
    "remove_clean",
    "delete_recent",
    "blacklist",
    "ban",
  ]);
});

test("regular members cannot see moderation actions", () => {
  const actions = getContactActions({
    isGroup: true,
    canManage: false,
    isSelf: false,
    isBot: false,
  });

  assert.deepEqual(actions.map((action) => action.key), ["start"]);
});

test("a contact modal keeps only private-conversation action", () => {
  const actions = getContactActions({
    isGroup: false,
    canManage: true,
    isSelf: false,
    isBot: false,
  });

  assert.deepEqual(actions.map((action) => action.key), ["start"]);
});
