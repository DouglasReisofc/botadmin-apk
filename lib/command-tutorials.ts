import { DEFAULT_COMMAND_ALIASES } from "resources/default-command-aliases";
import type { FieldTutorial, TutorialFieldDefinition } from "types/tutorials";

export type CommandTutorialSectionData = {
  id: string;
  title: string;
  description: string;
  tutorials: FieldTutorial[];
};

export type PublicTutorialSectionMeta = {
  id: string;
  title: string;
  description: string;
  fieldLabel: string;
  fieldDescription: string;
};

type CommandTutorialEntry = {
  command: string;
  description: string;
  adminOnly: boolean;
  aliases: string[];
};

export type CommandFunctionInfo = {
  summary: string;
  when: string[];
  usage?: string[];
  adminOnly?: boolean;
  related?: string[];
};

type CommandCategoryDefinition = {
  id: string;
  title: string;
  description: string;
  match: RegExp;
};

const GENERATED_TUTORIAL_UPDATED_AT = "2026-05-12T13:00:00.000Z";

const EXTRA_RUNTIME_COMMANDS = [
  "abrirgp",
  "abrirgrupo",
  "addads",
  "rmads",
  "listads",
  "ads",
  "painel",
  "amazon",
  "mercadolivre",
  "freepik",
  "envato",
  "tts",
  "videotts",
  "legendaaudio",
  "audiovideo",
  "audionovideo",
  "videodoaudio",
  "vozvideo",
  "infovideotts",
  "listatts",
  "clonarvoz",
  "rmtts",
  "cancelarrifa",
  "criarimagem",
  "criarimage",
  "createimage",
  "tourl",
  "tuurl",
  "resolver",
  "desencurtar",
  "unshorten",
  "movie",
  "series",
  "série",
  "s2",
  "sticker2",
  "fig",
  "gif",
  "figurinhas",
  "stickers",
  "fig2",
  "figpack",
  "stickerpack",
  "renomear",
  "delete",
  "del",
  "apagarmensagem",
  "mutar",
  "silenciar",
  "desmutar",
  "ativar",
  "fechargp",
  "fechargrupo",
  "removeautorepo",
  "addad",
  "removeads",
  "cancelarrifa",
] as const;

const COMMAND_FACTS: Record<string, CommandFunctionInfo> = {
  abrirauto: {
    summary: "configura os horarios em que o grupo sera aberto automaticamente para todos enviarem mensagens.",
    when: ["quando voce quer reabrir o grupo todos os dias em horarios fixos", "quando a comunidade fecha de madrugada e volta pela manha"],
    usage: ["!abrirauto 07:00 12:00", "!abrirauto on", "!abrirauto off", "!abrirauto 1", "!abrirauto 0"],
    adminOnly: true,
    related: ["fecharauto", "horariotz", "abrirgrupo"],
  },
  abrirgp: {
    summary: "abre o grupo manualmente ou programa horarios de abertura se voce informar HH:MM.",
    when: ["quando o grupo esta fechado apenas para administradores", "quando voce quer liberar conversa imediatamente ou configurar abertura automatica"],
    usage: ["!abrirgp", "!abrirgp 07:00", "!abrirgp off"],
    adminOnly: true,
    related: ["fechargp", "abrirauto", "fecharauto"],
  },
  abrirgrupo: {
    summary: "abre o grupo manualmente, liberando mensagens de todos os participantes.",
    when: ["quando o grupo esta fechado apenas para administradores", "quando voce quer liberar conversa imediatamente sem esperar o horario automatico"],
    usage: ["!abrirgrupo"],
    adminOnly: true,
    related: ["fechargrupo", "abrirauto", "fecharauto"],
  },
  addads: {
    summary: "cadastra um anuncio automatico com texto, intervalo, horarios e midia opcional.",
    when: ["quando voce quer divulgar uma mensagem recorrente no grupo", "quando precisa programar campanhas, avisos ou ofertas"],
    usage: ["!addads 6h | texto do anuncio", "!addads 08:00 12:00 | texto do anuncio"],
    adminOnly: true,
    related: ["listads", "rmads"],
  },
  addad: {
    summary: "cadastra um anuncio automatico com texto, intervalo, horarios e midia opcional.",
    when: ["quando voce quer divulgar uma mensagem recorrente no grupo", "quando precisa programar campanhas, avisos ou ofertas"],
    usage: ["!addad 6h | texto do anuncio"],
    adminOnly: true,
    related: ["listads", "rmads"],
  },
  addautorepo: {
    summary: "cria uma autoresposta com um ou mais gatilhos e uma resposta em texto ou midia.",
    when: ["quando o grupo recebe perguntas repetidas", "quando uma palavra-chave deve disparar uma resposta pronta"],
    usage: ["!addautorepo preco, valor | Nosso plano custa R$ 25", "responda uma midia com !addautorepo catalogo |"],
    adminOnly: true,
    related: ["autoresposta", "listaautorepo", "rmautorepo"],
  },
  addblacklist: {
    summary: "adiciona um numero a lista de bloqueio e tenta remover o participante do grupo.",
    when: ["quando um participante deve ficar impedido de voltar", "quando voce quer bloquear por numero, nao apenas remover uma vez"],
    usage: ["!addblacklist @usuario", "!addblacklist 5511999999999"],
    adminOnly: true,
    related: ["rmblacklist", "ban", "kick"],
  },
  addhorapg: {
    summary: "configura os horarios e recados exibidos pelo comando de agenda do grupo.",
    when: ["quando o grupo precisa de lembretes diarios", "quando horarios fixos devem aparecer para os participantes"],
    usage: ["!addhorapg 08:00 12:30", "!addhorapg 08:00 | Abrir atendimento"],
    adminOnly: true,
    related: ["horapg", "horariotz"],
  },
  addregras: {
    summary: "cadastra ou atualiza as regras oficiais do grupo, com texto e midia opcional.",
    when: ["quando as regras mudarem", "quando voce quer deixar o regulamento disponivel para todos consultarem"],
    usage: ["!addregras texto completo das regras", "responda uma imagem ou video com !addregras"],
    adminOnly: true,
    related: ["regras", "bemvindo", "menuadm"],
  },
  addtabela: {
    summary: "cadastra ou atualiza uma tabela, cardapio, lista de valores ou comunicado fixo do grupo.",
    when: ["quando membros pedem a mesma tabela com frequencia", "quando voce quer salvar precos, horarios ou cardapio"],
    usage: ["!addtabela texto da tabela", "responda uma imagem com !addtabela"],
    adminOnly: true,
    related: ["tabela", "comandos"],
  },
  ads: {
    summary: "lista os anuncios automaticos cadastrados no grupo.",
    when: ["quando voce quer conferir campanhas ativas", "antes de remover ou editar anuncios recorrentes"],
    usage: ["!ads"],
    adminOnly: true,
    related: ["addads", "rmads", "listads"],
  },
  all: {
    summary: "menciona todos os participantes do grupo em uma chamada geral.",
    when: ["quando todos precisam receber um aviso", "quando uma comunicacao importante nao pode depender de leitura passiva"],
    usage: ["!all aviso importante"],
    adminOnly: true,
    related: ["marcar", "mencionar", "hidetag"],
  },
  allg: {
    summary: "menciona todos os participantes do grupo em uma chamada geral.",
    when: ["quando todos precisam receber um aviso", "quando uma comunicacao importante nao pode depender de leitura passiva"],
    usage: ["!allg aviso importante"],
    adminOnly: true,
    related: ["marcar", "mencionar", "hidetag"],
  },
  amazon: {
    summary: "pesquisa produtos da Amazon pelo comando de busca integrado.",
    when: ["quando o grupo usa afiliados ou consulta de produtos", "quando voce quer buscar um item sem sair do WhatsApp"],
    usage: ["!amazon nome do produto"],
    related: ["mercadolivre"],
  },
  antdoc: {
    summary: "liga ou desliga o bloqueio de documentos enviados no grupo.",
    when: ["quando documentos nao devem ser enviados por membros", "quando o grupo quer reduzir arquivos suspeitos"],
    usage: ["!antdoc"],
    adminOnly: true,
    related: ["antimage", "antvideo", "antaudio"],
  },
  antimage: {
    summary: "liga ou desliga o bloqueio de imagens enviadas no grupo.",
    when: ["quando imagens devem ser restritas", "quando o grupo precisa operar apenas com texto"],
    usage: ["!antimage"],
    adminOnly: true,
    related: ["antvideo", "antisticker", "antinsfwimagem"],
  },
  antilink: {
    summary: "liga ou desliga o bloqueio de links gerais enviados por membros.",
    when: ["quando o grupo sofre com spam de links", "quando apenas links aprovados devem passar"],
    usage: ["!antilink"],
    adminOnly: true,
    related: ["permitirlink", "removerlink", "linkspermitidos"],
  },
  antilinkgp: {
    summary: "liga ou desliga o bloqueio de convites de grupos e canais do WhatsApp.",
    when: ["quando membros divulgam outros grupos", "quando convites externos precisam ser bloqueados automaticamente"],
    usage: ["!antilinkgp"],
    adminOnly: true,
    related: ["antilink", "banextremo"],
  },
  antinsfwimagem: {
    summary: "analisa imagens recebidas e bloqueia conteudo adulto ou NSFW quando ativado.",
    when: ["quando o grupo precisa barrar imagem adulta", "quando o bot deve aplicar moderacao visual automatica"],
    usage: ["!antinsfwimagem"],
    adminOnly: true,
    related: ["moderacaocomia", "antimage"],
  },
  antipalavras: {
    summary: "liga ou desliga o filtro de palavras proibidas no grupo.",
    when: ["quando certas palavras devem gerar remocao ou infracao", "quando a moderacao precisa impedir termos especificos"],
    usage: ["!antipalavras"],
    adminOnly: true,
    related: ["resetinfra", "moderacaocomia"],
  },
  antisticker: {
    summary: "liga ou desliga o bloqueio de figurinhas enviadas no grupo.",
    when: ["quando figurinhas atrapalham a conversa", "quando o grupo precisa reduzir flood visual"],
    usage: ["!antisticker"],
    adminOnly: true,
    related: ["autosticker", "antimage"],
  },
  antaudio: {
    summary: "liga ou desliga o bloqueio de audios enviados no grupo.",
    when: ["quando audios nao devem ser permitidos", "quando o grupo precisa manter conversas em texto"],
    usage: ["!antaudio"],
    adminOnly: true,
    related: ["antvideo", "antdoc"],
  },
  antvcard: {
    summary: "liga ou desliga o bloqueio de contatos e vCards enviados no grupo.",
    when: ["quando membros usam contatos para spam", "quando o grupo quer impedir compartilhamento de numeros"],
    usage: ["!antvcard"],
    adminOnly: true,
    related: ["antdoc", "antilink"],
  },
  antvideo: {
    summary: "liga ou desliga o bloqueio de videos enviados no grupo.",
    when: ["quando videos devem ser restritos", "quando o grupo precisa evitar midias pesadas"],
    usage: ["!antvideo"],
    adminOnly: true,
    related: ["antimage", "antaudio"],
  },
  apagar: {
    summary: "apaga a mensagem respondida, desde que o bot tenha permissao no grupo.",
    when: ["quando uma mensagem precisa ser removida rapidamente", "quando o admin quer limpar spam ou conteudo indevido"],
    usage: ["responda uma mensagem com !apagar"],
    adminOnly: true,
    related: ["ban", "mute"],
  },
  apkmodhacker: {
    summary: "pesquisa aplicativos APK modificados pelo recurso legado conectado ao bot.",
    when: ["quando o recurso legado de APK estiver ativo", "quando usuarios pesquisam apps modificados"],
    usage: ["!apkmodhacker nome do app"],
  },
  ativar: {
    summary: "remove o silencio de um participante que estava mutado.",
    when: ["quando o membro pode voltar a enviar mensagens", "quando um mute temporario precisa ser encerrado manualmente"],
    usage: ["!ativar @usuario"],
    adminOnly: true,
    related: ["mute", "unmute"],
  },
  attp: {
    summary: "gera figurinha animada com texto.",
    when: ["quando voce quer transformar uma frase curta em sticker animado", "quando o grupo usa figurinhas de texto"],
    usage: ["!attp texto da figurinha"],
    related: ["attp2", "attp3", "sticker"],
  },
  attp2: {
    summary: "gera uma variacao de figurinha animada com texto.",
    when: ["quando voce quer outro estilo de sticker de texto", "quando o comando !attp nao entrega o estilo desejado"],
    usage: ["!attp2 texto da figurinha"],
    related: ["attp", "attp3"],
  },
  attp3: {
    summary: "gera uma variacao de figurinha animada com texto.",
    when: ["quando voce quer outro estilo de sticker de texto", "quando o grupo usa stickers animados"],
    usage: ["!attp3 texto da figurinha"],
    related: ["attp", "attp2"],
  },
  autodownloader: {
    summary: "liga ou desliga o download automatico de links suportados enviados no grupo.",
    when: ["quando links de midia devem virar arquivo automaticamente", "quando o grupo usa TikTok, YouTube, Instagram ou outros links suportados"],
    usage: ["!autodownloader"],
    adminOnly: true,
    related: ["menudownloads", "ytmp3", "tiktok"],
  },
  autoresposta: {
    summary: "liga ou desliga respostas automaticas por palavra-chave.",
    when: ["quando gatilhos cadastrados devem responder sozinhos", "quando voce quer pausar ou ativar o atendimento automatico"],
    usage: ["!autoresposta"],
    adminOnly: true,
    related: ["addautorepo", "rmautorepo", "listaautorepo"],
  },
  autosticker: {
    summary: "liga ou desliga a conversao automatica de imagens e videos curtos em figurinhas.",
    when: ["quando imagens enviadas no grupo devem virar sticker", "quando voce quer automatizar criacao de figurinhas"],
    usage: ["!autosticker"],
    adminOnly: true,
    related: ["sticker", "attp"],
  },
  avadakedrava: {
    summary: "remove do grupo o participante respondido, mencionado ou informado por numero.",
    when: ["quando voce quer usar o alias de banimento", "quando um membro precisa ser removido imediatamente"],
    usage: ["!avadakedrava @usuario"],
    adminOnly: true,
    related: ["ban", "kick"],
  },
  ban: {
    summary: "remove do grupo o participante respondido, mencionado ou informado por numero.",
    when: ["quando um membro viola regras e precisa sair", "quando spam ou abuso precisa de acao imediata"],
    usage: ["!ban @usuario", "responda uma mensagem com !ban"],
    adminOnly: true,
    related: ["kick", "addblacklist", "apagar"],
  },
  banextremo: {
    summary: "liga ou desliga a remocao automatica de quem insiste em enviar links proibidos.",
    when: ["quando o antilink precisa punir reincidencia", "quando voce quer uma moderacao mais rigida contra spam"],
    usage: ["!banextremo"],
    adminOnly: true,
    related: ["antilink", "antilinkgp"],
  },
  bangringos: {
    summary: "liga ou desliga a remocao automatica de participantes com DDI nao permitido.",
    when: ["quando o grupo quer aceitar apenas certos paises", "quando entradas estrangeiras estao gerando spam"],
    usage: ["!bangringos"],
    adminOnly: true,
    related: ["addddi", "rmddi", "rmgringos"],
  },
  bemvindo: {
    summary: "liga ou desliga a mensagem automatica de boas-vindas para novos participantes.",
    when: ["quando novos membros devem receber saudacao", "quando regras, links ou instrucoes precisam aparecer na entrada"],
    usage: ["!bemvindo"],
    adminOnly: true,
    related: ["fundobemvindo", "legendabemvindo", "addregras"],
  },
  botinterage: {
    summary: "liga ou desliga a IA que responde mensagens no grupo.",
    when: ["quando voce quer o bot conversando com membros", "quando o atendimento automatico precisa responder perguntas abertas"],
    usage: ["!botinterage"],
    adminOnly: true,
    related: ["vozbotinterage", "promptbot", "keygroq"],
  },
  cancelarrifa: {
    summary: "cancela uma rifa ativa quando ela ainda pode ser encerrada.",
    when: ["quando uma rifa precisa ser encerrada sem sorteio", "quando houve erro na criacao da rifa"],
    usage: ["!cancelarrifa"],
    adminOnly: true,
    related: ["rifa", "addrifa"],
  },
  clonarvoz: {
    summary: "abre o fluxo de clonagem ou cadastro de voz para uso nos comandos de TTS.",
    when: ["quando voce quer criar uma voz personalizada", "quando o grupo usa narracao por voz clonada"],
    usage: ["!clonarvoz"],
    adminOnly: true,
    related: ["tts", "listatts", "rmtts"],
  },
  comandos: {
    summary: "exibe a lista completa de comandos disponiveis para usuarios do grupo.",
    when: ["quando o usuario nao sabe quais comandos existem", "quando voce quer mostrar atalhos sem abrir o menu principal"],
    usage: ["!comandos"],
    related: ["menu", "menuadm", "menudownloads"],
  },
  comprarcoins: {
    summary: "inicia uma compra ou recarga de BotCoins para o participante.",
    when: ["quando o usuario quer adicionar moedas ao saldo", "quando o grupo monetiza BotCoins"],
    usage: ["!comprarcoins 100"],
    related: ["coins", "menubotcoins", "premium"],
  },
  comprarpremium: {
    summary: "abre o menu de compra premium com os planos configurados pelo administrador do grupo.",
    when: ["quando o grupo cobra acesso a comandos premium", "quando um membro quer escolher um plano premium de 30, 60, 90 dias ou outro prazo configurado"],
    usage: ["!comprarpremium", "botao Plano 1, Plano 2 ou Plano 3"],
    related: ["premium", "coins", "comprarcoins"],
  },
  comprarrifa: {
    summary: "compra ou reserva numeros de uma rifa ativa no grupo.",
    when: ["quando um participante quer entrar em uma rifa", "quando a rifa usa venda de numeros"],
    usage: ["!comprarrifa 1", "!comprarrifa 5 12 20"],
    related: ["rifa", "rifas", "sortearrifa"],
  },
  criarimagem: {
    summary: "gera imagem por IA a partir de um prompt de texto.",
    when: ["quando o usuario quer criar uma imagem no grupo", "quando voce quer usar o gerador de imagens conectado ao bot"],
    usage: ["!criarimagem um robo administrando grupo de whatsapp"],
    related: ["imageai", "imageai3"],
  },
  criarimage: {
    summary: "gera imagem por IA a partir de um prompt de texto.",
    when: ["quando o usuario quer criar uma imagem no grupo", "quando voce quer usar o gerador de imagens conectado ao bot"],
    usage: ["!criarimage um robo administrando grupo de whatsapp"],
    related: ["criarimagem", "imageai"],
  },
  createimage: {
    summary: "gera imagem por IA a partir de um prompt de texto.",
    when: ["quando o usuario quer criar uma imagem no grupo", "quando voce quer usar o gerador de imagens conectado ao bot"],
    usage: ["!createimage whatsapp bot dashboard"],
    related: ["criarimagem", "imageai"],
  },
  coins: {
    summary: "mostra saldo, nivel e progresso de BotCoins do participante.",
    when: ["quando o usuario quer consultar moedas", "antes de comprar premium ou usar comandos pagos"],
    usage: ["!coins"],
    related: ["coinsrank", "premium", "comprarcoins"],
  },
  coinsrank: {
    summary: "mostra o ranking de BotCoins do grupo.",
    when: ["quando participantes querem ver quem tem mais moedas", "quando o grupo usa competicao por saldo"],
    usage: ["!coinsrank"],
    related: ["coins", "menubotcoins"],
  },
  del: {
    summary: "apaga a mensagem respondida, desde que o bot tenha permissao no grupo.",
    when: ["quando uma mensagem precisa ser removida rapidamente", "quando o admin quer limpar spam ou conteudo indevido"],
    usage: ["responda uma mensagem com !del"],
    adminOnly: true,
    related: ["apagar"],
  },
  delete: {
    summary: "apaga a mensagem respondida, desde que o bot tenha permissao no grupo.",
    when: ["quando uma mensagem precisa ser removida rapidamente", "quando o admin quer limpar spam ou conteudo indevido"],
    usage: ["responda uma mensagem com !delete"],
    adminOnly: true,
    related: ["apagar"],
  },
  demote: {
    summary: "rebaixa um administrador para membro comum do grupo.",
    when: ["quando alguem nao deve mais ter permissao de admin", "quando voce precisa ajustar cargos pelo WhatsApp"],
    usage: ["!demote @usuario"],
    adminOnly: true,
    related: ["promote", "rebaixar"],
  },
  desencurtar: {
    summary: "resolve um link encurtado e mostra a URL final.",
    when: ["quando voce quer verificar para onde um link aponta", "quando precisa inspecionar link antes de abrir"],
    usage: ["!desencurtar https://bit.ly/exemplo"],
    related: ["resolve", "resolver"],
  },
  dono: {
    summary: "mostra informacoes do dono, suporte ou responsavel pelo bot.",
    when: ["quando o usuario precisa de suporte", "quando alguem quer saber quem administra o bot"],
    usage: ["!dono"],
    related: ["painel", "vencimento"],
  },
  envato: {
    summary: "pesquisa itens da Envato pelo recurso de busca integrado.",
    when: ["quando o grupo usa pesquisa de assets digitais", "quando voce quer consultar templates ou arquivos"],
    usage: ["!envato termo de busca"],
    related: ["freepik"],
  },
  en: {
    summary: "altera o idioma das respostas do bot para ingles.",
    when: ["quando o grupo usa ingles", "quando voce quer trocar o idioma rapidamente"],
    usage: ["!en"],
    adminOnly: true,
    related: ["idiomas", "ptbr", "es"],
  },
  english: {
    summary: "altera o idioma das respostas do bot para ingles.",
    when: ["quando o grupo usa ingles", "quando voce quer trocar o idioma rapidamente"],
    usage: ["!english"],
    adminOnly: true,
    related: ["idiomas", "ptbr", "espanol"],
  },
  es: {
    summary: "altera o idioma das respostas do bot para espanhol.",
    when: ["quando o grupo usa espanhol", "quando voce quer trocar o idioma rapidamente"],
    usage: ["!es"],
    adminOnly: true,
    related: ["idiomas", "ptbr", "en"],
  },
  espanhol: {
    summary: "altera o idioma das respostas do bot para espanhol.",
    when: ["quando o grupo usa espanhol", "quando voce quer trocar o idioma rapidamente"],
    usage: ["!espanol"],
    adminOnly: true,
    related: ["idiomas", "ptbr", "english"],
  },
  facebook: {
    summary: "baixa videos publicos do Facebook a partir de um link suportado.",
    when: ["quando alguem manda link de video do Facebook", "quando o grupo quer receber a midia direto no WhatsApp"],
    usage: ["!facebook link_do_video"],
    related: ["tiktok", "kwai", "insta"],
  },
  fechargp: {
    summary: "fecha o grupo manualmente ou programa horarios de fechamento se voce informar HH:MM.",
    when: ["quando precisa pausar a conversa", "quando o grupo entra em horario de avisos ou manutencao"],
    usage: ["!fechargp", "!fechargp 00:00", "!fechargp off"],
    adminOnly: true,
    related: ["abrirgp", "fecharauto"],
  },
  fechargrupo: {
    summary: "fecha o grupo manualmente, deixando apenas administradores enviarem mensagens.",
    when: ["quando precisa pausar a conversa", "quando o grupo entra em horario de avisos ou manutencao"],
    usage: ["!fechargrupo"],
    adminOnly: true,
    related: ["abrirgrupo", "fecharauto"],
  },
  fecharauto: {
    summary: "configura os horarios em que o grupo sera fechado automaticamente para membros.",
    when: ["quando o grupo deve fechar todos os dias em horarios fixos", "quando admins querem automatizar periodos de silencio"],
    usage: ["!fecharauto 22:00 23:30", "!fecharauto on", "!fecharauto off", "!fecharauto 1", "!fecharauto 0"],
    adminOnly: true,
    related: ["abrirauto", "horariotz", "fechargrupo"],
  },
  filme: {
    summary: "pesquisa informacoes de filmes pelo recurso de busca do bot.",
    when: ["quando usuarios pedem detalhes de um filme", "quando o grupo usa consultas de entretenimento"],
    usage: ["!filme nome do filme"],
    related: ["serie"],
  },
  frase: {
    summary: "gera um card de frase a partir de texto ou tema.",
    when: ["quando voce quer transformar texto em imagem", "quando o grupo usa cards para frases prontas"],
    usage: ["!frase sua frase aqui"],
    related: ["frase2", "gerarfrase"],
  },
  frase2: {
    summary: "gera uma variacao visual de card de frase.",
    when: ["quando voce quer outro modelo de card", "quando o comando de frase padrao nao combina com o estilo desejado"],
    usage: ["!frase2 sua frase aqui"],
    related: ["frase", "frase3"],
  },
  frase3: {
    summary: "gera um card com frase do Pensador ou tema informado.",
    when: ["quando voce quer card com autoria ou tema", "quando o grupo usa frases motivacionais"],
    usage: ["!frase3 amor"],
    related: ["gerarfrase", "frase"],
  },
  frase4: {
    summary: "gera outra variacao de card visual de frase.",
    when: ["quando voce quer diversificar o visual dos cards", "quando o grupo usa frases com frequencia"],
    usage: ["!frase4 sua frase aqui"],
    related: ["frase", "frase2"],
  },
  frasenovideo: {
    summary: "coloca uma frase em um video enviado, respondido ou informado por link.",
    when: ["quando voce quer legendar um video com texto curto", "quando usuarios criam videos com frase"],
    usage: ["responda um video com !frasenovideo texto", "!frasenovideo link_do_video | texto"],
    related: ["frasenovideo2", "frasevideo"],
  },
  frasenovideo2: {
    summary: "gera uma variacao de frase em video com suporte a handle e texto.",
    when: ["quando voce quer usar o segundo modelo de frase em video", "quando precisa incluir handle ou texto formatado"],
    usage: ["!frasenovideo2 @perfil | texto"],
    related: ["frasenovideo"],
  },
  frasevideo: {
    summary: "coloca uma frase em um video enviado, respondido ou informado por link.",
    when: ["quando voce quer legendar um video com texto curto", "quando usuarios criam videos com frase"],
    usage: ["!frasevideo texto"],
    related: ["frasenovideo"],
  },
  freepik: {
    summary: "pesquisa recursos ou assets no Freepik pelo comando integrado.",
    when: ["quando o grupo busca imagens, vetores ou assets", "quando voce quer consultar conteudo criativo"],
    usage: ["!freepik termo de busca"],
    related: ["envato"],
  },
  fundobemvindo: {
    summary: "define ou remove a imagem de fundo da mensagem visual de boas-vindas.",
    when: ["quando voce quer personalizar a entrada de novos membros", "quando a arte antiga de boas-vindas precisa ser trocada"],
    usage: ["responda uma imagem com !fundobemvindo", "!fundobemvindo reset"],
    adminOnly: true,
    related: ["bemvindo", "legendabemvindo"],
  },
  fundomenu: {
    summary: "define ou remove a imagem de fundo usada nos menus do bot.",
    when: ["quando o menu precisa ter visual personalizado", "quando voce quer trocar a arte do grupo"],
    usage: ["responda uma imagem com !fundomenu", "!fundomenu reset"],
    adminOnly: true,
    related: ["menu", "menuadm"],
  },
  gerarfrase: {
    summary: "busca ou gera uma frase pronta a partir de um tema informado.",
    when: ["quando voce quer uma frase sobre um assunto", "antes de criar card com comandos de frase"],
    usage: ["!gerarfrase motivacao"],
    related: ["frase", "frase3"],
  },
  gpwhatsapp: {
    summary: "pesquisa grupos de WhatsApp no recurso legado conectado ao bot.",
    when: ["quando o grupo usa busca de comunidades", "quando usuarios procuram links de outros grupos"],
    usage: ["!gpwhatsapp tema"],
  },
  hentaistube: {
    summary: "pesquisa conteudo adulto no Hentaistube pelo recurso legado; deve ficar desativado em grupos publicos ou profissionais.",
    when: ["somente em ambientes privados onde esse tipo de conteudo e permitido", "nunca em grupos comerciais, suporte ou comunidades abertas"],
    usage: ["!hentaistube termo"],
  },
  hidetag: {
    summary: "menciona todos os participantes usando marcacao oculta.",
    when: ["quando todos devem receber notificacao", "quando voce nao quer exibir uma lista grande de arrobas"],
    usage: ["!hidetag aviso"],
    adminOnly: true,
    related: ["marcar", "mencionar"],
  },
  hidetagall: {
    summary: "menciona todos os participantes usando marcacao oculta.",
    when: ["quando todos devem receber notificacao", "quando voce nao quer exibir uma lista grande de arrobas"],
    usage: ["!hidetagall aviso"],
    adminOnly: true,
    related: ["marcar", "mencionar"],
  },
  horapg: {
    summary: "mostra a agenda, horarios e recados configurados para o grupo.",
    when: ["quando membros perguntam horarios", "quando admins configuraram agenda diaria"],
    usage: ["!horapg"],
    related: ["addhorapg", "horariotz"],
  },
  horariotz: {
    summary: "define o fuso horario usado nas rotinas de agenda, abrir e fechar grupo.",
    when: ["quando os horarios automaticos saem no fuso errado", "quando o grupo opera em outra cidade ou pais"],
    usage: ["!horariotz America/Sao_Paulo", "!horariotz off"],
    adminOnly: true,
    related: ["fecharauto", "abrirauto", "addhorapg"],
  },
  id: {
    summary: "mostra o ID do grupo e o ID de quem chamou o comando.",
    when: ["quando voce precisa configurar ou depurar integracoes", "quando o suporte pede o identificador do grupo"],
    usage: ["!id"],
    related: ["linkgp", "status"],
  },
  idiomas: {
    summary: "mostra o menu de idiomas e permite trocar a lingua das respostas do bot.",
    when: ["quando o grupo precisa mudar idioma", "quando usuarios querem ver opcoes de traducao da interface"],
    usage: ["!idiomas"],
    adminOnly: true,
    related: ["ptbr", "english", "espanol"],
  },
  insta: {
    summary: "baixa reels, stories, fotos ou videos do Instagram quando o link e suportado.",
    when: ["quando alguem envia link do Instagram", "quando o grupo quer receber a midia direto no WhatsApp"],
    usage: ["!insta link_do_instagram"],
    related: ["instagram", "tiktok", "facebook"],
  },
  instagram: {
    summary: "baixa reels, stories, fotos ou videos do Instagram quando o link e suportado.",
    when: ["quando alguem envia link do Instagram", "quando o grupo quer receber a midia direto no WhatsApp"],
    usage: ["!instagram link_do_instagram"],
    related: ["insta", "tiktok", "facebook"],
  },
  instastalk: {
    summary: "consulta informacoes publicas de um perfil do Instagram.",
    when: ["quando usuarios querem ver dados de perfil", "quando o recurso de stalk esta habilitado"],
    usage: ["!instastalk usuario"],
    related: ["instagramstalk"],
  },
  keygroq: {
    summary: "configura chaves Groq usadas pela IA do grupo.",
    when: ["quando a IA precisa de chave nova", "quando o Bot interage sera usado com Groq"],
    usage: ["!keygroq chave_aqui"],
    adminOnly: true,
    related: ["botinterage", "promptbot"],
  },
  kwai: {
    summary: "baixa video do Kwai a partir de um link suportado.",
    when: ["quando alguem envia link do Kwai", "quando o grupo quer receber o video direto no WhatsApp"],
    usage: ["!kwai link_do_kwai"],
    related: ["tiktok", "facebook"],
  },
  douyin: {
    summary: "baixa video do Douyin a partir de um link suportado.",
    when: ["quando alguem envia link do Douyin", "quando o grupo quer receber o video direto no WhatsApp"],
    usage: ["!douyin link_do_douyin"],
    related: ["tiktok", "kwai"],
  },
  legendaaudio: {
    summary: "gera video ou legenda visual a partir de audio do WhatsApp e texto informado.",
    when: ["quando voce quer transformar audio em conteudo legendado", "quando usa recursos de TTS e video"],
    usage: ["responda um audio com !audiovideo", "responda um audio com !audiovideo | texto da legenda", "envie um audio e depois use !audiovideo"],
    related: ["tts", "videotts", "infovideotts"],
  },
  legendabemvindo: {
    summary: "define, ativa ou remove a legenda usada na mensagem de boas-vindas.",
    when: ["quando a saudacao precisa de texto personalizado", "quando voce quer explicar regras logo na entrada"],
    usage: ["!legendabemvindo Bem-vindo {{pushName}}", "!legendabemvindo off"],
    adminOnly: true,
    related: ["bemvindo", "fundobemvindo"],
  },
  lerimagem: {
    summary: "le ou interpreta imagens recebidas, extraindo texto ou contexto visual quando o recurso esta ativo.",
    when: ["quando alguem envia print e quer leitura", "quando a IA deve analisar imagem"],
    usage: ["responda uma imagem com !lerimagem"],
    adminOnly: true,
    related: ["botinterage", "moderacaocomia"],
  },
  linkgp: {
    summary: "gera ou mostra o link de convite do grupo e um resumo do grupo.",
    when: ["quando admins precisam compartilhar convite", "quando e necessario conferir dados do grupo"],
    usage: ["!linkgp"],
    adminOnly: true,
    related: ["id", "participantes"],
  },
  listaautorepo: {
    summary: "lista as autorespostas cadastradas e os gatilhos ativos.",
    when: ["quando voce quer revisar respostas automaticas", "antes de remover um gatilho"],
    usage: ["!listaautorepo"],
    adminOnly: true,
    related: ["addautorepo", "rmautorepo", "autoresposta"],
  },
  listads: {
    summary: "lista todos os anuncios automaticos cadastrados no grupo.",
    when: ["quando voce quer conferir campanhas ativas", "quando precisa encontrar o ID de um anuncio para remover"],
    usage: ["!listads"],
    adminOnly: true,
    related: ["addads", "rmads"],
  },
  listatts: {
    summary: "lista as vozes disponiveis para comandos de TTS.",
    when: ["antes de gerar audio com !tts", "quando voce quer conferir vozes privadas e gratuitas"],
    usage: ["!listatts"],
    related: ["tts", "videotts", "rmtts"],
  },
  m: {
    summary: "exibe o menu principal com os recursos disponiveis no bot.",
    when: ["quando o usuario quer ver atalhos principais", "quando o comando !menu precisa de alias curto"],
    usage: ["!m"],
    related: ["menu", "comandos", "menuadm"],
  },
  marcar: {
    summary: "menciona os participantes do grupo em uma chamada geral visivel.",
    when: ["quando todos devem receber aviso", "quando o admin quer chamar atencao do grupo"],
    usage: ["!marcar aviso importante"],
    adminOnly: true,
    related: ["mencionar", "hidetag", "all"],
  },
  mban: {
    summary: "remove do grupo o participante respondido, mencionado ou informado por numero.",
    when: ["quando um membro precisa ser removido", "quando voce usa o alias legado de banimento"],
    usage: ["!mban @usuario"],
    adminOnly: true,
    related: ["ban", "kick"],
  },
  mediafire: {
    summary: "baixa arquivo do MediaFire a partir de um link suportado.",
    when: ["quando alguem envia link do MediaFire", "quando o arquivo deve ser entregue no WhatsApp"],
    usage: ["!mediafire link_do_mediafire"],
    related: ["mf", "resolve"],
  },
  menciona: {
    summary: "menciona participantes do grupo.",
    when: ["quando todos precisam ser notificados", "quando o admin quer chamada geral"],
    usage: ["!menciona aviso"],
    adminOnly: true,
    related: ["marcar"],
  },
  mencionar: {
    summary: "menciona os participantes do grupo em uma chamada geral.",
    when: ["quando todos devem receber aviso", "quando voce prefere o alias de mencao geral"],
    usage: ["!mencionar aviso importante"],
    adminOnly: true,
    related: ["marcar", "hidetag"],
  },
  menu: {
    summary: "exibe o menu principal com os recursos disponiveis no bot.",
    when: ["quando o usuario quer descobrir comandos", "quando precisa de entrada rapida para menus"],
    usage: ["!menu"],
    related: ["comandos", "menuadm", "menudownloads"],
  },
  menuadm: {
    summary: "exibe o menu de administracao com comandos restritos aos administradores.",
    when: ["quando admins precisam configurar o grupo", "quando voce quer ver comandos de moderacao, regras, anuncios e automacoes"],
    usage: ["!menuadm"],
    adminOnly: true,
    related: ["menu", "menuativacoes", "comandos"],
  },
  menuadmin: {
    summary: "exibe o menu de administracao com comandos restritos aos administradores.",
    when: ["quando admins precisam configurar o grupo", "quando voce quer ver comandos de moderacao, regras, anuncios e automacoes"],
    usage: ["!menuadmin"],
    adminOnly: true,
    related: ["menuadm"],
  },
  menuativacoes: {
    summary: "exibe o menu de filtros, protecoes e automacoes que podem ser ativadas no grupo.",
    when: ["quando admins querem saber o que pode ligar ou desligar", "quando voce esta configurando a seguranca do grupo"],
    usage: ["!menuativacoes"],
    adminOnly: true,
    related: ["antilink", "autoresposta", "botinterage"],
  },
  menubotcoins: {
    summary: "exibe o menu principal de BotCoins, saldo, ranking, premium e compra de moedas.",
    when: ["quando o grupo usa economia interna", "quando usuarios querem saber comandos de moedas"],
    usage: ["!menubotcoins"],
    related: ["coins", "premium", "coinsrank"],
  },
  menudownloads: {
    summary: "exibe o menu com comandos de download e conversao de midias.",
    when: ["quando usuarios querem baixar YouTube, TikTok, Instagram ou Spotify", "quando voce quer mostrar atalhos de midia"],
    usage: ["!menudownloads"],
    related: ["play", "ytmp3", "tiktok"],
  },
  mercadolivre: {
    summary: "pesquisa produtos do Mercado Livre pelo comando de busca integrado.",
    when: ["quando o grupo usa afiliados ou consulta de produtos", "quando voce quer buscar um item no Mercado Livre"],
    usage: ["!mercadolivre nome do produto"],
    related: ["amazon"],
  },
  moderacaocomia: {
    summary: "liga ou desliga a moderacao com IA para apoiar analise de mensagens e midias.",
    when: ["quando filtros simples nao bastam", "quando a IA deve ajudar a identificar conteudo problemático"],
    usage: ["!moderacaocomia"],
    adminOnly: true,
    related: ["botinterage", "lerimagem", "antipalavras"],
  },
  movie: {
    summary: "pesquisa informacoes de filmes pelo recurso de busca do bot.",
    when: ["quando usuarios pedem detalhes de um filme", "quando o grupo usa consultas de entretenimento"],
    usage: ["!movie nome do filme"],
    related: ["filme", "serie"],
  },
  mute: {
    summary: "silencia um participante, removendo mensagens dele enquanto estiver mutado.",
    when: ["quando alguem precisa parar de enviar mensagens por um tempo", "quando o admin quer aplicar punicao sem banir"],
    usage: ["!mute @usuario", "!mute 10m @usuario"],
    adminOnly: true,
    related: ["unmute", "ban"],
  },
  mutar: {
    summary: "silencia um participante, removendo mensagens dele enquanto estiver mutado.",
    when: ["quando alguem precisa parar de enviar mensagens por um tempo", "quando o admin quer aplicar punicao sem banir"],
    usage: ["!mutar @usuario"],
    adminOnly: true,
    related: ["desmutar", "mute"],
  },
  painel: {
    summary: "envia link ou instrucoes de acesso ao painel do usuario.",
    when: ["quando o cliente precisa abrir o dashboard", "quando alguem pede acesso ao painel"],
    usage: ["!painel"],
    related: ["dono", "vencimento"],
  },
  participantes: {
    summary: "menciona ou lista participantes conforme a funcao de marcacao do grupo.",
    when: ["quando admins querem chamar todos", "quando o grupo precisa de uma chamada geral"],
    usage: ["!participantes aviso"],
    adminOnly: true,
    related: ["marcar", "mencionar"],
  },
  permitirlink: {
    summary: "adiciona um link ou dominio a lista permitida do antilink.",
    when: ["quando um dominio confiavel nao deve ser bloqueado", "quando voce usa antilink com excecoes"],
    usage: ["!permitirlink exemplo.com"],
    adminOnly: true,
    related: ["removerlink", "linkspermitidos", "antilink"],
  },
  play: {
    summary: "pesquisa audio ou video no YouTube e oferece opcoes para baixar.",
    when: ["quando o usuario informa nome de musica ou video", "quando ele ainda nao tem o link exato"],
    usage: ["!play nome da musica"],
    related: ["yt", "ytmp3", "ytmp4"],
  },
  playstore: {
    summary: "pesquisa aplicativos na Play Store pelo recurso legado.",
    when: ["quando usuarios querem encontrar app", "quando o grupo usa consulta de aplicativos"],
    usage: ["!playstore nome do app"],
  },
  prefix: {
    summary: "mostra ou altera os prefixos usados antes dos comandos.",
    when: ["quando voce quer trocar ! por outro prefixo", "quando o grupo precisa aceitar mais de um prefixo"],
    usage: ["!prefix", "!prefix ! / ."],
    adminOnly: true,
    related: ["menuadm", "comandos"],
  },
  prefixo: {
    summary: "mostra ou altera os prefixos usados antes dos comandos.",
    when: ["quando voce quer trocar ! por outro prefixo", "quando o grupo precisa aceitar mais de um prefixo"],
    usage: ["!prefixo", "!prefixo ! / ."],
    adminOnly: true,
    related: ["prefix"],
  },
  promote: {
    summary: "promove o participante respondido ou mencionado a administrador do grupo.",
    when: ["quando um membro deve virar admin", "quando voce ajusta cargos pelo WhatsApp"],
    usage: ["!promote @usuario"],
    adminOnly: true,
    related: ["demote", "promover"],
  },
  promover: {
    summary: "promove o participante respondido ou mencionado a administrador do grupo.",
    when: ["quando um membro deve virar admin", "quando voce ajusta cargos pelo WhatsApp"],
    usage: ["!promover @usuario"],
    adminOnly: true,
    related: ["rebaixar", "promote"],
  },
  promoveradm: {
    summary: "promove o participante respondido ou mencionado a administrador do grupo.",
    when: ["quando um membro deve virar admin", "quando voce ajusta cargos pelo WhatsApp"],
    usage: ["!promoveradm @usuario"],
    adminOnly: true,
    related: ["rebaixaradm"],
  },
  promver: {
    summary: "promove o participante respondido ou mencionado a administrador do grupo.",
    when: ["quando um membro deve virar admin", "quando voce usa o alias legado com erro de escrita"],
    usage: ["!promver @usuario"],
    adminOnly: true,
    related: ["promover"],
  },
  promptbot: {
    summary: "configura o prompt usado pela IA do Bot interage no grupo.",
    when: ["quando voce quer mudar a personalidade da IA", "quando o atendimento automatico precisa seguir instrucoes especificas"],
    usage: ["!promptbot responda como suporte objetivo"],
    adminOnly: true,
    related: ["botinterage", "keygroq"],
  },
  pt: {
    summary: "altera o idioma das respostas do bot para portugues.",
    when: ["quando o grupo usa portugues", "quando voce quer voltar ao idioma padrao"],
    usage: ["!pt"],
    adminOnly: true,
    related: ["idiomas", "en", "es"],
  },
  ptbr: {
    summary: "altera o idioma das respostas do bot para portugues do Brasil.",
    when: ["quando o grupo usa portugues brasileiro", "quando voce quer voltar ao idioma padrao"],
    usage: ["!ptbr"],
    adminOnly: true,
    related: ["idiomas", "en", "es"],
  },
  portugues: {
    summary: "altera o idioma das respostas do bot para portugues.",
    when: ["quando o grupo usa portugues", "quando voce quer voltar ao idioma padrao"],
    usage: ["!portugues"],
    adminOnly: true,
    related: ["idiomas", "english", "espanol"],
  },
  ranking: {
    summary: "mostra o top 10 de participantes com mais interacoes no grupo.",
    when: ["quando usuarios querem ver o placar", "quando o grupo usa ranking de engajamento"],
    usage: ["!ranking"],
    related: ["meuranking", "resetarranking"],
  },
  rb2: {
    summary: "remove fundo de imagem usando uma variacao legado do removedor.",
    when: ["quando voce quer testar outro removedor de fundo", "quando o comando principal nao funcionar"],
    usage: ["responda uma imagem com !rb2"],
    related: ["removebg", "sfundo"],
  },
  rbgec: {
    summary: "remove fundo de imagem usando uma variacao legado do removedor.",
    when: ["quando voce quer testar outro removedor de fundo", "quando o comando principal nao funcionar"],
    usage: ["responda uma imagem com !rbgec"],
    related: ["removebg", "sfundo"],
  },
  rebaixar: {
    summary: "remove o cargo de administrador do participante respondido ou mencionado.",
    when: ["quando um admin deve virar membro comum", "quando voce ajusta cargos pelo WhatsApp"],
    usage: ["!rebaixar @usuario"],
    adminOnly: true,
    related: ["promover"],
  },
  rebaixaradm: {
    summary: "remove o cargo de administrador do participante respondido ou mencionado.",
    when: ["quando um admin deve virar membro comum", "quando voce ajusta cargos pelo WhatsApp"],
    usage: ["!rebaixaradm @usuario"],
    adminOnly: true,
    related: ["promoveradm"],
  },
  regras: {
    summary: "mostra as regras oficiais cadastradas para o grupo.",
    when: ["quando um participante quer consultar o regulamento", "quando admins querem enviar regras sem copiar texto manualmente"],
    usage: ["!regras"],
    related: ["addregras", "bemvindo", "menu"],
  },
  removeads: {
    summary: "remove um anuncio automatico pelo numero ou ID mostrado na lista.",
    when: ["quando uma campanha deve parar", "quando um anuncio recorrente foi criado por engano"],
    usage: ["!removeads 1", "!removeads abc123"],
    adminOnly: true,
    related: ["listads", "addads"],
  },
  removeautorepo: {
    summary: "remove uma autoresposta pelo gatilho informado.",
    when: ["quando uma resposta automatica ficou desatualizada", "quando um gatilho deve parar de responder"],
    usage: ["!removeautorepo preco"],
    adminOnly: true,
    related: ["rmautorepo", "listaautorepo"],
  },
  removebg: {
    summary: "remove o fundo de uma imagem enviada, respondida ou informada por link.",
    when: ["quando voce quer uma imagem com fundo transparente", "quando precisa preparar figurinha, produto ou arte"],
    usage: ["responda uma imagem com !removebg"],
    related: ["sfundo", "rb2", "rbgec"],
  },
  removebg2: {
    summary: "remove o fundo de uma imagem usando uma variacao do recurso legado.",
    when: ["quando voce quer tentar outro motor de recorte", "quando o primeiro removedor nao entregar bom resultado"],
    usage: ["responda uma imagem com !removebg2"],
    related: ["removebg", "sfundo"],
  },
  removebgec: {
    summary: "remove o fundo de uma imagem usando uma variacao do recurso legado.",
    when: ["quando voce quer tentar outro motor de recorte", "quando o primeiro removedor nao entregar bom resultado"],
    usage: ["responda uma imagem com !removebgec"],
    related: ["removebg", "sfundo"],
  },
  removerinativos: {
    summary: "remove imediatamente membros sem interação pelo período informado.",
    when: ["quando o grupo precisa limpar membros parados agora", "quando admins querem remover quem não fala há alguns dias"],
    usage: ["!removerinativos 5d", "!removerinativos 30d"],
    adminOnly: true,
    related: ["removerinativosauto", "ranking", "participantes"],
  },
  removerinativosauto: {
    summary: "ativa, desativa ou consulta a remoção automática de membros inativos.",
    when: ["quando a limpeza de inativos deve rodar sozinha", "quando admins querem definir os dias de inatividade"],
    usage: ["!removerinativosauto 30d", "!removerinativosauto off", "!removerinativosauto status"],
    adminOnly: true,
    related: ["removerinativos", "antiafk", "ranking"],
  },
  antiafk: {
    summary: "ativa ou ajusta remoção automática de membros que ficam dias sem falar.",
    when: ["quando o grupo precisa evitar membros fantasmas", "quando admins querem configurar limpeza por inatividade"],
    usage: ["!antiafk", "!antiafk 40", "!antiafk off", "!antiafk status"],
    adminOnly: true,
    related: ["removerinativosauto", "removerinativos", "ranking"],
  },
  removerlink: {
    summary: "remove um link ou dominio da lista permitida do antilink.",
    when: ["quando uma excecao deixou de ser confiavel", "quando voce quer voltar a bloquear um dominio"],
    usage: ["!removerlink exemplo.com"],
    adminOnly: true,
    related: ["permitirlink", "linkspermitidos"],
  },
  resetarranking: {
    summary: "zera o ranking de interacoes do grupo.",
    when: ["quando voce quer reiniciar a competicao", "quando um novo periodo de ranking comeca"],
    usage: ["!resetarranking"],
    adminOnly: true,
    related: ["ranking", "meuranking"],
  },
  resetinfra: {
    summary: "zera infracoes registradas para um participante.",
    when: ["quando um usuario recebeu perdao", "quando o historico de punicoes precisa ser limpo"],
    usage: ["!resetinfra @usuario"],
    adminOnly: true,
    related: ["antipalavras", "banextremo"],
  },
  revelar: {
    summary: "tenta revelar uma midia de visualizacao unica respondida no grupo.",
    when: ["quando alguem envia foto ou video de visualizacao unica", "quando o bot consegue baixar a midia antes de sumir"],
    usage: ["responda a midia com !revelar"],
    related: ["sticker", "tourl"],
  },
  resolve: {
    summary: "resolve um link encurtado e mostra a URL final.",
    when: ["quando voce quer verificar para onde um link aponta", "quando precisa inspecionar link antes de abrir"],
    usage: ["!resolve https://bit.ly/exemplo"],
    related: ["resolver", "desencurtar"],
  },
  resolver: {
    summary: "resolve um link encurtado e mostra a URL final.",
    when: ["quando voce quer verificar para onde um link aponta", "quando precisa inspecionar link antes de abrir"],
    usage: ["!resolver https://bit.ly/exemplo"],
    related: ["resolve", "desencurtar"],
  },
  rifa: {
    summary: "mostra a rifa ativa, numeros disponiveis e instrucoes de compra.",
    when: ["quando participantes querem consultar a rifa", "quando admins querem divulgar numeros restantes"],
    usage: ["!rifa"],
    related: ["comprarrifa", "sortearrifa", "addrifa"],
  },
  rifas: {
    summary: "mostra rifas ativas, numeros disponiveis e instrucoes de compra.",
    when: ["quando existe mais de uma rifa", "quando participantes querem consultar rifas"],
    usage: ["!rifas"],
    related: ["rifa", "comprarrifa"],
  },
  rmautorepo: {
    summary: "remove uma autoresposta pelo gatilho informado.",
    when: ["quando uma resposta automatica ficou desatualizada", "quando um gatilho deve parar de responder"],
    usage: ["!rmautorepo preco"],
    adminOnly: true,
    related: ["addautorepo", "listaautorepo"],
  },
  rmads: {
    summary: "remove um anuncio automatico pelo numero ou ID mostrado na lista.",
    when: ["quando uma campanha deve parar", "quando um anuncio recorrente foi criado por engano"],
    usage: ["!rmads 1", "!rmads abc123"],
    adminOnly: true,
    related: ["listads", "addads"],
  },
  rmblacklist: {
    summary: "remove um numero da lista de bloqueio.",
    when: ["quando um numero pode voltar ao grupo", "quando um bloqueio foi aplicado por engano"],
    usage: ["!rmblacklist 5511999999999"],
    adminOnly: true,
    related: ["addblacklist"],
  },
  rmgringos: {
    summary: "remove do grupo participantes com DDI fora da lista permitida.",
    when: ["quando entraram muitos numeros estrangeiros", "quando voce quer aplicar a lista de DDIs permitidos de uma vez"],
    usage: ["!rmgringos 55,351"],
    adminOnly: true,
    related: ["addddi", "rmddi", "bangringos"],
  },
  rmtts: {
    summary: "remove uma voz clonada ou cadastrada para TTS.",
    when: ["quando uma voz nao deve mais aparecer na lista", "quando voce quer limpar vozes antigas"],
    usage: ["!rmtts nome-da-voz"],
    adminOnly: true,
    related: ["listatts", "clonarvoz"],
  },
  premium: {
    summary: "mostra o status premium do participante no grupo, validade e comandos liberados.",
    when: ["quando o usuario quer saber se tem premium ativo", "quando o grupo usa assinatura interna para comandos especiais"],
    usage: ["!premium"],
    related: ["comprarpremium", "coins", "menubotcoins"],
  },
  s: {
    summary: "cria figurinha a partir de imagem, video curto ou midia respondida.",
    when: ["quando voce quer transformar midia em sticker", "quando precisa criar figurinha rapidamente"],
    usage: ["responda uma imagem com !s"],
    related: ["sticker", "attp"],
  },
  s2: {
    summary: "cria figurinha quadrada a partir de imagem, video curto ou midia respondida.",
    when: ["quando voce quer sticker no formato quadrado", "quando o recorte padrao nao ficou bom"],
    usage: ["responda uma imagem com !s2"],
    related: ["sticker2", "s"],
  },
  fig: {
    summary: "busca GIFs no GIPHY pelo termo informado e transforma em pacote de figurinhas.",
    when: ["quando voce quer varias figurinhas animadas por tema", "quando quer aproveitar resultados de GIF como sticker"],
    usage: ["!fig onepiece", "!gif meme brasileiro 12"],
    related: ["gif", "fig2", "sticker"],
  },
  fig2: {
    summary: "busca um pacote de figurinhas pelo termo informado e tenta enviar o pacote inteiro de uma vez.",
    when: ["quando voce quer um pacote pronto de stickers", "quando quer reduzir varias buscas manuais de figurinhas"],
    usage: ["!fig2 onepiece", "!fig2 messi 5", "!figpack memes"],
    related: ["fig", "stickerpack"],
  },
  savepin: {
    summary: "baixa imagens ou videos do Pinterest a partir de um link.",
    when: ["quando alguem envia link do Pinterest", "quando o grupo quer receber a midia direta"],
    usage: ["!savepin link_do_pin"],
    related: ["pinterest"],
  },
  serie: {
    summary: "pesquisa informacoes de series pelo recurso de busca do bot.",
    when: ["quando usuarios pedem detalhes de uma serie", "quando o grupo usa consultas de entretenimento"],
    usage: ["!serie nome da serie"],
    related: ["filme"],
  },
  series: {
    summary: "pesquisa informacoes de series pelo recurso de busca do bot.",
    when: ["quando usuarios pedem detalhes de uma serie", "quando o grupo usa consultas de entretenimento"],
    usage: ["!series nome da serie"],
    related: ["serie"],
  },
  "série": {
    summary: "pesquisa informacoes de series pelo recurso de busca do bot.",
    when: ["quando usuarios pedem detalhes de uma serie", "quando o grupo usa consultas de entretenimento"],
    usage: ["!série nome da serie"],
    related: ["serie"],
  },
  silenciar: {
    summary: "silencia um participante, removendo mensagens dele enquanto estiver mutado.",
    when: ["quando alguem precisa parar de enviar mensagens por um tempo", "quando o admin quer aplicar punicao sem banir"],
    usage: ["!silenciar @usuario"],
    adminOnly: true,
    related: ["desmutar", "mute"],
  },
  sisreg: {
    summary: "monitora uma unidade do Sisreg e avisa quando houver disponibilidade.",
    when: ["quando o usuario quer acompanhar vagas do Sisreg", "quando precisa receber aviso automatico de disponibilidade"],
    usage: ["!sisreg unidade ou codigo"],
    related: ["rmsisreg"],
  },
  soadm: {
    summary: "liga ou desliga a restricao de comandos para apenas administradores.",
    when: ["quando membros comuns nao devem usar comandos", "quando o grupo precisa reduzir abuso de recursos"],
    usage: ["!soadm"],
    adminOnly: true,
    related: ["menuadm", "comandos"],
  },
  sortearrifa: {
    summary: "sorteia um vencedor entre numeros pagos ou participantes da rifa.",
    when: ["quando a rifa esta pronta para o resultado", "quando admins querem anunciar o vencedor"],
    usage: ["!sortearrifa"],
    adminOnly: true,
    related: ["rifa", "comprarrifa"],
  },
  sorteio: {
    summary: "cria ou executa um sorteio rapido no grupo.",
    when: ["quando voce quer sortear participantes", "quando precisa de uma dinamica simples"],
    usage: ["!sorteio"],
    adminOnly: true,
    related: ["sorteio2", "enquete"],
  },
  spamngl: {
    summary: "envia mensagens para um link NGL usando o recurso legado; use com responsabilidade e apenas onde for permitido.",
    when: ["quando o recurso legado estiver ativo e autorizado", "evite em qualquer contexto que gere abuso ou spam"],
    usage: ["!spamngl link mensagem"],
  },
  spotify: {
    summary: "baixa ou converte musica do Spotify para envio em audio.",
    when: ["quando alguem envia link do Spotify", "quando o grupo quer receber a faixa como audio"],
    usage: ["!spotify link_ou_nome"],
    related: ["spotifydl", "ytmp3"],
  },
  spotifydl: {
    summary: "baixa ou converte musica do Spotify para envio em audio.",
    when: ["quando alguem envia link do Spotify", "quando o grupo quer receber a faixa como audio"],
    usage: ["!spotifydl link_ou_nome"],
    related: ["spotify"],
  },
  sticker: {
    summary: "cria figurinha a partir de imagem, video curto ou midia respondida.",
    when: ["quando voce quer transformar midia em sticker", "quando precisa criar figurinha rapidamente"],
    usage: ["responda uma imagem com !sticker"],
    related: ["s", "attp"],
  },
  sticker2: {
    summary: "cria figurinha quadrada a partir de imagem, video curto ou midia respondida.",
    when: ["quando voce quer sticker no formato quadrado", "quando o recorte padrao nao ficou bom"],
    usage: ["responda uma imagem com !sticker2"],
    related: ["s2", "sticker"],
  },
  tabela: {
    summary: "mostra a tabela, cardapio, lista de valores ou comunicado fixo cadastrado para o grupo.",
    when: ["quando membros pedem valores ou lista fixa", "quando o admin quer enviar informacao padronizada"],
    usage: ["!tabela"],
    related: ["addtabela", "regras"],
  },
  tiktok: {
    summary: "baixa video do TikTok sem marca d'agua quando um link suportado e enviado.",
    when: ["quando alguem envia link do TikTok", "quando o grupo quer receber o video direto no WhatsApp"],
    usage: ["!tiktok link_do_tiktok"],
    related: ["kwai", "instagram", "facebook"],
  },
  tomp3: {
    summary: "converte audio ou video respondido para MP3.",
    when: ["quando voce tem um video e quer apenas o audio", "quando precisa converter midia enviada no grupo"],
    usage: ["responda uma midia com !tomp3"],
    related: ["ytmp3"],
  },
  tourl: {
    summary: "sobe uma midia enviada ou respondida e retorna uma URL publica.",
    when: ["quando voce precisa transformar arquivo em link", "quando quer compartilhar midia fora do WhatsApp"],
    usage: ["responda uma imagem com !tourl"],
    related: ["tuurl", "revelar"],
  },
  tts: {
    summary: "gera audio narrado por voz TTS a partir de um texto.",
    when: ["quando voce quer transformar texto em audio", "quando quer testar uma voz cadastrada"],
    usage: ["!tts laizza ola mundo", "!tts zoro expressivo | ola mundo"],
    related: ["listatts", "videotts", "legendaaudio"],
  },
  tuurl: {
    summary: "sobe uma midia enviada ou respondida e retorna uma URL publica.",
    when: ["quando voce precisa transformar arquivo em link", "quando quer compartilhar midia fora do WhatsApp"],
    usage: ["responda uma imagem com !tuurl"],
    related: ["tourl"],
  },
  unmute: {
    summary: "remove o silencio de um participante que estava mutado.",
    when: ["quando o membro pode voltar a enviar mensagens", "quando um mute temporario precisa ser encerrado manualmente"],
    usage: ["!unmute @usuario"],
    adminOnly: true,
    related: ["mute"],
  },
  uptodown: {
    summary: "pesquisa aplicativos no Uptodown pelo recurso legado.",
    when: ["quando usuarios procuram APKs ou apps", "quando a busca de app externo esta habilitada"],
    usage: ["!uptodown nome do app"],
    related: ["playstore"],
  },
  vencimento: {
    summary: "mostra a validade do plano ou cobertura do bot no grupo.",
    when: ["quando o cliente quer saber ate quando o bot esta ativo", "quando admins precisam conferir renovacao"],
    usage: ["!vencimento"],
    related: ["painel", "dono"],
  },
  videotts: {
    summary: "gera video com legenda animada e audio TTS.",
    when: ["quando voce quer transformar texto em video narrado", "quando o grupo usa conteudo curto com voz"],
    usage: ["!videotts laizza | texto do video"],
    related: ["tts", "infovideotts", "legendaaudio"],
  },
  vozbotinterage: {
    summary: "liga ou desliga respostas por voz geradas pela IA do Bot interage.",
    when: ["quando voce quer que a IA responda em audio", "quando o grupo prefere respostas faladas"],
    usage: ["!vozbotinterage"],
    adminOnly: true,
    related: ["botinterage", "tts"],
  },
  yt: {
    summary: "pesquisa videos no YouTube e mostra opcoes com previa.",
    when: ["quando o usuario quer buscar video ou musica", "antes de escolher baixar MP3 ou MP4"],
    usage: ["!yt nome do video"],
    related: ["play", "ytmp3", "ytmp4"],
  },
  ytmp3: {
    summary: "baixa o audio de um video do YouTube por link ou termo de busca.",
    when: ["quando o usuario quer apenas o audio", "quando o resultado deve ser enviado em MP3"],
    usage: ["!ytmp3 link_do_youtube", "!ytmp3 nome da musica"],
    related: ["play", "ytmp4", "yt"],
  },
  ytmp4: {
    summary: "baixa o video do YouTube por link ou termo de busca.",
    when: ["quando o usuario quer o video completo", "quando o resultado deve ser enviado como MP4"],
    usage: ["!ytmp4 link_do_youtube", "!ytmp4 nome do video"],
    related: ["play", "ytmp3", "yt"],
  },
  ytsearch: {
    summary: "pesquisa videos no YouTube e mostra opcoes com previa.",
    when: ["quando o usuario quer buscar video ou musica", "antes de escolher baixar MP3 ou MP4"],
    usage: ["!ytsearch nome do video"],
    related: ["yt", "play"],
  },
};

const SOCIAL_ACTION_SUMMARIES: Record<string, string> = {
  brincadeiras: "abre ou controla o menu de brincadeiras do grupo.",
  feliz: "envia uma reacao de felicidade.",
  menubrincadeiras: "abre o menu de comandos de brincadeiras.",
  nerding: "envia uma brincadeira ou card com tema nerd.",
};

const COMMAND_CATEGORIES: CommandCategoryDefinition[] = [
  {
    id: "command-admin",
    title: "Administracao do grupo",
    description: "Comandos restritos a administradores para configurar, moderar, proteger e operar o grupo.",
    match: /^(menu|m|menuadm|menuadmin|menuativacoes|prefix|prefixo|id|abrirgp|abrirgrupo|fechargp|fechargrupo|fecharauto|abrirauto|horariotz|promote|promover|promoveradm|promver|demote|rebaixar|rebaixaradm|linkgp|participantes|dono|vencimento|painel|sisreg|rmsisreg)$/,
  },
  {
    id: "command-moderation",
    title: "Moderacao e seguranca",
    description: "Comandos de bloqueio, remocao, mute, blacklist, antilink, antiflood, DDIs e filtros de midia.",
    match: /^(anti|antaudio|antdoc|antvcard|antvideo|ban|apagar|delete|del|apagarmensagem|mute|mutar|silenciar|unmute|desmutar|ativar|rmgringos|bangringos|removerinativosauto|removerinativos|permitirlink|removerlink|addblacklist|rmblacklist|blacklist|mban|banextremo|soadm|zerarinfra|resetinfra|res)/,
  },
  {
    id: "command-content",
    title: "Regras, tabelas, atendimento e mensagens fixas",
    description: "Comandos para regras, tabelas, boas-vindas, autorespostas, agenda, idiomas e comunicados.",
    match: /^(bemvindo|fundobemvindo|legendabemvindo|fundomenu|addregras|regras|addtabela|tabela|autoresposta|addautorepo|rmautorepo|removeautorepo|listaautorepo|horapg|addhorapg|comandos|idiomas|portugues|pt|ptbr|english|en|espanol|es|addads|addad|rmads|removeads|listads|ads)$/,
  },
  {
    id: "command-downloads",
    title: "Downloads, pesquisa e midia",
    description: "Comandos para pesquisar, baixar e converter YouTube, TikTok, Instagram, Spotify, Pinterest e arquivos.",
    match: /^(play|yt|ytsearch|ytmp3|ytmp4|tomp3|tiktok|douyin|kwai|shopee|mercadolivre|amazon|savepin|pinterest|pin|insta|instagram|facebook|spotify|spotifydl|soundcloud|bandcamp|mixcloud|twitterspaces|twitch|rumble|odysee|dailymotion|mediafire|playstore|uptodown|apkmodhacker|filme|movie|serie|series|série|gpwhatsapp|instastalk|resolve|resolver|desencurtar|unshorten|tourl|tuurl|freepik|envato|autodownloader)$/,
  },
  {
    id: "command-ai",
    title: "IA, voz, imagem e stickers",
    description: "Comandos de IA, TTS, imagem, leitura visual, figurinhas, cards e remocao de fundo.",
    match: /^(botinterage|vozbotinterage|keygroq|promptbot|moderacaocomia|lerimagem|criarimagem|criarimage|createimage|removebg|removebg2|removebgec|attp|attp2|attp3|autosticker|sticker|sticker2|s|s2|fig|gif|figurinhas|stickers|fig2|figpack|stickerpack|frase|frase2|frase3|frase4|frasenovideo|frasenovideo2|frasevideo|gerarfrase|rb2|rbgec|rename|renomear|revelar|tts|videotts|legendaaudio|audiovideo|audionovideo|videodoaudio|vozvideo|infovideotts|listatts|clonarvoz|rmtts)$/,
  },
  {
    id: "command-engagement",
    title: "Rifas, sorteios, ranking e jogos",
    description: "Comandos para ranking, rifas, sorteios, enquetes e jogos de grupo.",
    match: /^(ranking|meuranking|resetarranking|sorteio|addrifa|rifa|rifas|comprarrifa|sortearrifa|cancelarrifa|jogos|menujogos)$/,
  },
  {
    id: "command-coins",
    title: "BotCoins e recompensas",
    description: "Comandos de saldo, ranking, compra de moedas e assinatura premium interna do grupo.",
    match: /^(bc|coins|coinsrank|menubotcoins|premium|comprarpremium|comprarcoins)$/,
  },
  {
    id: "command-social",
    title: "Brincadeiras e interacao social",
    description: "Comandos de reacao, brincadeiras e interacoes sociais entre participantes.",
    match: /^(all|allg|avadakedrava|brincadeiras|feliz|hidetag|hidetagall|marcar|mencionar|menubrincadeiras|nerding)$/,
  },
  {
    id: "command-other",
    title: "Outros comandos ativos",
    description: "Comandos publicados no catalogo atual que ainda nao se encaixam nas categorias principais.",
    match: /.*/,
  },
];

export const COMMAND_TUTORIAL_SLUG_PREFIX = "command-";

export const normalizeCommand = (value: string): string =>
  value.trim().replace(/^[/!#.]+/, "").toLowerCase();

const ACTIVE_ADMIN_ONLY_COMMANDS = [
  "prefix",
  "antilink",
  "antilinkgp",
  "banextremo",
  "bangringos",
  "rmgringos",
  "antipalavras",
  "soadm",
  "autoresposta",
  "autosticker",
  "autodownloader",
  "bemvindo",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
  "resetarranking",
  "botinterage",
  "vozbotinterage",
  "lerimagem",
  "moderacaocomia",
] as const;

const RUNTIME_ADMIN_ONLY_COMMANDS = new Set(ACTIVE_ADMIN_ONLY_COMMANDS.map(normalizeCommand));

const ADMIN_COMMAND_CATEGORY =
  COMMAND_CATEGORIES.find((category) => category.id === "command-admin") ?? COMMAND_CATEGORIES[0];

export const getCommandTutorialSlug = (command: string): string | null => {
  const normalized = normalizeCommand(command);
  return normalized ? `${COMMAND_TUTORIAL_SLUG_PREFIX}${normalized}` : null;
};

export const getCommandFromTutorialSlug = (slug: string): string | null => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug.startsWith(COMMAND_TUTORIAL_SLUG_PREFIX)) {
    return null;
  }

  const command = normalizeCommand(normalizedSlug.slice(COMMAND_TUTORIAL_SLUG_PREFIX.length));
  return command || null;
};

export const stripCommandRelatedSection = (description: string): string =>
  description
    .replace(/\n{0,2}##\s+Comandos relacionados[\s\S]*?(?=\n##\s+|\s*$)/i, "")
    .trim();

export const getCommandPagePathFromTutorialSlug = (slug: string): string | null => {
  const command = getCommandFromTutorialSlug(slug);
  return command ? `/comandos/${encodeURIComponent(command)}` : null;
};

const isStubDescription = (description: string): boolean =>
  description.trim().toLowerCase().includes("descricao pendente");

const formatCommand = (command: string) => `!${command}`;

const getAliases = (command: string): string[] => {
  const aliases = DEFAULT_COMMAND_ALIASES?.[command] ?? [];
  const values = Array.isArray(aliases) && aliases.length > 0 ? aliases : [command];
  return Array.from(new Set(values.map(normalizeCommand).filter(Boolean)));
};

const sentenceFromDescription = (description: string): string | null => {
  const trimmed = description.trim();
  if (!trimmed || isStubDescription(trimmed)) return null;
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1).replace(/\.$/, "")}.`;
};

const buildSocialInfo = (command: string): CommandFunctionInfo | null => {
  const summary = SOCIAL_ACTION_SUMMARIES[command];
  if (!summary) return null;
  return {
    summary,
    when: [
      "quando o grupo esta com brincadeiras liberadas",
      "quando os participantes querem interagir de forma leve",
    ],
    usage: [`!${command}`, `!${command} @usuario`],
    related: ["menubrincadeiras", "modobrincadeira"],
  };
};

const buildFallbackInfo = (entry: CommandTutorialEntry): CommandFunctionInfo => {
  const description = sentenceFromDescription(entry.description);
  if (description) {
    return {
      summary: description,
      when: ["quando voce precisa usar exatamente essa funcao descrita no menu ou no handler do bot"],
      usage: [`!${entry.command}`],
      adminOnly: entry.adminOnly,
    };
  }

  return {
    summary:
      "existe no inventario interno do bot, mas o codigo atual nao traz uma descricao operacional confirmada para prometer publicamente.",
    when: [
      "use somente depois de testar em um grupo controlado",
      "mantenha fora de materiais comerciais ate validar se o handler legado ainda funciona",
    ],
    usage: [`!${entry.command}`],
    adminOnly: entry.adminOnly,
  };
};

const getCommandInfo = (entry: CommandTutorialEntry): CommandFunctionInfo => {
  return COMMAND_FACTS[entry.command] ?? buildSocialInfo(entry.command) ?? buildFallbackInfo(entry);
};

const isAdminOnlyCommand = (entry: CommandTutorialEntry): boolean =>
  Boolean(COMMAND_FACTS[entry.command]?.adminOnly ?? entry.adminOnly) ||
  RUNTIME_ADMIN_ONLY_COMMANDS.has(entry.command);

export const getPublicCommandInfo = (command: string): CommandFunctionInfo | null => {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return null;
  }

  const entry: CommandTutorialEntry = {
    command: normalized,
    description: COMMAND_FACTS[normalized]?.summary ?? "",
    adminOnly: RUNTIME_ADMIN_ONLY_COMMANDS.has(normalized),
    aliases: getAliases(normalized),
  };
  const info = getCommandInfo(entry);

  return {
    ...info,
    adminOnly: isAdminOnlyCommand(entry),
  };
};

const getCommandCategory = (entry: CommandTutorialEntry): CommandCategoryDefinition =>
  isAdminOnlyCommand(entry)
    ? ADMIN_COMMAND_CATEGORY
    : (COMMAND_CATEGORIES.find((category) => category.match.test(entry.command)) ??
      COMMAND_CATEGORIES[COMMAND_CATEGORIES.length - 1]);

const getCommandEntries = (): CommandTutorialEntry[] => {
  const entries = new Map<string, CommandTutorialEntry>();

  for (const command of Object.keys(DEFAULT_COMMAND_ALIASES || {})) {
    const normalized = normalizeCommand(command);
    if (!normalized || entries.has(normalized)) continue;
    const info = COMMAND_FACTS[normalized];
    entries.set(normalized, {
      command: normalized,
      description: info?.summary ?? "",
      adminOnly: Boolean(info?.adminOnly) || RUNTIME_ADMIN_ONLY_COMMANDS.has(normalized),
      aliases: getAliases(normalized),
    });
  }

  for (const command of EXTRA_RUNTIME_COMMANDS) {
    const normalized = normalizeCommand(command);
    if (!normalized || entries.has(normalized)) continue;
    const info = COMMAND_FACTS[normalized];
    entries.set(normalized, {
      command: normalized,
      description: info?.summary ?? "",
      adminOnly: Boolean(info?.adminOnly) || RUNTIME_ADMIN_ONLY_COMMANDS.has(normalized),
      aliases: getAliases(normalized),
    });
  }

  return Array.from(entries.values()).sort((a, b) => a.command.localeCompare(b.command, "pt-BR"));
};

const getRelatedCommands = (
  entry: CommandTutorialEntry,
  categoryEntries: CommandTutorialEntry[],
  limit = 8,
): CommandTutorialEntry[] => {
  const explicit = getCommandInfo(entry).related ?? [];
  const explicitSet = new Set(explicit.map(normalizeCommand));
  const explicitItems = categoryEntries.filter((item) => explicitSet.has(item.command) && item.command !== entry.command);
  const remaining = categoryEntries.filter((item) => !explicitSet.has(item.command) && item.command !== entry.command);
  return [...explicitItems, ...remaining].slice(0, limit);
};

const buildTutorialDescription = (
  entry: CommandTutorialEntry,
  category: CommandCategoryDefinition,
): string => {
  const info = getCommandInfo(entry);
  const aliasList = entry.aliases.map(formatCommand).join(", ");
  const permissions = (info.adminOnly ?? entry.adminOnly)
    ? "Este comando deve ser usado por administradores ou pessoas com permissao de moderacao, porque altera configuracoes, remove usuarios, muda cargos ou mexe em automacoes do grupo."
    : "Este comando pode ser usado por participantes quando estiver liberado no grupo. Administradores ainda podem restringir o acesso pelas permissoes e ativacoes do painel.";
  const usage = info.usage && info.usage.length > 0 ? info.usage : [`!${entry.command}`];

  return [
    `# Comando ${formatCommand(entry.command)}`,
    `O comando ${formatCommand(entry.command)} ${info.summary}`,
    "## Para que serve",
    `Ele fica na categoria "${category.title}" e deve ser entendido como: ${info.summary}`,
    "## Quando usar",
    info.when.map((item) => `- ${item}`).join("\n"),
    "## Como usar",
    [
      ...usage.map((item) => `- ${item}`),
      `- Variacoes aceitas: ${aliasList}.`,
    ].join("\n"),
    "## Permissoes e cuidados",
    permissions,
  ].join("\n\n");
};

const buildGeneratedTutorial = (
  entry: CommandTutorialEntry,
  category: CommandCategoryDefinition,
): FieldTutorial => ({
  slug: getCommandTutorialSlug(entry.command) ?? `${COMMAND_TUTORIAL_SLUG_PREFIX}${entry.command}`,
  title: `Comando ${formatCommand(entry.command)}`,
  description: stripCommandRelatedSection(buildTutorialDescription(entry, category)),
  mediaUrl: null,
  mediaType: null,
  mediaPath: null,
  updatedAt: GENERATED_TUTORIAL_UPDATED_AT,
});

const buildCommandTutorialSections = (): CommandTutorialSectionData[] => {
  const entries = getCommandEntries();
  const entriesByCategory = COMMAND_CATEGORIES.map((category) => {
    const categoryEntries = entries.filter((entry) => getCommandCategory(entry).id === category.id);
    return { category, entries: categoryEntries };
  }).filter((section) => section.entries.length > 0);

  return entriesByCategory.map(({ category, entries: categoryEntries }) => ({
    id: category.id,
    title: category.title,
    description: category.description,
    tutorials: categoryEntries.map((entry) =>
      buildGeneratedTutorial(entry, category),
    ),
  }));
};

export const getGeneratedCommandTutorialSections = (
  overrides = new Map<string, FieldTutorial>(),
): CommandTutorialSectionData[] =>
  buildCommandTutorialSections().map((section) => ({
    ...section,
    tutorials: section.tutorials.map((tutorial) => {
      const override = overrides.get(tutorial.slug);
      const selected = override ?? tutorial;
      return {
        ...selected,
        description: stripCommandRelatedSection(selected.description),
      };
    }),
  }));

export const getGeneratedCommandTutorials = (): FieldTutorial[] =>
  buildCommandTutorialSections().flatMap((section) => section.tutorials);

export const getGeneratedCommandTutorialFields = (): TutorialFieldDefinition[] =>
  getGeneratedCommandTutorials().map((tutorial) => {
    const command = getCommandFromTutorialSlug(tutorial.slug) ?? tutorial.slug;
    return {
      key: command,
      slug: tutorial.slug,
      label: tutorial.title,
      description: `Edite o tutorial publico do ${tutorial.title.toLowerCase()}, incluindo exemplos, permissoes e comandos relacionados.`,
    };
  });

export const getGeneratedCommandTutorialBySlug = (slug: string): FieldTutorial | null => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) return null;
  return getGeneratedCommandTutorials().find((tutorial) => tutorial.slug === normalizedSlug) ?? null;
};

export const getGeneratedCommandTutorialByCommand = (command: string): FieldTutorial | null => {
  const slug = getCommandTutorialSlug(command);
  return slug ? getGeneratedCommandTutorialBySlug(slug) : null;
};

export const findGeneratedCommandTutorialSection = (
  slug: string,
): PublicTutorialSectionMeta | null => {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) return null;

  for (const section of buildCommandTutorialSections()) {
    const tutorial = section.tutorials.find((item) => item.slug === normalizedSlug);
    if (!tutorial) continue;
    return {
      id: section.id,
      title: section.title,
      description: section.description,
      fieldLabel: tutorial.title,
      fieldDescription: section.description,
    };
  }

  return null;
};
