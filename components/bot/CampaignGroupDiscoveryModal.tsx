import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Stack } from "react-bootstrap";
import { IconExternalLink, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";

import type { BotInstance } from "types/bot-instances";
import type { DivulgacaoGroupCandidate, DivulgacaoInspectionResult } from "types/divulgacao";
import {
  buildCandidateFromInspection,
  extractInviteLinksFromText,
  normalizeCandidate,
  normalizeInviteKey,
  resolveGroupImage,
} from "./divulgacao-shared";
import GroupAvatar from "./GroupAvatar";

type SelectedEntry = {
  candidate: DivulgacaoGroupCandidate;
  inspection?: DivulgacaoInspectionResult | null;
};

export type CampaignDiscoverySelection = {
  instanceId: number;
  candidate: DivulgacaoGroupCandidate;
  inspection: DivulgacaoInspectionResult;
};

type Props = {
  show: boolean;
  onHide: () => void;
  apiKey: string;
  instances: BotInstance[];
  defaultInstanceId: number | null;
  onConfirm: (entries: CampaignDiscoverySelection[]) => void;
};

const INITIAL_MAX_PAGES = 2;

const INSPECTION_DELAY_MS = 1200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isGroupRestricted = (inspection?: DivulgacaoInspectionResult | null): boolean =>
  Boolean(
    inspection &&
      (inspection.adminsOnly ||
        inspection.locked ||
        inspection.joinApprovalRequired),
  );

type InspectionStatusInfo = {
  variant: "success" | "warning";
  label: string;
  detail?: string | null;
};

const getInspectionStatusInfo = (inspection?: DivulgacaoInspectionResult | null): InspectionStatusInfo | null => {
  if (!inspection) {
    return null;
  }
  if (!isGroupRestricted(inspection)) {
    return { variant: "success", label: "Grupo aberto" };
  }
  const reasons: string[] = [];
  if (inspection.adminsOnly) {
    reasons.push("apenas admins");
  }
  if (inspection.locked) {
    reasons.push("bloqueado");
  }
  if (inspection.joinApprovalRequired) {
    reasons.push("com aprovação");
  }
  return {
    variant: "warning",
    label: "Grupo fechado",
    detail: reasons.length ? reasons.join(", ") : null,
  };
};

const CampaignGroupDiscoveryModal = ({
  show,
  onHide,
  apiKey,
  instances,
  defaultInstanceId,
  onConfirm,
}: Props) => {
  const [selectedInstanceId, setSelectedInstanceId] = useState<number>(() => defaultInstanceId ?? instances[0]?.id ?? 0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DivulgacaoGroupCandidate[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [manualLinksInput, setManualLinksInput] = useState("");
  const [manualProcessing, setManualProcessing] = useState(false);
  const [selectionMap, setSelectionMap] = useState<Record<string, SelectedEntry>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [currentMaxPages, setCurrentMaxPages] = useState(INITIAL_MAX_PAGES);
  const [lastResultsCount, setLastResultsCount] = useState(0);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const currentInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  useEffect(() => {
    if (show) {
      setSelectedInstanceId(defaultInstanceId ?? instances[0]?.id ?? 0);
      setSearchResults([]);
      setSearchQuery("");
      setFeedback(null);
      setSearchError(null);
      setManualLinksInput("");
      setCurrentQuery("");
      setCurrentMaxPages(INITIAL_MAX_PAGES);
      setLastResultsCount(0);
      setCanLoadMore(false);
      setLoadingMore(false);
    }
  }, [show, defaultInstanceId, instances]);

  const performInspection = async (inviteLink: string): Promise<DivulgacaoInspectionResult> => {
    if (!currentInstance) {
      throw new Error("Selecione uma instância antes de validar os grupos.");
    }
    const response = await fetch("/api/divulgacao/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite: inviteLink, instanceId: currentInstance.id }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const error = new Error(errorPayload?.message ?? "Falha ao validar o grupo.");
      (error as { status?: number }).status = response.status;
      throw error;
    }
    const payload = await response.json();
    if (!payload?.inspection) {
      throw new Error("O servidor não retornou as informações do grupo.");
    }
    return payload.inspection as DivulgacaoInspectionResult;
  };

  const describeInspectionFailure = (
    entry: SelectedEntry,
    error: unknown,
  ): string => {
    const title = entry.candidate.title || entry.candidate.inviteCode || "Grupo desconhecido";
    const status = error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : null;
    if (status && status >= 500) {
      return `${title} (link inválido ou expirado)`;
    }
    return `${title} (${error instanceof Error && error.message ? error.message : "falha ao validar"})`;
  };

  const fetchCandidates = async (query: string, maxPages: number): Promise<DivulgacaoGroupCandidate[]> => {
    if (!apiKey) {
      throw new Error("Gere uma chave de API antes de buscar grupos.");
    }
    const url = new URL("/api/rest/gruposwhats", window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("details", "1");
    url.searchParams.set("maxPages", String(maxPages));
    url.searchParams.set("delayMs", "1000");
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status === false) {
      const message =
        (payload?.mensagem as string | undefined) ||
        (payload?.message as string | undefined) ||
        "Não foi possível consultar o agregador.";
      throw new Error(message);
    }
    const groups = Array.isArray(payload?.resultado?.groups)
      ? payload.resultado.groups
      : Array.isArray(payload?.groups)
        ? payload.groups
        : [];
    const normalized: DivulgacaoGroupCandidate[] = [];
    groups.forEach((group: Record<string, unknown>, idx: number) => {
      const mapped = normalizeCandidate(group, idx);
      if (mapped) {
        normalized.push(mapped);
      }
    });
    return normalized;
  };

  const handleSearch = async () => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSearchError("Informe um termo de busca antes de procurar grupos.");
      return;
    }
    if (!apiKey) {
      setSearchError("Gere uma chave de API em Configurações > API REST para consultar o agregador.");
      return;
    }
    try {
      setSearching(true);
      setSearchError(null);
      const normalized = await fetchCandidates(trimmedQuery, INITIAL_MAX_PAGES);
      setSearchResults(normalized);
      setCurrentQuery(trimmedQuery);
      setCurrentMaxPages(INITIAL_MAX_PAGES);
      setLastResultsCount(normalized.length);
      setCanLoadMore(normalized.length > 0);
      if (normalized.length === 0) {
        setSearchError("Nenhum grupo público foi encontrado para o termo informado.");
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Erro ao buscar grupos.");
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = async () => {
    if (!currentQuery || loadingMore) {
      return;
    }
    if (!apiKey) {
      setSearchError("Gere uma chave de API antes de carregar mais grupos.");
      return;
    }
    try {
      setLoadingMore(true);
      const nextMaxPages = currentMaxPages + 1;
      const normalized = await fetchCandidates(currentQuery, nextMaxPages);
      setSearchResults(normalized);
      setCurrentMaxPages(nextMaxPages);
      if (normalized.length > lastResultsCount) {
        setLastResultsCount(normalized.length);
        setCanLoadMore(true);
      } else {
        setCanLoadMore(false);
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Erro ao buscar mais grupos.");
      setCanLoadMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelection = (candidate: DivulgacaoGroupCandidate, checked: boolean) => {
    const key = normalizeInviteKey(candidate.inviteCode);
    setSelectionMap((prev) => {
      const copy = { ...prev };
      if (checked) {
        copy[key] = { candidate, inspection: copy[key]?.inspection };
      } else {
        delete copy[key];
      }
      return copy;
    });
  };

  const handleSelectAllResults = () => {
    if (searchResults.length === 0) {
      return;
    }
    setSelectionMap((prev) => {
      const copy = { ...prev };
      searchResults.forEach((candidate) => {
        const key = normalizeInviteKey(candidate.inviteCode);
        copy[key] = { candidate, inspection: copy[key]?.inspection };
      });
      return copy;
    });
  };

  const handleManualAddition = async () => {
    if (!manualLinksInput.trim()) {
      setFeedback("Cole ao menos um link antes de validar.");
      return;
    }
    try {
      setManualProcessing(true);
      const invites = extractInviteLinksFromText(manualLinksInput);
      if (invites.length === 0) {
        setFeedback("Nenhum link válido foi identificado. Use URLs do chat.whatsapp.com.");
        return;
      }
      const additions: Record<string, SelectedEntry> = {};
      const failures: string[] = [];
      for (const invite of invites) {
        try {
          const inspection = await performInspection(invite.inviteLink);
          const candidate = buildCandidateFromInspection(inspection);
          additions[normalizeInviteKey(invite.inviteCode)] = { candidate, inspection };
        } catch (error) {
          const isInvalidLink =
            error &&
            typeof error === "object" &&
            "status" in error &&
            Number((error as { status?: number }).status) >= 500;
          failures.push(
            isInvalidLink
              ? `${invite.inviteLink} (link inválido ou expirado)`
              : `${invite.inviteLink} (${error instanceof Error ? error.message : "falha ao validar"})`,
          );
        }
      }
      setSelectionMap((prev) => ({ ...prev, ...additions }));
      if (failures.length > 0) {
        setFeedback(
          failures.length === 1
            ? `Ignoramos um link inválido: ${failures[0]}`
            : `Ignoramos ${failures.length} links inválidos: ${failures.join(", ")}.`,
        );
      } else {
        setFeedback(null);
      }
      setManualLinksInput("");
    } finally {
      setManualProcessing(false);
    }
  };

  const selectedList = Object.entries(selectionMap);

  const handleRemoveSelected = (key: string) => {
    setSelectionMap((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleConfirm = async () => {
    if (selectedList.length === 0) {
      setFeedback("Selecione ao menos um grupo antes de adicionar.");
      return;
    }
    try {
      setInspecting(true);
      const results: CampaignDiscoverySelection[] = [];
      const updatedEntries: Record<string, SelectedEntry> = { ...selectionMap };
      const removedGroups: string[] = [];
      const failedGroups: string[] = [];
      for (let index = 0; index < selectedList.length; index += 1) {
        const [key, entry] = selectedList[index];
        let inspection = entry.inspection ?? null;
        let inspectedNow = false;
        if (!inspection) {
          inspectedNow = true;
          try {
            inspection = await performInspection(entry.candidate.inviteLink);
            updatedEntries[key] = { ...entry, inspection };
          } catch (error) {
            failedGroups.push(describeInspectionFailure(entry, error));
            delete updatedEntries[key];
            if (inspectedNow && index < selectedList.length - 1) {
              await sleep(INSPECTION_DELAY_MS);
            }
            continue;
          }
        }
        if (!inspection.groupJid) {
          failedGroups.push(
            `${entry.candidate.title || entry.candidate.inviteCode || "Grupo desconhecido"} (não foi possível identificar o grupo)`,
          );
          delete updatedEntries[key];
          if (inspectedNow && index < selectedList.length - 1) {
            await sleep(INSPECTION_DELAY_MS);
          }
          continue;
        }
        if (isGroupRestricted(inspection)) {
          removedGroups.push(entry.candidate.title || entry.candidate.inviteCode || inspection.inviteCode);
          delete updatedEntries[key];
        } else {
          results.push({
            instanceId: selectedInstanceId,
            candidate: entry.candidate,
            inspection,
          });
        }
        if (inspectedNow && index < selectedList.length - 1) {
          await sleep(INSPECTION_DELAY_MS);
        }
      }
      setSelectionMap(updatedEntries);
      if (results.length === 0) {
        const messages: string[] = [];
        if (removedGroups.length > 0) {
          messages.push("Todos os grupos selecionados estão fechados ou exigem aprovação.");
        }
        if (failedGroups.length > 0) {
          messages.push(
            failedGroups.length === 1
              ? `Ignoramos um link inválido: ${failedGroups[0]}.`
              : `Ignoramos ${failedGroups.length} links inválidos: ${failedGroups.join(", ")}.`,
          );
        }
        if (messages.length === 0) {
          messages.push("Nenhum grupo válido foi encontrado entre as seleções.");
        }
        setFeedback(messages.join(" "));
        return;
      }
      const warningParts: string[] = [];
      if (removedGroups.length > 0) {
        warningParts.push(
          removedGroups.length === 1
            ? `Removemos o grupo "${removedGroups[0]}" por estar fechado.`
            : `Removemos ${removedGroups.length} grupos fechados: ${removedGroups.join(", ")}.`,
        );
      }
      if (failedGroups.length > 0) {
        warningParts.push(
          failedGroups.length === 1
            ? `Ignoramos um link inválido: ${failedGroups[0]}.`
            : `Ignoramos ${failedGroups.length} links inválidos: ${failedGroups.join(", ")}.`,
        );
      }
      if (warningParts.length > 0) {
        warningParts.push("Os demais grupos foram adicionados normalmente.");
      }
      setFeedback(warningParts.length > 0 ? warningParts.join(" ") : null);
      onConfirm(results);
      setSelectionMap({});
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao validar os grupos selecionados.");
    } finally {
      setInspecting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Adicionar grupos públicos</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {feedback && (
          <Alert variant="warning" onClose={() => setFeedback(null)} dismissible>
            {feedback}
          </Alert>
        )}
        <Stack gap={3}>
          <Form.Group>
            <Form.Label>Instância que fará os envios</Form.Label>
            <Form.Select value={selectedInstanceId} onChange={(event) => setSelectedInstanceId(Number(event.target.value))}>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} · {instance.phone} · {instance.sessionStatus}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label>Pesquisar grupos</Form.Label>
            <Stack direction="horizontal" gap={2}>
              <Form.Control
                placeholder="marketing, promoções, sorteios..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? <Spinner animation="border" size="sm" className="me-1" /> : <IconSearch size={16} className="me-1" />}
                Buscar
              </Button>
            </Stack>
            {searchError && <div className="text-danger small mt-2">{searchError}</div>}
          </Form.Group>
          {searchResults.length > 0 && (
            <>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div className="text-muted small">{searchResults.length} grupos carregados</div>
                <div className="d-flex gap-2">
                  <Button variant="outline-primary" size="sm" onClick={handleSelectAllResults}>
                    Selecionar todos
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={!canLoadMore || loadingMore}
                  >
                    {loadingMore ? <Spinner animation="border" size="sm" className="me-1" /> : null}
                    Carregar mais
                  </Button>
                </div>
              </div>
            <Row xs={1} md={2} className="g-3">
              {searchResults.map((group) => {
                const key = normalizeInviteKey(group.inviteCode);
                const checked = Boolean(selectionMap[key]);
                const statusInfo = getInspectionStatusInfo(selectionMap[key]?.inspection);
                const badgeTextColor = statusInfo?.variant === "warning" ? "dark" : undefined;
                return (
                  <Col key={group.id}>
                    <Card className={`h-100 ${checked ? "border-success" : ""}`}>
                      <Card.Body>
                        <div className="d-flex gap-2 align-items-start mb-2">
                          <GroupAvatar imageUrl={resolveGroupImage(group)} size={48} />
                          <div className="flex-grow-1">
                            <div className="d-flex justify-content-between align-items-start gap-2">
                              <span className="fw-semibold">{group.title}</span>
                              {group.members && (
                                <Badge bg="light" text="dark">
                                  {group.members} membros
                                </Badge>
                              )}
                            </div>
                            <div className="small text-muted">{group.inviteCode}</div>
                          </div>
                          <Form.Check type="checkbox" checked={checked} onChange={(event) => toggleSelection(group, event.target.checked)} />
                        </div>
                        <p className="text-muted small text-break">{group.description}</p>
                        {statusInfo && (
                          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                            <Badge bg={statusInfo.variant} text={badgeTextColor}>
                              {statusInfo.label}
                            </Badge>
                            {statusInfo.detail ? <span className="small text-muted">{statusInfo.detail}</span> : null}
                          </div>
                        )}
                        <Stack direction="horizontal" gap={2}>
                          <Button
                            as="a"
                            href={group.inviteLink}
                            target="_blank"
                            rel="noreferrer"
                            size="sm"
                            variant="outline-secondary"
                          >
                            <IconExternalLink size={14} className="me-1" />
                            Abrir
                          </Button>
                          {group.categories?.slice(0, 2).map((category) => (
                            <Badge bg="light" text="dark" key={category}>
                              {category}
                            </Badge>
                          ))}
                        </Stack>
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
            </Row>
            </>
          )}
          <Form.Group>
            <Form.Label>Adicionar links manualmente</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={manualLinksInput}
              placeholder="Cole links do chat.whatsapp.com, um por linha."
              onChange={(event) => setManualLinksInput(event.target.value)}
            />
            <Button className="mt-2" variant="success" size="sm" onClick={handleManualAddition} disabled={manualProcessing}>
              {manualProcessing ? <Spinner animation="border" size="sm" className="me-1" /> : <IconPlus size={14} className="me-1" />}
              Validar links
            </Button>
          </Form.Group>
          <div>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>Selecionados ({selectedList.length})</strong>
              {selectedList.length > 0 && (
                <Button variant="outline-danger" size="sm" onClick={() => setSelectionMap({})}>
                  Limpar tudo
                </Button>
              )}
            </div>
            {selectedList.length === 0 ? (
              <p className="text-muted mb-0">Nenhum grupo selecionado ainda.</p>
            ) : (
              <Stack gap={2}>
                {selectedList.map(([key, entry]) => {
                  const statusInfo = getInspectionStatusInfo(entry.inspection);
                  const badgeTextColor = statusInfo?.variant === "warning" ? "dark" : undefined;
                  return (
                    <Card key={key}>
                      <Card.Body className="d-flex justify-content-between align-items-start gap-3">
                        <div>
                          <div className="fw-semibold">{entry.candidate.title}</div>
                          <div className="small text-muted">{entry.candidate.inviteLink}</div>
                          {statusInfo && (
                            <div className="mt-1 d-flex flex-wrap align-items-center gap-2">
                              <Badge bg={statusInfo.variant} text={badgeTextColor}>
                                {statusInfo.label}
                              </Badge>
                              {statusInfo.detail ? <span className="small text-muted">{statusInfo.detail}</span> : null}
                            </div>
                          )}
                        </div>
                        <Button variant="outline-danger" size="sm" onClick={() => handleRemoveSelected(key)}>
                          <IconTrash size={14} />
                        </Button>
                      </Card.Body>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </div>
        </Stack>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={inspecting}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleConfirm} disabled={inspecting || selectedList.length === 0}>
          {inspecting ? <Spinner animation="border" size="sm" className="me-1" /> : <IconPlus size={16} className="me-1" />}
          Adicionar à campanha
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default CampaignGroupDiscoveryModal;
