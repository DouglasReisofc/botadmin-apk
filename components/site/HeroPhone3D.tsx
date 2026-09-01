"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./HeroPhone3D.module.css";

const IconSignal = () => (
  <svg viewBox="0 0 18 12" width="16" height="11" fill="currentColor" aria-hidden="true">
    <rect x="0" y="8" width="3" height="4" rx="0.6" />
    <rect x="5" y="5" width="3" height="7" rx="0.6" />
    <rect x="10" y="2.5" width="3" height="9.5" rx="0.6" />
    <rect x="15" y="0" width="3" height="12" rx="0.6" opacity="0.35" />
  </svg>
);

const IconWifi = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12 18.5a1.5 1.5 0 1 0 .001 2.999A1.5 1.5 0 0 0 12 18.5zm-4.2-3.1 1.4 1.4A4 4 0 0 1 12 16c1.1 0 2.1.4 2.8 1.1l1.4-1.4A6 6 0 0 0 12 14a6 6 0 0 0-4.2 1.4zm-2.9-2.9 1.4 1.4A8 8 0 0 1 12 12c2.2 0 4.2.9 5.7 2.3l1.4-1.4A10 10 0 0 0 12 10a10 10 0 0 0-7.1 2.5z" />
  </svg>
);

const IconBattery = () => (
  <svg viewBox="0 0 28 14" width="22" height="11" fill="none" aria-hidden="true">
    <rect x="0.6" y="0.6" width="23" height="12.8" rx="2.2" stroke="currentColor" strokeWidth="1.2" />
    <rect x="2.2" y="2.3" width="17.5" height="9.4" rx="1.2" fill="currentColor" />
    <path d="M24.5 4.2h1.4c.8 0 1.5.7 1.5 1.5v2.6c0 .8-.7 1.5-1.5 1.5h-1.4V4.2z" fill="currentColor" />
  </svg>
);

const IconVideo = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 3.5v-10l-4 3.5z" />
  </svg>
);

const IconCall = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1L6.6 10.8z" />
  </svg>
);

const IconMore = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);

const IconEmoji = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm-3.5 7.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm7 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 17.5c-2.3 0-4.2-1.4-4.8-3.4h9.6c-.6 2-2.5 3.4-4.8 3.4z" />
  </svg>
);

const IconAttach = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M16.5 6.5v8.8a4.5 4.5 0 1 1-9 0V6.2a3 3 0 0 1 6 0v8.6a1.5 1.5 0 1 1-3 0V7.5h1.5v7.3a3 3 0 1 0 6 0V6.2a4.5 4.5 0 1 0-9 0v9.1a6 6 0 1 0 12 0V6.5H16.5z" />
  </svg>
);

const IconMic = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z" />
  </svg>
);

const IconDeleted = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M8 1.3A6.7 6.7 0 1 0 14.7 8 6.7 6.7 0 0 0 8 1.3zm0 12A5.3 5.3 0 1 1 13.3 8 5.3 5.3 0 0 1 8 13.3zm2.4-8.4L8 7.3 5.6 4.9 4.9 5.6 7.3 8l-2.4 2.4.7.7L8 8.7l2.4 2.4.7-.7L8.7 8l2.4-2.4-.7-.7z" />
  </svg>
);

type Person = {
  name: string;
  color: string;
  avatar: string;
  text: string;
  /** Se true, além de apagar a mensagem, remove a pessoa do grupo */
  removeFromGroup: boolean;
};

const PEOPLE: Person[] = [
  {
    name: "Carlos",
    color: "#53bdeb",
    avatar: "/images/avatar/avatar-8.jpg",
    text: "Olha essa promoção 👀\nhttps://spam-ofertas.fake/desconto",
    removeFromGroup: true,
  },
  {
    name: "Pedro",
    color: "#e1701a",
    avatar: "/images/avatar/avatar-4.jpg",
    text: "Entra no meu grupo também\nhttps://chat.whatsapp.com/convite-fake",
    removeFromGroup: false,
  },
  {
    name: "Lucas",
    color: "#9b59b6",
    avatar: "/images/avatar/avatar-10.jpg",
    text: "Link da loja 🔥\nhttps://loja-suspeita.fake/oferta",
    removeFromGroup: true,
  },
  {
    name: "Marina",
    color: "#e84393",
    avatar: "/images/avatar/avatar-5.jpg",
    text: "Passa no site:\nhttps://desconto-spam.fake/vip",
    removeFromGroup: false,
  },
  {
    name: "Rafa",
    color: "#00b894",
    avatar: "/images/avatar/avatar-11.jpg",
    text: "Acesso liberado aqui\nhttps://link-proibido.fake/acesso",
    removeFromGroup: true,
  },
  {
    name: "Bruno",
    color: "#0984e3",
    avatar: "/images/avatar/avatar-7.jpg",
    text: "Confere esse cupom\nhttps://cupom-spam.fake/agora",
    removeFromGroup: false,
  },
];

type ChatItem =
  | {
      id: string;
      kind: "msg";
      name: string;
      color: string;
      avatar: string;
      text: string;
      time: string;
      deleted?: boolean;
      isLink?: boolean;
    }
  | {
      id: string;
      kind: "event";
      text: string;
      tone?: "neutral" | "danger" | "success";
    };

const BASE_MEMBERS = ["Ana", "Carlos", "Pedro", "Lucas", "Marina", "Rafa", "Bruno", "você"];

const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const formatMembers = (list: string[]) => {
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")}…`;
};

const HeroPhone3D = () => {
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: "seed-event",
      kind: "event",
      tone: "success",
      text: "ANTILINK ativo neste grupo",
    },
    {
      id: "seed-msg",
      kind: "msg",
      name: PEOPLE[0].name,
      color: PEOPLE[0].color,
      avatar: PEOPLE[0].avatar,
      text: PEOPLE[0].text,
      time: nowTime(),
      isLink: true,
    },
  ]);
  const [members, setMembers] = useState<string[]>([...BASE_MEMBERS, PEOPLE[0].name, "você"].filter(
    (name, index, arr) => arr.indexOf(name) === index,
  ));
  // Seed já mostra PEOPLE[0]; o loop começa no próximo
  const personIndex = useRef(1);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<"idle" | "waiting-delete" | "waiting-remove">("idle");
  const lastMsgId = useRef<string | null>(null);
  const lastPerson = useRef<Person | null>(null);

  const clock = useMemo(() => nowTime(), [items.length]);
  const membersLabel = useMemo(() => formatMembers(members), [members]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    // requestAnimationFrame ajuda no iOS/mobile quando o layout ainda está medindo
    const id = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(id);
  }, [items]);

  // Loop da demo (mobile + desktop). Não desliga por prefers-reduced-motion:
  // a demo do produto precisa rodar em todos os aparelhos.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let lastTickAt = Date.now();

    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (fn: () => void, ms: number) => {
      clearTimer();
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const tick = () => {
      if (cancelled) return;
      lastTickAt = Date.now();

      // 1) Alguém manda link
      if (phaseRef.current === "idle") {
        if (personIndex.current > 0 && personIndex.current % PEOPLE.length === 0) {
          setMembers(BASE_MEMBERS);
          setItems((prev) =>
            [
              ...prev,
              {
                id: uid(),
                kind: "event" as const,
                tone: "success" as const,
                text: "Novos membros entraram no grupo",
              },
            ].slice(-12),
          );
        }

        const person = PEOPLE[personIndex.current % PEOPLE.length];
        personIndex.current += 1;
        const id = uid();
        lastMsgId.current = id;
        lastPerson.current = person;

        setMembers((prev) =>
          prev.includes(person.name)
            ? prev
            : [...prev.filter((name) => name !== "você"), person.name, "você"],
        );

        setItems((prev) => {
          const next: ChatItem[] = [
            ...prev,
            {
              id,
              kind: "msg",
              name: person.name,
              color: person.color,
              avatar: person.avatar,
              text: person.text,
              time: nowTime(),
              isLink: true,
            },
          ];
          return next.slice(-12);
        });

        phaseRef.current = "waiting-delete";
        schedule(tick, 1200);
        return;
      }

      // 2) Mensagem apagada por BotAdmin
      if (phaseRef.current === "waiting-delete") {
        const targetId = lastMsgId.current;
        if (targetId) {
          setItems((prev) =>
            prev.map((item) =>
              item.kind === "msg" && item.id === targetId
                ? {
                    ...item,
                    deleted: true,
                    isLink: false,
                    text: "Esta mensagem foi apagada por BotAdmin",
                  }
                : item,
            ),
          );
        }

        const person = lastPerson.current;
        if (person?.removeFromGroup) {
          phaseRef.current = "waiting-remove";
          schedule(tick, 900);
          return;
        }

        phaseRef.current = "idle";
        schedule(tick, 1400);
        return;
      }

      // 3) Algumas pessoas também são removidas do grupo
      if (phaseRef.current === "waiting-remove") {
        const person = lastPerson.current;
        if (person) {
          setMembers((prev) => prev.filter((name) => name !== person.name));
          setItems((prev) => {
            const next: ChatItem[] = [
              ...prev,
              {
                id: uid(),
                kind: "event",
                tone: "danger",
                text: `${person.name} foi removido por BotAdmin`,
              },
            ];
            return next.slice(-12);
          });
        }

        phaseRef.current = "idle";
        schedule(tick, 1500);
      }
    };

    // Kick imediato + um segundo kick (hidratação mobile às vezes atrasa o 1º paint)
    schedule(tick, 450);
    const boot = setTimeout(() => {
      if (!cancelled && Date.now() - lastTickAt > 2000) {
        phaseRef.current = "idle";
        schedule(tick, 200);
      }
    }, 2200);

    // Watchdog: se a aba voltar do background ou o loop travar, reinicia
    watchdog = setInterval(() => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastTickAt > 4500) {
        phaseRef.current = "idle";
        schedule(tick, 120);
      }
    }, 2000);

    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        if (Date.now() - lastTickAt > 1500) {
          phaseRef.current = "idle";
          schedule(tick, 200);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      clearTimer();
      clearTimeout(boot);
      if (watchdog) clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return (
    <div className={styles.stage} aria-label="Demonstração WhatsApp: links apagados e membros removidos pelo BotAdmin">
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.heroRow}>
        <div className={styles.callout} aria-hidden="false">
          <div className={styles.calloutCard}>
            <span className={styles.calloutBadge}>Proteção automática</span>
            <p className={styles.calloutTitle}>
              Assim o seu grupo
              <br />
              <strong>fica protegido</strong>
            </p>
            <p className={styles.calloutText}>
              O BotAdmin apaga links proibidos e remove quem insiste — sem você precisar fazer nada.
            </p>
          </div>

          <svg
            className={styles.curveArrow}
            viewBox="0 0 160 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/*
              Curva: (22,30) → (122,72)
              Tangente final ≈ 3*(P3-P2) = (42,114) → ângulo ~70°
              A ponta (triângulo) aponta no eixo +X local e gira 70°.
            */}
            <path
              className={styles.curvePath}
              d="M22 30 C 62 16, 108 34, 122 72"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="butt"
              fill="none"
            />
            <g transform="translate(122 72) rotate(70)">
              {/* encaixa a base na ponta da linha */}
              <path d="M0 0 L-13 -7.2 L-13 7.2 Z" fill="currentColor" />
            </g>
            <circle className={styles.curveDot} cx="22" cy="30" r="5" fill="currentColor" />
          </svg>
        </div>

        <div className={styles.phoneShell}>
          <div className={styles.phoneBezel}>
            <span className={styles.sideBtnTop} aria-hidden="true" />
            <span className={styles.sideBtnVol} aria-hidden="true" />
            <span className={styles.sideBtnPower} aria-hidden="true" />
            <div className={styles.phone}>
              <div className={styles.notch} aria-hidden="true" />

          <header className={styles.header}>
            <div className={styles.statusBar}>
              <span>{clock}</span>
              <span className={styles.statusRight}>
                <IconSignal />
                <IconWifi />
                <IconBattery />
              </span>
            </div>

            <div className={styles.headerMain}>
              <img
                className={styles.groupPhoto}
                src="/images/avatar/avatar-12.jpg"
                alt="Foto do grupo"
                width={40}
                height={40}
              />
              <div className={styles.headerText}>
                <strong>Grupo VIP · Ofertas</strong>
                <span>{membersLabel}</span>
              </div>
              <div className={styles.headerActions}>
                <span className={styles.iconBtn}>
                  <IconVideo />
                </span>
                <span className={styles.iconBtn}>
                  <IconCall />
                </span>
                <span className={styles.iconBtn}>
                  <IconMore />
                </span>
              </div>
            </div>

            <div className={styles.protectionBar}>
              <span>🛡️ ANTILINK</span>
              <span>ativo</span>
            </div>
          </header>

          <div className={styles.chat} ref={chatRef}>
            <div className={styles.dayChip}>Hoje</div>

            {items.map((item) => {
              if (item.kind === "event") {
                return (
                  <div
                    key={item.id}
                    className={styles.eventChip}
                    data-tone={item.tone || "neutral"}
                  >
                    {item.text}
                  </div>
                );
              }

              return (
                <article
                  key={item.id}
                  className={[
                    styles.bubble,
                    styles.in,
                    item.isLink ? styles.linkBubble : "",
                    item.deleted ? styles.deletedBubble : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className={styles.senderRow}>
                    <img
                      className={styles.msgAvatar}
                      src={item.avatar}
                      alt=""
                      width={18}
                      height={18}
                    />
                    <span className={styles.sender} style={{ color: item.color }}>
                      {item.name}
                    </span>
                  </div>

                  {item.deleted ? (
                    <p className={styles.deletedText}>
                      <IconDeleted />
                      Esta mensagem foi apagada por BotAdmin
                    </p>
                  ) : (
                    <p className={styles.msgText}>
                      {item.text.split(/(https?:\/\/\S+)/g).map((part, i) =>
                        part.startsWith("http") ? (
                          <span key={i} className={styles.link}>
                            {part}
                          </span>
                        ) : (
                          <span key={i}>{part}</span>
                        ),
                      )}
                    </p>
                  )}

                  <div className={styles.meta}>
                    <time>{item.time}</time>
                  </div>
                </article>
              );
            })}
          </div>

          <footer className={styles.composer}>
            <span className={styles.composeIcon}>
              <IconEmoji />
            </span>
            <div className={styles.input}>Mensagem</div>
            <span className={styles.composeIcon}>
              <IconAttach />
            </span>
            <span className={styles.mic}>
              <IconMic />
            </span>
          </footer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroPhone3D;
