"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";
import { formatDateTime } from "lib/format";
import type { AdminMetaTemplate } from "types/admin-meta-templates";
import type {
  AdminCampaignDetail,
  AdminCampaignSummary,
  AdminCampaignStatus,
} from "types/admin-campaigns";
import type { AdminUserSummary } from "types/users";

interface Props {
  campaigns: AdminCampaignSummary[];
  templates: AdminMetaTemplate[];
  hasTemplateCredentials: boolean;
}

type Feedback = { type: "success" | "danger" | "info"; message: string } | null;

const STATUS_LABELS: Record<AdminCampaignStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  queued: "Na fila",
  sending: "Enviando",
  completed: "Concluída",
  paused: "Pausada",
  cancelled: "Cancelada",
};

const STATUS_VARIANTS: Record<AdminCampaignStatus, string> = {
  draft: "secondary",
  scheduled: "info",
  queued: "info",
  sending: "primary",
  completed: "success",
  paused: "warning",
  cancelled: "danger",
};

const CONTACT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  queued: "Na fila",
  sent: "Enviada",
  failed: "Falha",
  skipped: "Ignorada",
};

const CONTACT_STATUS_VARIANTS: Record<string, string> = {
  pending: "secondary",
  queued: "info",
  sent: "success",
  failed: "danger",
  skipped: "warning",
};

const DEFAULT_IMPORT_OPTIONS = {
  delimiter: "," as "," | ";" | "\t",
  hasHeader: true,
};

type CreateCampaignFormState = {
  name: string;
  description: string;
  templateId: string;
  scheduledAt: string;
};

type ImportFormState = {
  file: File | null;
  delimiter: "," | ";" | "\t";
  hasHeader: boolean;
  headers: string[];
  phoneColumn: string;
  nameColumn: string;
  variableColumns: Record<string, string>;
  previewRows: string[][];
};

const DEFAULT_CREATE_FORM: CreateCampaignFormState = {
  name: "",
  description: "",
  templateId: "",
  scheduledAt: "",
};

const DEFAULT_IMPORT_FORM: ImportFormState = {
  file: null,
  delimiter: DEFAULT_IMPORT_OPTIONS.delimiter,
  hasHeader: DEFAULT_IMPORT_OPTIONS.hasHeader,
  headers: [],
  phoneColumn: "",
  nameColumn: "",
  variableColumns: {},
  previewRows: [],
};

const splitCsvLine = (line: string, delimiter: string): string[] => {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  const pushCurrent = () => {
    columns.push(current);
    current = "";
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();
  return columns.map((column) => column.trim());
};

const parseCsvPreview = (text: string, delimiter: string, hasHeader: boolean) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [] as string[], rows: [] as string[][] };
  }

  if (!hasHeader) {
    const rows = lines.slice(0, 10).map((line) => splitCsvLine(line, delimiter));
    return { headers: rows[0]?.map((_, index) => `Coluna ${index + 1}`) ?? [], rows };
  }

  const [headerLine, ...rowLines] = lines;
  const headers = splitCsvLine(headerLine, delimiter);
  const rows = rowLines.slice(0, 10).map((line) => splitCsvLine(line, delimiter));
  return { headers, rows };
};

const extractTemplateVariables = (template: AdminMetaTemplate): string[] => {
  const variables = new Set<string>();

  const collectFromText = (text: string | null | undefined) => {
    if (!text) return;
    const regex = /{{\s*(\d+)\s*}}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      variables.add(match[1]);
    }
  };

  collectFromText(template.components?.find((component) => (component.type ?? "").toUpperCase() === "HEADER")?.text as string | undefined);
  collectFromText(template.components?.find((component) => (component.type ?? "").toUpperCase() === "BODY")?.text as string | undefined);
  collectFromText(template.components?.find((component) => (component.type ?? "").toUpperCase() === "FOOTER")?.text as string | undefined);

  return Array.from(variables)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
    .map((value) => String(value));
};

const suggestColumn = (headers: string[], candidates: string[]): string => {
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  for (const candidate of candidates) {
    const index = normalizedHeaders.findIndex((header) => header === candidate.toLowerCase());
    if (index >= 0) {
      return headers[index];
    }
  }
  return "";
};

const formatContactVariables = (variables: Record<string, string>): string => {
  const entries = Object.entries(variables);
  if (entries.length === 0) {
    return "-";
  }

  return entries
    .map(([key, value]) => `{{${key}}}: ${value}`)
    .join(" | ");
};

const AdminCampaignManager = ({ campaigns, templates, hasTemplateCredentials }: Props) => {
  const router = useRouter();
  const [campaignItems, setCampaignItems] = useState<AdminCampaignSummary[]>(campaigns);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    campaigns.length > 0 ? campaigns[0].campaignId : null,
  );
  const [campaignDetails, setCampaignDetails] = useState<Record<string, AdminCampaignDetail>>({});
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm, setCreateForm] = useState<CreateCampaignFormState>(DEFAULT_CREATE_FORM);
  const [createFeedback, setCreateFeedback] = useState<Feedback>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [importCsvModalVisible, setImportCsvModalVisible] = useState(false);
  const [importCsvForm, setImportCsvForm] = useState<ImportFormState>(DEFAULT_IMPORT_FORM);
  const [importCsvFeedback, setImportCsvFeedback] = useState<Feedback>(null);
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualForm, setManualForm] = useState<{ phone: string; name: string; variables: Record<string, string> }>(
    { phone: "", name: "", variables: {} },
  );
  const [manualFeedback, setManualFeedback] = useState<Feedback>(null);
  const [isAddingContact, setIsAddingContact] = useState(false);

  const [importUsersModalVisible, setImportUsersModalVisible] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userResults, setUserResults] = useState<AdminUserSummary[]>([]);
  const [userResultsHasMore, setUserResultsHasMore] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [importUsersFeedback, setImportUsersFeedback] = useState<Feedback>(null);
  const [isImportingUsers, setIsImportingUsers] = useState(false);

  const [globalFeedback, setGlobalFeedback] = useState<Feedback>(null);
  const [isStartingCampaign, setIsStartingCampaign] = useState(false);
  const [isDispatchingCampaign, setIsDispatchingCampaign] = useState(false);

  useEffect(() => {
    setCampaignItems(campaigns);
    if (campaigns.length === 0) {
      setSelectedCampaignId(null);
    } else if (!campaigns.some((campaign) => campaign.campaignId === selectedCampaignId)) {
      setSelectedCampaignId(campaigns[0].campaignId);
    }
  }, [campaigns, selectedCampaignId]);

  const sortedCampaigns = useMemo(
    () => campaignItems.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [campaignItems],
  );

  const templateDictionary = useMemo(() => {
    return templates.reduce<Record<string, AdminMetaTemplate>>((acc, template) => {
      acc[template.templateId] = template;
      return acc;
    }, {});
  }, [templates]);

  const selectedCampaign = useMemo(() => {
    if (!selectedCampaignId) {
      return null;
    }
    return campaignItems.find((campaign) => campaign.campaignId === selectedCampaignId) ?? null;
  }, [campaignItems, selectedCampaignId]);

  const selectedTemplate = useMemo(() => {
    if (!selectedCampaign) {
      return null;
    }
    return templateDictionary[selectedCampaign.templateId] ?? null;
  }, [selectedCampaign, templateDictionary]);

  const selectedCampaignDetail = useMemo(() => {
    if (!selectedCampaignId) {
      return null;
    }
    return campaignDetails[selectedCampaignId] ?? null;
  }, [campaignDetails, selectedCampaignId]);

  const selectedTemplateVariables = useMemo(() => {
    if (!selectedTemplate) {
      return [];
    }
    return extractTemplateVariables(selectedTemplate);
  }, [selectedTemplate]);

  const pendingContacts = selectedCampaign?.stats.pendingContacts ?? 0;
  const canStartCampaign = useMemo(() => {
    if (!selectedCampaign) {
      return false;
    }
    return ["draft", "paused"].includes(selectedCampaign.status) && pendingContacts > 0;
  }, [selectedCampaign, pendingContacts]);

  const canDispatchNow = useMemo(() => {
    if (!selectedCampaign) {
      return false;
    }
    return ["queued", "sending"].includes(selectedCampaign.status) && pendingContacts > 0;
  }, [selectedCampaign, pendingContacts]);

  useEffect(() => {
    if (!manualModalVisible) {
      return;
    }

    setManualForm((previous) => {
      const nextVariables: Record<string, string> = {};
      for (const variable of selectedTemplateVariables) {
        nextVariables[variable] = previous.variables?.[variable] ?? "";
      }

      return {
        ...previous,
        variables: nextVariables,
      };
    });
  }, [manualModalVisible, selectedTemplateVariables]);

  useEffect(() => {
    if (!importUsersModalVisible) {
      setUserResults([]);
      setSelectedUserIds([]);
      setIsLoadingUsers(false);
      setImportUsersFeedback(null);
      return;
    }

    setIsLoadingUsers(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          pageSize: "100",
          status: "active",
        });
        const trimmedQuery = userSearchQuery.trim();
        if (trimmedQuery) {
          params.set("query", trimmedQuery);
        }

        const response = await fetch(`/api/admin/users/list?${params.toString()}`, {
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const message = payload?.message ?? "Não foi possível carregar os usuários.";
          throw new Error(message);
        }

        const users = Array.isArray(payload?.users)
          ? (payload?.users as AdminUserSummary[])
          : [];

        setUserResults(users);
        setUserResultsHasMore(Boolean(payload?.hasMore));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load users for campaign import", error);
          setImportUsersFeedback({
            type: "danger",
            message:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar os usuários.",
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingUsers(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [importUsersModalVisible, userSearchQuery]);

  const loadCampaignDetail = async (campaignId: string, force = false) => {
    if (!campaignId) {
      return;
    }

    if (!force && campaignDetails[campaignId]) {
      return;
    }

    setIsLoadingDetail(true);
    setDetailError(null);

    try {
      const response = await fetch(`/api/admin/campaigns/${campaignId}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.message ?? "Não foi possível carregar os detalhes da campanha.";
        throw new Error(message);
      }

      const payload = (await response.json()) as { campaign?: AdminCampaignDetail };
      if (!payload?.campaign) {
        throw new Error("Resposta inválida da API.");
      }

      setCampaignDetails((previous) => ({ ...previous, [campaignId]: payload.campaign }));
      setCampaignItems((previous) =>
        previous.map((item) =>
          item.campaignId === campaignId
            ? {
                ...item,
                stats: payload.campaign.stats,
                status: payload.campaign.status,
                updatedAt: payload.campaign.updatedAt,
                scheduledAt: payload.campaign.scheduledAt,
                sendingStartedAt: payload.campaign.sendingStartedAt,
                sendingCompletedAt: payload.campaign.sendingCompletedAt,
                lastError: payload.campaign.lastError,
              }
            : item,
        ),
      );
    } catch (error) {
      console.error("Failed to fetch campaign detail", error);
      setDetailError(error instanceof Error ? error.message : "Não foi possível carregar os detalhes.");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (selectedCampaignId) {
      void loadCampaignDetail(selectedCampaignId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId]);

  const handleOpenCreateModal = () => {
    setCreateForm((previous) => ({
      ...DEFAULT_CREATE_FORM,
      templateId: templates[0]?.templateId ?? previous.templateId,
    }));
    setCreateFeedback(null);
    setCreateModalVisible(true);
  };

  const handleOpenManualModal = () => {
    if (!selectedCampaign) {
      setGlobalFeedback({
        type: "danger",
        message: "Selecione uma campanha antes de adicionar contatos.",
      });
      return;
    }

    const variableDefaults = selectedTemplateVariables.reduce<Record<string, string>>((acc, variable) => {
      acc[variable] = "";
      return acc;
    }, {});

    setManualForm({ phone: "", name: "", variables: variableDefaults });
    setManualFeedback(null);
    setManualModalVisible(true);
  };

  const handleManualFieldChange = (field: "phone" | "name") =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      setManualForm((previous) => ({ ...previous, [field]: value }));
    };

  const handleManualVariableChange = (variable: string) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      setManualForm((previous) => ({
        ...previous,
        variables: { ...previous.variables, [variable]: value },
      }));
    };

  const handleAddContactManually = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCampaign) {
      setManualFeedback({ type: "danger", message: "Selecione uma campanha antes de adicionar contatos." });
      return;
    }

    if (!manualForm.phone.trim()) {
      setManualFeedback({ type: "danger", message: "Informe o número de telefone do contato." });
      return;
    }

    setIsAddingContact(true);
    setManualFeedback(null);

    try {
      const variablesPayload = selectedTemplateVariables.reduce<Record<string, string>>((acc, variable) => {
        const value = manualForm.variables?.[variable];
        if (typeof value === "string" && value.trim()) {
          acc[variable] = value.trim();
        }
        return acc;
      }, {});

      const response = await fetch(`/api/admin/campaigns/${selectedCampaign.campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: manualForm.phone,
          name: manualForm.name || null,
          variables: variablesPayload,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível adicionar o contato.";
        throw new Error(message);
      }

      setGlobalFeedback({ type: "success", message: payload?.message ?? "Contato adicionado à campanha." });
      setManualModalVisible(false);
      setManualForm({ phone: "", name: "", variables: {} });
      await loadCampaignDetail(selectedCampaign.campaignId, true);
      router.refresh();
    } catch (error) {
      console.error("Failed to add manual contact", error);
      setManualFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível adicionar o contato.",
      });
    } finally {
      setIsAddingContact(false);
    }
  };

  const handleOpenImportUsersModal = () => {
    if (!selectedCampaign) {
      setGlobalFeedback({
        type: "danger",
        message: "Selecione uma campanha antes de importar usuários.",
      });
      return;
    }

    setUserSearchQuery("");
    setSelectedUserIds([]);
    setUserResults([]);
    setImportUsersFeedback(null);
    setImportUsersModalVisible(true);
  };

  const toggleUserSelection = (userId: number, hasPhone: boolean) => {
    if (!hasPhone) {
      return;
    }

    setSelectedUserIds((previous) =>
      previous.includes(userId)
        ? previous.filter((id) => id !== userId)
        : [...previous, userId],
    );
  };

  const handleSelectAllUsers = () => {
    const selectableIds = userResults
      .filter((user) => typeof user.whatsappNumber === "string" && user.whatsappNumber.trim().length > 0)
      .map((user) => user.id);
    setSelectedUserIds(selectableIds);
  };

  const handleClearUserSelection = () => {
    setSelectedUserIds([]);
  };

  const handleImportUsers = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCampaign) {
      setImportUsersFeedback({ type: "danger", message: "Selecione uma campanha antes de importar usuários." });
      return;
    }

    if (selectedUserIds.length === 0) {
      setImportUsersFeedback({ type: "danger", message: "Selecione ao menos um usuário para importar." });
      return;
    }

    setIsImportingUsers(true);
    setImportUsersFeedback(null);

    try {
      const response = await fetch(`/api/admin/campaigns/${selectedCampaign.campaignId}/contacts/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selectedUserIds }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível importar os usuários selecionados.";
        throw new Error(message);
      }

      const inserted = payload?.result?.inserted ?? selectedUserIds.length;
      const totalFound = payload?.result?.totalFound ?? selectedUserIds.length;
      const skipped = payload?.result?.skipped ?? Math.max(0, totalFound - inserted);

      const successMessage = `Importação concluída. ${inserted} contato(s) importado(s) de ${totalFound}.${skipped > 0 ? ` ${skipped} contato(s) foram ignorados.` : ""}`.trim();

      setGlobalFeedback({ type: "success", message: successMessage });
      setImportUsersModalVisible(false);
      setSelectedUserIds([]);
      setUserResults([]);
      await loadCampaignDetail(selectedCampaign.campaignId, true);
      router.refresh();
    } catch (error) {
      console.error("Failed to import campaign contacts from users", error);
      setImportUsersFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível importar os usuários selecionados.",
      });
    } finally {
      setIsImportingUsers(false);
    }
  };

  const handleCreateFieldChange = (field: keyof CreateCampaignFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.currentTarget.value;
      setCreateForm((previous) => ({ ...previous, [field]: value }));
    };

  const handleCreateCampaign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasTemplateCredentials) {
      setCreateFeedback({
        type: "danger",
        message: "Sincronize as credenciais do bot administrativo antes de criar campanhas.",
      });
      return;
    }

    if (!createForm.templateId) {
      setCreateFeedback({ type: "danger", message: "Selecione um modelo para a campanha." });
      return;
    }

    setIsCreating(true);
    setCreateFeedback(null);

    try {
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description || null,
          templateId: createForm.templateId,
          scheduledAt: createForm.scheduledAt || null,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível criar a campanha.";
        throw new Error(message);
      }

      if (payload?.campaign) {
        const summary = payload.campaign as AdminCampaignSummary;
        setCampaignItems((previous) => {
          const filtered = previous.filter((item) => item.campaignId !== summary.campaignId);
          return [summary, ...filtered];
        });
        setSelectedCampaignId(summary.campaignId);
        await loadCampaignDetail(summary.campaignId, true);
      }

      setCreateModalVisible(false);
      setCreateForm(DEFAULT_CREATE_FORM);
      setGlobalFeedback({ type: "success", message: payload?.message ?? "Campanha criada com sucesso." });
      router.refresh();
    } catch (error) {
      console.error("Failed to create campaign", error);
      setCreateFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível criar a campanha.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelectCampaign = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setImportCsvModalVisible(false);
    setImportCsvForm(DEFAULT_IMPORT_FORM);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) {
      setImportCsvForm((previous) => ({ ...previous, file: null, headers: [], previewRows: [] }));
      return;
    }

    setImportCsvForm((previous) => ({
      ...previous,
      file,
      headers: [],
      previewRows: [],
      phoneColumn: "",
      nameColumn: "",
      variableColumns: {},
    }));
    setImportCsvFeedback(null);
  };

  const handleImportFieldChange = (field: keyof ImportFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.currentTarget.value;
      if (field === "delimiter") {
        setImportCsvForm((previous) => ({
          ...previous,
          delimiter: value as ImportFormState["delimiter"],
        }));
        return;
      }

      if (field === "hasHeader") {
        setImportCsvForm((previous) => ({
          ...previous,
          hasHeader: event.currentTarget.checked,
        }));
        return;
      }

      setImportCsvForm((previous) => ({ ...previous, [field]: value }));
    };

  const handleVariableColumnChange = (variable: string) =>
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.currentTarget.value;
      setImportCsvForm((previous) => ({
        ...previous,
        variableColumns: {
          ...previous.variableColumns,
          [variable]: value,
        },
      }));
    };

  useEffect(() => {
    if (!importCsvForm.file) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const text = await importCsvForm.file!.text();
        if (cancelled) {
          return;
        }

        const { headers, rows } = parseCsvPreview(text, importCsvForm.delimiter, importCsvForm.hasHeader);
        const normalizedHeaders = headers.map((header) => header.toLowerCase());

        setImportCsvForm((previous) => {
          const phoneColumn = previous.phoneColumn && normalizedHeaders.includes(previous.phoneColumn.toLowerCase())
            ? previous.phoneColumn
            : suggestColumn(headers, ["phone", "telefone", "whatsapp", "numero"]);

          const nameColumn = previous.nameColumn && normalizedHeaders.includes(previous.nameColumn.toLowerCase())
            ? previous.nameColumn
            : suggestColumn(headers, ["name", "nome"]);

          const nextVariableColumns = { ...previous.variableColumns };
          for (const variable of selectedTemplateVariables) {
            const previousColumn = previous.variableColumns[variable];
            if (previousColumn && normalizedHeaders.includes(previousColumn.toLowerCase())) {
              nextVariableColumns[variable] = previousColumn;
            } else {
              nextVariableColumns[variable] = suggestColumn(headers, [
                `var${variable}`,
                `valor${variable}`,
                `variavel${variable}`,
              ]);
            }
          }

          return {
            ...previous,
            headers,
            previewRows: rows,
            phoneColumn,
            nameColumn,
            variableColumns: nextVariableColumns,
          };
        });
      } catch (error) {
        console.error("Failed to parse CSV preview", error);
        if (!cancelled) {
          setImportCsvFeedback({ type: "danger", message: "Não foi possível analisar o arquivo selecionado." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importCsvForm.file, importCsvForm.delimiter, importCsvForm.hasHeader, selectedTemplateVariables]);

  const handleImportContacts = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCampaign) {
      setImportCsvFeedback({ type: "danger", message: "Selecione uma campanha para importar os contatos." });
      return;
    }

    if (!importCsvForm.file) {
      setImportCsvFeedback({ type: "danger", message: "Escolha um arquivo CSV para prosseguir." });
      return;
    }

    if (!importCsvForm.phoneColumn) {
      setImportCsvFeedback({ type: "danger", message: "Informe qual coluna representa o telefone." });
      return;
    }

    setIsImportingCsv(true);
    setImportCsvFeedback(null);

    try {
      const formData = new FormData();
      formData.append("file", importCsvForm.file);
      formData.append(
        "options",
        JSON.stringify({
          delimiter: importCsvForm.delimiter,
          hasHeader: importCsvForm.hasHeader,
          mapping: {
            phoneColumn: importCsvForm.phoneColumn,
            nameColumn: importCsvForm.nameColumn || null,
            variableColumns: selectedTemplateVariables.reduce<Record<string, string | null>>((acc, variable) => {
              acc[variable] = importCsvForm.variableColumns[variable] ?? null;
              return acc;
            }, {}),
          },
        }),
      );

      const response = await fetch(`/api/admin/campaigns/${selectedCampaign.campaignId}/contacts/upload`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível importar os contatos.";
        throw new Error(message);
      }

      const inserted = payload?.result?.inserted ?? 0;
      const totalFound = payload?.result?.totalFound ?? inserted;
      const skipped = payload?.result?.skipped ?? 0;

      const successMessage = `Importação concluída. ${inserted} contato(s) importado(s) de ${totalFound}. ${skipped > 0 ? `${skipped} contato(s) foram ignorados.` : ""}`.trim();

      setGlobalFeedback({ type: "success", message: successMessage });
      setImportCsvModalVisible(false);
      setImportCsvForm(DEFAULT_IMPORT_FORM);
      await loadCampaignDetail(selectedCampaign.campaignId, true);
      router.refresh();
    } catch (error) {
      console.error("Failed to import contacts", error);
      setImportCsvFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível importar os contatos.",
      });
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleStartCampaign = async () => {
    if (!selectedCampaign) {
      return;
    }

    setIsStartingCampaign(true);
    setGlobalFeedback(null);

    try {
      const response = await fetch(`/api/admin/campaigns/${selectedCampaign.campaignId}/start`, {
        method: "POST",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível colocar a campanha na fila.";
        throw new Error(message);
      }

      const summary = payload?.campaign as AdminCampaignSummary | undefined;
      if (summary) {
        setCampaignItems((previous) =>
          previous.map((item) => (item.campaignId === summary.campaignId ? summary : item)),
        );
      }

      setGlobalFeedback({ type: "success", message: payload?.message ?? "Campanha iniciada." });
      await loadCampaignDetail(selectedCampaign.campaignId, true);
      router.refresh();
    } catch (error) {
      console.error("Failed to start campaign", error);
      setGlobalFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível iniciar a campanha.",
      });
    } finally {
      setIsStartingCampaign(false);
    }
  };

  const handleDispatchCampaign = async (mode: "async" | "sync" = "async") => {
    if (!selectedCampaign) {
      return;
    }

    setIsDispatchingCampaign(true);
    setGlobalFeedback(null);

    try {
      const response = await fetch(
        `/api/admin/campaigns/${selectedCampaign.campaignId}/send${mode === "sync" ? "?mode=sync" : ""}`,
        { method: "POST" },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível processar a campanha.";
        throw new Error(message);
      }

      const summary = payload?.campaign as AdminCampaignSummary | undefined;
      if (summary) {
        setCampaignItems((previous) =>
          previous.map((item) => (item.campaignId === summary.campaignId ? summary : item)),
        );
      }

      setGlobalFeedback({ type: "success", message: payload?.message ?? "Processamento iniciado." });
      await loadCampaignDetail(selectedCampaign.campaignId, true);
      router.refresh();
    } catch (error) {
      console.error("Failed to dispatch campaign", error);
      setGlobalFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Não foi possível processar a campanha.",
      });
    } finally {
      setIsDispatchingCampaign(false);
    }
  };

  const sampleCsvContent = useMemo(() => {
    const variableHeaders = selectedTemplateVariables.map((variable) => `var${variable}`);
    const headers = ["phone", "name", ...variableHeaders];
    const sampleLine = [
      "5599999999999",
      "Cliente Exemplo",
      ...selectedTemplateVariables.map((variable) => `Valor ${variable}`),
    ];
    return `${headers.join(",")}\n${sampleLine.join(",")}`;
  }, [selectedTemplateVariables]);

  return (
    <div className="d-flex flex-column gap-4">
      <FloatingAlert feedback={globalFeedback} onClose={() => setGlobalFeedback(null)} />

      {!hasTemplateCredentials && (
        <Alert variant="warning" className="mb-0">
          Antes de criar campanhas, configure o token e o Business Account ID na aba <strong>Bot administrativo &gt; Webhook</strong> e sincronize os modelos aprovados na seção &quot;Modelos&quot;.
        </Alert>
      )}

      <Card>
        <Card.Header className="d-flex flex-column gap-2 gap-md-0 flex-md-row justify-content-md-between align-items-md-center">
          <div>
            <Card.Title as="h2" className="h5 mb-0">
              Campanhas cadastradas
            </Card.Title>
            <small className="text-secondary">Gerencie os envios em massa criados com os modelos aprovados na Meta.</small>
          </div>

          <div className="d-flex gap-2 flex-wrap">
            <Button variant="outline-secondary" onClick={() => router.refresh()}>
              Atualizar lista
            </Button>
            <Button onClick={handleOpenCreateModal} disabled={!hasTemplateCredentials}>
              Nova campanha
            </Button>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Modelo</th>
                <th>Status</th>
                <th>Contatos</th>
                <th>Criada em</th>
                <th className="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedCampaigns.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-secondary py-4">
                    Nenhuma campanha cadastrada até o momento. Crie uma nova campanha utilizando um modelo aprovado para iniciar seus envios.
                  </td>
                </tr>
              )}

              {sortedCampaigns.map((campaign) => (
                <tr key={campaign.campaignId}>
                  <td>
                    <div className="fw-semibold">{campaign.name}</div>
                    {campaign.description && (
                      <small className="text-secondary d-block">{campaign.description}</small>
                    )}
                  </td>
                  <td>
                    <div className="d-flex flex-column">
                      <span className="fw-semibold">{campaign.templateName}</span>
                      <small className="text-secondary">ID: {campaign.templateId}</small>
                    </div>
                  </td>
                  <td>
                    <Badge bg={STATUS_VARIANTS[campaign.status] ?? "secondary"}>
                      {STATUS_LABELS[campaign.status] ?? campaign.status}
                    </Badge>
                  </td>
                  <td>
                    <div className="d-flex flex-column">
                      <span>Total: {campaign.stats.totalContacts}</span>
                      <small className="text-secondary">
                        Enviados: {campaign.stats.sentContacts} | Pendentes: {campaign.stats.pendingContacts}
                      </small>
                    </div>
                  </td>
                  <td>{formatDateTime(campaign.createdAt)}</td>
                  <td className="text-end">
                    <Button
                      variant={selectedCampaignId === campaign.campaignId ? "primary" : "outline-primary"}
                      size="sm"
                      onClick={() => handleSelectCampaign(campaign.campaignId)}
                    >
                      {selectedCampaignId === campaign.campaignId ? "Selecionada" : "Visualizar"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {selectedCampaign && (
        <Card>
          <Card.Header>
            <Card.Title as="h2" className="h5 mb-0">
              Detalhes da campanha
            </Card.Title>
          </Card.Header>
          <Card.Body className="d-flex flex-column gap-4">
            <Row className="gy-3">
              <Col md={6}>
                <div className="d-flex flex-column gap-1">
                  <span className="fw-semibold">{selectedCampaign.name}</span>
                  <small className="text-secondary">ID: {selectedCampaign.campaignId}</small>
                  {selectedCampaign.description && (
                    <small className="text-secondary">{selectedCampaign.description}</small>
                  )}
                </div>
              </Col>
              <Col md={3}>
                <div className="d-flex flex-column gap-1">
                  <span>Status atual</span>
                  <Badge bg={STATUS_VARIANTS[selectedCampaign.status] ?? "secondary"} className="align-self-start">
                    {STATUS_LABELS[selectedCampaign.status] ?? selectedCampaign.status}
                  </Badge>
                </div>
              </Col>
              <Col md={3}>
                <div className="d-flex flex-column gap-1">
                  <span>Atualizada em</span>
                  <small className="text-secondary">{formatDateTime(selectedCampaign.updatedAt)}</small>
                </div>
              </Col>
            </Row>

            <Row className="gy-3">
              <Col md={2}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Total</span>
                  <span>{selectedCampaign.stats.totalContacts}</span>
                </div>
              </Col>
              <Col md={2}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Pendentes</span>
                  <span>{selectedCampaign.stats.pendingContacts}</span>
                </div>
              </Col>
              <Col md={2}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Na fila</span>
                  <span>{selectedCampaign.stats.queuedContacts}</span>
                </div>
              </Col>
              <Col md={2}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Enviadas</span>
                  <span>{selectedCampaign.stats.sentContacts}</span>
                </div>
              </Col>
              <Col md={2}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Falhas</span>
                  <span>{selectedCampaign.stats.failedContacts}</span>
                </div>
              </Col>
              <Col md={2}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Ignoradas</span>
                  <span>{selectedCampaign.stats.skippedContacts}</span>
                </div>
              </Col>
            </Row>

            <Row className="gy-3">
              <Col md={3}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Envio iniciado em</span>
                  <small className="text-secondary">
                    {selectedCampaign.sendingStartedAt ? formatDateTime(selectedCampaign.sendingStartedAt) : "-"}
                  </small>
                </div>
              </Col>
              <Col md={3}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Envio concluído em</span>
                  <small className="text-secondary">
                    {selectedCampaign.sendingCompletedAt ? formatDateTime(selectedCampaign.sendingCompletedAt) : "-"}
                  </small>
                </div>
              </Col>
              <Col md={6}>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Último erro</span>
                  <small className="text-secondary">
                    {selectedCampaign.lastError ?? "-"}
                  </small>
                </div>
              </Col>
            </Row>

            <div className="d-flex flex-wrap gap-2">
              <Button
                onClick={handleStartCampaign}
                disabled={!canStartCampaign || isStartingCampaign}
              >
                {isStartingCampaign ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Iniciando...
                  </>
                ) : (
                  "Iniciar envios"
                )}
              </Button>
              <Button
                variant="outline-primary"
                onClick={() => handleDispatchCampaign("async")}
                disabled={!canDispatchNow || isDispatchingCampaign}
              >
                {isDispatchingCampaign ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Processando...
                  </>
                ) : (
                  "Processar agora"
                )}
              </Button>
              <Button onClick={handleOpenManualModal}>Adicionar contato manual</Button>
              <Button
                variant="outline-primary"
                onClick={() => {
                  const variableDefaults = selectedTemplateVariables.reduce<Record<string, string>>((acc, variable) => {
                    acc[variable] = "";
                    return acc;
                  }, {});

                  setImportCsvForm({
                    ...DEFAULT_IMPORT_FORM,
                    delimiter: DEFAULT_IMPORT_OPTIONS.delimiter,
                    hasHeader: DEFAULT_IMPORT_OPTIONS.hasHeader,
                    variableColumns: variableDefaults,
                  });
                  setImportCsvFeedback(null);
                  setImportCsvModalVisible(true);
                }}
              >
                Importar CSV
              </Button>
              <Button variant="outline-primary" onClick={handleOpenImportUsersModal}>
                Importar usuários
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => loadCampaignDetail(selectedCampaign.campaignId, true)}
              >
                Atualizar detalhes
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => {
                  const blob = new Blob([sampleCsvContent], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `modelo-campanha-${selectedCampaign.campaignId}.csv`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }}
              >
                Baixar modelo CSV
              </Button>
            </div>

            {isLoadingDetail && (
              <div className="d-flex align-items-center gap-2 text-secondary">
                <Spinner animation="border" size="sm" /> Carregando detalhes da campanha...
              </div>
            )}

            {detailError && !isLoadingDetail && (
              <Alert variant="danger" className="mb-0">
                {detailError}
              </Alert>
            )}

            {selectedCampaignDetail && !detailError && (
              <div className="d-flex flex-column gap-3">
                <h3 className="h6 mb-0">Últimos contatos importados</h3>
                <Table responsive hover className="mb-0">
                  <thead>
                    <tr>
                      <th>Contato</th>
                      <th>Telefone</th>
                      <th>Status</th>
                      <th>Variáveis</th>
                      <th>Atualização</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCampaignDetail.contacts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-secondary py-4">
                          Nenhum contato importado ainda. Utilize os botões de importação para carregar sua base.
                        </td>
                      </tr>
                    ) : (
                      selectedCampaignDetail.contacts.map((contact) => (
                        <tr key={contact.contactId}>
                          <td>{contact.name ?? "-"}</td>
                          <td>{contact.phone}</td>
                          <td>
                            <Badge bg={CONTACT_STATUS_VARIANTS[contact.status] ?? "secondary"}>
                              {CONTACT_STATUS_LABELS[contact.status] ?? contact.status}
                            </Badge>
                          </td>
                          <td>{formatContactVariables(contact.variables)}</td>
                          <td>{formatDateTime(contact.updatedAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      <Modal
        show={createModalVisible}
        onHide={() => {
          setCreateModalVisible(false);
          setCreateFeedback(null);
          setCreateForm(DEFAULT_CREATE_FORM);
        }}
        backdrop="static"
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Nova campanha</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleCreateCampaign} className="d-flex flex-column gap-3">
            {createFeedback && (
              <Alert variant={createFeedback.type === "danger" ? "danger" : "success"} className="mb-0">
                {createFeedback.message}
              </Alert>
            )}

            {!hasTemplateCredentials && (
              <Alert variant="warning" className="mb-0">
                Configure as credenciais do bot administrativo na aba &quot;Bot administrativo &gt; Webhook&quot; antes de criar campanhas.
              </Alert>
            )}

            <Form.Group controlId="campaign-name">
              <Form.Label>Nome da campanha</Form.Label>
              <Form.Control
                value={createForm.name}
                onChange={handleCreateFieldChange("name")}
                placeholder="Ex: Black Friday Loja X"
                required
                maxLength={191}
              />
            </Form.Group>

            <Form.Group controlId="campaign-description">
              <Form.Label>Descrição (opcional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={createForm.description}
                onChange={handleCreateFieldChange("description")}
                placeholder="Breve descrição para identificar esta campanha"
                maxLength={1000}
              />
            </Form.Group>

            <Form.Group controlId="campaign-template">
              <Form.Label>Modelo aprovado</Form.Label>
              <Form.Select
                value={createForm.templateId}
                onChange={handleCreateFieldChange("templateId")}
                required
                disabled={templates.length === 0}
              >
                {templates.length === 0 && <option value="">Nenhum modelo disponível. Sincronize primeiro.</option>}
                {templates.map((template) => (
                  <option value={template.templateId} key={template.templateId}>
                    {template.name} ({template.language})
                  </option>
                ))}
              </Form.Select>
              <Form.Text className="text-secondary">
                Utilize a aba &quot;Modelos&quot; para sincronizar os templates aprovados diretamente da Meta.
              </Form.Text>
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="outline-secondary" onClick={() => setCreateModalVisible(false)} disabled={isCreating}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isCreating || !hasTemplateCredentials}>
                {isCreating ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Criando...
                  </>
                ) : (
                  "Criar campanha"
                )}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        show={importUsersModalVisible}
        onHide={() => {
          setImportUsersModalVisible(false);
          setSelectedUserIds([]);
          setUserResults([]);
          setImportUsersFeedback(null);
        }}
        backdrop="static"
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Importar usuários para {selectedCampaign?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleImportUsers} className="d-flex flex-column gap-3">
            {importUsersFeedback && (
              <Alert variant={importUsersFeedback.type} className="mb-0">
                {importUsersFeedback.message}
              </Alert>
            )}

            <Form.Group controlId="import-users-search">
              <Form.Label>Buscar usuários</Form.Label>
              <Form.Control
                value={userSearchQuery}
                onChange={(event) => setUserSearchQuery(event.currentTarget.value)}
                placeholder="Nome ou e-mail"
              />
              <Form.Text className="text-secondary">
                Apenas usuários com número de WhatsApp cadastrado serão importados. Refinar a busca pode ajudar a localizar grupos específicos.
              </Form.Text>
            </Form.Group>

            <div className="d-flex justify-content-between align-items-center">
              <span className="fw-semibold">Usuários encontrados</span>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleSelectAllUsers}
                  disabled={userResults.length === 0}
                >
                  Selecionar todos
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleClearUserSelection}
                  disabled={selectedUserIds.length === 0}
                >
                  Limpar seleção
                </Button>
              </div>
            </div>

            <Table responsive hover className="mb-0">
              <thead>
                <tr>
                  <th style={{ width: "48px" }}></th>
                  <th>Usuário</th>
                  <th>E-mail</th>
                  <th>Telefone</th>
                </tr>
              </thead>
              <tbody>
                {userResults.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-secondary py-4">
                      {isLoadingUsers ? "Carregando usuários..." : "Nenhum usuário encontrado."}
                    </td>
                  </tr>
                )}

                {userResults.map((user) => {
                  const phone = user.whatsappNumber?.trim() ?? "";
                  const hasPhone = phone.length > 0;
                  const isSelected = selectedUserIds.includes(user.id);

                  return (
                    <tr key={user.id} className={!hasPhone ? "table-secondary" : undefined}>
                      <td>
                        <Form.Check
                          type="checkbox"
                          aria-label={`Selecionar ${user.name}`}
                          checked={isSelected}
                          disabled={!hasPhone || isImportingUsers}
                          onChange={() => toggleUserSelection(user.id, hasPhone)}
                        />
                      </td>
                      <td>
                        <div className="d-flex flex-column">
                          <span className="fw-semibold">{user.name}</span>
                          <small className="text-secondary">ID: {user.id}</small>
                        </div>
                      </td>
                      <td>{user.email ?? "-"}</td>
                      <td>{hasPhone ? phone : <span className="text-secondary">Sem número cadastrado</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            {userResultsHasMore && (
              <Alert variant="info" className="mb-0">
                A lista foi limitada aos primeiros 100 resultados. Refine a busca para localizar outros usuários.
              </Alert>
            )}

            <div className="d-flex justify-content-end gap-2">
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setImportUsersModalVisible(false);
                  setSelectedUserIds([]);
                  setUserResults([]);
                  setImportUsersFeedback(null);
                }}
                disabled={isImportingUsers}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isImportingUsers || selectedUserIds.length === 0}>
                {isImportingUsers ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Importando...
                  </>
                ) : (
                  `Importar ${selectedUserIds.length} contato(s)`
                )}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        show={manualModalVisible}
        onHide={() => {
          setManualModalVisible(false);
          setManualForm({ phone: "", name: "", variables: {} });
          setManualFeedback(null);
        }}
        backdrop="static"
      >
        <Modal.Header closeButton>
          <Modal.Title>Adicionar contato manual</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleAddContactManually} className="d-flex flex-column gap-3">
            {manualFeedback && (
              <Alert variant={manualFeedback.type} className="mb-0">
                {manualFeedback.message}
              </Alert>
            )}

            <Form.Group controlId="manual-contact-phone">
              <Form.Label>Número de telefone</Form.Label>
              <Form.Control
                value={manualForm.phone}
                onChange={handleManualFieldChange("phone")}
                placeholder="Ex: 5599999999999"
                required
              />
              <Form.Text className="text-secondary">
                Informe o número completo com DDI e DDD. Você pode utilizar apenas dígitos ou o formato internacional com &quot;+&quot;.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="manual-contact-name">
              <Form.Label>Nome (opcional)</Form.Label>
              <Form.Control
                value={manualForm.name}
                onChange={handleManualFieldChange("name")}
                placeholder="Nome do contato"
              />
            </Form.Group>

            {selectedTemplateVariables.length > 0 && (
              <div className="d-flex flex-column gap-3">
                <div className="fw-semibold">Variáveis do modelo</div>
                {selectedTemplateVariables.map((variable) => (
                  <Form.Group controlId={`manual-variable-${variable}`} key={variable}>
                    <Form.Label>Valor para {`{{${variable}}}`}</Form.Label>
                    <Form.Control
                      value={manualForm.variables[variable] ?? ""}
                      onChange={handleManualVariableChange(variable)}
                    />
                  </Form.Group>
                ))}
                <Form.Text className="text-secondary">
                  Deixe em branco para manter o valor padrão definido no template.
                </Form.Text>
              </div>
            )}

            <div className="d-flex justify-content-end gap-2">
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setManualModalVisible(false);
                  setManualForm({ phone: "", name: "", variables: {} });
                  setManualFeedback(null);
                }}
                disabled={isAddingContact}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isAddingContact}>
                {isAddingContact ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Adicionando...
                  </>
                ) : (
                  "Adicionar contato"
                )}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        show={importCsvModalVisible}
        onHide={() => {
          setImportCsvModalVisible(false);
          setImportCsvForm(DEFAULT_IMPORT_FORM);
          setImportCsvFeedback(null);
        }}
        backdrop="static"
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Importar CSV para {selectedCampaign?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleImportContacts} className="d-flex flex-column gap-3">
            {importCsvFeedback && (
              <Alert variant={importCsvFeedback.type === "danger" ? "danger" : "success"} className="mb-0">
                {importCsvFeedback.message}
              </Alert>
            )}

            <Alert variant="info" className="mb-0">
              <div className="fw-semibold mb-2">Como preparar o CSV?</div>
              <ul className="mb-0 ps-3">
                <li>Inclua uma coluna obrigatória chamada <strong>phone</strong> com os números no formato internacional (ex: 5599999999999).</li>
                <li>Opcionalmente adicione uma coluna <strong>name</strong> e as colunas <strong>var1, var2...</strong> conforme as variáveis utilizadas no modelo.</li>
                <li>O arquivo deve estar em UTF-8 com separador &quot;,&quot; (vírgula), ponto e vírgula ou tabulação.</li>
                <li>Você pode baixar um modelo pronto clicando no botão <em>Baixar modelo CSV</em> na área de detalhes.</li>
              </ul>
            </Alert>

            <Form.Group controlId="import-file">
              <Form.Label>Arquivo CSV</Form.Label>
              <Form.Control type="file" accept=".csv,text/csv" onChange={handleFileChange} required />
            </Form.Group>

            <Row className="gy-3">
              <Col md={4}>
                <Form.Group controlId="import-delimiter">
                  <Form.Label>Separador</Form.Label>
                  <Form.Select
                    value={importCsvForm.delimiter}
                    onChange={handleImportFieldChange("delimiter")}
                    disabled={isImportingCsv}
                  >
                    <option value="," >Vírgula (,)</option>
                    <option value=";">Ponto e vírgula (;)</option>
                    <option value="\t">Tabulação</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="import-header" className="d-flex align-items-center gap-2 mt-4">
                  <Form.Check
                    type="checkbox"
                    label="Arquivo possui cabeçalho"
                    checked={importCsvForm.hasHeader}
                    onChange={handleImportFieldChange("hasHeader")}
                    disabled={isImportingCsv}
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row className="gy-3">
              <Col md={6}>
                <Form.Group controlId="import-phone-column">
                  <Form.Label>Coluna de telefone</Form.Label>
                  <Form.Select
                    value={importCsvForm.phoneColumn}
                    onChange={(event) =>
                      setImportCsvForm((previous) => ({ ...previous, phoneColumn: event.currentTarget.value }))
                    }
                    required
                    disabled={isImportingCsv || importCsvForm.headers.length === 0}
                  >
                    <option value="">Selecione a coluna</option>
                    {importCsvForm.headers.map((header) => (
                      <option value={header} key={header}>
                        {header}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="import-name-column">
                  <Form.Label>Coluna de nome (opcional)</Form.Label>
                  <Form.Select
                    value={importCsvForm.nameColumn}
                    onChange={(event) =>
                      setImportCsvForm((previous) => ({ ...previous, nameColumn: event.currentTarget.value }))
                    }
                    disabled={isImportingCsv || importCsvForm.headers.length === 0}
                  >
                    <option value="">Sem nome</option>
                    {importCsvForm.headers.map((header) => (
                      <option value={header} key={header}>
                        {header}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            {selectedTemplateVariables.length > 0 && (
              <div className="d-flex flex-column gap-3">
                <div className="fw-semibold">Mapeamento das variáveis do modelo</div>
                {selectedTemplateVariables.map((variable) => (
                  <Form.Group controlId={`import-variable-${variable}`} key={variable}>
                    <Form.Label>
                      Variável {`{{${variable}}}`} (coluna)
                    </Form.Label>
                    <Form.Select
                      value={importCsvForm.variableColumns[variable] ?? ""}
                      onChange={handleVariableColumnChange(variable)}
                      disabled={isImportingCsv || importCsvForm.headers.length === 0}
                    >
                      <option value="">Sem preenchimento</option>
                      {importCsvForm.headers.map((header) => (
                        <option value={header} key={header}>
                          {header}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                ))}
              </div>
            )}

            {importCsvForm.previewRows.length > 0 && (
              <div className="d-flex flex-column gap-2">
                <div className="fw-semibold">Pré-visualização</div>
                <Table size="sm" responsive className="mb-0">
                  <thead>
                    <tr>
                      {importCsvForm.headers.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importCsvForm.previewRows.map((row, index) => (
                      <tr key={index}>
                        {row.map((column, columnIndex) => (
                          <td key={`${index}-${columnIndex}`}>{column || <span className="text-secondary">(vazio)</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            <div className="d-flex justify-content-end gap-2">
              <Button variant="outline-secondary" onClick={() => setImportCsvModalVisible(false)} disabled={isImportingCsv}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isImportingCsv}>
                {isImportingCsv ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Importando...
                  </>
                ) : (
                  "Importar contatos"
                )}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default AdminCampaignManager;
