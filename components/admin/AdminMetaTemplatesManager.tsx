/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  Modal,
  OverlayTrigger,
  Spinner,
  Table,
  Tooltip,
} from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";
import {
  META_MEDIA_KIND_LABEL,
  META_TEMPLATE_CATEGORIES,
  META_TEMPLATE_LIMITS,
} from "types/admin-meta-templates";
import type {
  AdminMetaTemplate,
  MetaTemplateCategory,
  MetaTemplateComponent,
  TemplateMediaKind,
  TemplateMediaUpload,
} from "types/admin-meta-templates";

type Feedback = { type: "success" | "danger" | "info"; message: string } | null;

type TemplateHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

type TemplateButtonState = {
  kind: "quick_reply" | "url" | "phone";
  text: string;
  url?: string;
  example?: string;
  phoneNumber?: string;
};

type HeaderPreviewState = {
  kind: TemplateHeaderType;
  url: string | null;
  error: string | null;
  isLoading: boolean;
};

type TemplateFormState = {
  name: string;
  language: string;
  category: MetaTemplateCategory;
  headerType: TemplateHeaderType;
  headerText: string;
  headerMediaHandle: string;
  body: string;
  footer: string;
  buttons: TemplateButtonState[];
};

type TemplateEditorMetadata = {
  formState: TemplateFormState;
  isEditable: boolean;
  fatalReason: string | null;
  warnings: string[];
  canEditHeader: boolean;
  canEditButtons: boolean;
};

interface Props {
  templates: AdminMetaTemplate[];
  hasCredentials: boolean;
}

const DEFAULT_CATEGORY = META_TEMPLATE_CATEGORIES[0];
const DEFAULT_LANGUAGE = "pt_BR";
const MEDIA_HEADER_TYPES: TemplateHeaderType[] = ["IMAGE", "VIDEO", "DOCUMENT"];
const HEADER_TYPE_TO_MEDIA_KIND: Record<Exclude<TemplateHeaderType, "NONE" | "TEXT">, TemplateMediaKind> = {
  IMAGE: "image",
  VIDEO: "video",
  DOCUMENT: "document",
};
const HEADER_ACCEPT_BY_KIND: Record<Exclude<TemplateHeaderType, "NONE" | "TEXT">, string> = {
  IMAGE: "image/jpeg,image/png,image/webp",
  VIDEO: "video/mp4,video/3gpp",
  DOCUMENT:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const resolveHeaderMediaLabel = (type: TemplateHeaderType): string => {
  if (type === "IMAGE" || type === "VIDEO" || type === "DOCUMENT") {
    return META_MEDIA_KIND_LABEL[HEADER_TYPE_TO_MEDIA_KIND[type]];
  }
  return type.toLowerCase();
};

const isMediaHeaderType = (type: TemplateHeaderType): boolean =>
  MEDIA_HEADER_TYPES.includes(type as TemplateHeaderType);

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const truncate = (value: string, limit = 80) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

const renderHeaderPreview = (
  kind: TemplateHeaderType,
  url: string,
  options: { size?: "compact" | "full" } = {},
) => {
  const size = options.size ?? "compact";
  const maxWidth = size === "compact" ? 200 : 420;

  if (kind === "IMAGE") {
    return (
      <img
        src={url}
        alt="Pré-visualização do cabeçalho"
        style={{
          maxWidth: "100%",
          width: size === "compact" ? Math.min(maxWidth, 200) : "100%",
          height: "auto",
          borderRadius: 8,
          border: "1px solid rgba(0,0,0,0.1)",
        }}
      />
    );
  }

  if (kind === "VIDEO") {
    return (
      <video
        controls
        src={url}
        style={{
          maxWidth: size === "compact" ? maxWidth : "100%",
          borderRadius: 8,
        }}
      >
        Seu navegador não suporta a reprodução do vídeo.
      </video>
    );
  }

  if (kind === "DOCUMENT") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-decoration-none">
        Visualizar documento
      </a>
    );
  }

  return null;
};

const sortTemplates = (items: AdminMetaTemplate[]) =>
  [...items].sort((a, b) => a.name.localeCompare(b.name));

const resolveCategory = (category: string | null | undefined): MetaTemplateCategory => {
  if (category) {
    const normalized = category.trim().toUpperCase();
    const match = META_TEMPLATE_CATEGORIES.find((candidate) => candidate === normalized);
    if (match) {
      return match;
    }
  }
  return DEFAULT_CATEGORY;
};

const createEmptyFormState = (): TemplateFormState => ({
  name: "",
  language: DEFAULT_LANGUAGE,
  category: DEFAULT_CATEGORY,
  headerType: "NONE",
  headerText: "",
  headerMediaHandle: "",
  body: "",
  footer: "",
  buttons: [],
});

const getStatusVariant = (status: string) => {
  const normalized = status.trim().toUpperCase();
  if (normalized === "APPROVED") return "success";
  if (normalized === "PENDING" || normalized === "IN_APPEAL") return "warning";
  if (normalized === "REJECTED" || normalized === "DISABLED") return "danger";
  return "secondary";
};

const getQualityVariant = (score: string | null) => {
  if (!score) {
    return "secondary";
  }
  const normalized = score.trim().toUpperCase();
  if (normalized === "GREEN") return "success";
  if (normalized === "YELLOW") return "warning";
  if (normalized === "RED") return "danger";
  return "secondary";
};

const extractHeaderHandle = (component: MetaTemplateComponent | undefined): string => {
  if (!component || !component.example) {
    return "";
  }
  const example = component.example as Record<string, unknown>;
  const handles = example.header_handle;
  if (Array.isArray(handles) && typeof handles[0] === "string") {
    return handles[0];
  }
  return "";
};

const summarizeComponents = (template: AdminMetaTemplate) => {
  const header = template.components.find((component) => (component.type ?? "").toUpperCase() === "HEADER");
  const body = template.components.find((component) => (component.type ?? "").toUpperCase() === "BODY");
  const footer = template.components.find((component) => (component.type ?? "").toUpperCase() === "FOOTER");
  const buttonsComponent = template.components.find(
    (component) => (component.type ?? "").toUpperCase() === "BUTTONS",
  );

  let headerSummary = "—";
  let headerInfo: { kind: TemplateHeaderType; handle: string | null } | null = null;
  if (header) {
    const format = (header.format ?? "TEXT").toUpperCase();
    if (format === "TEXT" && typeof header.text === "string") {
      headerSummary = header.text;
      headerInfo = { kind: "TEXT", handle: null };
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
      const handle = extractHeaderHandle(header);
      const handleOrUrl = handle || (typeof header.text === "string" ? header.text : "");
      const label = handleOrUrl ? truncate(handleOrUrl) : "";
      headerSummary = `${format} ${label ? `(${label})` : ""}`.trim();
      headerInfo = {
        kind: format as TemplateHeaderType,
        handle: handleOrUrl || null,
      };
    } else {
      headerSummary = format;
    }
  }

  const buttonSummaries = Array.isArray(buttonsComponent?.buttons)
    ? buttonsComponent.buttons.map((button) => {
        const type = (button?.type ?? "").toUpperCase();
        const text = typeof button?.text === "string" ? button.text : "";
        if (type === "QUICK_REPLY") {
          return `Resposta rápida: ${text}`.trim();
        }
        if (type === "URL") {
          const url = typeof button?.url === "string" ? button.url : "";
          return `Link: ${text}${url ? ` → ${url}` : ""}`.trim();
        }
        if (type === "PHONE_NUMBER") {
          const phone = typeof button?.phone_number === "string" ? button.phone_number : "";
          return `Telefone: ${text}${phone ? ` → ${phone}` : ""}`.trim();
        }
        return type || "Botão";
      })
    : [];

  return {
    header: headerSummary,
    body: typeof body?.text === "string" ? body.text : "",
    footer: typeof footer?.text === "string" ? footer.text : "",
    buttons: buttonSummaries,
    headerInfo,
  };
};

const computeEditorMetadata = (template: AdminMetaTemplate): TemplateEditorMetadata => {
  let headerType: TemplateHeaderType = "NONE";
  let headerText = "";
  let headerMediaHandle = "";
  let body = "";
  let footer = "";
  const buttons: TemplateButtonState[] = [];
  let fatalReason: string | null = null;
  const warnings: string[] = [];
  const addWarning = (message: string) => {
    if (!warnings.includes(message)) {
      warnings.push(message);
    }
  };
  let canEditHeader = true;
  let canEditButtons = true;

  const normalizedStatus = (template.status ?? "").toUpperCase();
  if (["PENDING", "IN_APPEAL"].includes(normalizedStatus)) {
    fatalReason =
      "Este modelo está em análise pela Meta. Aguarde a revisão ser concluída para tentar novamente.";
  }

  for (const component of template.components) {
    const type = (component.type ?? "").toUpperCase();

    if (type === "HEADER") {
      const format = (component.format ?? "TEXT").toUpperCase();
      if (format === "TEXT" && typeof component.text === "string") {
        headerType = "TEXT";
        headerText = component.text;
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
        headerType = format as TemplateHeaderType;
        headerMediaHandle = extractHeaderHandle(component);
        if (!headerMediaHandle) {
          addWarning("O cabeçalho de mídia não possui handle salvo. Informe um novo handle ao editar.");
        }
      } else {
        canEditHeader = false;
        addWarning("Formato de cabeçalho não suportado. O conteúdo será preservado na edição.");
      }
      continue;
    }

    if (type === "BODY") {
      if (body && !fatalReason) {
        fatalReason = "Modelos com múltiplos blocos de corpo não são suportados.";
      }
      if (typeof component.text === "string") {
        body = component.text;
      }
      continue;
    }

    if (type === "FOOTER") {
      if (typeof component.text === "string") {
        footer = component.text;
      }
      continue;
    }

    if (type === "BUTTONS") {
      const componentButtons = Array.isArray(component.buttons) ? component.buttons : [];

      for (const button of componentButtons) {
        const buttonType = (button?.type ?? "").toUpperCase();
        const text = typeof button?.text === "string" ? button.text : "";

        if (buttonType === "QUICK_REPLY") {
          buttons.push({ kind: "quick_reply", text });
          continue;
        }

        if (buttonType === "URL") {
          const url = typeof button?.url === "string" ? button.url : "";
          const example = Array.isArray(button?.example)
            ? (button.example as unknown[]).find((item) => typeof item === "string")
            : typeof button?.example === "string"
              ? button.example
              : "";
          buttons.push({ kind: "url", text, url, example: example ?? "" });
          continue;
        }

        if (buttonType === "PHONE_NUMBER") {
          const phoneNumber = typeof button?.phone_number === "string" ? button.phone_number : "";
          buttons.push({ kind: "phone", text, phoneNumber });
          continue;
        }

        canEditButtons = false;
        addWarning("Este modelo possui botões de um tipo que não pode ser editado pelo painel. Eles serão mantidos.");
      }

      if (componentButtons.length > META_TEMPLATE_LIMITS.buttonCount) {
        addWarning(
          `O modelo possui mais de ${META_TEMPLATE_LIMITS.buttonCount} botões. Considere revisar a configuração diretamente na Meta antes de editar aqui.`,
        );
      }

      continue;
    }

    if (!fatalReason) {
      fatalReason = "Componentes adicionais não são suportados neste editor.";
    }
  }

  if (!body && !fatalReason) {
    fatalReason = "Modelos sem corpo de texto não são suportados.";
  }

  return {
    formState: {
      name: template.name,
      language: template.language,
      category: resolveCategory(template.category),
      headerType,
      headerText,
      headerMediaHandle,
      body,
      footer,
      buttons,
    },
    isEditable: !fatalReason,
    fatalReason,
    warnings,
    canEditHeader,
    canEditButtons,
  };
};

const AdminMetaTemplatesManager = ({ templates, hasCredentials }: Props) => {
  const [items, setItems] = useState<AdminMetaTemplate[]>(() => sortTemplates(templates));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);
  const [formState, setFormState] = useState<TemplateFormState>(() => createEmptyFormState());
  const [formError, setFormError] = useState<string | null>(null);
  const [editorWarnings, setEditorWarnings] = useState<string[]>([]);
  const [editorCapabilities, setEditorCapabilities] = useState<{ header: boolean; buttons: boolean }>({
    header: true,
    buttons: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingHeader, setIsUploadingHeader] = useState(false);
  const [headerUploadError, setHeaderUploadError] = useState<string | null>(null);
  const [headerUploadInfo, setHeaderUploadInfo] = useState<TemplateMediaUpload | null>(null);
  const headerFileInputRef = useRef<HTMLInputElement | null>(null);
  const localHeaderPreviewUrlRef = useRef<string | null>(null);
  const [modalHeaderPreview, setModalHeaderPreview] = useState<{ url: string | null; error: string | null; isLoading: boolean }>({
    url: null,
    error: null,
    isLoading: false,
  });
  const [templateHeaderPreviews, setTemplateHeaderPreviews] = useState<Record<string, HeaderPreviewState>>({});

  useEffect(() => {
    setItems(sortTemplates(templates));
  }, [templates]);

  const credentialWarning = useMemo(() => {
    if (hasCredentials) {
      return null;
    }
    return (
      <Alert variant="warning" className="mb-0">
        Cadastre o access token e o Business Account ID no webhook administrativo para importar
        e criar modelos diretamente pelo painel.
      </Alert>
    );
  }, [hasCredentials]);

  const handleSync = async () => {
    if (!hasCredentials) {
      setFeedback({
        type: "danger",
        message: "Configure o webhook da Meta antes de sincronizar os modelos.",
      });
      return;
    }

    setIsSyncing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/meta/templates/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload?.message ?? "Não foi possível sincronizar os modelos.";
        throw new Error(message);
      }

      setItems(Array.isArray(payload?.templates) ? sortTemplates(payload.templates) : []);
      setFeedback({
        type: "success",
        message: payload?.message ?? "Modelos sincronizados com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao sincronizar modelos", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Ocorreu um erro inesperado ao sincronizar os modelos.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const openCreateModal = () => {
    setModalMode("create");
    setCurrentTemplateId(null);
    setFormState(createEmptyFormState());
    setFormError(null);
    setEditorWarnings([]);
    setEditorCapabilities({ header: true, buttons: true });
    setHeaderUploadError(null);
    setHeaderUploadInfo(null);
    if (localHeaderPreviewUrlRef.current) {
      URL.revokeObjectURL(localHeaderPreviewUrlRef.current);
      localHeaderPreviewUrlRef.current = null;
    }
    setModalHeaderPreview({ url: null, error: null, isLoading: false });
    setIsModalOpen(true);
  };

  const openEditModal = (template: AdminMetaTemplate) => {
    const metadata = computeEditorMetadata(template);
    if (!metadata.isEditable) {
      setFeedback({
        type: "danger",
        message: metadata.fatalReason ?? "Este modelo não pode ser editado pelo painel.",
      });
      return;
    }

    setModalMode("edit");
    setCurrentTemplateId(template.templateId);
    setFormState(metadata.formState);
    setFormError(null);
    setEditorWarnings(metadata.warnings);
    setEditorCapabilities({
      header: metadata.canEditHeader,
      buttons: metadata.canEditButtons,
    });
    setHeaderUploadError(null);
    setHeaderUploadInfo(null);
    if (localHeaderPreviewUrlRef.current) {
      URL.revokeObjectURL(localHeaderPreviewUrlRef.current);
      localHeaderPreviewUrlRef.current = null;
    }
    setModalHeaderPreview({ url: null, error: null, isLoading: false });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormError(null);
    setEditorWarnings([]);
    setEditorCapabilities({ header: true, buttons: true });
    setCurrentTemplateId(null);
    setIsSubmitting(false);
    setIsUploadingHeader(false);
    setHeaderUploadError(null);
    setHeaderUploadInfo(null);
    if (headerFileInputRef.current) {
      headerFileInputRef.current.value = "";
    }
    if (localHeaderPreviewUrlRef.current) {
      URL.revokeObjectURL(localHeaderPreviewUrlRef.current);
      localHeaderPreviewUrlRef.current = null;
    }
    setModalHeaderPreview({ url: null, error: null, isLoading: false });
  };

  const handleFieldChange = (field: keyof TemplateFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      setFormState((previous) => ({
        ...previous,
        [field]: value,
      }));
    };

  const handleHeaderTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (modalMode === "edit" && !editorCapabilities.header) {
      return;
    }
    const value = event.currentTarget.value as TemplateHeaderType;
    setHeaderUploadError(null);
    setHeaderUploadInfo(null);
    if (headerFileInputRef.current) {
      headerFileInputRef.current.value = "";
    }
    setFormState((previous) => {
      if (value === "TEXT") {
        return {
          ...previous,
          headerType: value,
          headerText: previous.headerText,
          headerMediaHandle: "",
        };
      }
      if (value === "NONE") {
        return {
          ...previous,
          headerType: value,
          headerText: "",
          headerMediaHandle: "",
        };
      }
      return {
        ...previous,
        headerType: value,
        headerText: "",
      headerMediaHandle: previous.headerMediaHandle,
      };
    });
  };

  const triggerHeaderFileDialog = () => {
    if (modalMode === "edit" && !editorCapabilities.header) {
      return;
    }
    headerFileInputRef.current?.click();
  };

  const handleHeaderFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    if (!MEDIA_HEADER_TYPES.includes(formState.headerType)) {
      setHeaderUploadError("Selecione o tipo de cabeçalho de mídia antes de enviar o arquivo.");
      event.target.value = "";
      return;
    }

    try {
      setIsUploadingHeader(true);
      setHeaderUploadError(null);

      if (localHeaderPreviewUrlRef.current) {
        URL.revokeObjectURL(localHeaderPreviewUrlRef.current);
        localHeaderPreviewUrlRef.current = null;
      }

      const localUrl = URL.createObjectURL(file);
      localHeaderPreviewUrlRef.current = localUrl;
      setModalHeaderPreview({ url: localUrl, error: null, isLoading: true });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", HEADER_TYPE_TO_MEDIA_KIND[formState.headerType]);

      const response = await fetch("/api/admin/meta/uploads", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível enviar o arquivo.";
        throw new Error(message);
      }

      const media = payload?.media as TemplateMediaUpload | null;
      if (!media?.handle) {
        throw new Error("Meta não retornou a referência do arquivo.");
      }

      setHeaderUploadInfo(media);
      setFormState((previous) => ({
        ...previous,
        headerMediaHandle: media.handle,
      }));
    } catch (error) {
      console.error("Erro ao enviar mídia do cabeçalho", error);
      setHeaderUploadError(
        error instanceof Error ? error.message : "Não foi possível enviar o arquivo.",
      );
      setModalHeaderPreview({
        url: localHeaderPreviewUrlRef.current,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar o arquivo.",
        isLoading: false,
      });
    } finally {
      setIsUploadingHeader(false);
      event.target.value = "";
    }
  };

  const fetchHeaderPreviewUrl = async (handle: string): Promise<string> => {
    if (!handle) {
      throw new Error("Handle inválido.");
    }
    if (isHttpUrl(handle)) {
      return handle;
    }

    const response = await fetch(
      `/api/admin/meta/uploads/preview?handle=${encodeURIComponent(handle)}`,
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok || typeof payload?.url !== "string") {
      throw new Error(
        payload?.message ?? "Não foi possível carregar a mídia armazenada na Meta.",
      );
    }

    return payload.url as string;
  };

  const handleTemplateHeaderPreview = async (
    templateId: string,
    info: { kind: TemplateHeaderType; handle: string | null },
  ) => {
    if (!info.handle) {
      setTemplateHeaderPreviews((previous) => ({
        ...previous,
        [templateId]: {
          kind: info.kind,
          url: null,
          error: "Este modelo não possui handle configurado.",
          isLoading: false,
        },
      }));
      return;
    }

    const current = templateHeaderPreviews[templateId];
    if (current?.isLoading) {
      return;
    }
    if (current?.url && !current.error) {
      return;
    }

    setTemplateHeaderPreviews((previous) => ({
      ...previous,
      [templateId]: {
        kind: info.kind,
        url: current?.url ?? null,
        error: null,
        isLoading: true,
      },
    }));

    try {
      const url = await fetchHeaderPreviewUrl(info.handle);
      setTemplateHeaderPreviews((previous) => ({
        ...previous,
        [templateId]: {
          kind: info.kind,
          url,
          error: null,
          isLoading: false,
        },
      }));
    } catch (error) {
      setTemplateHeaderPreviews((previous) => ({
        ...previous,
        [templateId]: {
          kind: info.kind,
          url: null,
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível carregar a mídia armazenada na Meta.",
          isLoading: false,
        },
      }));
    }
  };

  const handleCategoryChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value as MetaTemplateCategory;
    setFormState((previous) => ({
      ...previous,
      category: resolveCategory(value),
    }));
  };

  const handleRemoveButton = (index: number) => {
    if (!editorCapabilities.buttons) {
      return;
    }

    setFormState((previous) => {
      const next = previous.buttons.filter((_, buttonIndex) => buttonIndex !== index);
      return { ...previous, buttons: next };
    });
  };

  const handleAddButton = () => {
    if (!editorCapabilities.buttons) {
      return;
    }

    setFormState((previous) => {
      if (previous.buttons.length >= META_TEMPLATE_LIMITS.buttonCount) {
        return previous;
      }

      return {
        ...previous,
        buttons: [...previous.buttons, { kind: "quick_reply", text: "" }],
      };
    });
  };

  useEffect(() => {
    return () => {
      if (localHeaderPreviewUrlRef.current) {
        URL.revokeObjectURL(localHeaderPreviewUrlRef.current);
        localHeaderPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isModalOpen) {
      setModalHeaderPreview({ url: null, error: null, isLoading: false });
      return;
    }

    if (!isMediaHeaderType(formState.headerType)) {
      setModalHeaderPreview({ url: null, error: null, isLoading: false });
      return;
    }

    const handle = formState.headerMediaHandle.trim();
    if (!handle) {
      setModalHeaderPreview({ url: null, error: null, isLoading: false });
      return;
    }

    let cancelled = false;

    const resolvePreview = async () => {
      setModalHeaderPreview((previous) => ({ ...previous, isLoading: true, error: null }));
      try {
        const url = await fetchHeaderPreviewUrl(handle);
        if (!cancelled) {
          if (localHeaderPreviewUrlRef.current) {
            URL.revokeObjectURL(localHeaderPreviewUrlRef.current);
            localHeaderPreviewUrlRef.current = null;
          }
          setModalHeaderPreview({ url, error: null, isLoading: false });
        }
      } catch (error) {
        if (!cancelled) {
          setModalHeaderPreview({
            url: localHeaderPreviewUrlRef.current,
            error:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar a mídia armazenada na Meta.",
            isLoading: false,
          });
        }
      }
    };

    void resolvePreview();

    return () => {
      cancelled = true;
    };
  }, [isModalOpen, formState.headerType, formState.headerMediaHandle]);

  const handleButtonKindChange = (index: number) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      if (!editorCapabilities.buttons) {
        return;
      }
      const kind = event.currentTarget.value as TemplateButtonState["kind"];
      setFormState((previous) => {
        const next = previous.buttons.map((button, buttonIndex) => {
          if (buttonIndex !== index) {
            return button;
          }
          if (kind === "quick_reply") {
            return { kind, text: button.text ?? "" };
          }
          if (kind === "url") {
            return {
              kind,
              text: button.text ?? "",
              url: button.url ?? "",
              example: button.example ?? "",
            };
          }
          return {
            kind,
            text: button.text ?? "",
            phoneNumber: button.phoneNumber ?? "",
          };
        });
        return { ...previous, buttons: next };
      });
    };

  const handleButtonFieldChange = (index: number, field: keyof TemplateButtonState) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!editorCapabilities.buttons) {
        return;
      }
      const value = event.currentTarget.value;
      setFormState((previous) => {
        const next = previous.buttons.map((button, buttonIndex) => {
          if (buttonIndex !== index) {
            return button;
          }
          return { ...button, [field]: value };
        });
        return { ...previous, buttons: next };
      });
    };

  const sanitizeSubmitPayload = () => {
    const preserveHeader = modalMode === "edit" && !editorCapabilities.header;
    const preserveButtons = modalMode === "edit" && !editorCapabilities.buttons;

    const payload: Record<string, unknown> = {
      language: formState.language.trim(),
      category: formState.category,
      body: formState.body.trim(),
      footer: formState.footer.trim() || null,
      preserveHeader,
      preserveButtons,
    };

    if (!preserveHeader) {
      payload.headerType = formState.headerType;
      if (formState.headerType === "TEXT") {
        payload.header = formState.headerText.trim();
      } else if (formState.headerType === "NONE") {
        payload.header = null;
      } else {
        payload.headerMediaHandle = formState.headerMediaHandle.trim();
      }
    }

    if (!preserveButtons) {
      const buttonsPayload = formState.buttons
        .map((button) => {
          if (button.kind === "quick_reply") {
            const text = button.text.trim();
            return text
              ? {
                  kind: "quick_reply",
                  text,
                }
              : null;
          }
          if (button.kind === "url") {
            const text = button.text.trim();
            const url = (button.url ?? "").trim();
            if (!text && !url) {
              return null;
            }
            const example = (button.example ?? "").trim();
            return {
              kind: "url",
              text,
              url,
              example: example || undefined,
            };
          }
          const text = button.text.trim();
          const phoneNumber = (button.phoneNumber ?? "").trim();
          if (!text && !phoneNumber) {
            return null;
          }
          return {
            kind: "phone",
            text,
            phoneNumber,
          };
        })
        .filter((entry): entry is Record<string, unknown> => entry !== null);

      payload.buttons = buttonsPayload;
    }

    if (modalMode === "create") {
      payload.name = formState.name.trim();
    } else if (formState.name.trim()) {
      payload.name = formState.name.trim();
    }

    return payload;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasCredentials) {
      setFormError("Configure o webhook da Meta antes de salvar o modelo.");
      return;
    }

    if (modalMode === "create" && !formState.name.trim()) {
      setFormError(
        "Informe um nome para o modelo utilizando letras minúsculas, números ou underscore.",
      );
      return;
    }

    if (!formState.body.trim()) {
      setFormError("Informe o conteúdo do corpo do modelo.");
      return;
    }

    const preserveHeader = modalMode === "edit" && !editorCapabilities.header;
    if (!preserveHeader) {
      if (formState.headerType === "TEXT" && !formState.headerText.trim()) {
        setFormError("Informe o texto do cabeçalho ou selecione 'Sem cabeçalho'.");
        return;
      }
      if (
        (formState.headerType === "IMAGE" || formState.headerType === "VIDEO" || formState.headerType === "DOCUMENT") &&
        !formState.headerMediaHandle.trim()
      ) {
        setFormError("Informe o handle do arquivo utilizado no cabeçalho.");
        return;
      }
    }

    if (editorCapabilities.buttons) {
      if (formState.buttons.length > META_TEMPLATE_LIMITS.buttonCount) {
        setFormError(`Adicione no máximo ${META_TEMPLATE_LIMITS.buttonCount} botões.`);
        return;
      }

      let quickReplyCount = 0;
      let ctaCount = 0;

      for (let index = 0; index < formState.buttons.length; index += 1) {
        const button = formState.buttons[index];
        const text = button.text.trim();
        if (!text) {
          setFormError(`Informe o texto do botão ${index + 1}.`);
          return;
        }
        if (text.length > META_TEMPLATE_LIMITS.buttonText) {
          setFormError(
            `O texto do botão ${index + 1} pode ter no máximo ${META_TEMPLATE_LIMITS.buttonText} caracteres.`,
          );
          return;
        }

        if (button.kind === "quick_reply") {
          quickReplyCount += 1;
        } else if (button.kind === "url") {
          const url = (button.url ?? "").trim();
          if (!url) {
            setFormError(`Informe a URL do botão ${index + 1}.`);
            return;
          }
          try {
            const parsed = new URL(url);
            if (!parsed.protocol.startsWith("http")) {
              throw new Error("invalid");
            }
          } catch {
            setFormError(`Informe uma URL válida para o botão ${index + 1}.`);
            return;
          }
          ctaCount += 1;
        } else if (button.kind === "phone") {
          const phone = (button.phoneNumber ?? "").trim();
          if (!phone) {
            setFormError(`Informe o telefone do botão ${index + 1}.`);
            return;
          }
          if (!/^\+?[0-9]{6,15}$/.test(phone)) {
            setFormError(`Informe um telefone válido para o botão ${index + 1}.`);
            return;
          }
          ctaCount += 1;
        }
      }

      if (quickReplyCount > 0 && ctaCount > 0) {
        setFormError(
          "Não é possível combinar botões de resposta rápida com botões de link ou telefone no mesmo modelo.",
        );
        return;
      }

      if (ctaCount > 2) {
        setFormError("Adicione no máximo 2 botões de chamada para ação (link/telefone).");
        return;
      }
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const payload = sanitizeSubmitPayload();
      const endpoint =
        modalMode === "create"
          ? "/api/admin/meta/templates"
          : `/api/admin/meta/templates/${encodeURIComponent(currentTemplateId ?? "")}`;

      const method = modalMode === "create" ? "POST" : "PUT";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const message = data?.message ?? "Não foi possível salvar o modelo.";
        throw new Error(message);
      }

      if (data?.template) {
        setItems((previous) => {
          const next = modalMode === "create"
            ? [...previous, data.template as AdminMetaTemplate]
            : previous.map((item) =>
                item.templateId === data.template.templateId ? (data.template as AdminMetaTemplate) : item,
              );
          return sortTemplates(next);
        });
      }

      setFeedback({
        type: "success",
        message: data?.message ?? "Modelo salvo com sucesso.",
      });
      closeModal();
    } catch (error) {
      console.error("Erro ao salvar modelo", error);
      setFormError(
        error instanceof Error ? error.message : "Não foi possível salvar o modelo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderEditButton = (template: AdminMetaTemplate) => {
    const metadata = computeEditorMetadata(template);
    const lacksCredentials = !hasCredentials;
    const disabled =
      lacksCredentials || !metadata.isEditable || isSyncing;

    let tooltipMessage: string | null = null;

    if (lacksCredentials) {
      tooltipMessage = "Configure o webhook da Meta antes de editar os modelos.";
    } else if (!metadata.isEditable) {
      tooltipMessage = metadata.fatalReason ?? "Este modelo não pode ser editado pelo painel.";
    } else if (metadata.warnings.length > 0) {
      tooltipMessage = metadata.warnings.join(" ");
    }

    const buttonElement = (
      <Button
        size="sm"
        variant="outline-primary"
        onClick={() => openEditModal(template)}
        disabled={disabled}
      >
        Editar
      </Button>
    );

    if (!tooltipMessage) {
      return buttonElement;
    }

    const overlay = (
      <Tooltip id={`template-edit-info-${template.templateId}`}>
        {tooltipMessage}
      </Tooltip>
    );

    if (disabled) {
      return (
        <OverlayTrigger placement="top" overlay={overlay}>
          <span className="d-inline-block">{buttonElement}</span>
        </OverlayTrigger>
      );
    }

    return (
      <OverlayTrigger placement="top" overlay={overlay}>
        {buttonElement}
      </OverlayTrigger>
    );
  };

  const renderTemplateRows = () => {
    if (items.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="text-center text-secondary py-4">
            Nenhum modelo importado até o momento. Utilize o botão &quot;Sincronizar modelos&quot; para
            carregar os modelos disponíveis na Meta.
          </td>
        </tr>
      );
    }

    return items.map((template) => {
      const summary = summarizeComponents(template);
      const headerMediaInfo = summary.headerInfo;
      const previewState = templateHeaderPreviews[template.templateId];

      return (
        <tr key={template.templateId}>
          <td>
            <div className="fw-semibold d-flex flex-column gap-1">
              <span>{template.name}</span>
              <small className="text-secondary">{template.templateId}</small>
            </div>
          </td>
          <td>
            <div className="d-flex flex-column gap-1">
              <span>{template.language}</span>
              <small className="text-secondary">{template.category ?? "—"}</small>
            </div>
          </td>
          <td>
            <div className="d-flex flex-column gap-1">
              <Badge bg={getStatusVariant(template.status)}>{template.status}</Badge>
              {template.qualityScore && (
                <Badge bg={getQualityVariant(template.qualityScore)}>
                  Qualidade: {template.qualityScore}
                </Badge>
              )}
            </div>
          </td>
          <td>
            <div className="d-flex flex-column gap-1">
              {summary.header && (
                <small className="text-secondary">
                  <strong>Header:</strong> {summary.header}
                </small>
              )}
              {headerMediaInfo && isMediaHeaderType(headerMediaInfo.kind) && (
                <div className="d-flex flex-column gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleTemplateHeaderPreview(template.templateId, headerMediaInfo)}
                      disabled={previewState?.isLoading || !headerMediaInfo.handle}
                    >
                      {previewState?.isLoading ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" /> Carregando...
                        </>
                      ) : (
                        "Ver mídia"
                      )}
                    </Button>
                    {previewState?.error && (
                      <small className="text-danger">{previewState.error}</small>
                    )}
                  </div>
                  {previewState?.url && (
                    <div className="border rounded p-2 bg-light-subtle">
                      {renderHeaderPreview(headerMediaInfo.kind, previewState.url, { size: "compact" })}
                    </div>
                  )}
                </div>
              )}
              <small className="text-secondary">
                <strong>Body:</strong>{" "}
                <span title={summary.body}>{summary.body || "—"}</span>
              </small>
              {summary.footer && (
                <small className="text-secondary">
                  <strong>Footer:</strong> {summary.footer}
                </small>
              )}
              {summary.buttons.length > 0 && (
                <small className="text-secondary">
                  <strong>Botões:</strong> {summary.buttons.join(", ")}
                </small>
              )}
              {template.rejectedReason && (
                <small className="text-danger">
                  Motivo da Meta: {template.rejectedReason}
                </small>
              )}
            </div>
          </td>
          <td>
            <div className="d-flex flex-column gap-1">
              {template.metaUpdatedAt && (
                <small className="text-secondary">
                  Meta: {new Date(template.metaUpdatedAt).toLocaleString()}
                </small>
              )}
              {template.lastSyncedAt && (
                <small className="text-secondary">
                  Sincronizado: {new Date(template.lastSyncedAt).toLocaleString()}
                </small>
              )}
            </div>
          </td>
          <td className="text-end">
            {renderEditButton(template)}
          </td>
        </tr>
      );
    });
  };

  return (
    <div className="d-flex flex-column gap-4">
      <Card>
        <Card.Header>
          <Card.Title as="h2" className="h5 mb-0">
            Modelos da Meta
          </Card.Title>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-3">
          <p className="text-secondary mb-0">
            Importe todos os modelos de mensagem cadastrados na Meta, crie novas variações e mantenha o
            catálogo sempre atualizado para campanhas de envio em massa.
          </p>

          {credentialWarning}

          <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

          <div className="d-flex flex-wrap gap-2">
            <Button onClick={handleSync} disabled={isSyncing || !hasCredentials}>
              {isSyncing ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" /> Sincronizando...
                </>
              ) : (
                "Sincronizar modelos"
              )}
            </Button>
            <Button
              variant="outline-primary"
              onClick={openCreateModal}
              disabled={!hasCredentials || isSyncing}
            >
              Novo modelo
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title as="h2" className="h5 mb-0">
            Modelos cadastrados
          </Card.Title>
        </Card.Header>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Idioma / Categoria</th>
                <th>Status</th>
                <th>Conteúdo</th>
                <th>Atualizações</th>
                <th className="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>{renderTemplateRows()}</tbody>
          </Table>
        </Card.Body>
      </Card>

      <Modal show={isModalOpen} onHide={closeModal} size="lg" backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>
            {modalMode === "create" ? "Criar novo modelo" : "Editar modelo"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            {formError && (
              <Alert variant="danger" className="mb-0">
                {formError}
              </Alert>
            )}

            {editorWarnings.length > 0 && (
              <Alert variant="info" className="mb-0">
                <ul className="mb-0 ps-3">
                  {editorWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <Form.Group controlId="meta-template-name">
              <Form.Label>Nome do modelo</Form.Label>
              <Form.Control
                value={formState.name}
                onChange={handleFieldChange("name")}
                placeholder="ex: mensagem_boas_vindas"
                disabled={modalMode === "edit"}
                maxLength={60}
                required={modalMode === "create"}
              />
              <Form.Text className="text-secondary">
                Use letras minúsculas, números e underscore. Após aprovado pela Meta o nome não pode ser alterado.
              </Form.Text>
            </Form.Group>

            <div className="row">
              <div className="col-12 col-md-6">
                <Form.Group controlId="meta-template-language">
                  <Form.Label>Idioma</Form.Label>
                  <Form.Control
                    value={formState.language}
                    onChange={handleFieldChange("language")}
                    placeholder="pt_BR"
                    maxLength={12}
                    required
                  />
                  <Form.Text className="text-secondary">
                    Informe o código do idioma no formato ll_CC (ex: pt_BR, en_US).
                  </Form.Text>
                </Form.Group>
              </div>
              <div className="col-12 col-md-6">
                <Form.Group controlId="meta-template-category">
                  <Form.Label>Categoria</Form.Label>
                  <Form.Select value={formState.category} onChange={handleCategoryChange} required>
                    {META_TEMPLATE_CATEGORIES.map((category) => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>
            </div>

            <Form.Group controlId="meta-template-header-type">
              <Form.Label>Tipo de cabeçalho</Form.Label>
              <Form.Select
                value={formState.headerType}
                onChange={handleHeaderTypeChange}
                disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.header)}
              >
                <option value="NONE">Sem cabeçalho</option>
                <option value="TEXT">Texto</option>
                <option value="IMAGE">Imagem</option>
                <option value="VIDEO">Vídeo</option>
                <option value="DOCUMENT">Documento</option>
              </Form.Select>
              <Form.Text className="text-secondary">
                {modalMode === "edit" && !editorCapabilities.header
                  ? "O cabeçalho atual será preservado porque utiliza um formato não editável aqui."
                  : "Selecione o formato aceito pela Meta. Headers de mídia exigem o handle do arquivo já enviado à API."}
              </Form.Text>
            </Form.Group>

            {formState.headerType === "TEXT" && (
              <Form.Group controlId="meta-template-header-text">
                <Form.Label>Texto do cabeçalho</Form.Label>
                <Form.Control
                  value={formState.headerText}
                  onChange={handleFieldChange("headerText")}
                  placeholder="Saudação do cabeçalho"
                  maxLength={META_TEMPLATE_LIMITS.header}
                  disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.header)}
                />
                <Form.Text className="text-secondary">
                  Até {META_TEMPLATE_LIMITS.header} caracteres. Utilize variáveis como <code>{`{{1}}`}</code> se necessário.
                </Form.Text>
              </Form.Group>
            )}

            {formState.headerType !== "TEXT" && formState.headerType !== "NONE" && (
              <Form.Group controlId="meta-template-header-media">
                <Form.Label>
                  Arquivo do cabeçalho ({resolveHeaderMediaLabel(formState.headerType)})
                </Form.Label>
                <div className="d-flex flex-column gap-2">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={triggerHeaderFileDialog}
                      disabled={
                        isSubmitting ||
                        isUploadingHeader ||
                        (modalMode === "edit" && !editorCapabilities.header)
                      }
                    >
                      Selecionar arquivo
                    </Button>
                    {isUploadingHeader && <Spinner animation="border" size="sm" />}
                    {headerUploadInfo && (
                      <div className="d-flex flex-column">
                        <small className="text-success">
                          Upload: {headerUploadInfo.fileName} ({headerUploadInfo.mimeType})
                        </small>
                        <small className="text-secondary">
                          Handle: <code>{headerUploadInfo.handle}</code>
                        </small>
                      </div>
                    )}
                  </div>

                  {headerUploadError && (
                    <Alert variant="danger" className="mb-0 py-2 px-3">
                      {headerUploadError}
                    </Alert>
                  )}

                  <Form.Control
                    value={formState.headerMediaHandle}
                    onChange={handleFieldChange("headerMediaHandle")}
                    placeholder="Ex.: <handle retornado pela Meta>"
                    disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.header)}
                  />
                  <Form.Text className="text-secondary">
                    Informe o handle retornado pela Meta ao enviar o arquivo. Use o botão acima para realizar o upload direto pelo painel.
                  </Form.Text>
                  {formState.headerMediaHandle && (
                    <Form.Text className="text-secondary">
                      Handle atual: <code>{formState.headerMediaHandle}</code>
                    </Form.Text>
                  )}
                  {modalHeaderPreview.isLoading && (
                    <div className="d-flex align-items-center gap-2 text-secondary">
                      <Spinner animation="border" size="sm" />
                      <small>Carregando pré-visualização...</small>
                    </div>
                  )}
                  {modalHeaderPreview.error && !modalHeaderPreview.isLoading && (
                    <Alert variant="warning" className="mb-0 py-2 px-3">
                      {modalHeaderPreview.error}
                    </Alert>
                  )}
                  {modalHeaderPreview.url && (
                    <div className="border rounded p-2 bg-light-subtle">
                      {renderHeaderPreview(formState.headerType, modalHeaderPreview.url, {
                        size: "full",
                      })}
                    </div>
                  )}
                </div>
                <input
                  ref={headerFileInputRef}
                  type="file"
                  accept={
                    HEADER_ACCEPT_BY_KIND[
                      formState.headerType as keyof typeof HEADER_ACCEPT_BY_KIND
                    ] ?? undefined
                  }
                  className="d-none"
                  onChange={handleHeaderFileChange}
                />
              </Form.Group>
            )}

            <Form.Group controlId="meta-template-body">
              <Form.Label>Corpo da mensagem</Form.Label>
              <Form.Control
                as="textarea"
                rows={5}
                value={formState.body}
                onChange={handleFieldChange("body")}
                placeholder="Conteúdo principal do modelo"
                maxLength={META_TEMPLATE_LIMITS.body}
                required
              />
              <Form.Text className="text-secondary">
                Utilize variáveis com <code>{`{{1}}`}</code>, <code>{`{{2}}`}</code> conforme a necessidade. Limite de {META_TEMPLATE_LIMITS.body} caracteres.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="meta-template-footer">
              <Form.Label>Rodapé (opcional)</Form.Label>
              <Form.Control
                value={formState.footer}
                onChange={handleFieldChange("footer")}
                placeholder="Mensagem final"
                maxLength={META_TEMPLATE_LIMITS.footer}
              />
              <Form.Text className="text-secondary">
                Até {META_TEMPLATE_LIMITS.footer} caracteres.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="meta-template-buttons">
              <Form.Label>Botões (opcionais)</Form.Label>
              <div className="d-flex flex-column gap-3">
                {formState.buttons.map((button, index) => (
                  <div key={`template-button-${index}`} className="border rounded p-3 d-flex flex-column gap-2">
                    <div className="d-flex flex-column flex-lg-row gap-2">
                      <Form.Select
                        value={button.kind}
                        onChange={handleButtonKindChange(index)}
                        disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.buttons)}
                        className="w-100"
                      >
                        <option value="quick_reply">Resposta rápida</option>
                        <option value="url">Abrir link</option>
                        <option value="phone">Ligar</option>
                      </Form.Select>
                      <Form.Control
                        value={button.text}
                        onChange={handleButtonFieldChange(index, "text")}
                        placeholder="Texto do botão"
                        maxLength={META_TEMPLATE_LIMITS.buttonText}
                        disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.buttons)}
                      />
                    </div>

                    {button.kind === "url" && (
                      <div className="d-flex flex-column flex-lg-row gap-2">
                        <Form.Control
                          value={button.url ?? ""}
                          onChange={handleButtonFieldChange(index, "url")}
                          placeholder="https://exemplo.com"
                          disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.buttons)}
                        />
                        <Form.Control
                          value={button.example ?? ""}
                          onChange={handleButtonFieldChange(index, "example")}
                          placeholder="Exemplo utilizado pela Meta (opcional)"
                          disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.buttons)}
                        />
                      </div>
                    )}

                    {button.kind === "phone" && (
                      <Form.Control
                        value={button.phoneNumber ?? ""}
                        onChange={handleButtonFieldChange(index, "phoneNumber")}
                        placeholder="Ex.: +5511999999999"
                        disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.buttons)}
                      />
                    )}

                    <div className="d-flex justify-content-end">
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => handleRemoveButton(index)}
                        disabled={isSubmitting || (modalMode === "edit" && !editorCapabilities.buttons)}
                      >
                        Remover botão
                      </Button>
                    </div>
                  </div>
                ))}

                {formState.buttons.length < META_TEMPLATE_LIMITS.buttonCount && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleAddButton}
                    disabled={
                      isSubmitting ||
                      (modalMode === "edit" && !editorCapabilities.buttons)
                    }
                    className="align-self-start"
                  >
                    Adicionar botão
                  </Button>
                )}

                <Form.Text className="text-secondary">
                  {modalMode === "edit" && !editorCapabilities.buttons
                    ? "O modelo possui botões com configurações avançadas. Eles serão mantidos sem alterações."
                    : `Combine até ${META_TEMPLATE_LIMITS.buttonCount} botões. É permitido usar apenas respostas rápidas ou até 2 botões de chamada para ação (link/telefone).`}
                </Form.Text>
              </div>
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="outline-secondary" onClick={closeModal} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Salvando...
                  </>
                ) : (
                  "Salvar modelo"
                )}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default AdminMetaTemplatesManager;
