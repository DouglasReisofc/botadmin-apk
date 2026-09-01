import assert from "node:assert/strict";

import { selectStatusContentsForTarget } from "lib/bot-ad-campaign-dispatcher";
import type { StatusContentHistory } from "lib/bot-ad-campaigns";
import type {
  BotAdCampaignContent,
  BotAdCampaignStatusRandomizer,
} from "types/bot-ad-campaigns";

const status = (
  id: string,
  options: { preferred?: boolean; scheduleSlot?: number } = {},
): BotAdCampaignContent => ({
  id,
  type: "status",
  statusType: "text",
  text: id,
  alwaysSendWhenRandomized: options.preferred === true,
  config:
    options.scheduleSlot == null
      ? null
      : { scheduleSlot: options.scheduleSlot },
});

const history = (
  dailySentCount: number,
  dailyUsageCounts: Record<string, number> = {},
  usageCounts: Record<string, number> = dailyUsageCounts,
): StatusContentHistory => ({
  lastContentId: null,
  usageCounts: { ...usageCounts },
  dailySentCount,
  dailyUsageCounts,
});

const randomizer: BotAdCampaignStatusRandomizer = {
  enabled: true,
  perRunCount: 1,
  dailyLimit: 2,
  ensurePreferredDaily: true,
};
const contents = [status("normal-1"), status("preferred", { preferred: true }), status("normal-2")];

assert.deepEqual(
  selectStatusContentsForTarget(contents, randomizer, history(0)).map(
    (content) => content.id,
  ),
  ["preferred"],
  "a primeira seleção diária deve garantir uma postagem preferencial",
);

assert.equal(
  selectStatusContentsForTarget(
    contents,
    randomizer,
    history(1, { preferred: 1 }),
  ).some((content) => content.id === "preferred"),
  false,
  "a postagem preferencial não deve ser forçada novamente no mesmo dia",
);

assert.deepEqual(
  selectStatusContentsForTarget(contents, randomizer, history(2)),
  [],
  "nenhum conteúdo pode ultrapassar o limite diário",
);

assert.deepEqual(
  selectStatusContentsForTarget(contents, null, history(3), {
    schedule: {
      kind: "recurring",
      everyMinutes: 60,
      timezone: "UTC",
    },
    now: new Date("2026-08-23T12:00:00.000Z"),
  }),
  [],
  "programações antigas também devem receber um limite diário seguro",
);

const fixedContents = [
  status("normal-cedo", { scheduleSlot: 0 }),
  status("venda-noite", { preferred: true, scheduleSlot: 1 }),
];
const fixedLimit: BotAdCampaignStatusRandomizer = {
  enabled: false,
  dailyLimit: 1,
  ensurePreferredDaily: true,
};
const fixedSchedule = {
  kind: "window" as const,
  timezone: "UTC",
  atTimes: ["08:00", "18:00"],
};

assert.deepEqual(
  selectStatusContentsForTarget(fixedContents, fixedLimit, history(0), {
    schedule: fixedSchedule,
    now: new Date("2026-08-23T08:00:00.000Z"),
  }),
  [],
  "a última vaga deve ficar reservada quando o preferencial está em um horário posterior",
);

assert.deepEqual(
  selectStatusContentsForTarget(fixedContents, fixedLimit, history(0), {
    schedule: fixedSchedule,
    now: new Date("2026-08-23T18:00:00.000Z"),
  }).map((content) => content.id),
  ["venda-noite"],
  "a vaga reservada deve ser usada pelo preferencial no horário dele",
);

assert.deepEqual(
  selectStatusContentsForTarget(
    [status("já-enviado"), status("nunca-enviado")],
    { enabled: true, perRunCount: 1, dailyLimit: 10 },
    history(0, {}, { "já-enviado": 8 }),
  ).map((content) => content.id),
  ["nunca-enviado"],
  "conteúdos nunca enviados devem continuar prioritários mesmo em dias posteriores",
);

const dynamicProfileContents: BotAdCampaignContent[] = [
  {
    ...status("perfil:reel-1"),
    config: {
      instagramProfile: { username: "cenasbrfilmes", automatic: true },
    },
  },
  {
    ...status("perfil:reel-2"),
    config: {
      instagramProfile: { username: "cenasbrfilmes", automatic: true },
    },
  },
];
assert.equal(
  selectStatusContentsForTarget(dynamicProfileContents, null, history(0)).length,
  1,
  "uma fonte automática nunca deve disparar o perfil inteiro de uma vez",
);

console.log("status daily limit tests passed");
