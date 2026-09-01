import { DEFAULT_COMMAND_ALIASES } from "resources/default-command-aliases";

export type FieldTutorial = {
  slug: string;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  updatedAt: string;
  mediaPath?: string | null;
};

export type FieldTutorialMap = Partial<Record<string, FieldTutorial>>;

export type TutorialFieldDefinition<Key extends string = string> = {
  key: Key;
  slug: string;
  label: string;
  description: string;
};

export type TutorialSection = {
  id: string;
  title: string;
  description: string;
  fields: TutorialFieldDefinition[];
};

export type WebhookTutorialFieldKey =
  | "endpoint"
  | "verifyToken"
  | "appId"
  | "businessAccountId"
  | "phoneNumberId"
  | "accessToken";

export const WEBHOOK_TUTORIAL_FIELDS: TutorialFieldDefinition<WebhookTutorialFieldKey>[] = [
  {
    key: "endpoint",
    slug: "webhook-endpoint",
    label: "Endpoint",
    description:
      "Explique como localizar o endpoint gerado pela plataforma e onde ele deve ser cadastrado na Meta.",
  },
  {
    key: "verifyToken",
    slug: "webhook-verify-token",
    label: "Verify Token",
    description:
      "Oriente o usuário sobre como definir o token de verificação utilizado na etapa de validação do webhook.",
  },
  {
    key: "appId",
    slug: "webhook-app-id",
    label: "App ID",
    description:
      "Detalhe como encontrar o identificador do aplicativo no painel da Meta para integrá-lo ao chatbot.",
  },
  {
    key: "businessAccountId",
    slug: "webhook-business-account-id",
    label: "WhatsApp Business Account ID",
    description:
      "Mostre como identificar a conta do WhatsApp Business vinculada à Cloud API.",
  },
  {
    key: "phoneNumberId",
    slug: "webhook-phone-number-id",
    label: "Phone Number ID",
    description:
      "Explique como localizar o identificador do número conectado à API do WhatsApp.",
  },
  {
    key: "accessToken",
    slug: "webhook-access-token",
    label: "Access Token",
    description:
      "Instrua o usuário a gerar e copiar o token de acesso permanente utilizado para enviar mensagens.",
  },
];

export const WEBHOOK_TUTORIAL_SLUG_BY_KEY = WEBHOOK_TUTORIAL_FIELDS.reduce(
  (accumulator, field) => ({ ...accumulator, [field.key]: field.slug }),
  {} as Record<WebhookTutorialFieldKey, string>,
);

export type GroupTutorialFieldKey =
  | "activations"
  | "welcome"
  | "autoresponse"
  | "ads"
  | "schedule"
  | "botinterage"
  | "sweepstakes"
  | "details"
  | "media"
  | "aliases"
  | "groupadd";

export type InstanceTutorialFieldKey = "instancesconnect";

export const GROUP_TUTORIAL_FIELDS: TutorialFieldDefinition<GroupTutorialFieldKey>[] = [
  {
    key: "activations",
    slug: "group-activations",
    label: "Ativações do grupo",
    description:
      "Explique como ligar ou desligar recursos, configurar prefixos, listas de bloqueio e demais controles de automação.",
  },
  {
    key: "welcome",
    slug: "group-welcome",
    label: "Mensagem de boas-vindas",
    description:
      "Ensine a personalizar a mensagem enviada a novos participantes, anexar mídia e aplicar regras automaticamente.",
  },
  {
    key: "autoresponse",
    slug: "group-autoresponse",
    label: "Autorespostas",
    description:
      "Mostre como criar respostas rápidas disparadas por palavras-chave, anexar mídia e configurar cartões de contato.",
  },
  {
    key: "ads",
    slug: "group-ads",
    label: "Anúncios programados",
    description:
      "Explique como cadastrar mensagens promocionais automáticas, definir horários e anexar mídias para divulgação.",
  },
  {
    key: "schedule",
    slug: "group-schedule",
    label: "Abrir e fechar grupo",
    description:
      "Mostre como programar horários para fechar o grupo apenas para administradores ou reabri-lo para todos automaticamente.",
  },
  {
    key: "botinterage",
    slug: "group-botinterage",
    label: "Bot interage (IA)",
    description:
      "Ensine a ativar o assistente de IA, cadastrar chaves Groq, configurar prompt personalizado e habilitar respostas por voz.",
  },
  {
    key: "sweepstakes",
    slug: "group-sweepstakes",
    label: "Sorteios",
    description:
      "Mostre como criar sorteios automáticos, definir duração, limites de participantes e finalizar tudo pelo painel.",
  },
  {
    key: "details",
    slug: "group-details",
    label: "Dados do grupo",
    description:
      "Oriente a atualizar nome, descrição, foto, mensagens temporárias e permissões administrativas do grupo.",
  },
  {
    key: "media",
    slug: "group-media",
    label: "Menus do bot",
    description:
      "Explique como editar os menus enviados pelo bot dentro do grupo, incluindo textos, botões e imagens de fundo.",
  },
  {
    key: "aliases",
    slug: "group-aliases",
    label: "Nomes dos comandos",
    description:
      "Mostre como personalizar os nomes de cada comando e definir variações que os participantes podem utilizar.",
  },
  {
    key: "groupadd",
    slug: "group-add",
    label: "Cadastrar grupo",
    description:
      "Ensine como vincular um grupo do WhatsApp, colar o convite e escolher a instância correta para o robô.",
  },
];

export const GROUP_TUTORIAL_SLUG_BY_KEY = GROUP_TUTORIAL_FIELDS.reduce(
  (accumulator, field) => ({ ...accumulator, [field.key]: field.slug }),
  {} as Record<GroupTutorialFieldKey, string>,
);

export type GroupActivationTutorialKey =
  | "antifake"
  | "bloqueiolinks"
  | "antipalavras"
  | "multprefixo"
  | "soadm"
  | "antilinkgp"
  | "banextremo";

export const GROUP_ACTIVATION_TUTORIAL_FIELDS: TutorialFieldDefinition<GroupActivationTutorialKey>[] =
  [
    {
      key: "antifake",
      slug: "group-activation-antifake",
      label: "Anti-fake",
      description:
        "Explique como a validação de DDI funciona, quais mensagens são exibidas e quando utilizar o recurso Anti-fake.",
    },
    {
      key: "bloqueiolinks",
      slug: "group-activation-bloqueiolinks",
      label: "Bloqueio automático de links",
      description:
        "Detalhe quais links são bloqueados, como configurar exceções e quando ativar o bloqueio automático.",
    },
    {
      key: "antipalavras",
      slug: "group-activation-antipalavras",
      label: "Bloquear palavras proibidas",
      description:
        "Descreva como cadastrar palavras proibidas, ajustar o limite de infrações e orientar a remoção automática.",
    },
    {
      key: "multprefixo",
      slug: "group-activation-multprefixo",
      label: "Multi prefixo",
      description:
        "Mostre como adicionar vários prefixos personalizados e em quais situações o recurso é recomendado.",
    },
    {
      key: "soadm",
      slug: "group-activation-soadm",
      label: "Modo só admins",
      description:
        "Oriente quando ativar o modo exclusivo para administradores e como ele afeta os demais participantes.",
    },
    {
      key: "antilinkgp",
      slug: "group-activation-antilinkgp",
      label: "Bloquear convites do WhatsApp",
      description:
        "Explique como o robô identifica convites de grupos/canais e quais medidas ele toma ao bloqueá-los.",
    },
    {
      key: "banextremo",
      slug: "group-activation-banextremo",
      label: "Ban automático",
      description:
        "Apresente quando utilizar o banimento automático e quais regras devem ser configuradas antes de ativá-lo.",
    },
  ];

export const GROUP_ACTIVATION_TUTORIAL_SLUG_BY_KEY =
  GROUP_ACTIVATION_TUTORIAL_FIELDS.reduce(
    (accumulator, field) => ({ ...accumulator, [field.key]: field.slug }),
    {} as Record<GroupActivationTutorialKey, string>,
  );

const COMMAND_TUTORIAL_ENTRIES = Object.keys(DEFAULT_COMMAND_ALIASES || {}).sort((a, b) =>
  a.localeCompare(b),
);

export type CommandTutorialFieldKey = string;

export const COMMAND_TUTORIAL_FIELDS: TutorialFieldDefinition<CommandTutorialFieldKey>[] =
  COMMAND_TUTORIAL_ENTRIES.map((key) => {
    const aliases = DEFAULT_COMMAND_ALIASES?.[key] ?? [];
    const aliasList =
      Array.isArray(aliases) && aliases.length > 0 ? aliases.map((item) => `/${item}`).join(", ") : `/${key}`;

    return {
      key,
      slug: `command-${key}`,
      label: `Comando ${aliasList.split(", ")[0]}`,
      description: `Explique como e quando utilizar o comando ${aliasList}, incluindo exemplos práticos.`,
    };
  });

export const COMMAND_TUTORIAL_SLUG_BY_KEY = COMMAND_TUTORIAL_FIELDS.reduce(
  (accumulator, field) => ({ ...accumulator, [field.key]: field.slug }),
  {} as Record<CommandTutorialFieldKey, string>,
);

export const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    id: "instances",
    title: "Painel do usuário · Instâncias",
    description:
      "Tutoriais que aparecem na tela de conexão do WhatsApp para guiar o pareamento do robô.",
    fields: [
      {
        key: "instancesconnect",
        slug: "instances-connect",
        label: "Conectar instância",
        description:
          "Explique como criar uma nova instância, gerar o QR Code ou código de pareamento e conectar o número do robô.",
      },
    ],
  },
  {
    id: "webhook",
    title: "Integração com a Meta",
    description:
      "Tutoriais exibidos nas etapas de configuração do webhook para orientar a conexão com a API oficial.",
    fields: WEBHOOK_TUTORIAL_FIELDS,
  },
  {
    id: "group-settings",
    title: "Painel do usuário · Grupos",
    description:
      "Materiais de apoio que aparecem nas principais abas de configuração dos grupos dentro do painel do usuário.",
    fields: GROUP_TUTORIAL_FIELDS,
  },
  {
    id: "group-activations",
    title: "Painel do usuário · Ativações",
    description:
      "Conteúdos específicos sobre cada ativação do bot, ajudando o usuário a entender como e quando habilitar cada recurso.",
    fields: GROUP_ACTIVATION_TUTORIAL_FIELDS,
  },
  {
    id: "group-commands",
    title: "Painel do usuário · Comandos do bot",
    description:
      "Tutoriais específicos para cada comando. São exibidos ao lado dos campos de personalização de nomes.",
    fields: COMMAND_TUTORIAL_FIELDS,
  },
];

export const ALL_TUTORIAL_SLUGS = TUTORIAL_SECTIONS.flatMap((section) =>
  section.fields.map((field) => field.slug),
);
