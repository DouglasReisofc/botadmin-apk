"use client";

import { useEffect, useMemo, useState } from "react";
import { IconArrowBackUp, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";

import { buildCommandPreviewScenario } from "lib/command-preview";

import styles from "./CommandPhoneDemo.module.css";

type CommandPhoneDemoProps = {
  command: string;
  title: string;
  summary?: string;
  sectionTitle?: string | null;
};

const CommandPhoneDemo = ({ command, title, summary, sectionTitle }: CommandPhoneDemoProps) => {
  const scenario = useMemo(() => buildCommandPreviewScenario(command, summary), [command, summary]);
  const messages = scenario.messages;
  const commandLabel = scenario.commandText;
  const stepLabels = scenario.steps;
  const [visibleCount, setVisibleCount] = useState(1);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setVisibleCount((current) => {
        if (current >= messages.length) {
          window.clearInterval(id);
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1100);
    return () => window.clearInterval(id);
  }, [messages.length, playing]);

  const restart = () => {
    setVisibleCount(1);
    setPlaying(true);
  };

  const visibleMessages = messages.slice(0, visibleCount);

  return (
    <section className={styles.demoShell} aria-label={`Simulação animada do ${title}`}>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{scenario.sourceLabel}</span>
        <h2>Veja como o comando {commandLabel} funciona no WhatsApp</h2>
        <p>{scenario.intro}</p>
        <ol className={styles.steps}>
          {stepLabels.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <div className={styles.controls}>
          <button type="button" className={styles.controlButton} onClick={restart}>
            {playing ? <IconRefresh size={15} /> : <IconPlayerPlay size={15} />}
            {playing ? "Reiniciar" : "Rever simulação"}
          </button>
        </div>
      </div>

      <div className={styles.phoneWrap}>
        <div className={styles.transcript}>
          <h3>Transcrição do preview do comando {commandLabel}</h3>
          <ol>
            {messages.map((message) => (
              <li key={message.id}>
                {message.from === "user"
                  ? "Admin"
                  : message.from === "member"
                    ? message.sender || "Membro"
                  : message.from === "bot"
                    ? "BotAdmin"
                    : message.from === "event"
                      ? "Evento do WhatsApp"
                      : "Sistema"}
                {": "}
                {message.text}
              </li>
            ))}
          </ol>
        </div>
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.status}>
              <span>11:14</span>
              <span>4G</span>
            </div>
            <header className={styles.header}>
              <span className={styles.back}>‹</span>
              <span className={styles.avatar}>B</span>
              <span className={styles.headerText}>
                <strong>Grupo com BotAdmin</strong>
                <span>{sectionTitle || "Tutorial de comando"}</span>
              </span>
              <span className={styles.dots}>⋮</span>
            </header>
            <div className={styles.chat}>
              {visibleMessages.map((message) => {
                if (message.from === "system" || message.from === "event") {
                  return (
                    <div
                      key={message.id}
                      className={message.from === "event" ? styles.event : styles.system}
                    >
                      {message.text}
                    </div>
                  );
                }
                const className = message.from === "user" ? styles.outgoing : styles.incoming;
                return (
                  <article key={message.id} className={`${styles.bubble} ${className}`}>
                    {message.sender ? <span className={styles.sender}>{message.sender}</span> : null}
                    <p className={styles.text}>{message.text}</p>
                    {message.footer ? <span className={styles.footer}>{message.footer}</span> : null}
                    {message.buttons?.length ? (
                      <div className={styles.buttonList}>
                        {message.buttons.map((button) => (
                          <span key={button} className={styles.replyButton}>
                            <IconArrowBackUp size={14} />
                            {button}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <span className={styles.time}>11:14</span>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
        <p className={styles.caption}>
          Demonstração visual do que o usuário vê no WhatsApp ao usar o comando.
        </p>
      </div>
    </section>
  );
};

export default CommandPhoneDemo;
