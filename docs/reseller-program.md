# Programa de parceiros

O programa usa três camadas independentes:

- `admin_panel_members`: papel e permissões do painel (`manager`, `reseller` ou `support`), sem alterar `users.role`.
- `reseller_wallets` e `reseller_credit_ledger`: créditos de ativação, estornos e idempotência.
- `reseller_customer_links`: carteira de clientes de cada parceiro e plano ativo.

## Fluxos

1. Um administrador abre **Parceiros**, seleciona um usuário, define o papel, permissões e percentual de comissão.
2. O administrador adiciona créditos usando uma chave de idempotência opcional.
3. O revendedor abre **Afiliados > Programa de revenda**, cadastra o cliente e pode ativar ou renovar um plano consumindo um crédito.
4. A ativação é transacional; se a assinatura não puder ser aplicada, o crédito é devolvido automaticamente.

## Endpoints

- `GET/POST /api/admin/partners`: listar/vincular parceiros e lançar créditos.
- `GET/POST /api/user/reseller`: carteira, clientes, cadastro e ativação do próprio revendedor.

Os endpoints validam permissões no servidor, registram auditoria e são seguros para repetição. A coluna `features_json` em `subscription_plans` permite liberar recursos por plano; a tela de planos administra esses flags e os helpers `assertUserPlanFeature`/`getUserPlanFeature` fazem a validação de entitlement.

