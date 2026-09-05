import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAdminIdentityAliases,
  isOpaqueWhatsappIdentity,
  resolveTrustedPhoneIdentity,
  whatsappPhoneIdentitiesOverlap,
} from "../lib/bot-events/moderation-identity";

test("LID opaco nunca e interpretado como telefone estrangeiro", () => {
  assert.equal(isOpaqueWhatsappIdentity("241123943518336@lid"), true);
  assert.equal(
    resolveTrustedPhoneIdentity(["241123943518336@lid"]),
    null,
  );
});

test("resolucao usa somente a identidade telefonica real do remetente", () => {
  assert.deepEqual(
    resolveTrustedPhoneIdentity([
      "241123943518336@lid",
      "554999272475:18@s.whatsapp.net",
    ]),
    {
      digits: "554999272475",
      identifier: "554999272475@s.whatsapp.net",
    },
  );
});

test("administrador conserva aliases PN, JID e LID", () => {
  const aliases = collectAdminIdentityAliases({
    PhoneNumber: "554999272475",
    JID: "554999272475@s.whatsapp.net",
    LID: "241123943518336@lid",
    IsAdmin: true,
  });
  assert.deepEqual(
    Array.from(aliases).sort(),
    ["241123943518336", "554999272475"],
  );
});

test("comparacao protege o proprio numero com variacoes de DDI/dispositivo", () => {
  assert.equal(
    whatsappPhoneIdentitiesOverlap(
      "554999272475:22@s.whatsapp.net",
      "+55 (49) 99272-475",
    ),
    true,
  );
  assert.equal(
    whatsappPhoneIdentitiesOverlap("5511988887777", "351911111111"),
    false,
  );
});
