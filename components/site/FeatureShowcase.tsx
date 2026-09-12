"use client";

import { useRef, useState } from "react";
import styles from "./FeatureShowcase.module.css";

const examples = [
  { category: "COMUNIDADES", title: "Um grupo organizado começa na chegada.", description: "Configure boas-vindas, regras e proteções para cada comunidade. Você escolhe o que o robô pode fazer.", example: "Exemplo: receber um novo membro com uma mensagem de boas-vindas e as regras do grupo.", image: "community" },
  { category: "CONEXÃO", title: "Do celular para o seu painel.", description: "Conecte o WhatsApp por QR Code ou código de pareamento e acompanhe suas conversas em um só lugar.", example: "Exemplo: selecionar um perfil e gerenciar seus grupos sem trocar de aparelho.", image: "connect" },
  { category: "DIVULGAÇÕES", title: "Prepare agora. Publique na hora certa.", description: "Organize listas, mensagens e variações. Defina horários e intervalos de envio de acordo com sua rotina.", example: "Exemplo: programar um aviso com imagem e botões para os grupos da sua lista.", image: "hero" },
  { category: "AFILIADOS", title: "Seu catálogo, sua forma de divulgar.", description: "Organize produtos por plataforma, configure a mensagem e confira a prévia antes de compartilhar.", example: "Exemplo: separar produtos da Shopee e do Mercado Livre e criar uma divulgação para cada público.", image: "commerce" },
  { category: "GRUPOS BOTADMIN", title: "Uma comunidade dentro do BotAdmin.", description: "Crie um grupo interno com identidade própria, compartilhe o convite e ajuste as permissões dos membros.", example: "Exemplo: personalizar o nome, a foto e o robô de um grupo exclusivo para seus clientes.", image: "community" },
  { category: "COMANDOS", title: "Menos tarefas repetidas. Mais conversa.", description: "Disponibilize comandos e configure as automações que fazem sentido para cada grupo.", example: "Exemplo: deixar regras e informações de ajuda acessíveis por um comando no chat.", image: "connect" },
] as const;

export default function FeatureShowcase({ images = {} }: { images?: Record<string, string> }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ first: true, last: false });
  const updateEdges = () => {
    const el = track.current;
    if (el) setEdge({ first: el.scrollLeft <= 2, last: el.scrollLeft + el.clientWidth >= el.scrollWidth - 3 });
  };
  const move = (direction: number) => {
    const el = track.current;
    if (!el) return;
    const distance = el.firstElementChild?.getBoundingClientRect().width || el.clientWidth;
    el.scrollBy({ left: direction * (distance + 24), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return (
    <section className={styles.section} aria-labelledby="showcase-title" id="exemplos">
      <div className={styles.inner}>
        <header className={styles.header}>
          <div><span className={styles.eyebrow}>BOTADMIN NA PRÁTICA</span><h2 id="showcase-title">Uma rotina mais simples.<br />Várias formas de usar.</h2><p>Explore os recursos e imagine como eles podem ajudar no seu dia a dia.</p></div>
          <div className={styles.controls}>
            <button type="button" onClick={() => move(-1)} disabled={edge.first} aria-label="Ver exemplos anteriores" aria-controls="showcase-track">←</button>
            <button type="button" onClick={() => move(1)} disabled={edge.last} aria-label="Ver próximos exemplos" aria-controls="showcase-track">→</button>
          </div>
        </header>
        <div className={styles.track} id="showcase-track" ref={track} onScroll={updateEdges} tabIndex={0} aria-label="Exemplos de recursos; deslize ou use as setas">
          {examples.map((item, index) => <article className={styles.card} key={item.category}>
            <div className={styles.art}><img src={images[item.image] || `/botadmin-landing/botadmin-${item.image}-v2.webp`} alt="" loading="lazy" decoding="async" width={1200} height={900} /><span>{String(index + 1).padStart(2, "0")}</span></div>
            <div className={styles.copy}><span className={styles.eyebrow}>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p><div className={styles.example}>{item.example}</div></div>
          </article>)}
        </div>
        <p className={styles.hint}>Deslize para explorar · Exemplos ilustrativos. A disponibilidade depende do plano e das configurações.</p>
        <div className={styles.steps}>
          {[ ["01", "Crie sua conta", "Acesse o painel pelo computador ou celular."], ["02", "Configure seu espaço", "Conecte um perfil WhatsApp ou crie seu grupo interno."], ["03", "Deixe do seu jeito", "Escolha regras, comandos e programações para sua rotina."] ].map(([number, title, copy]) => <div key={number}><b>{number}</b><h3>{title}</h3><p>{copy}</p></div>)}
        </div>
        <div className={styles.faq}>
          <h2>Antes de começar</h2>
          <details><summary>Preciso conectar um WhatsApp para usar os grupos internos?</summary><p>Não. Os grupos internos do BotAdmin funcionam dentro do próprio sistema. Para gerenciar conversas e grupos do WhatsApp, conecte um perfil na área de perfis.</p></details>
          <details><summary>Posso escolher quais automações ficam ativas?</summary><p>Sim. Configure os recursos disponíveis no seu plano e as permissões de cada grupo. Revise as regras antes de ativar ações de moderação.</p></details>
          <details><summary>Consigo usar no celular e no computador?</summary><p>Sim. O painel web se adapta ao tamanho da tela. Use a mesma conta para acessar os recursos disponíveis para você.</p></details>
          <details><summary>O BotAdmin é um produto oficial do WhatsApp?</summary><p>Não. BotAdmin é uma plataforma independente. WhatsApp é uma marca da Meta. O uso de integrações deve respeitar as regras e condições da plataforma.</p></details>
        </div>
      </div>
    </section>
  );
}
