"use client";

import { useMemo, useState } from "react";
import AdminBillingNotificationSettings from "components/admin/AdminBillingNotificationSettings";
import AdminNotificationBroadcastForm from "components/admin/AdminNotificationBroadcastForm";
import AdminSmtpSettingsForm from "components/admin/AdminSmtpSettingsForm";
import AdminPushNotificationTestCard from "components/admin/AdminPushNotificationTestCard";
import AdminEmailTemplatesManager from "components/admin/AdminEmailTemplatesManager";
import AdminTtsTestCard from "components/admin/AdminTtsTestCard";
import AdminPlanGuardSettings from "components/admin/AdminPlanGuardSettings";
import type { BillingNotificationSettings } from "types/admin-notifications";
import type { AdminSmtpSettings } from "types/admin-smtp";
import type { AdminEmailTemplate } from "types/admin-email-templates";
import type { PlanGuardSettings } from "types/plan-guard";

type ViewId = "billing" | "email" | "push" | "templates";

type ViewOption = {
  id: ViewId;
  label: string;
  description: string;
};

const VIEW_OPTIONS: readonly ViewOption[] = [
  {
    id: "billing",
    label: "Cobranças automáticas",
    description:
      "Configure os lembretes automáticos de renovação que serão enviados antes e no dia do vencimento dos planos.",
  },
  {
    id: "email",
    label: "E-mails e SMTP",
    description:
      "Envie notificações manuais para usuários específicos ou configure o servidor SMTP oficial da plataforma.",
  },
  {
    id: "push",
    label: "Push Firebase",
    description:
      "Teste envios via Firebase para tokens individuais, usuários cadastrados ou todos os dispositivos conectados.",
  },
  {
    id: "templates",
    label: "Templates e voz",
    description:
      "Gerencie os modelos de e-mail utilizados pelo sistema e valide a síntese de voz usada em notificações.",
  },
];

type AdminNotificationsSettingsProps = {
  billingSettings: BillingNotificationSettings;
  billingVariables: Array<{ token: string; description: string }>;
  smtpSettings: AdminSmtpSettings | null;
  emailTemplates: AdminEmailTemplate[];
  recipients: Array<{ id: number; name: string; email: string | null }>;
  planGuardSettings: PlanGuardSettings;
  planGuardVariables: Array<{ token: string; description: string }>;
};

const AdminNotificationsSettings = ({
  billingSettings,
  billingVariables,
  smtpSettings,
  emailTemplates,
  recipients,
  planGuardSettings,
  planGuardVariables,
}: AdminNotificationsSettingsProps) => {
  const [activeView, setActiveView] = useState<ViewId>("billing");

  const activeOption = useMemo(
    () => VIEW_OPTIONS.find((option) => option.id === activeView) ?? VIEW_OPTIONS[0],
    [activeView],
  );

  return (
    <div className="d-flex flex-column gap-4">
      <section className="card">
        <div className="card-body">
          <h2 className="h5 mb-2">Escolha o que deseja configurar</h2>
          <p className="text-secondary mb-3">
            Use os botões abaixo para alternar entre lembretes automáticos, SMTP, notificações push e edição de modelos.
          </p>
          <div className="d-flex flex-wrap gap-2">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`btn ${activeView === option.id ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setActiveView(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-secondary small mb-0 mt-3">{activeOption.description}</p>
        </div>
      </section>

      <div className="d-flex flex-column gap-5">
        {activeView === "billing" ? (
          <AdminBillingNotificationSettings
            initialSettings={billingSettings}
            variables={billingVariables}
          />
        ) : null}

        {activeView === "billing" ? (
          <AdminPlanGuardSettings
            initialSettings={planGuardSettings}
            variables={planGuardVariables}
          />
        ) : null}

        {activeView === "email" ? (
          <>
            <AdminNotificationBroadcastForm users={recipients} />
            <AdminSmtpSettingsForm initialSettings={smtpSettings} />
          </>
        ) : null}

        {activeView === "push" ? <AdminPushNotificationTestCard /> : null}

        {activeView === "templates" ? (
          <>
            <AdminEmailTemplatesManager templates={emailTemplates} />
            <AdminTtsTestCard />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default AdminNotificationsSettings;
