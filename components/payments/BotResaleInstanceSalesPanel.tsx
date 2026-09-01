"use client";

import { useState } from "react";
import { Alert, Card, Form, Spinner } from "react-bootstrap";
import { useRouter } from "next/navigation";

import styles from "components/payments/BotResalePayments.module.css";

type BotResaleInstanceSalesPanelProps = {
  instances: Array<{
    id: number;
    name: string;
    phone: string;
    serverName: string;
    licenseSalesEnabled: boolean;
  }>;
};

const BotResaleInstanceSalesPanel = ({ instances }: BotResaleInstanceSalesPanelProps) => {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "danger"; message: string } | null>(null);

  const handleToggle = async (instance: BotInstance, enabled: boolean) => {
    setPendingId(instance.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/bot-instances/${instance.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseSalesEnabled: enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível atualizar a renovação pelo grupo.");
      }
      setFeedback({
        type: "success",
        message: enabled
          ? `Renovação pelo grupo ativada no perfil ${instance.name}.`
          : `Renovação pelo grupo desativada no perfil ${instance.name}.`,
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bot-resale:wallet-updated"));
      }
      router.refresh();
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao atualizar renovação pelo grupo.",
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card className={`border-0 shadow-sm ${styles.compactCard}`}>
      <Card.Body className="d-flex flex-column gap-3">
        <div>
          <Card.Title as="h2" className="h5 mb-1">
            Renovação pelo grupo
          </Card.Title>
          <Card.Text className="text-secondary mb-0 small d-none d-md-block">
            Mostra botões de renovação quando o grupo estiver vencido, para o próprio admin renovar sem abrir o painel.
          </Card.Text>
        </div>

        {feedback ? (
          <Alert variant={feedback.type} className="mb-0 py-2" onClose={() => setFeedback(null)} dismissible>
            {feedback.message}
          </Alert>
        ) : null}

        {instances.length === 0 ? (
          <Alert variant="light" className="mb-0 border">
            Nenhum perfil encontrado. Crie um perfil em Instâncias para liberar a renovação pelo grupo.
          </Alert>
        ) : (
          <div className="d-flex flex-column gap-2">
            {instances.map((instance) => {
              const isPending = pendingId === instance.id;
              return (
                <div
                  key={instance.id}
                  className="d-flex justify-content-between align-items-center gap-3 border rounded p-3 bg-light-subtle"
                >
                  <div>
                    <strong>{instance.name}</strong>
                    <div className="text-secondary small">
                      {instance.phone || "Sem número"} • {instance.serverName}
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {isPending ? <Spinner animation="border" size="sm" /> : null}
                    <Form.Check
                      type="switch"
                      id={`bot-resale-${instance.id}`}
                      label={instance.licenseSalesEnabled ? "Renovação ativa" : "Renovação inativa"}
                      checked={instance.licenseSalesEnabled}
                      disabled={isPending}
                      onChange={(event) => void handleToggle(instance, event.currentTarget.checked)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default BotResaleInstanceSalesPanel;
