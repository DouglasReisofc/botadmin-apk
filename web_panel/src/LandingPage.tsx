import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  ChartNoAxesCombined,
  Check,
  LockKeyhole,
  QrCode,
  Sparkles,
  WandSparkles,
  Wifi,
} from "lucide-react";

import { absoluteMediaUrl, api } from "./api";

type PublicFeature = { title?: string; description?: string };
type PublicGroup = { id?: string | number; title?: string; description?: string; imageUrl?: string; isActive?: boolean };
type PublicSettings = {
  siteName?: string;
  tagline?: string;
  logoUrl?: string;
  heroBadge?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroButtonLabel?: string;
  heroButtonUrl?: string;
  heroSecondaryButtonLabel?: string;
  heroSecondaryButtonUrl?: string;
  heroImageUrl?: string;
  featuresTitle?: string;
  featuresSubtitle?: string;
  features?: PublicFeature[];
  workflowTitle?: string;
  workflowDescription?: string;
  workflowBullets?: string[];
  workflowImageUrl?: string;
  ctaTitle?: string;
  ctaDescription?: string;
  ctaButtonLabel?: string;
  ctaButtonUrl?: string;
  footerText?: string;
  officialGroupInviteLink?: string;
  officialGroups?: PublicGroup[];
};

const API_ORIGIN = "https://botadmin.shop";
const defaults = {
  siteName: "Bot Admin",
  heroBadge: "Bot admin para grupos",
  heroTitle: "Administre grupos do WhatsApp no piloto automático",
  heroSubtitle: "Modere conversas, dê boas-vindas, aplique regras e acione comandos de forma automática com o Bot Admin oficial conectado à API da Meta.",
  featuresTitle: "Tudo que você precisa para moderar grupos",
  featuresSubtitle: "Defina regras e comandos; o bot monitora mensagens e toma as ações configuradas em tempo real.",
  workflowTitle: "Como o Bot Admin cuida do seu grupo",
  workflowDescription: "Você define as regras e comandos. O bot monitora mensagens e aplica as políticas automaticamente, 24/7.",
  ctaTitle: "Pronto para organizar seus grupos?",
  ctaDescription: "Ative o Bot Admin e mantenha suas comunidades seguras, organizadas e produtivas.",
};

const defaultFeatures: Required<PublicFeature>[] = [
  { title: "Moderação automática", description: "Boas-vindas, remoção de spam, palavras proibidas, avisos e banimento automático conforme as regras do grupo." },
  { title: "Regras e comandos", description: "Crie comandos como /regras, /menu e /ajuda; ative modo silêncio, somente admin e mensagens programadas." },
  { title: "Relatórios e integrações", description: "Receba alertas no painel, conecte webhooks e registre ações para auditoria das suas comunidades." },
];

const capabilityBlocks = [
  { title: "Automação e moderação de grupos", icon: WandSparkles, items: ["Antilink, antipalavras e regras automáticas em tempo real.", "Comandos personalizados para menu, ajuda e rotinas do grupo.", "Autodownloader para links suportados, incluindo vídeos da Shopee."] },
  { title: "Controle completo de WhatsApp Web", icon: LockKeyhole, items: ["Conexão e pareamento de WhatsApps Web direto no painel.", "Sincronização de grupos por instância e vínculo por convite.", "Gestão de status operacional para evitar operação no escuro."] },
  { title: "Escala comercial e integração", icon: ChartNoAxesCombined, items: ["Campanhas para grupos e status com fluxo orientado no painel.", "API REST para integrar CRM, sistemas próprios e automações externas.", "Experiência responsiva para desktop e mobile com onboarding guiado."] },
];

const safePath = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin || url.origin === API_ORIGIN) return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* use fallback for malformed admin configuration */ }
  return fallback;
};

const safeAsset = (value: string | undefined) => {
  const normalized = absoluteMediaUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized, window.location.origin);
    return url.origin === window.location.origin || url.origin === API_ORIGIN ? normalized : "";
  } catch {
    return "";
  }
};

const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim() : fallback;

export function LandingPage() {
  const [settings, setSettings] = useState<PublicSettings>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void api.publicSite().then((result) => {
      if (active) setSettings((result.settings || {}) as PublicSettings);
    }).catch(() => undefined).finally(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const siteName = text(settings.siteName, defaults.siteName);
  const features = settings.features?.length ? settings.features : defaultFeatures;
  const groups = (settings.officialGroups || []).filter((group) => group.isActive !== false);
  const logo = safeAsset(settings.logoUrl) || "/images/brand/botadmin-logo.webp";
  const heroImage = safeAsset(settings.heroImageUrl) || "/images/png/dasher-ai.png";
  const workflowImage = safeAsset(settings.workflowImageUrl) || "/images/png/botadmin-workflow.jpg";
  const primaryUrl = safePath(settings.heroButtonUrl, "/sign-up");
  const secondaryUrl = safePath(settings.heroSecondaryButtonUrl, "/sign-in");
  const ctaUrl = safePath(settings.ctaButtonUrl, "/sign-up");
  const workflowBullets = settings.workflowBullets?.length ? settings.workflowBullets : ["Boas-vindas automáticas com links e regras", "Bloqueio de spam e palavras proibidas", "Comandos rápidos: /regras, /menu, /silêncio"];
  const marquee = useMemo(() => ["Moderação automática", "Antilink", "Boas-vindas", "Comandos", "Afiliados", "QR Code", "Bot 24/7", "WhatsApp"], []);

  return (
    <main className="landing-page" data-local-react-landing="true">
      <header className="landing-header">
        <div className="container">
          <nav className="landing-header__nav d-flex align-items-center justify-content-between flex-wrap gap-3 py-3" aria-label="Navegação principal">
            <a className="public-brand d-inline-flex align-items-center gap-2 fw-bold fs-4 text-decoration-none" href="/" aria-label={`${siteName} - página inicial`}>
              <img className="public-brand__img" src={logo} alt={`Logo ${siteName}`} width={40} height={40} />
              <span>Bot <b>Admin</b></span>
            </a>
            <div className="landing-header__links d-flex align-items-center flex-wrap gap-2 gap-md-3 small fw-semibold">
              <a className="landing-nav-link" href="/comandos">Comandos</a>
              <a className="landing-nav-link" href="/tutorials">Tutoriais</a>
              <a className="landing-nav-link" href="/grupos-oficiais">Grupos oficiais</a>
              <a className="landing-nav-link" href="/robo-afiliados">Afiliados</a>
              <a className="landing-nav-link" href="#planos">Planos</a>
              <a className="landing-btn landing-btn--ghost" href={secondaryUrl}>Entrar</a>
              <a className="landing-btn landing-btn--neon" href={primaryUrl}>{text(settings.heroButtonLabel, "Começar")}</a>
            </div>
          </nav>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__aurora" aria-hidden="true" />
        <div className="landing-hero__scan" aria-hidden="true" />
        <div className="container landing-hero__container"><div className="row align-items-center gy-5">
          <div className="col-lg-6"><div className="landing-hero__copy">
            <div className="landing-hero__badge"><span className="landing-hero__pulse" />{text(settings.heroBadge, defaults.heroBadge)}</div>
            <h1 className="landing-hero__title">{text(settings.heroTitle, defaults.heroTitle)}</h1>
            <p className="landing-hero__subtitle">{text(settings.heroSubtitle, defaults.heroSubtitle)}</p>
            <div className="landing-hero__actions"><a className="landing-btn landing-btn--neon landing-btn--lg" href={primaryUrl}>{text(settings.heroButtonLabel, "Criar conta")}</a><a className="landing-btn landing-btn--glass landing-btn--lg" href={secondaryUrl}>{text(settings.heroSecondaryButtonLabel, "Já sou cliente")}</a><a className="landing-btn landing-btn--glass landing-btn--lg" href="/comandos">Ver comandos</a></div>
            <div className="landing-hero__stats" aria-label="Destaques do BotAdmin"><div className="landing-stat"><strong>24/7</strong><span>Robô online</span></div><div className="landing-stat"><strong>0.4s</strong><span>Resposta média</span></div><div className="landing-stat"><strong>Auto</strong><span>Moderação total</span></div></div>
          </div></div>
          <div className="col-lg-6 text-center"><div className="landing-hero__phone-stage"><div className="landing-hero__phone-glow" aria-hidden="true" /><img className="landing-hero__hero-image" src={heroImage} alt="Painel BotAdmin para WhatsApp" /></div></div>
        </div></div>
      </section>

      <div className="landing-marquee" aria-hidden="true"><div className="landing-marquee__track">{[0, 1].map((loop) => <div className="landing-marquee__group" key={loop}>{marquee.map((item) => <span key={`${loop}-${item}`}>{item}</span>)}</div>)}</div></div>

      <section className="landing-section landing-section--glass py-10"><div className="container"><div className="row align-items-center gy-5"><div className="col-lg-6"><span className="badge bg-primary mb-3 text-uppercase landing-chip">API própria do WhatsApp</span><h2 className="fw-bold mb-3 landing-title">Use o robô com conexão própria por QR Code</h2><p className="text-secondary mb-4 landing-lead">O BotAdmin permite conectar instâncias do WhatsApp direto no painel para operar o robô em grupos, responder comandos e automatizar rotinas sem configuração manual complexa.</p><div className="row gy-3"><div className="col-sm-6"><div className="landing-feature-point d-flex gap-3"><div className="landing-feature-point__icon"><QrCode size={26} /></div><div><h3 className="h6 fw-bold mb-1">Pareamento por QR</h3><p className="text-secondary small mb-0">Escaneie o QR Code no celular e vincule a instância.</p></div></div></div><div className="col-sm-6"><div className="landing-feature-point d-flex gap-3"><div className="landing-feature-point__icon"><Wifi size={26} /></div><div><h3 className="h6 fw-bold mb-1">API integrada</h3><p className="text-secondary small mb-0">Comandos, automações, grupos e painel administrativo.</p></div></div></div></div></div><div className="col-lg-6"><div className="landing-media-panel mx-auto"><div className="landing-media-panel__placeholder"><Bot size={62} /><span>WhatsApp conectado</span><small>Operação em tempo real</small></div></div></div></div></div></section>

      <section className="landing-section landing-section--mesh py-10"><div className="container"><header className="text-center mb-6 landing-section-head"><span className="landing-kicker">Recursos</span><h2 className="fw-bold mb-3 landing-title">{text(settings.featuresTitle, defaults.featuresTitle)}</h2><p className="text-secondary mb-0 landing-lead mx-auto">{text(settings.featuresSubtitle, defaults.featuresSubtitle)}</p></header><div className="row gy-4">{features.map((feature, index) => <div className="col-md-4" key={`${feature.title}-${index}`}><article className="h-100 border-0 landing-card landing-card--hover"><div className="card-body p-5"><div className="landing-icon-badge mb-3">{index === 0 ? <Activity size={28} /> : index === 1 ? <WandSparkles size={28} /> : <ChartNoAxesCombined size={28} />}</div><h3 className="h4 mb-3">{text(feature.title, defaultFeatures[index % defaultFeatures.length].title)}</h3><p className="text-secondary mb-0">{text(feature.description, defaultFeatures[index % defaultFeatures.length].description)}</p></div></article></div>)}</div></div></section>

      <section id="planos" className="landing-section landing-section--glass py-10"><div className="container"><header className="text-center mb-6 landing-section-head"><span className="badge bg-primary mb-3 text-uppercase landing-chip">Planos e preços</span><h2 className="fw-bold mb-3 landing-title">Planos do Bot Admin</h2><p className="text-secondary mb-0 landing-lead mx-auto">Escolha a estrutura certa para sua operação no WhatsApp.</p></header><div className="row gy-4"><div className="col-lg-4 col-md-6"><article className="h-100 border-0 landing-card landing-card--plan landing-card--hover"><div className="card-body p-5"><h3 className="h4 fw-bold mb-1">Plano Mensal</h3><p className="text-secondary small">mensal</p><div className="display-6 fw-bold mb-3 landing-price">R$ 25,00 <span className="fs-6 text-secondary fw-normal">/ mensal</span></div><ul className="list-unstyled d-flex flex-column gap-2 mb-4"><li className="d-flex gap-2"><Check size={18} className="text-success" />1 grupo ativado por licença</li><li className="d-flex gap-2"><Check size={18} className="text-success" />Painel e automações em tempo real</li><li className="d-flex gap-2"><Check size={18} className="text-success" />Suporte e atualizações</li></ul><a className="btn btn-success rounded-pill" href={primaryUrl}>Começar agora <ArrowRight size={16} /></a></div></article></div><div className="col-lg-4 col-md-6"><article className="h-100 border-0 landing-card landing-card--plan landing-card--hover"><div className="card-body p-5"><h3 className="h4 fw-bold mb-1">Plano Anual</h3><p className="text-secondary small">365 dias</p><div className="display-6 fw-bold mb-3 landing-price">R$ 297,00 <span className="fs-6 text-secondary fw-normal">/ anual</span></div><ul className="list-unstyled d-flex flex-column gap-2 mb-4"><li className="d-flex gap-2"><Check size={18} className="text-success" />Economia na renovação anual</li><li className="d-flex gap-2"><Check size={18} className="text-success" />Todos os recursos do painel</li><li className="d-flex gap-2"><Check size={18} className="text-success" />Prioridade e estabilidade</li></ul><a className="btn btn-outline-success rounded-pill" href={primaryUrl}>Ver detalhes <ArrowRight size={16} /></a></div></article></div></div></div></section>

      <section className="landing-section py-10"><div className="container"><header className="text-center mb-6 landing-section-head"><span className="landing-kicker">Capacidades</span><h2 className="fw-bold mb-3 landing-title">Muito além do básico</h2><p className="text-secondary mb-0 landing-lead mx-auto">Recursos para operação profissional de comunidades, suporte e vendas.</p></header><div className="row gy-4">{capabilityBlocks.map(({ title, icon: Icon, items }) => <div className="col-lg-4 col-md-6" key={title}><article className="h-100 border-0 landing-card landing-card--hover"><div className="card-body p-5"><div className="landing-icon-badge mb-3"><Icon size={28} /></div><h3 className="h4 mb-3">{title}</h3><ul className="list-unstyled d-flex flex-column gap-2 mb-0">{items.map((item) => <li className="d-flex align-items-start gap-2 text-secondary" key={item}><Sparkles size={16} className="text-success mt-1 flex-shrink-0" /><span>{item}</span></li>)}</ul></div></article></div>)}</div></div></section>

      <section className="landing-section landing-section--glass py-10"><div className="container"><div className="row align-items-center gy-6"><div className="col-lg-6"><div className="landing-media-frame"><img src={workflowImage} alt="Fluxo do BotAdmin" className="rounded-4" loading="lazy" /></div></div><div className="col-lg-6"><span className="landing-kicker">Como funciona</span><h2 className="fw-bold mb-3 landing-title">{text(settings.workflowTitle, defaults.workflowTitle)}</h2><p className="text-secondary mb-4 landing-lead">{text(settings.workflowDescription, defaults.workflowDescription)}</p><ul className="list-unstyled d-flex flex-column gap-2 landing-check-list">{workflowBullets.map((bullet) => <li className="d-flex align-items-center gap-2" key={bullet}><Sparkles className="text-success" size={20} />{bullet}</li>)}</ul></div></div></div></section>

      {groups.length > 0 && <section className="landing-section landing-section--mesh py-10"><div className="container"><div className="row align-items-center gy-5"><div className="col-lg-5"><span className="badge bg-success mb-3 text-uppercase landing-chip">Grupo oficial</span><h2 className="fw-bold mb-3 landing-title">Entre no grupo oficial do BotAdmin</h2><p className="text-secondary mb-4 landing-lead">Teste comandos, acompanhe novidades e fale com a comunidade.</p><a className="btn btn-success btn-lg rounded-pill" href="/grupos-oficiais">Ver grupos oficiais</a></div><div className="col-lg-7"><div className="row gy-4">{groups.slice(0, 2).map((group) => { const groupImage = safeAsset(group.imageUrl); return <div className="col-md-6" key={String(group.id || group.title)}><article className="h-100 border-0 landing-card landing-card--hover text-center"><div className="card-body p-4 d-flex flex-column align-items-center"><div className="landing-avatar mb-3">{groupImage ? <img src={groupImage} alt={group.title || "Grupo oficial"} loading="lazy" /> : <span className="display-6 fw-bold text-success">#</span>}</div><h3 className="h5 fw-bold mb-3">{group.title || "Grupo oficial BotAdmin"}</h3><div className="landing-inset w-100 text-start text-secondary small p-3 mb-4">{group.description || "Grupo oficial para testar comandos e acompanhar novidades."}</div><a href="/grupos-oficiais" className="btn btn-outline-success btn-sm rounded-pill mt-auto">Abrir grupo</a></div></article></div>; })}</div></div></div></div></section>}

      <section className="landing-cta py-10"><div className="container"><div className="landing-cta__panel"><div className="row align-items-center gy-4"><div className="col-lg-8"><h2 className="fw-bold mb-2">{text(settings.ctaTitle, defaults.ctaTitle)}</h2><p className="mb-0 opacity-90">{text(settings.ctaDescription, defaults.ctaDescription)}</p></div><div className="col-lg-4 text-lg-end"><a className="btn btn-light btn-lg rounded-pill px-4 fw-bold" href={ctaUrl}>{text(settings.ctaButtonLabel, "Começar agora")}</a></div></div></div></div></section>

      <footer className="landing-footer py-5"><div className="container"><div className="row align-items-center gy-3"><div className="col-lg-6"><p className="fw-bold mb-2 landing-footer__brand">Bot <span>Admin</span></p><p className="text-secondary small mb-0">{text(settings.footerText, "Automação e gestão para grupos do WhatsApp com foco em operação, segurança e suporte ao cliente.")}</p><p className="text-secondary small mb-0 mt-2">© {new Date().getFullYear()} BotAdmin. Todos os direitos reservados.</p></div><div className="col-lg-6"><div className="d-flex justify-content-lg-end justify-content-start flex-wrap gap-3 small landing-footer__links"><a href="/comandos">Comandos</a><a href="/tutorials">Tutoriais</a><a href="/grupos-oficiais">Grupos oficiais</a><a href="/robo-afiliados">Robô de afiliados</a><a href="/termos">Termos de uso</a><a href="/privacidade">Política de privacidade</a><a href={secondaryUrl}>Entrar</a></div></div></div></div></footer>
      {!loaded && <div className="landing-react-loading" role="status">Carregando conteúdo…</div>}
    </main>
  );
}
