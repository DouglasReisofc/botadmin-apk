"use client";

import { useMemo, useState } from "react";
import { Button, Card } from "react-bootstrap";

import type { BotMenuConfig } from "types/bot";
import type { MetaBusinessProfile } from "types/meta";

import UserBotProfileForm from "./UserBotProfileForm";

interface UserBotConfigPanelProps {
  menuConfig: BotMenuConfig | null;
  profile: MetaBusinessProfile | null;
  hasWebhookCredentials: boolean;
}

type ViewId = "profile";

type ViewOption = {
  id: ViewId;
  label: string;
  description: string;
};

const VIEW_OPTIONS: readonly ViewOption[] = [
  {
    id: "profile",
    label: "Perfil do WhatsApp",
    description:
      "Atualize foto, descrição e dados comerciais exibidos no perfil do número integrado à Meta.",
  },
];

const UserBotConfigPanel = ({
  menuConfig,
  profile,
  hasWebhookCredentials,
}: UserBotConfigPanelProps) => {
  const [activeView, setActiveView] = useState<ViewId>("profile");

  const activeOption = useMemo(
    () => VIEW_OPTIONS.find((option) => option.id === activeView) ?? VIEW_OPTIONS[0],
    [activeView],
  );

  return (
    <div className="d-flex flex-column gap-4">
      <Card>
        <Card.Body>
          <div className="d-flex flex-column flex-lg-row gap-3 align-items-lg-start">
            <div className="flex-grow-1">
              <Card.Title as="h2" className="h5 mb-1">
                Passo 1 — Credenciais
              </Card.Title>
              <Card.Text className="text-secondary mb-2">
                Antes de personalizar o bot, cadastre as credenciais do WhatsApp/Meta. Sem elas nenhuma automação funcionará.
              </Card.Text>
            </div>
            <Button
              href="/dashboard/user/webhook"
              variant={hasWebhookCredentials ? "outline-secondary" : "warning"}
              className="text-nowrap"
            >
              {hasWebhookCredentials ? "Revisar credenciais" : "Configurar credenciais"}
            </Button>
          </div>

          <hr className="my-4" />

          <Card.Title as="h2" className="h5">
            Passo 2 — Conteúdos do bot
          </Card.Title>
          <Card.Text className="text-secondary mb-3">
            Depois de validar suas credenciais, escolha o que deseja ajustar no bot.
          </Card.Text>

          <div className="d-flex flex-wrap gap-2">
            {VIEW_OPTIONS.map((option) => (
              <Button
                key={option.id}
                variant={activeView === option.id ? "primary" : "outline-primary"}
                onClick={() => setActiveView(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <Card.Text className="text-secondary mb-0 mt-3">{activeOption.description}</Card.Text>
        </Card.Body>
      </Card>

      {activeView === "profile" && (
        <UserBotProfileForm profile={profile} hasWebhookCredentials={hasWebhookCredentials} />
      )}
    </div>
  );
};

export default UserBotConfigPanel;
