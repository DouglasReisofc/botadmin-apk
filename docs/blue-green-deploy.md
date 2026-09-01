# Deploy blue/green do BotAdmin no aaPanel

O BotAdmin usa dois processos Next.js no mesmo servidor:

- `blue`: porta 4322 e build `.next-blue`;
- `green`: porta 4323 e build `.next-green`.

O Nginx do aaPanel aponta para o slot ativo e mantém a versão anterior como
fallback permanente. O deploy envia o build apenas ao slot inativo, testa o
endpoint público e troca o tráfego. Depois, a versão anterior permanece ligada
como standby com `BOTADMIN_DISABLE_BACKGROUND_JOBS=1`, sem duplicar schedulers,
disparos ou consumidores. Assim, uma oscilação curta do processo ativo não
deixa o Nginx sem upstream e não gera uma sequência de respostas 502.

## Publicar

Com a chave SSH de deploy instalada (configuração padrão desta VPS):

```bash
npm run deploy:bluegreen
```

Em outra máquina que ainda não tenha a chave, a senha pode ser fornecida somente
ao processo (não é salva no repositório):

```bash
BOTADMIN_SSH_PASSWORD='senha' npm run deploy:bluegreen
```

Para publicar um build `.next` que já existe, sem compilá-lo novamente:

```bash
BOTADMIN_SSH_PASSWORD='senha' npm run deploy:bluegreen:current-build
```

## Conferir e reverter

```bash
BOTADMIN_SSH_PASSWORD='senha' npm run deploy:bluegreen:status
BOTADMIN_SSH_PASSWORD='senha' npm run deploy:bluegreen:rollback
```

As tarefas em segundo plano ficam desligadas no primeiro health check. Ao
ativá-las, os dispatchers usam leases no Redis, impedindo duas instâncias de
executarem a mesma rotina durante a curta sobreposição da troca.

O fluxo não substitui a necessidade futura de uma segunda VPS para falha total
da máquina. Ele elimina a indisponibilidade causada por restart durante deploy
na VPS atual.
