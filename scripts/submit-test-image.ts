import { submitBotInterageSystemImageJob } from "../lib/botinterage-system";

const main = async () => {
  const startedAt = Date.now();
  const job = await submitBotInterageSystemImageJob({
    groupId: 1404,
    userId: 22732,
    instanceId: 266,
    chatId: "120363406245712972@g.us",
    senderJid: "botadmin-e2e-test",
    prompt:
      "Crie uma imagem quadrada simples para teste técnico: um cérebro azul brilhante conectado a um balão de conversa, fundo escuro, sem texto.",
  });
  console.log(JSON.stringify({ ...job, submitMs: Date.now() - startedAt }));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao criar imagem de teste");
  process.exitCode = 1;
});
