/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";

import type {
  BillingNotificationRule,
  BillingNotificationSettings,
} from "types/admin-notifications";

type AdminBillingNotificationSettingsProps = {
  initialSettings: BillingNotificationSettings;
  variables: Array<{ token: string; description: string }>;
};

type Feedback = { type: "success" | "danger" | "warning"; message: string } | null;

const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Bahia",
  "America/Bogota",
  "America/Mexico_City",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/Lisbon",
  "Atlantic/Azores",
];

const timeOptions = Array.from({ length: 24 }, (_, hour) =>
  ["00", "15", "30", "45"].map((minute) => `${hour.toString().padStart(2, "0")}:${minute}`),
).flat();

const AdminBillingNotificationSettings = ({
  initialSettings,
  variables,
}: AdminBillingNotificationSettingsProps) => {
  const [settings, setSettings] = useState<BillingNotificationSettings>(initialSettings);
  const [rules, setRules] = useState<BillingNotificationRule[]>(initialSettings.rules);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [uploadingRuleId, setUploadingRuleId] = useState<string | null>(null);

  const handleRuleChange = (id: string, patch: Partial<BillingNotificationRule>) => {
    setRules((prev) =>
      prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  };

  const handleRuleRemove = (id: string) => {
    if (rules.length <= 1) {
      setFeedback({
        type: "danger",
        message: "Mantenha pelo menos um lembrete configurado.",
      });
      return;
    }
    setRules((prev) => prev.filter((rule) => rule.id !== id));
  };

  const handleAddRule = () => {
    if (rules.length >= 12) {
      setFeedback({
        type: "danger",
        message: "Você atingiu o limite de lembretes configuráveis (12).",
      });
      return;
    }
    setRules((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: `Novo lembrete ${prev.length + 1}`,
        enabled: true,
        offsetDays: 0,
        sendTime: settings.defaultSendTime,
        channels: { email: true, push: true },
        subject: "Atualização sobre seu plano",
        emailHtml:
          "<p>Olá {{user_name}},</p><p>Estamos monitorando seu plano {{plan_name}}.</p>",
        pushTitle: "Aviso sobre o plano",
        pushBody: "Seu plano {{plan_name}} está próximo do vencimento.",
        pushImagePath: null,
        pushImageUrl: null,
        pushTargetUrl: "{{dashboard_url}}",
      },
    ]);
  };

  const handlePushImageUpload = async (ruleId: string, file: File) => {
    setFeedback(null);
    setUploadingRuleId(ruleId);
    try {
      if (file.size > 2.5 * 1024 * 1024) {
        throw new Error("Envie imagens com até 2,5 MB.");
      }

      const formData = new FormData();
      formData.append("file", file);

      const currentRule = rules.find((rule) => rule.id === ruleId);
      if (currentRule?.pushImagePath) {
        formData.append("previousPath", currentRule.pushImagePath);
      }

      const response = await fetch("/api/admin/notifications/push/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data?.message === "string" ? data.message : "Não foi possível enviar a imagem.",
        );
      }

      const media = data?.media;
      if (!media || typeof media.path !== "string" || typeof media.url !== "string") {
        throw new Error("Resposta inesperada ao enviar a imagem.");
      }

      handleRuleChange(ruleId, {
        pushImagePath: media.path,
        pushImageUrl: media.url,
      });

      setFeedback({
        type: "success",
        message: "Imagem do push atualizada com sucesso.",
      });
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao enviar a imagem.",
      });
    } finally {
      setUploadingRuleId(null);
    }
  };

  const handlePushImageRemove = async (rule: BillingNotificationRule) => {
    setFeedback(null);
    setUploadingRuleId(rule.id);
    try {
      if (rule.pushImagePath) {
        await fetch("/api/admin/notifications/push/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: rule.pushImagePath }),
        }).catch(() => Promise.resolve());
      }
      handleRuleChange(rule.id, { pushImagePath: null, pushImageUrl: null });
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Falha ao remover a imagem.",
      });
    } finally {
      setUploadingRuleId(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    try {
      const payload: BillingNotificationSettings = {
        ...settings,
        rules,
      };
      const response = await fetch("/api/admin/billing-notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Não foi possível salvar as configurações.",
        );
      }

      if (data?.settings) {
        setSettings(data.settings);
        setRules(data.settings.rules);
      }
      setFeedback({
        type: "success",
        message: data?.message ?? "Configurações atualizadas com sucesso.",
      });
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro inesperado ao salvar.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const availableTimezoneOptions = useMemo(() => {
    if (typeof Intl.supportedValuesOf === "function") {
      try {
        const supported = Intl.supportedValuesOf("timeZone") as string[];
        const combined = Array.from(new Set([...COMMON_TIMEZONES, ...supported]));
        return combined.map((tz) => ({
          value: tz,
          label: tz.replace("_", " "),
        }));
      } catch {
        // ignore and fallback to static list
      }
    }
    return COMMON_TIMEZONES.map((tz) => ({
      value: tz,
      label: tz.replace("_", " "),
    }));
  }, []);

  return (
    <Card className="mb-5">
      <Card.Header>
        <Card.Title as="h2" className="h5 mb-0">
          Notificações automáticas de cobrança
        </Card.Title>
        <Card.Subtitle className="text-secondary small mt-1">
          Personalize lembretes por e-mail e push antes e no dia do vencimento dos planos. Utilize
          as variáveis disponíveis para preencher automaticamente os dados do usuário.
        </Card.Subtitle>
      </Card.Header>
      <Card.Body>
        <FloatingAlert
          feedback={feedback}
          onClose={() => setFeedback(null)}
        />

        <Form className="d-flex flex-column gap-4" onSubmit={handleSubmit}>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Fuso horário</Form.Label>
                <Form.Select
                  value={settings.timezone}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, timezone: event.currentTarget.value }))
                  }
                  required
                >
                  {availableTimezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-secondary">
                  O horário de envio dos lembretes será calculado com base nesse fuso horário.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Horário padrão de envio</Form.Label>
                <Form.Select
                  value={settings.defaultSendTime}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, defaultSendTime: event.currentTarget.value }))
                  }
                >
                  {timeOptions.map((timeOption) => (
                    <option key={timeOption} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-secondary">
                  Utilizado ao criar um novo lembrete. Cada lembrete pode ter um horário específico.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex justify-content-between align-items-center">
            <h3 className="h6 mb-0">Lembretes configurados</h3>
            <Button variant="outline-primary" type="button" onClick={handleAddRule}>
              Adicionar lembrete
            </Button>
          </div>

          <div className="d-flex flex-column gap-3">
            {rules.map((rule) => (
              <Card key={rule.id} className="border">
                <Card.Body className="d-flex flex-column gap-3">
                  <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                    <div className="flex-grow-1">
                      <Form.Label className="fw-semibold">Nome do lembrete</Form.Label>
                      <Form.Control
                        value={rule.label}
                        onChange={(event) =>
                          handleRuleChange(rule.id, { label: event.currentTarget.value })
                        }
                        maxLength={120}
                      />
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <Form.Check
                        type="switch"
                        id={`rule-enabled-${rule.id}`}
                        label="Ativo"
                        checked={rule.enabled}
                        onChange={(event) =>
                          handleRuleChange(rule.id, { enabled: event.currentTarget.checked })
                        }
                      />
                      <Button
                        variant="outline-danger"
                        size="sm"
                        type="button"
                        onClick={() => handleRuleRemove(rule.id)}
                      >
                        Remover
                      </Button>
                    </div>
                  </div>

                  <Row className="g-3">
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Dias em relação ao vencimento</Form.Label>
                        <Form.Control
                          type="number"
                          value={rule.offsetDays}
                          onChange={(event) =>
                            handleRuleChange(rule.id, {
                              offsetDays: Number.parseInt(event.currentTarget.value, 10) || 0,
                            })
                          }
                          min={-30}
                          max={30}
                        />
                        <Form.Text className="text-secondary">
                          Use valores negativos para dias antes do vencimento. Ex: -2 = dois dias
                          antes.
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Horário de envio</Form.Label>
                        <Form.Select
                          value={rule.sendTime}
                          onChange={(event) =>
                            handleRuleChange(rule.id, { sendTime: event.currentTarget.value })
                          }
                        >
                          {timeOptions.map((timeOption) => (
                            <option key={timeOption} value={timeOption}>
                              {timeOption}
                            </option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Canais</Form.Label>
                        <div className="d-flex gap-3">
                          <Form.Check
                            type="checkbox"
                            id={`rule-email-${rule.id}`}
                            label="E-mail"
                            checked={rule.channels.email}
                            onChange={(event) =>
                              handleRuleChange(rule.id, {
                                channels: {
                                  ...rule.channels,
                                  email: event.currentTarget.checked,
                                },
                              })
                            }
                          />
                          <Form.Check
                            type="checkbox"
                            id={`rule-push-${rule.id}`}
                            label="Push"
                            checked={rule.channels.push}
                            onChange={(event) =>
                              handleRuleChange(rule.id, {
                                channels: {
                                  ...rule.channels,
                                  push: event.currentTarget.checked,
                                },
                              })
                            }
                          />
                        </div>
                        <Form.Text className="text-secondary">
                          Ao menos um canal precisa estar habilitado.
                        </Form.Text>
                      </Form.Group>
                    </Col>
                  </Row>

                  <Form.Group>
                    <Form.Label>Assunto do e-mail</Form.Label>
                    <Form.Control
                      value={rule.subject}
                      onChange={(event) =>
                        handleRuleChange(rule.id, { subject: event.currentTarget.value })
                      }
                      maxLength={200}
                      disabled={!rule.channels.email}
                    />
                  </Form.Group>

                  <Form.Group>
                    <Form.Label>Conteúdo do e-mail (HTML)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={6}
                      value={rule.emailHtml}
                      onChange={(event) =>
                        handleRuleChange(rule.id, { emailHtml: event.currentTarget.value })
                      }
                      maxLength={8000}
                      disabled={!rule.channels.email}
                    />
                    <Form.Text className="text-secondary">
                      Utilize HTML simples. O e-mail será enviado no formato HTML.
                    </Form.Text>
                  </Form.Group>

                  <Row className="g-3">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Título do push</Form.Label>
                        <Form.Control
                          value={rule.pushTitle}
                          onChange={(event) =>
                            handleRuleChange(rule.id, { pushTitle: event.currentTarget.value })
                          }
                          maxLength={100}
                          disabled={!rule.channels.push}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Link de destino (push)</Form.Label>
                        <Form.Control
                          value={rule.pushTargetUrl ?? ""}
                          onChange={(event) =>
                            handleRuleChange(rule.id, { pushTargetUrl: event.currentTarget.value })
                          }
                          placeholder="https://painel.seusite.com/minha-assinatura"
                          disabled={!rule.channels.push}
                        />
                      </Form.Group>
                    </Col>
                  </Row>

                  <Row className="g-3">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Mensagem do push</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={3}
                          value={rule.pushBody}
                          onChange={(event) =>
                            handleRuleChange(rule.id, { pushBody: event.currentTarget.value })
                          }
                          maxLength={500}
                          disabled={!rule.channels.push}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Imagem (push)</Form.Label>
                        {rule.pushImageUrl && (
                          <div className="d-flex align-items-center gap-3 mb-2">
                            <img
                              src={rule.pushImageUrl}
                              alt="Prévia da notificação"
                              className="rounded border"
                              style={{ width: 96, height: 96, objectFit: "cover" }}
                            />
                            <div className="d-flex flex-column gap-2">
                              <div className="text-secondary small">
                                {rule.pushImagePath ?? rule.pushImageUrl}
                              </div>
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => handlePushImageRemove(rule)}
                                disabled={!rule.channels.push || uploadingRuleId === rule.id}
                              >
                                Remover imagem
                              </Button>
                            </div>
                          </div>
                        )}
                        <Form.Control
                          type="file"
                          accept="image/*"
                          disabled={!rule.channels.push || uploadingRuleId === rule.id}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) {
                              void handlePushImageUpload(rule.id, file);
                            }
                            event.currentTarget.value = "";
                          }}
                        />
                        {uploadingRuleId === rule.id && (
                          <div className="d-flex align-items-center gap-2 mt-2 text-secondary small">
                            <Spinner animation="border" size="sm" />
                            Enviando imagem...
                          </div>
                        )}
                        <Form.Text className="text-secondary">
                          Opcional. Algumas plataformas exibem a imagem ao expandir a notificação. Envie arquivos até 2,5 MB.
                        </Form.Text>
                      </Form.Group>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            ))}
          </div>

          <div>
            <h3 className="h6 mb-2">Variáveis disponíveis</h3>
            <ul className="text-secondary small mb-0">
              {variables.map((variable) => (
                <li key={variable.token}>
                  <code>{variable.token}</code> — {variable.description}
                </li>
              ))}
            </ul>
          </div>

          <div className="d-flex justify-content-end">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar notificações"}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

export default AdminBillingNotificationSettings;
