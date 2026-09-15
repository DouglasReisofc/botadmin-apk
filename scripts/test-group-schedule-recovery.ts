import assert from "node:assert/strict";
import { test } from "node:test";
import { getLatestGroupScheduleAction, markOpenDispatch } from "../lib/bot-group-schedule";
import type { BotGroupScheduleConfig } from "../types/bot-groups";

const config = (patch: Partial<BotGroupScheduleConfig> = {}): BotGroupScheduleConfig => ({
  openEnabled: true, openTimes: ["08:00"], openSentTimes: {}, openMessage: null,
  closeEnabled: true, closeTimes: ["23:00"], closeSentTimes: {}, closeMessage: null,
  lastOpenAt: null, lastCloseAt: null, timezone: "America/Sao_Paulo", ...patch,
});
const at = (local: string) => new Date(`${local}-03:00`);
test("recovers a missed morning open hours after database recovery", () => {
  const d = getLatestGroupScheduleAction(config(), at("2026-09-15T10:40:00"))!;
  assert.equal(d.action, "open"); assert.equal(d.overdueMinutes, 160); assert.equal(d.run, true);
  assert.equal(d.context.dateIso, "2026-09-15");
});
test("only the latest transition wins; never replay an obsolete close", () => {
  const d = getLatestGroupScheduleAction(config({ closeTimes: ["00:00", "09:00"], openTimes: ["08:00", "10:00"] }), at("2026-09-15T10:40:00"))!;
  assert.equal(d.action, "open"); assert.equal(d.clock, "10:00");
});
test("a completed latest action does not cause replay of earlier missing events", () => {
  const d = getLatestGroupScheduleAction(config({ openSentTimes: { "08:00": "2026-09-15" } }), at("2026-09-15T10:40:00"))!;
  assert.equal(d.run, false);
});
test("cross-midnight recovery uses previous local calendar date", () => {
  const d = getLatestGroupScheduleAction(config(), at("2026-10-01T00:10:00"))!;
  assert.equal(d.action, "close"); assert.equal(d.context.dateIso, "2026-09-30"); assert.equal(d.overdueMinutes, 70);
});
test("date rollover is correct at new year and leap day", () => {
  assert.equal(getLatestGroupScheduleAction(config(), at("2026-01-01T00:10:00"))!.context.dateIso, "2025-12-31");
  assert.equal(getLatestGroupScheduleAction(config(), at("2024-03-01T00:10:00"))!.context.dateIso, "2024-02-29");
});
test("timezone override is respected", () => {
  const d = getLatestGroupScheduleAction(config(), new Date("2026-09-15T11:30:00Z"), { timezone: "America/Manaus" })!;
  assert.equal(d.action, "close"); assert.equal(d.context.dateIso, "2026-09-14");
});
test("disabled schedules never execute", () => {
  assert.equal(getLatestGroupScheduleAction(config({ openEnabled: false, closeEnabled: false }), new Date()), null);
});
test("conflicting times close once instead of flipping both ways", () => {
  assert.equal(getLatestGroupScheduleAction(config({ closeTimes: ["08:00"] }), at("2026-09-15T08:00:00"))!.action, "close");
});
test("successful marking makes retry idempotent without modifying the input", () => {
  const c = config(); const date = at("2026-09-15T10:40:00");
  const d = getLatestGroupScheduleAction(c, date)!;
  const saved = markOpenDispatch(c, d.clock, d.context);
  assert.equal(getLatestGroupScheduleAction(saved, date)!.run, false);
  assert.deepEqual(c.openSentTimes, {});
});
test("unsorted and invalid times do not hide the latest valid occurrence", () => {
  const d = getLatestGroupScheduleAction(config({ openTimes: ["10:00", "invalid", "08:00"] }), at("2026-09-15T10:40:00"))!;
  assert.equal(d.clock, "10:00");
});
