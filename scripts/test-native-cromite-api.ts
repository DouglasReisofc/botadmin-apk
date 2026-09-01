#!/usr/bin/env tsx

import assert from "node:assert/strict";

import {
  enqueueAutoDownNativeJob,
  pullAutoDownNativeJob,
  resetAutoDownState,
  submitAutoDownNativeJobResult,
} from "lib/autodown";

const main = () => {
  resetAutoDownState();

  const job = enqueueAutoDownNativeJob({
    id: "native-test-job",
    url: "https://chatgpt.com/",
    site: "chatgpt",
    metadata: {
      source: "test",
      chatgpt: {
        prompt: "Crie uma imagem simples de teste.",
        file_name_hint: "native-test.png",
      },
    },
  });

  assert.equal(job.id, "native-test-job");
  assert.equal(job.site, "chatgpt");

  const pulled = pullAutoDownNativeJob({
    clientId: "native-test-client",
    deviceId: "native-test-device",
    label: "Cromite test",
  });

  assert.ok(pulled);
  assert.equal(pulled.id, "native-test-job");
  assert.equal(pulled.metadata.chatgpt && typeof pulled.metadata.chatgpt, "object");

  const base64Png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax3pK0AAAAASUVORK5CYII=";
  const result = submitAutoDownNativeJobResult({
    client_id: "native-test-client",
    job_id: "native-test-job",
    status: "success",
    site: "chatgpt",
    requested_url: "https://chatgpt.com/",
    requested_asset_type: "image",
    link_info: {
      selected: {
        type: "image",
        filename: "native-test.png",
      },
      embedded_file_base64: base64Png1x1,
      embedded_file_name: "native-test.png",
      embedded_content_type: "image/png",
    },
    message: "Imagem gerada.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.result?.status, "success");
  assert.equal(result.result?.site, "chatgpt");
  assert.equal(result.result?.filename, "native-test.png");
  assert.equal(result.result?.mime, "image/png");
  assert.equal(
    Boolean(result.result?.metadata && "link_info" in result.result.metadata),
    true,
  );

  console.log("native-cromite-api ok");
};

main();
