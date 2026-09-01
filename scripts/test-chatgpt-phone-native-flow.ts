#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const main = async () => {
  const autodown = await import("lib/autodown");
  const chatgpt = await import("lib/chatgpt-phone");

  autodown.resetAutoDownState();

  const jobId = randomUUID();
  await chatgpt.createChatGptPhoneJob({
    jobId,
    prompt: "Teste nativo Cromite",
    request: {
      message: "Crie uma imagem simples de teste nativo.",
      timeoutMs: 30_000,
      settleMs: 500,
      newChat: true,
      resultSource: "database",
    },
  });

  const runner = chatgpt.runChatGptPhoneJob(jobId, {
    timeoutMs: 30_000,
    settleMs: 500,
    newChat: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  const pulled = autodown.pullAutoDownNativeJob({
    clientId: "native-flow-test-client",
    deviceId: "native-flow-test-device",
    label: "Cromite native flow test",
  });

  assert.ok(pulled);
  assert.equal(pulled.id, jobId);
  assert.equal(pulled.site, "chatgpt");

  const metadata = pulled.metadata as Record<string, unknown>;
  assert.equal(metadata.source, "chatgpt-phone");
  assert.equal(typeof metadata.chatgpt, "object");

  const base64Png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax3pK0AAAAASUVORK5CYII=";
  autodown.submitAutoDownNativeJobResult({
    client_id: "native-flow-test-client",
    job_id: jobId,
    status: "success",
    site: "chatgpt",
    requested_url: "https://chatgpt.com/",
    requested_asset_type: "image",
    link_info: {
      selected: {
        type: "image",
        filename: "native-flow-test.png",
      },
      embedded_file_base64: base64Png1x1,
      embedded_file_name: "native-flow-test.png",
      embedded_content_type: "image/png",
    },
    message: "Imagem gerada.",
  });

  const finalJob = await runner;
  assert.equal(finalJob.status, "succeeded");
  assert.equal(finalJob.resultType, "media");
  assert.equal(finalJob.phoneApiUrl, null);
  assert.equal(finalJob.artifacts.length, 1);
  assert.equal(finalJob.artifacts[0]?.mimeType, "image/png");
  assert.equal(finalJob.artifacts[0]?.fileName, "native-flow-test.png");
  assert.ok(finalJob.artifacts[0]?.base64);

  const { getDb } = await import("lib/db");
  await getDb().query("DELETE FROM chatgpt_phone_jobs WHERE job_id = ? LIMIT 1", [jobId]);

  console.log(`chatgpt-phone-native-flow ok job=${jobId}`);
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
