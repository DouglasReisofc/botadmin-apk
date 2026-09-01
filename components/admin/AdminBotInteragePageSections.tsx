"use client";

import { useState } from "react";

import AdminBotInterageConfigForm from "components/admin/AdminBotInterageConfigForm";
import AdminBotInterageTtsConfigForm from "components/admin/AdminBotInterageTtsConfigForm";
import type {
  AdminBotInterageAllowedUser,
  AdminBotInterageConfig,
} from "types/botinterage";
import type {
  AdminBotInterageTtsAllowedUser,
  AdminBotInterageTtsConfig,
} from "types/botinterage-tts";

type SectionId =
  | "ia-config"
  | "ia-users"
  | "tts-config"
  | "tts-voices"
  | "tts-users";

interface AdminBotInteragePageSectionsProps {
  iaConfig: AdminBotInterageConfig;
  iaAllowedUsers: AdminBotInterageAllowedUser[];
  ttsConfig: AdminBotInterageTtsConfig;
  ttsAllowedUsers: AdminBotInterageTtsAllowedUser[];
}

const sectionDescription: Record<SectionId, string> = {
  "ia-config": "Configuração da API privada de IA (URL, token e modelo padrão).",
  "ia-users": "Controle de quais usuários podem ativar e usar o BotInterage com IA.",
  "tts-config": "Configuração da API privada de TTS (URL, token e voz padrão).",
  "tts-voices": "Clone, teste, edite e remova vozes sem digitar IDs manualmente.",
  "tts-users": "Controle de quais usuários podem ativar respostas com áudio.",
};

const AdminBotInteragePageSections = ({
  iaConfig,
  iaAllowedUsers,
  ttsConfig,
  ttsAllowedUsers,
}: AdminBotInteragePageSectionsProps) => {
  const [section, setSection] = useState<SectionId>("ia-config");

  return (
    <div className="d-flex flex-column gap-4">
      <div className="card">
        <div className="card-body">
          <h2 className="h5 mb-2">Escolha o que deseja configurar</h2>
          <p className="text-secondary mb-3">
            Use os botões abaixo para navegar entre IA, TTS, vozes clonadas e permissões.
          </p>
          <div className="d-flex flex-wrap gap-2" role="tablist" aria-label="Seções do BotInterage">
            {([
              ["ia-config", "API IA"],
              ["ia-users", "Permissões IA"],
              ["tts-config", "API TTS"],
              ["tts-voices", "Vozes TTS"],
              ["tts-users", "Permissões TTS"],
            ] as Array<[SectionId, string]>).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={section === id}
                className={`btn btn-sm ${section === id ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-secondary mb-0 mt-3">{sectionDescription[section]}</p>
        </div>
      </div>

      <div role="tabpanel">
        {section === "ia-config" ? (
          <AdminBotInterageConfigForm
            initialConfig={iaConfig}
            initialAllowedUsers={iaAllowedUsers}
            mode="config"
          />
        ) : null}
        {section === "ia-users" ? (
          <AdminBotInterageConfigForm
            initialConfig={iaConfig}
            initialAllowedUsers={iaAllowedUsers}
            mode="users"
          />
        ) : null}
        {section === "tts-config" ? (
          <AdminBotInterageTtsConfigForm
            initialConfig={ttsConfig}
            initialAllowedUsers={ttsAllowedUsers}
            mode="config"
          />
        ) : null}
        {section === "tts-voices" ? (
          <AdminBotInterageTtsConfigForm
            initialConfig={ttsConfig}
            initialAllowedUsers={ttsAllowedUsers}
            mode="voices"
          />
        ) : null}
        {section === "tts-users" ? (
          <AdminBotInterageTtsConfigForm
            initialConfig={ttsConfig}
            initialAllowedUsers={ttsAllowedUsers}
            mode="users"
          />
        ) : null}
      </div>
    </div>
  );
};

export default AdminBotInteragePageSections;
