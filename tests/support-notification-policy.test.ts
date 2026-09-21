import assert from "node:assert/strict";
import test from "node:test";

import { shouldNotifySupportOpened } from "../lib/support-notification-policy";

test("an external contact opening a new conversation emits support_opened", () => {
  assert.equal(
    shouldNotifySupportOpened({
      direction: "inbound",
      hasPreviousMessage: false,
      isAdminThread: false,
      senderRole: "contact",
    }),
    true,
  );
});

test("an admin starting the internal chat does not look like a support request", () => {
  assert.equal(
    shouldNotifySupportOpened({
      direction: "inbound",
      hasPreviousMessage: false,
      isAdminThread: true,
      senderRole: "admin",
    }),
    false,
  );
});

test("a registered user messaging the admin does not create support_opened for themselves", () => {
  assert.equal(
    shouldNotifySupportOpened({
      direction: "inbound",
      hasPreviousMessage: false,
      isAdminThread: true,
      senderRole: "user",
    }),
    false,
  );
});

test("later customer replies do not reopen the support notification", () => {
  assert.equal(
    shouldNotifySupportOpened({
      direction: "inbound",
      hasPreviousMessage: true,
      isAdminThread: false,
      senderRole: "contact",
    }),
    false,
  );
});
