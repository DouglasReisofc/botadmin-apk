export const DEFAULT_UNKNOWN_COMMAND_TEMPLATE_SAMPLE = [
  "⚠️ Comando desconhecido: {{comando}}",
  "",
  "📅 Data: {{data}}",
  "⏰ Hora: {{hora}}",
  "👤 Usuário: {{usuario}}",
  "🆔 ID: {{id}}",
  "👥 Grupo: {{grupo}}",
  "🪪 Cobertura: {{cobertura_texto}}",
  "",
  "{{sugestao_texto}}",
  "{{menu_hint}}",
]
  .filter(Boolean)
  .join("\n");

export const UNKNOWN_COMMAND_VARIABLES = [
  { token: "{{comando}}", description: "Comando digitado (com prefixo)." },
  { token: "{{mensagem}}", description: "Mensagem completa enviada pelo contato." },
  { token: "{{prefixo}}", description: "Prefixo principal configurado para o grupo." },
  { token: "{{menu_comando}}", description: "Atalho do menu (ex.: /menu)." },
  { token: "{{menu_hint}}", description: "Texto pronto incentivando o uso do menu." },
  { token: "{{sugestao}}", description: "Comando sugerido sem textos adicionais." },
  { token: "{{sugestao_texto}}", description: "Mensagem completa com a sugestão (quando existir)." },
  { token: "{{data}}", description: "Data atual no fuso do bot (DD/MM/AAAA)." },
  { token: "{{hora}}", description: "Horário atual." },
  { token: "{{usuario}}", description: "Nome do usuário que enviou a mensagem." },
  { token: "{{id}}", description: "JID completo (ID) do usuário." },
  { token: "{{usuario_numero}}", description: "Número do usuário sem o domínio." },
  { token: "{{grupo}}", description: "ID completo do grupo." },
  { token: "{{grupo_nome}}", description: "Nome do grupo." },
  { token: "{{instancia}}", description: "Nome da instância que respondeu." },
  { token: "{{cobertura_texto}}", description: "Origem + validade do plano/add-on em uso." },
  { token: "{{cobertura_origem}}", description: "Origem da cobertura (plano ou add-on)." },
  { token: "{{cobertura_expira_em}}", description: "Texto amigável com a data de expiração." },
  { token: "{{cobertura_data}}", description: "Data de expiração em formato ISO (quando disponível)." },
] as const;
