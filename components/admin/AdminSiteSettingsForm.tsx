"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { termsContentToHtml } from "lib/terms";

import type {
  AdminHomepageFeature,
  AdminOfficialGroupCandidate,
  AdminOfficialGroupLink,
  AdminSiteSettings,
  AdminSiteSettingsPayload,
} from "types/admin-site";
import type { BotInstanceAdminSummary } from "types/bot-instances";

interface AdminSiteSettingsFormProps {
  initialSettings: AdminSiteSettings;
  availableInstances: BotInstanceAdminSummary[];
  availableGroups: AdminOfficialGroupCandidate[];
}

type FormState = AdminSiteSettingsPayload & {
  logoUrl: string | null;
  faviconUrl: string | null;
  seoImageUrl: string | null;
  heroImageUrl: string | null;
  workflowImageUrl: string | null;
  emailVerificationApiKeysText: string;
  seoKeywordsText: string;
  seoHighlightKeywordsText: string;
};

type FeedbackState = { type: "success" | "error"; message: string } | null;

type ViewId = "branding" | "verification" | "homepage" | "officialGroup" | "seo" | "terms";

type ViewOption = {
  id: ViewId;
  label: string;
  description: string;
};

const VIEW_OPTIONS: readonly ViewOption[] = [
  {
    id: "branding",
    label: "Identidade visual",
    description:
      "Defina nome, slogan, logo e dados de contato exibidos em todas as páginas do site.",
  },
  {
    id: "verification",
    label: "Verificação de e-mail",
    description:
      "Configure a validação de e-mails com a API Email-Validator da Byteplant.",
  },
  {
    id: "homepage",
    label: "Página inicial",
    description: "Ajuste o destaque principal da home com título, descrição e chamada para ação.",
  },
  {
    id: "officialGroup",
    label: "Grupo oficial",
    description:
      "Escolha a instância administradora e mantenha atualizado o link público do grupo oficial.",
  },
  {
    id: "seo",
    label: "SEO e rodapé",
    description: "Configure metadados de busca e o texto institucional mostrado no rodapé.",
  },
  {
    id: "terms",
    label: "Termos e políticas",
    description:
      "Centralize os termos de uso exibidos no site público, incluindo política de reembolso e aviso de riscos.",
  },
];

const mapSettingsToFormState = (settings: AdminSiteSettings): FormState => ({
  siteName: settings.siteName,
  tagline: settings.tagline,
  logoUrl: settings.logoUrl,
  faviconUrl: settings.faviconUrl,
  supportEmail: settings.supportEmail,
  supportPhone: settings.supportPhone,
  supportUrl: settings.supportUrl,
  supportChatMode: settings.supportChannel,
  supportWhatsappNumber: settings.supportWhatsappNumber,
  userPanelBanners:
    settings.userPanelBanners.length > 0
      ? [...settings.userPanelBanners].sort((a, b) => a.order - b.order).map((banner) => ({ ...banner }))
      : [],
  testGroups:
    settings.testGroups.length > 0
      ? settings.testGroups.map((group) => ({ ...group }))
      : [],
  officialGroups:
    settings.officialGroups.length > 0
      ? settings.officialGroups.map((group) => ({ ...group }))
      : [],
  officialGroupInstanceId: settings.officialGroupInstanceId,
  officialGroupJid: settings.officialGroupJid,
  emailVerificationEnabled: settings.emailVerificationEnabled,
  emailVerificationApiKeys:
    settings.emailVerificationApiKeys.length > 0
      ? [...settings.emailVerificationApiKeys]
      : [],
  emailVerificationApiKeysText: settings.emailVerificationApiKeys.join("\n"),
  heroBadge: settings.heroBadge,
  heroTitle: settings.heroTitle,
  heroSubtitle: settings.heroSubtitle,
  heroButtonLabel: settings.heroButtonLabel,
  heroButtonUrl: settings.heroButtonUrl,
  heroSecondaryButtonLabel: settings.heroSecondaryButtonLabel,
  heroSecondaryButtonUrl: settings.heroSecondaryButtonUrl,
  heroImageUrl: settings.heroImageUrl,
  featuresTitle: settings.featuresTitle,
  featuresSubtitle: settings.featuresSubtitle,
  features:
    settings.features.length > 0
      ? settings.features.map((feature) => ({ ...feature }))
      : [],
  workflowTitle: settings.workflowTitle,
  workflowDescription: settings.workflowDescription,
  workflowBullets:
    settings.workflowBullets.length > 0 ? [...settings.workflowBullets] : [],
  workflowImageUrl: settings.workflowImageUrl,
  ctaTitle: settings.ctaTitle,
  ctaDescription: settings.ctaDescription,
  ctaButtonLabel: settings.ctaButtonLabel,
  ctaButtonUrl: settings.ctaButtonUrl,
  seoTitle: settings.seoTitle,
  seoDescription: settings.seoDescription,
  seoImageUrl: settings.seoImageUrl,
  footerText: settings.footerText,
  seoKeywords: settings.seoKeywords.length > 0 ? [...settings.seoKeywords] : [],
  seoHighlightKeywords:
    settings.seoHighlightKeywords.length > 0 ? [...settings.seoHighlightKeywords] : [],
  seoKeywordsText: settings.seoKeywords.join("\n"),
  seoHighlightKeywordsText: settings.seoHighlightKeywords.join("\n"),
  termsContent: settings.termsContent,
});

const AdminSiteSettingsForm = ({
  initialSettings,
  availableInstances,
  availableGroups,
}: AdminSiteSettingsFormProps) => {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState>(() => mapSettingsToFormState(initialSettings));
  const [persistedSettings, setPersistedSettings] = useState<AdminSiteSettings>(initialSettings);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [activeView, setActiveView] = useState<ViewId>("branding");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [removeFavicon, setRemoveFavicon] = useState(false);
  
  const [seoImageFile, setSeoImageFile] = useState<File | null>(null);
  const [seoImagePreview, setSeoImagePreview] = useState<string | null>(null);
  const [removeSeoImage, setRemoveSeoImage] = useState(false);
  const [heroImageFile, setHeroImageFile] = useState<File | null>(null);
  const [heroImagePreview, setHeroImagePreview] = useState<string | null>(null);
  const [removeHeroImage, setRemoveHeroImage] = useState(false);
  const [workflowImageFile, setWorkflowImageFile] = useState<File | null>(null);
  const [workflowImagePreview, setWorkflowImagePreview] = useState<string | null>(null);
  const [removeWorkflowImage, setRemoveWorkflowImage] = useState(false);
  const [isRefreshingOfficialGroup, setIsRefreshingOfficialGroup] = useState(false);
  const [selectedOfficialGroupId, setSelectedOfficialGroupId] = useState("");
  const [isPending, startTransition] = useTransition();

  const activeOption = useMemo(
    () => VIEW_OPTIONS.find((option) => option.id === activeView) ?? VIEW_OPTIONS[0],
    [activeView],
  );

  const updatedAtLabel = useMemo(() => {
    if (!persistedSettings.updatedAt) {
      return null;
    }

    try {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(persistedSettings.updatedAt));
    } catch {
      return null;
    }
  }, [persistedSettings.updatedAt]);

  const officialGroupsForSelectedInstance = useMemo(
    () =>
      availableGroups.filter(
        (group) =>
          !formState.officialGroupInstanceId ||
          group.instanceId === formState.officialGroupInstanceId,
      ),
    [availableGroups, formState.officialGroupInstanceId],
  );

  const termsPreviewHtml = useMemo(
    () => termsContentToHtml(formState.termsContent ?? ""),
    [formState.termsContent],
  );

  const termsCharacterCount = (formState.termsContent ?? "").length;

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return () => {};
    }

    const previewUrl = URL.createObjectURL(logoFile);
    setLogoPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [logoFile]);

  useEffect(() => {
    if (!faviconFile) {
      setFaviconPreview(null);
      return () => {};
    }

    const previewUrl = URL.createObjectURL(faviconFile);
    setFaviconPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [faviconFile]);

  

  useEffect(() => {
    if (!seoImageFile) {
      setSeoImagePreview(null);
      return () => {};
    }

    const previewUrl = URL.createObjectURL(seoImageFile);
    setSeoImagePreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [seoImageFile]);

  useEffect(() => {
    if (!heroImageFile) {
      setHeroImagePreview(null);
      return () => {};
    }

    const previewUrl = URL.createObjectURL(heroImageFile);
    setHeroImagePreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [heroImageFile]);

  useEffect(() => {
    if (!workflowImageFile) {
      setWorkflowImagePreview(null);
      return () => {};
    }

    const previewUrl = URL.createObjectURL(workflowImageFile);
    setWorkflowImagePreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [workflowImageFile]);

  const handleSiteNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setFormState((current) => ({ ...current, siteName: value }));
  };

type OptionalField =
  | "tagline"
  | "supportEmail"
  | "supportPhone"
  | "supportUrl"
  | "supportWhatsappNumber"
  | "heroBadge"
    | "heroTitle"
    | "heroSubtitle"
    | "heroButtonLabel"
    | "heroButtonUrl"
    | "heroSecondaryButtonLabel"
    | "heroSecondaryButtonUrl"
    | "featuresTitle"
    | "featuresSubtitle"
    | "workflowTitle"
    | "workflowDescription"
    | "ctaTitle"
    | "ctaDescription"
    | "ctaButtonLabel"
    | "ctaButtonUrl"
    | "seoTitle"
    | "seoDescription"
  | "footerText";

  const handleOptionalChange = (
    field: OptionalField,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value } = event.target;
    setFormState((current) => ({ ...current, [field]: value === "" ? null : value }));
  };

  const handleSupportChannelChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value === "whatsapp" ? "whatsapp" : "chat";
    setFormState((current) => ({ ...current, supportChatMode: nextValue }));
  };

  const handleOfficialGroupInstanceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    setFormState((current) => ({
      ...current,
      officialGroupInstanceId: Number.isFinite(value) && value > 0 ? value : null,
      officialGroupJid: null,
    }));
    setSelectedOfficialGroupId("");
  };

  const handleOfficialGroupSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedOfficialGroupId(value);
    const group = availableGroups.find((item) => String(item.groupId) === value);
    setFormState((current) => ({
      ...current,
      officialGroupJid: group?.remoteId ?? null,
    }));
  };

  const buildOfficialGroupFromCandidate = (group: AdminOfficialGroupCandidate): AdminOfficialGroupLink => ({
    id: `${group.instanceId}:${group.remoteId}`,
    groupId: group.groupId,
    instanceId: group.instanceId,
    remoteId: group.remoteId,
    title: group.title,
    description:
      group.description ??
      "Grupo oficial para testar comandos, acompanhar novidades e falar com a comunidade BotAdmin.",
    imageUrl: group.imageUrl,
    inviteLink: group.inviteLink,
    inviteUpdatedAt: null,
    isActive: true,
    order: formState.officialGroups.length,
  });

  const handleAddOfficialGroup = () => {
    const group = availableGroups.find((item) => String(item.groupId) === selectedOfficialGroupId);
    if (!group) {
      setFeedback({ type: "error", message: "Selecione um grupo da instância antes de adicionar." });
      return;
    }

    setFormState((current) => {
      const exists = current.officialGroups.some(
        (item) => item.instanceId === group.instanceId && item.remoteId === group.remoteId,
      );
      if (exists) {
        return current;
      }
      const next = [...current.officialGroups, buildOfficialGroupFromCandidate(group)].map((item, index) => ({
        ...item,
        order: index,
      }));
      return {
        ...current,
        officialGroups: next,
        officialGroupInstanceId: group.instanceId,
        officialGroupJid: group.remoteId,
      };
    });
  };

  const handleRemoveOfficialGroup = (id: string) => {
    setFormState((current) => ({
      ...current,
      officialGroups: current.officialGroups
        .filter((group) => group.id !== id)
        .map((group, index) => ({ ...group, order: index })),
    }));
  };

  const handleToggleOfficialGroup = (id: string) => {
    setFormState((current) => ({
      ...current,
      officialGroups: current.officialGroups.map((group) =>
        group.id === id ? { ...group, isActive: !group.isActive } : group,
      ),
    }));
  };

  const handleTermsContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setFormState((current) => ({ ...current, termsContent: value }));
  };

  const handleFeatureChange =
    (index: number, field: keyof AdminHomepageFeature) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { value } = event.target;
      setFormState((current) => {
        const features = [...current.features];
        if (!features[index]) {
          features[index] = { title: "", description: "" };
        }
        features[index] = { ...features[index], [field]: value };
        return { ...current, features };
      });
    };

  const handleAddFeature = () =>
    setFormState((current) =>
      current.features.length >= 6
        ? current
        : { ...current, features: [...current.features, { title: "", description: "" }] },
    );

  const handleRemoveFeature = (index: number) => () =>
    setFormState((current) => {
      const features = [...current.features];
      features.splice(index, 1);
      return { ...current, features };
    });

  const handleWorkflowBulletChange =
    (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setFormState((current) => {
        const bullets = [...current.workflowBullets];
        if (!bullets[index]) {
          bullets[index] = "";
        }
        bullets[index] = value;
        return { ...current, workflowBullets: bullets };
      });
    };

  const handleAddWorkflowBullet = () =>
    setFormState((current) =>
      current.workflowBullets.length >= 6
        ? current
        : { ...current, workflowBullets: [...current.workflowBullets, ""] },
    );

  const handleRemoveWorkflowBullet = (index: number) => () =>
    setFormState((current) => {
      const bullets = [...current.workflowBullets];
      bullets.splice(index, 1);
      return { ...current, workflowBullets: bullets };
    });

  const handleAddUserPanelBanner = () =>
    setFormState((current) => ({
      ...current,
      userPanelBanners: [
        ...current.userPanelBanners,
        {
          id: Date.now(),
          title: "",
          subtitle: "",
          linkUrl: "",
          mediaUrl: "",
          order: current.userPanelBanners.length + 1,
          isActive: true,
        },
      ],
    }));

  const handleUserPanelBannerChange =
    (index: number, field: "title" | "subtitle" | "linkUrl" | "mediaUrl") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormState((current) => {
        const banners = [...current.userPanelBanners];
        if (!banners[index]) {
          return current;
        }
        banners[index] = { ...banners[index], [field]: value };
        return { ...current, userPanelBanners: banners };
      });
    };

  const handleUserPanelBannerOrderChange =
    (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      setFormState((current) => {
        const banners = [...current.userPanelBanners];
        if (!banners[index]) {
          return current;
        }
        banners[index] = {
          ...banners[index],
          order: Number.isFinite(value) ? value : banners[index].order,
        };
        return { ...current, userPanelBanners: banners };
      });
    };

  const handleUserPanelBannerActiveChange =
    (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
      const checked = Boolean(event.target.checked);
      setFormState((current) => {
        const banners = [...current.userPanelBanners];
        if (!banners[index]) {
          return current;
        }
        banners[index] = { ...banners[index], isActive: checked };
        return { ...current, userPanelBanners: banners };
      });
    };

  const handleRemoveUserPanelBanner = (index: number) => () =>
    setFormState((current) => {
      const banners = [...current.userPanelBanners];
      banners.splice(index, 1);
      return { ...current, userPanelBanners: banners };
    });

  const handleAddTestGroup = () =>
    setFormState((current) => ({
      ...current,
      testGroups: [...current.testGroups, { title: "", url: "" }],
    }));

  const handleTestGroupChange =
    (index: number, field: "title" | "url") => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormState((current) => {
        const groups = [...current.testGroups];
        if (!groups[index]) {
          return current;
        }
        groups[index] = { ...groups[index], [field]: value };
        return { ...current, testGroups: groups };
      });
    };

  const handleRemoveTestGroup = (index: number) => () =>
    setFormState((current) => {
      const groups = [...current.testGroups];
      groups.splice(index, 1);
      return { ...current, testGroups: groups };
    });

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;

    if (!file) {
      setLogoFile(null);
      return;
    }

    setLogoFile(file);
    setRemoveLogo(false);
  };

  const handleSeoImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;

    if (!file) {
      setSeoImageFile(null);
      return;
    }

    setSeoImageFile(file);
    setRemoveSeoImage(false);
  };

  const handleHeroImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;

    if (!file) {
      setHeroImageFile(null);
      return;
    }

    setHeroImageFile(file);
    setRemoveHeroImage(false);
  };

  const handleWorkflowImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;

    if (!file) {
      setWorkflowImageFile(null);
      return;
    }

    setWorkflowImageFile(file);
    setRemoveWorkflowImage(false);
  };

  const handleClearLogoFile = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(false);
    setFormState((current) => ({ ...current, logoUrl: persistedSettings.logoUrl }));
  };

  

  const handleClearSeoImageFile = () => {
    setSeoImageFile(null);
    setSeoImagePreview(null);
    setRemoveSeoImage(false);
    setFormState((current) => ({ ...current, seoImageUrl: persistedSettings.seoImageUrl }));
  };

  const handleClearHeroImageFile = () => {
    setHeroImageFile(null);
    setHeroImagePreview(null);
    setRemoveHeroImage(false);
    setFormState((current) => ({ ...current, heroImageUrl: persistedSettings.heroImageUrl }));
  };

  const handleClearWorkflowImageFile = () => {
    setWorkflowImageFile(null);
    setWorkflowImagePreview(null);
    setRemoveWorkflowImage(false);
    setFormState((current) => ({ ...current, workflowImageUrl: persistedSettings.workflowImageUrl }));
  };

  const handleRemoveLogoClick = () => {
    setRemoveLogo(true);
    setLogoFile(null);
    setLogoPreview(null);
    setFormState((current) => ({ ...current, logoUrl: null }));
  };

  

  const handleRemoveSeoImageClick = () => {
    setRemoveSeoImage(true);
    setSeoImageFile(null);
    setSeoImagePreview(null);
    setFormState((current) => ({ ...current, seoImageUrl: null }));
  };

  const handleRemoveHeroImageClick = () => {
    setRemoveHeroImage(true);
    setHeroImageFile(null);
    setHeroImagePreview(null);
    setFormState((current) => ({ ...current, heroImageUrl: null }));
  };

  const handleRemoveWorkflowImageClick = () => {
    setRemoveWorkflowImage(true);
    setWorkflowImageFile(null);
    setWorkflowImagePreview(null);
    setFormState((current) => ({ ...current, workflowImageUrl: null }));
  };

  const handleCancelLogoRemoval = () => {
    setRemoveLogo(false);
    setFormState((current) => ({ ...current, logoUrl: persistedSettings.logoUrl }));
  };

  

  const handleCancelSeoImageRemoval = () => {
    setRemoveSeoImage(false);
    setFormState((current) => ({ ...current, seoImageUrl: persistedSettings.seoImageUrl }));
  };

  const handleCancelHeroImageRemoval = () => {
    setRemoveHeroImage(false);
    setFormState((current) => ({ ...current, heroImageUrl: persistedSettings.heroImageUrl }));
  };

  const handleCancelWorkflowImageRemoval = () => {
    setRemoveWorkflowImage(false);
    setFormState((current) => ({ ...current, workflowImageUrl: persistedSettings.workflowImageUrl }));
  };

  const handleEmailVerificationToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.target;
    setFormState((current) => ({ ...current, emailVerificationEnabled: checked }));
  };

  const handleEmailVerificationKeysChange = (
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const { value } = event.target;
    const keys = value
      .split(/\r?\n/)
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    setFormState((current) => ({
      ...current,
      emailVerificationApiKeysText: value,
      emailVerificationApiKeys: keys,
    }));
  };

  const parseKeywordText = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  const handleSeoKeywordsChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setFormState((current) => ({
      ...current,
      seoKeywordsText: value,
      seoKeywords: parseKeywordText(value),
    }));
  };

  const handleSeoHighlightKeywordsChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setFormState((current) => ({
      ...current,
      seoHighlightKeywordsText: value,
      seoHighlightKeywords: parseKeywordText(value),
    }));
  };

  const handleClearEmailVerificationKeys = () => {
    setFormState((current) => ({
      ...current,
      emailVerificationApiKeysText: "",
      emailVerificationApiKeys: [],
    }));
  };

  const handleRefreshOfficialGroupLink = async (group: AdminOfficialGroupLink, reset = false) => {
    setFeedback(null);
    setIsRefreshingOfficialGroup(true);
    try {
      const response = await fetch("/api/admin/site/official-group-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: group.groupId,
          instanceId: group.instanceId,
          groupJid: group.remoteId,
          reset,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível obter o link do grupo oficial.");
      }

      const nextSettings = payload?.settings as AdminSiteSettings | undefined;
      if (nextSettings) {
        setPersistedSettings(nextSettings);
        setFormState((current) => ({
          ...current,
          officialGroupInstanceId: nextSettings.officialGroupInstanceId,
          officialGroupJid: nextSettings.officialGroupJid,
          officialGroups: nextSettings.officialGroups,
        }));
        router.refresh();
      }

      setFeedback({
        type: "success",
        message: payload?.message ?? "Link do grupo oficial atualizado com sucesso.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível obter o link do grupo oficial.",
      });
    } finally {
      setIsRefreshingOfficialGroup(false);
    }
  };

  const resetForm = () => {
    setFormState(mapSettingsToFormState(persistedSettings));
    setFeedback(null);
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(false);
    setFaviconFile(null);
    setFaviconPreview(null);
    setRemoveFavicon(false);
    setSeoImageFile(null);
    setSeoImagePreview(null);
    setRemoveSeoImage(false);
    setHeroImageFile(null);
    setHeroImagePreview(null);
    setRemoveHeroImage(false);
    setWorkflowImageFile(null);
    setWorkflowImagePreview(null);
    setRemoveWorkflowImage(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      try {
        const payloadToSend = new FormData();
        payloadToSend.set("siteName", formState.siteName);
        payloadToSend.set("tagline", formState.tagline ?? "");
        payloadToSend.set("supportEmail", formState.supportEmail ?? "");
        payloadToSend.set("supportPhone", formState.supportPhone ?? "");
        payloadToSend.set("supportUrl", formState.supportUrl ?? "");
        payloadToSend.set("supportChatMode", formState.supportChatMode);
        payloadToSend.set("supportWhatsappNumber", formState.supportWhatsappNumber ?? "");
        payloadToSend.set("userPanelBanners", JSON.stringify(formState.userPanelBanners ?? []));
        payloadToSend.set("testGroups", JSON.stringify(formState.testGroups ?? []));
        payloadToSend.set("officialGroups", JSON.stringify(formState.officialGroups ?? []));
        payloadToSend.set("officialGroupInstanceId", String(formState.officialGroupInstanceId ?? ""));
        payloadToSend.set("officialGroupJid", formState.officialGroupJid ?? "");
        payloadToSend.set("emailVerificationEnabled", String(formState.emailVerificationEnabled));
        payloadToSend.set("emailVerificationApiKeys", formState.emailVerificationApiKeysText ?? "");
        payloadToSend.set("heroBadge", formState.heroBadge ?? "");
        payloadToSend.set("heroTitle", formState.heroTitle ?? "");
        payloadToSend.set("heroSubtitle", formState.heroSubtitle ?? "");
        payloadToSend.set("heroButtonLabel", formState.heroButtonLabel ?? "");
        payloadToSend.set("heroButtonUrl", formState.heroButtonUrl ?? "");
        payloadToSend.set("heroSecondaryButtonLabel", formState.heroSecondaryButtonLabel ?? "");
        payloadToSend.set("heroSecondaryButtonUrl", formState.heroSecondaryButtonUrl ?? "");
        payloadToSend.set("featuresTitle", formState.featuresTitle ?? "");
        payloadToSend.set("featuresSubtitle", formState.featuresSubtitle ?? "");
        payloadToSend.set("features", JSON.stringify(formState.features));
        payloadToSend.set("workflowTitle", formState.workflowTitle ?? "");
        payloadToSend.set("workflowDescription", formState.workflowDescription ?? "");
        payloadToSend.set("workflowBullets", JSON.stringify(formState.workflowBullets));
        payloadToSend.set("ctaTitle", formState.ctaTitle ?? "");
        payloadToSend.set("ctaDescription", formState.ctaDescription ?? "");
        payloadToSend.set("ctaButtonLabel", formState.ctaButtonLabel ?? "");
        payloadToSend.set("ctaButtonUrl", formState.ctaButtonUrl ?? "");
        payloadToSend.set("seoTitle", formState.seoTitle ?? "");
        payloadToSend.set("seoDescription", formState.seoDescription ?? "");
        payloadToSend.set("seoKeywords", formState.seoKeywordsText ?? "");
        payloadToSend.set(
          "seoHighlightKeywords",
          formState.seoHighlightKeywordsText ?? "",
        );
        payloadToSend.set("footerText", formState.footerText ?? "");
        payloadToSend.set("termsContent", formState.termsContent ?? "");
        payloadToSend.set("removeLogo", String(removeLogo));
        payloadToSend.set("removeFavicon", String(removeFavicon));
        payloadToSend.set("removeSeoImage", String(removeSeoImage));
        payloadToSend.set("removeHeroImage", String(removeHeroImage));
        payloadToSend.set("removeWorkflowImage", String(removeWorkflowImage));

        if (logoFile) {
          payloadToSend.set("logo", logoFile);
        }

        if (faviconFile) {
          payloadToSend.set("favicon", faviconFile);
        }

        

        if (seoImageFile) {
          payloadToSend.set("seoImage", seoImageFile);
        }

        if (heroImageFile) {
          payloadToSend.set("heroImage", heroImageFile);
        }

        if (workflowImageFile) {
          payloadToSend.set("workflowImage", workflowImageFile);
        }

        const response = await fetch("/api/admin/site", {
          method: "PUT",
          body: payloadToSend,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const message = payload?.message ?? "Não foi possível atualizar as configurações do site.";
          throw new Error(message);
        }

        const nextSettings = payload?.settings as AdminSiteSettings | undefined;
        if (nextSettings) {
          setPersistedSettings(nextSettings);
          setFormState(mapSettingsToFormState(nextSettings));
          setRemoveLogo(false);
          setRemoveFavicon(false);
          setRemoveSeoImage(false);
          setRemoveHeroImage(false);
          setRemoveWorkflowImage(false);
          setLogoFile(null);
          setLogoPreview(null);
          setFaviconFile(null);
          setFaviconPreview(null);
          setSeoImageFile(null);
          setSeoImagePreview(null);
          setHeroImageFile(null);
          setHeroImagePreview(null);
          setWorkflowImageFile(null);
          setWorkflowImagePreview(null);
          router.refresh();
        }

        setFeedback({
          type: "success",
          message: payload?.message ?? "Configurações atualizadas com sucesso.",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar as configurações do site.";
        setFeedback({ type: "error", message });
      }
    });
  };

  const currentLogoUrl = removeLogo ? null : formState.logoUrl;
  const displayLogo = logoPreview ?? currentLogoUrl;
  const showCancelRemoval = removeLogo && Boolean(persistedSettings.logoUrl);
  const currentFaviconUrl = removeFavicon ? null : formState.faviconUrl;
  const displayFavicon = faviconPreview ?? currentFaviconUrl;
  const showCancelFaviconRemoval = removeFavicon && Boolean(persistedSettings.faviconUrl);
  const currentSeoImageUrl = removeSeoImage ? null : formState.seoImageUrl;
  const displaySeoImage = seoImagePreview ?? currentSeoImageUrl;
  const showCancelSeoRemoval = removeSeoImage && Boolean(persistedSettings.seoImageUrl);
  const currentHeroImageUrl = removeHeroImage ? null : formState.heroImageUrl;
  const displayHeroImage = heroImagePreview ?? currentHeroImageUrl;
  const showCancelHeroRemoval = removeHeroImage && Boolean(persistedSettings.heroImageUrl);
  const currentWorkflowImageUrl = removeWorkflowImage ? null : formState.workflowImageUrl;
  const displayWorkflowImage = workflowImagePreview ?? currentWorkflowImageUrl;
  const showCancelWorkflowRemoval =
    removeWorkflowImage && Boolean(persistedSettings.workflowImageUrl);

  return (
    <div className="d-flex flex-column gap-4">
      <section className="card">
        <div className="card-body">
          <h2 className="h5 mb-2">Escolha o que deseja configurar</h2>
          <p className="text-secondary mb-3">
            Use os botões abaixo para navegar entre identidade visual, conteúdo da página inicial e ajustes de SEO.
          </p>
          <div className="d-flex flex-wrap gap-2">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`btn ${activeView === option.id ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setActiveView(option.id)}
                disabled={isPending}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-secondary small mb-0 mt-3">{activeOption.description}</p>
        </div>
      </section>

      <form
        className="d-flex flex-column gap-4"
        encType="multipart/form-data"
        onSubmit={handleSubmit}
      >
        {feedback && (
          <div
            className={`alert ${feedback.type === "success" ? "alert-success" : "alert-danger"}`}
            role="alert"
          >
            {feedback.message}
          </div>
        )}

      {activeView === "branding" && (
        <>
          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Identidade visual</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label" htmlFor="siteName">
                  Nome do site
                </label>
                <input
                  id="siteName"
                  name="siteName"
                  type="text"
                  required
                  maxLength={120}
                  className="form-control"
                  value={formState.siteName}
                  onChange={handleSiteNameChange}
                  placeholder="StoreBot"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="tagline">
                  Slogan ou frase de impacto
                </label>
                <input
                  id="tagline"
                  name="tagline"
                  type="text"
                  maxLength={160}
                  className="form-control"
                  value={formState.tagline ?? ""}
                  onChange={handleOptionalChange("tagline")}
                  placeholder="Automatize suas vendas no WhatsApp"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="siteLogo">
                  Logo do site
                </label>
                {displayLogo && (
                  <div className="d-flex align-items-start gap-3 mb-3">
                    <Image
                      src={displayLogo ?? ""}
                      alt="Prévia da logo do site"
                      width={96}
                      height={96}
                      className="rounded border bg-white p-2"
                      style={{ width: "96px", height: "96px", objectFit: "contain" }}
                      unoptimized
                    />
                    <div className="d-flex flex-column gap-2">
                      <span className="text-secondary small">
                        {logoPreview
                          ? "Prévia da nova logo (ainda não salva)."
                          : "Logo atual exibida no site público."}
                      </span>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={handleRemoveLogoClick}
                          disabled={isPending}
                        >
                          Remover logo
                        </button>
                        {logoPreview && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleClearLogoFile}
                            disabled={isPending}
                          >
                            Descartar imagem nova
                          </button>
                        )}
                        {showCancelRemoval && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleCancelLogoRemoval}
                            disabled={isPending}
                          >
                            Cancelar remoção
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!displayLogo && (
                  <p className="text-secondary small mb-3">
                    Envie uma imagem quadrada (PNG, JPG, WEBP ou SVG) de até 5 MB para personalizar o topo do site.
                  </p>
                )}
                <input
                  id="siteLogo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="form-control"
                  onChange={handleLogoFileChange}
                  disabled={isPending}
                />
                {removeLogo && !logoPreview && (
                  <p className="text-secondary small mb-0 mt-2">
                    A logo atual será removida ao salvar.
                  </p>
                )}
                {showCancelRemoval && !logoPreview && (
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={handleCancelLogoRemoval}
                      disabled={isPending}
                    >
                      Cancelar remoção
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Contato</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="supportEmail">
                    E-mail de contato
                  </label>
                  <input
                    id="supportEmail"
                    name="supportEmail"
                    type="email"
                    maxLength={160}
                    className="form-control"
                    value={formState.supportEmail ?? ""}
                    onChange={handleOptionalChange("supportEmail")}
                    placeholder="contato@suaempresa.com"
                    disabled={isPending}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor="supportPhone">
                    Telefone ou WhatsApp
                  </label>
                  <input
                    id="supportPhone"
                    name="supportPhone"
                    type="tel"
                    inputMode="tel"
                    maxLength={40}
                    className="form-control"
                    value={formState.supportPhone ?? ""}
                    onChange={handleOptionalChange("supportPhone")}
                    placeholder="(+55) 11 99999-0000"
                    disabled={isPending}
                  />
                </div>
                <div className="col-12">
                  <label className="form-label" htmlFor="supportUrl">
                    URL do suporte
                  </label>
                  <input
                    id="supportUrl"
                    name="supportUrl"
                    type="url"
                    inputMode="url"
                    maxLength={300}
                    className="form-control"
                    value={formState.supportUrl ?? ""}
                    onChange={handleOptionalChange("supportUrl")}
                    placeholder="https://seusite.com/suporte"
                    disabled={isPending}
                  />
                  <div className="form-text">
                    Deixe vazio para usar automaticamente a URL configurada no arquivo .env.
                  </div>
                </div>
                <div className="col-md-6">
                  <label className="form-label d-block">Canal exibido no painel</label>
                  <div className="d-flex flex-wrap gap-4">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="supportChatMode"
                        id="support-chat-mode-chat"
                        value="chat"
                        checked={formState.supportChatMode !== "whatsapp"}
                        onChange={handleSupportChannelChange}
                        disabled={isPending}
                      />
                      <label className="form-check-label" htmlFor="support-chat-mode-chat">
                        Chat interno
                      </label>
                    </div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="supportChatMode"
                        id="support-chat-mode-whatsapp"
                        value="whatsapp"
                        checked={formState.supportChatMode === "whatsapp"}
                        onChange={handleSupportChannelChange}
                        disabled={isPending}
                      />
                      <label className="form-check-label" htmlFor="support-chat-mode-whatsapp">
                        WhatsApp externo
                      </label>
                    </div>
                  </div>
                  <div className="form-text">
                    Defina se o botão flutuante abre o chat nativo ou redireciona para o WhatsApp.
                  </div>
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor="supportWhatsappNumber">
                    Número do WhatsApp para suporte
                  </label>
                  <input
                    id="supportWhatsappNumber"
                    name="supportWhatsappNumber"
                    type="tel"
                    inputMode="numeric"
                    maxLength={40}
                    className="form-control"
                    value={formState.supportWhatsappNumber ?? ""}
                    onChange={handleOptionalChange("supportWhatsappNumber")}
                    placeholder="559295333643"
                    disabled={isPending || formState.supportChatMode !== "whatsapp"}
                  />
                  <div className="form-text">
                    Informe apenas números com DDI. Usaremos esse valor para gerar o link em wa.me.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Banners do painel do usuário</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <p className="text-secondary mb-1">
                Esses banners aparecem somente no painel do usuário (dashboard) e não na página de links úteis.
              </p>
              {formState.userPanelBanners.length === 0 && (
                <div className="text-secondary small">Nenhum banner adicionado.</div>
              )}
              {formState.userPanelBanners.map((banner, index) => (
                <div key={banner.id ?? index} className="border rounded p-3 d-flex flex-column gap-3">
                  <div className="d-flex justify-content-between align-items-center gap-2">
                    <div className="fw-semibold">Banner #{index + 1}</div>
                    <div className="d-flex align-items-center gap-3">
                      <div className="form-check form-switch mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`user-banner-active-${index}`}
                          checked={banner.isActive !== false}
                          onChange={handleUserPanelBannerActiveChange(index)}
                          disabled={isPending}
                        />
                        <label className="form-check-label" htmlFor={`user-banner-active-${index}`}>
                          Ativo
                        </label>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={handleRemoveUserPanelBanner(index)}
                        disabled={isPending}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`user-banner-title-${index}`}>
                        Título
                      </label>
                      <input
                        id={`user-banner-title-${index}`}
                        type="text"
                        className="form-control"
                        maxLength={160}
                        value={banner.title}
                        onChange={handleUserPanelBannerChange(index, "title")}
                        disabled={isPending}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`user-banner-subtitle-${index}`}>
                        Subtítulo
                      </label>
                      <input
                        id={`user-banner-subtitle-${index}`}
                        type="text"
                        className="form-control"
                        maxLength={200}
                        value={banner.subtitle ?? ""}
                        onChange={handleUserPanelBannerChange(index, "subtitle")}
                        disabled={isPending}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`user-banner-link-${index}`}>
                        Link do banner (opcional)
                      </label>
                      <input
                        id={`user-banner-link-${index}`}
                        type="url"
                        className="form-control"
                        maxLength={300}
                        value={banner.linkUrl ?? ""}
                        onChange={handleUserPanelBannerChange(index, "linkUrl")}
                        placeholder="https://"
                        disabled={isPending}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`user-banner-media-${index}`}>
                        URL da imagem/GIF
                      </label>
                      <input
                        id={`user-banner-media-${index}`}
                        type="url"
                        className="form-control"
                        maxLength={300}
                        value={banner.mediaUrl}
                        onChange={handleUserPanelBannerChange(index, "mediaUrl")}
                        placeholder="https://..."
                        disabled={isPending}
                      />
                    </div>
                    <div className="col-md-3 col-6">
                      <label className="form-label" htmlFor={`user-banner-order-${index}`}>
                        Ordem
                      </label>
                      <input
                        id={`user-banner-order-${index}`}
                        type="number"
                        min={0}
                        className="form-control"
                        value={banner.order ?? 0}
                        onChange={handleUserPanelBannerOrderChange(index)}
                        disabled={isPending}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-outline-primary align-self-start"
                onClick={handleAddUserPanelBanner}
                disabled={isPending}
              >
                Adicionar banner
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Grupos de teste no botão do WhatsApp</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <p className="text-secondary mb-1">
                Informe links de grupos de teste. Eles aparecerão no mini card do botão flutuante de WhatsApp junto com a opção de falar com o suporte.
              </p>
              {formState.testGroups.length === 0 && (
                <div className="text-secondary small">Nenhum grupo cadastrado.</div>
              )}
              {formState.testGroups.map((group, index) => (
                <div key={`${group.title}-${index}`} className="border rounded p-3 d-flex flex-column gap-3">
                  <div className="d-flex justify-content-between align-items-center gap-2">
                    <div className="fw-semibold">Grupo #{index + 1}</div>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={handleRemoveTestGroup(index)}
                      disabled={isPending}
                    >
                      Remover
                    </button>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`test-group-title-${index}`}>
                        Título visível
                      </label>
                      <input
                        id={`test-group-title-${index}`}
                        type="text"
                        className="form-control"
                        maxLength={120}
                        value={group.title}
                        onChange={handleTestGroupChange(index, "title")}
                        disabled={isPending}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor={`test-group-url-${index}`}>
                        Link do grupo
                      </label>
                      <input
                        id={`test-group-url-${index}`}
                        type="url"
                        className="form-control"
                        maxLength={300}
                        value={group.url}
                        onChange={handleTestGroupChange(index, "url")}
                        placeholder="https://chat.whatsapp.com/..."
                        disabled={isPending}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-outline-primary align-self-start"
                onClick={handleAddTestGroup}
                disabled={isPending}
              >
                Adicionar grupo de teste
              </button>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Favicon</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label" htmlFor="siteFavicon">
                  Favicon do site
                </label>
                {displayFavicon && (
                  <div className="d-flex align-items-start gap-3 mb-3">
                    <Image
                      src={displayFavicon ?? ""}
                      alt="Prévia do favicon"
                      width={48}
                      height={48}
                      className="rounded border bg-white p-1"
                      style={{ width: "48px", height: "48px", objectFit: "contain" }}
                      unoptimized
                    />
                    <div className="d-flex flex-column gap-2">
                      <span className="text-secondary small">
                        {faviconPreview
                          ? "Prévia do novo favicon (ainda não salvo)."
                          : "Favicon atual utilizado nas abas do navegador."}
                      </span>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => setRemoveFavicon(true)}
                          disabled={isPending}
                        >
                          Remover favicon
                        </button>
                        {faviconPreview && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setFaviconFile(null)}
                            disabled={isPending}
                          >
                            Descartar imagem nova
                          </button>
                        )}
                        {showCancelFaviconRemoval && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setRemoveFavicon(false)}
                            disabled={isPending}
                          >
                            Cancelar remoção
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!displayFavicon && (
                  <p className="text-secondary small mb-3">
                    Envie um favicon (ICO/PNG/SVG/WEBP) até 5 MB. Tamanho sugerido 48×48.
                  </p>
                )}
                <input
                  id="siteFavicon"
                  name="favicon"
                  type="file"
                  accept="image/x-icon,image/png,image/svg+xml,image/webp"
                  className="form-control"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFaviconFile(e.target.files?.[0] ?? null)}
                  disabled={isPending}
                />
                {removeFavicon && !faviconPreview && (
                  <p className="text-secondary small mb-0 mt-2">
                    O favicon atual será removido ao salvar.
                  </p>
                )}
                {showCancelFaviconRemoval && !faviconPreview && (
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setRemoveFavicon(false)}
                      disabled={isPending}
                    >
                      Cancelar remoção
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          
        </>
      )}

      {activeView === "verification" && (
        <section className="card">
          <div className="card-header">
            <h2 className="h5 mb-0">Verificação de e-mail</h2>
          </div>
          <div className="card-body d-flex flex-column gap-3">
            <div>
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="emailVerificationEnabled"
                  checked={formState.emailVerificationEnabled}
                  onChange={handleEmailVerificationToggle}
                  disabled={isPending}
                />
                <label className="form-check-label fw-semibold" htmlFor="emailVerificationEnabled">
                  Ativar validação automática de e-mails
                </label>
              </div>
              <p className="text-secondary small mb-0">
                Novos cadastros são validados usando a API
                {" "}
                <a
                  href="https://www.byteplant.com/mail-validator"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Email-Validator da Byteplant
                </a>
                . Cada chave possui 1.000 verificações mensais.
              </p>
            </div>

            <div>
              <label className="form-label" htmlFor="emailVerificationApiKeys">
                API Keys Byteplant (uma por linha)
              </label>
              <textarea
                id="emailVerificationApiKeys"
                name="emailVerificationApiKeys"
                rows={4}
                className="form-control"
                value={formState.emailVerificationApiKeysText}
                onChange={handleEmailVerificationKeysChange}
                placeholder={"ex.: test_ABCD1234"}
                disabled={isPending}
              />
              <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={handleClearEmailVerificationKeys}
                  disabled={isPending || (!formState.emailVerificationApiKeysText && formState.emailVerificationApiKeys.length === 0)}
                >
                  Limpar lista
                </button>
                <span className="text-secondary small">
                  Adicione várias chaves para distribuir o consumo.
                </span>
              </div>
              {formState.emailVerificationEnabled && formState.emailVerificationApiKeys.length === 0 ? (
                <p className="text-danger small mb-0 mt-2">
                  Informe ao menos uma API Key para manter a verificação ativa.
                </p>
              ) : null}
              {formState.emailVerificationApiKeys.length > 0 ? (
                <p className="text-secondary small mb-0 mt-2">
                  {formState.emailVerificationApiKeys.length} chave(s) configurada(s).
                </p>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {activeView === "homepage" && (
        <>
          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Destaque principal</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label" htmlFor="heroBadge">
                  Texto auxiliar acima do título (badge)
                </label>
                <input
                  id="heroBadge"
                  name="heroBadge"
                  type="text"
                  maxLength={120}
                  className="form-control"
                  value={formState.heroBadge ?? ""}
                  onChange={handleOptionalChange("heroBadge")}
                  placeholder="Bot admin para grupos"
                  disabled={isPending}
                />
                <p className="text-secondary small mb-0">
                  Este texto curto aparece antes do título para contextualizar o destaque.
                </p>
              </div>
              <div>
                <label className="form-label" htmlFor="heroTitle">
                  Título principal
                </label>
                <input
                  id="heroTitle"
                  name="heroTitle"
                  type="text"
                  maxLength={160}
                  className="form-control"
                  value={formState.heroTitle ?? ""}
                  onChange={handleOptionalChange("heroTitle")}
                  placeholder="Administre grupos do WhatsApp no piloto automático"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="heroSubtitle">
                  Descrição principal
                </label>
                <textarea
                  id="heroSubtitle"
                  name="heroSubtitle"
                  rows={3}
                  maxLength={240}
                  className="form-control"
                  value={formState.heroSubtitle ?? ""}
                  onChange={handleOptionalChange("heroSubtitle")}
                  placeholder="Explique rapidamente como o bot modera conversas, dá boas‑vindas e aplica regras."
                  disabled={isPending}
                />
              </div>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="heroButtonLabel">
                    Texto do botão principal
                  </label>
                  <input
                    id="heroButtonLabel"
                    name="heroButtonLabel"
                    type="text"
                    maxLength={60}
                    className="form-control"
                    value={formState.heroButtonLabel ?? ""}
                    onChange={handleOptionalChange("heroButtonLabel")}
                    placeholder="Começar agora"
                    disabled={isPending}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor="heroButtonUrl">
                    URL do botão principal
                  </label>
                <input
                  id="heroButtonUrl"
                  name="heroButtonUrl"
                  type="text"
                  inputMode="url"
                  maxLength={300}
                  className="form-control"
                  value={formState.heroButtonUrl ?? ""}
                  onChange={handleOptionalChange("heroButtonUrl")}
                  placeholder="https://suaempresa.com/contato"
                  disabled={isPending}
                />
                </div>
              </div>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="heroSecondaryButtonLabel">
                    Texto do botão secundário
                  </label>
                  <input
                    id="heroSecondaryButtonLabel"
                    name="heroSecondaryButtonLabel"
                    type="text"
                    maxLength={60}
                    className="form-control"
                    value={formState.heroSecondaryButtonLabel ?? ""}
                    onChange={handleOptionalChange("heroSecondaryButtonLabel")}
                    placeholder="Ver planos"
                    disabled={isPending}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor="heroSecondaryButtonUrl">
                    URL do botão secundário
                  </label>
                <input
                  id="heroSecondaryButtonUrl"
                  name="heroSecondaryButtonUrl"
                  type="text"
                  inputMode="url"
                  maxLength={300}
                  className="form-control"
                  value={formState.heroSecondaryButtonUrl ?? ""}
                  onChange={handleOptionalChange("heroSecondaryButtonUrl")}
                  placeholder="/precos"
                  disabled={isPending}
                />
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="heroImage">
                  Imagem de destaque
                </label>
                {displayHeroImage && (
                  <div className="d-flex align-items-start gap-3 mb-3">
                    <Image
                      src={displayHeroImage ?? ""}
                      alt="Prévia da imagem de destaque"
                      width={320}
                      height={200}
                      className="rounded border bg-white"
                      style={{ width: "320px", height: "200px", objectFit: "cover" }}
                      unoptimized
                    />
                    <div className="d-flex flex-column gap-2">
                      <span className="text-secondary small">
                        {heroImagePreview
                          ? "Prévia da nova imagem (ainda não salva)."
                          : "Imagem atual exibida na parte principal da home."}
                      </span>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={handleRemoveHeroImageClick}
                          disabled={isPending}
                        >
                          Remover imagem
                        </button>
                        {heroImagePreview && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleClearHeroImageFile}
                            disabled={isPending}
                          >
                            Descartar imagem nova
                          </button>
                        )}
                        {showCancelHeroRemoval && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleCancelHeroImageRemoval}
                            disabled={isPending}
                          >
                            Cancelar remoção
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!displayHeroImage && (
                  <p className="text-secondary small mb-3">
                    Envie uma imagem em PNG, JPG ou WEBP de até 5 MB para ilustrar a área principal.
                  </p>
                )}
                <input
                  id="heroImage"
                  name="heroImage"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="form-control"
                  onChange={handleHeroImageChange}
                  disabled={isPending}
                />
                {removeHeroImage && !heroImagePreview && (
                  <p className="text-secondary small mb-0 mt-2">A imagem atual será removida ao salvar.</p>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Seção de destaques</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label" htmlFor="featuresTitle">
                  Título da seção
                </label>
                <input
                  id="featuresTitle"
                  name="featuresTitle"
                  type="text"
                  maxLength={160}
                  className="form-control"
                  value={formState.featuresTitle ?? ""}
                  onChange={handleOptionalChange("featuresTitle")}
                  placeholder="Tudo que você precisa para moderar grupos"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="featuresSubtitle">
                  Descrição da seção
                </label>
                <textarea
                  id="featuresSubtitle"
                  name="featuresSubtitle"
                  rows={3}
                  maxLength={320}
                  className="form-control"
                  value={formState.featuresSubtitle ?? ""}
                  onChange={handleOptionalChange("featuresSubtitle")}
                  placeholder="Resuma como o bot ajuda a manter o grupo organizado."
                  disabled={isPending}
                />
              </div>
              <div className="d-flex flex-column gap-3">
                {formState.features.length === 0 && (
                  <p className="text-secondary small mb-0">
                    Nenhum destaque cadastrado. Use o botão abaixo para adicionar itens.
                  </p>
                )}
                {formState.features.map((feature, index) => (
                  <div key={`feature-${index}`} className="border rounded-3 p-3 d-flex flex-column gap-3">
                    <div className="d-flex justify-content-between align-items-center">
                      <h3 className="h6 mb-0">Destaque {index + 1}</h3>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={handleRemoveFeature(index)}
                        disabled={isPending}
                      >
                        Remover
                      </button>
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`feature-title-${index}`}>
                        Título
                      </label>
                      <input
                        id={`feature-title-${index}`}
                        type="text"
                        maxLength={120}
                        className="form-control"
                        value={feature.title}
                        onChange={handleFeatureChange(index, "title")}
                        placeholder="Moderação automática"
                        disabled={isPending}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`feature-description-${index}`}>
                        Descrição
                      </label>
                      <textarea
                        id={`feature-description-${index}`}
                        rows={3}
                        maxLength={320}
                        className="form-control"
                        value={feature.description}
                        onChange={handleFeatureChange(index, "description")}
                        placeholder="Detalhe em poucas linhas o benefício oferecido."
                        disabled={isPending}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm align-self-start"
                onClick={handleAddFeature}
                disabled={isPending || formState.features.length >= 6}
              >
                Adicionar destaque
              </button>
              <p className="text-secondary small mb-0">
                Você pode cadastrar até 6 destaques. Eles são exibidos em ordem e usam ícones pré-definidos.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Seção de experiência</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label" htmlFor="workflowTitle">
                  Título da seção
                </label>
                <input
                  id="workflowTitle"
                  name="workflowTitle"
                  type="text"
                  maxLength={160}
                  className="form-control"
                  value={formState.workflowTitle ?? ""}
                  onChange={handleOptionalChange("workflowTitle")}
                  placeholder="Como o Bot Admin cuida do seu grupo"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="workflowDescription">
                  Descrição da seção
                </label>
                <textarea
                  id="workflowDescription"
                  name="workflowDescription"
                  rows={3}
                  maxLength={320}
                  className="form-control"
                  value={formState.workflowDescription ?? ""}
                  onChange={handleOptionalChange("workflowDescription")}
                  placeholder="Ex.: Boas‑vindas, anti‑spam, comandos e relatórios — tudo automático."
                  disabled={isPending}
                />
              </div>
              <div>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <label className="form-label mb-0">Lista de destaques rápidos</label>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={handleAddWorkflowBullet}
                    disabled={isPending || formState.workflowBullets.length >= 6}
                  >
                    Adicionar item
                  </button>
                </div>
                <div className="d-flex flex-column gap-2">
                  {formState.workflowBullets.length === 0 && (
                    <p className="text-secondary small mb-0">
                      Nenhum item cadastrado. Adicione pontos rápidos para reforçar os benefícios.
                    </p>
                  )}
                  {formState.workflowBullets.map((bullet, index) => (
                    <div
                      key={`bullet-${index}`}
                      className="d-flex flex-column flex-md-row gap-2 align-items-stretch align-items-md-center"
                    >
                      <input
                        type="text"
                        id={`workflow-bullet-${index}`}
                        maxLength={160}
                        className="form-control"
                        value={bullet}
                        onChange={handleWorkflowBulletChange(index)}
                        placeholder="Resumo do benefício"
                        disabled={isPending}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={handleRemoveWorkflowBullet(index)}
                        disabled={isPending}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="workflowImage">
                  Imagem da seção
                </label>
                {displayWorkflowImage && (
                  <div className="d-flex align-items-start gap-3 mb-3">
                    <Image
                      src={displayWorkflowImage ?? ""}
                      alt="Prévia da imagem secundária"
                      width={320}
                      height={200}
                      className="rounded border bg-white"
                      style={{ width: "320px", height: "200px", objectFit: "cover" }}
                      unoptimized
                    />
                    <div className="d-flex flex-column gap-2">
                      <span className="text-secondary small">
                        {workflowImagePreview
                          ? "Prévia da nova imagem (ainda não salva)."
                          : "Imagem atual exibida na segunda seção da página."}
                      </span>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={handleRemoveWorkflowImageClick}
                          disabled={isPending}
                        >
                          Remover imagem
                        </button>
                        {workflowImagePreview && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleClearWorkflowImageFile}
                            disabled={isPending}
                          >
                            Descartar imagem nova
                          </button>
                        )}
                        {showCancelWorkflowRemoval && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleCancelWorkflowImageRemoval}
                            disabled={isPending}
                          >
                            Cancelar remoção
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!displayWorkflowImage && (
                  <p className="text-secondary small mb-3">
                    Envie uma imagem em PNG, JPG ou WEBP de até 5 MB para ilustrar esta seção.
                  </p>
                )}
                <input
                  id="workflowImage"
                  name="workflowImage"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="form-control"
                  onChange={handleWorkflowImageChange}
                  disabled={isPending}
                />
                {removeWorkflowImage && !workflowImagePreview && (
                  <p className="text-secondary small mb-0 mt-2">
                    A imagem atual será removida ao salvar.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="h5 mb-0">Chamada final</h2>
            </div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label" htmlFor="ctaTitle">
                  Título da chamada final
                </label>
                <input
                  id="ctaTitle"
                  name="ctaTitle"
                  type="text"
                  maxLength={160}
                  className="form-control"
                  value={formState.ctaTitle ?? ""}
                  onChange={handleOptionalChange("ctaTitle")}
                  placeholder="Pronto para lançar seu chatbot vendedor?"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="ctaDescription">
                  Descrição
                </label>
                <textarea
                  id="ctaDescription"
                  name="ctaDescription"
                  rows={3}
                  maxLength={320}
                  className="form-control"
                  value={formState.ctaDescription ?? ""}
                  onChange={handleOptionalChange("ctaDescription")}
                  placeholder="Reforce o convite e destaque o próximo passo para o visitante."
                  disabled={isPending}
                />
              </div>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="ctaButtonLabel">
                    Texto do botão
                  </label>
                  <input
                    id="ctaButtonLabel"
                    name="ctaButtonLabel"
                    type="text"
                    maxLength={60}
                    className="form-control"
                    value={formState.ctaButtonLabel ?? ""}
                    onChange={handleOptionalChange("ctaButtonLabel")}
                    placeholder="Começar agora"
                    disabled={isPending}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor="ctaButtonUrl">
                    URL do botão
                  </label>
                <input
                  id="ctaButtonUrl"
                  name="ctaButtonUrl"
                  type="text"
                  inputMode="url"
                  maxLength={300}
                  className="form-control"
                  value={formState.ctaButtonUrl ?? ""}
                  onChange={handleOptionalChange("ctaButtonUrl")}
                  placeholder="https://suaempresa.com/cadastro"
                  disabled={isPending}
                />
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {activeView === "officialGroup" && (
        <section className="card">
          <div className="card-header">
            <h2 className="h5 mb-0">Grupos oficiais públicos</h2>
          </div>
          <div className="card-body d-flex flex-column gap-3">
            <p className="text-secondary mb-0">
              Selecione uma instância, escolha os grupos que devem aparecer no site público e atualize o convite pela
              API do WhatsApp. A instância precisa ser administradora do grupo para o link ser obtido.
            </p>
            <div className="row g-3">
              <div className="col-lg-6">
                <label className="form-label" htmlFor="officialGroupInstanceId">
                  Instância administradora
                </label>
                <select
                  id="officialGroupInstanceId"
                  className="form-select"
                  value={formState.officialGroupInstanceId ?? ""}
                  onChange={handleOfficialGroupInstanceChange}
                  disabled={isPending || isRefreshingOfficialGroup}
                >
                  <option value="">Selecione a instância</option>
                  {availableInstances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name} · {instance.phone} · {instance.userName}
                    </option>
                  ))}
                </select>
                <div className="form-text">
                  A instância precisa estar conectada e ser admin do grupo.
                </div>
              </div>
              <div className="col-lg-6">
                <label className="form-label" htmlFor="officialGroupSelect">
                  Grupo da instância
                </label>
                <select
                  id="officialGroupSelect"
                  className="form-select"
                  value={selectedOfficialGroupId}
                  onChange={handleOfficialGroupSelectChange}
                  disabled={isPending || isRefreshingOfficialGroup}
                >
                  <option value="">Selecione um grupo salvo</option>
                  {officialGroupsForSelectedInstance.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.title} · {group.remoteId}
                    </option>
                  ))}
                </select>
                <div className="form-text">
                  A lista usa os grupos já sincronizados no BotAdmin para a instância escolhida.
                </div>
              </div>
            </div>

            <div className="d-flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddOfficialGroup}
                disabled={isPending || isRefreshingOfficialGroup || !selectedOfficialGroupId}
              >
                Adicionar grupo na página pública
              </button>
            </div>

            <div className="d-flex flex-column gap-3 mt-2">
              {formState.officialGroups.length === 0 ? (
                <div className="border rounded p-3 bg-light text-secondary">
                  Nenhum grupo oficial selecionado ainda.
                </div>
              ) : (
                formState.officialGroups.map((group) => (
                  <div key={group.id} className="border rounded p-3 bg-light">
                    <div className="d-flex flex-column flex-lg-row gap-3 justify-content-between">
                      <div className="d-flex gap-3">
                        {group.imageUrl ? (
                          <img
                            src={group.imageUrl}
                            alt={group.title}
                            width={56}
                            height={56}
                            className="rounded object-fit-cover border"
                          />
                        ) : (
                          <div className="rounded border bg-white d-flex align-items-center justify-content-center fw-bold" style={{ width: 56, height: 56 }}>
                            #
                          </div>
                        )}
                        <div>
                          <div className="fw-semibold">{group.title}</div>
                          <div className="text-secondary small text-break">{group.remoteId}</div>
                          {group.inviteLink ? (
                            <a href={group.inviteLink} target="_blank" rel="noreferrer" className="small text-break">
                              {group.inviteLink}
                            </a>
                          ) : (
                            <div className="text-secondary small">Convite ainda não atualizado.</div>
                          )}
                          {group.inviteUpdatedAt && (
                            <div className="text-secondary small">
                              Atualizado em{" "}
                              {new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "short",
                                timeStyle: "short",
                                timeZone: "America/Sao_Paulo",
                              }).format(new Date(group.inviteUpdatedAt))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2 align-items-start">
                        <button
                          type="button"
                          className={`btn btn-sm ${group.isActive ? "btn-outline-success" : "btn-outline-secondary"}`}
                          onClick={() => handleToggleOfficialGroup(group.id)}
                          disabled={isPending || isRefreshingOfficialGroup}
                        >
                          {group.isActive ? "Visível" : "Oculto"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => handleRefreshOfficialGroupLink(group, false)}
                          disabled={isPending || isRefreshingOfficialGroup}
                        >
                          {isRefreshingOfficialGroup ? "Buscando..." : "Atualizar link"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => handleRefreshOfficialGroupLink(group, true)}
                          disabled={isPending || isRefreshingOfficialGroup}
                        >
                          Resetar convite
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-dark"
                          onClick={() => handleRemoveOfficialGroup(group.id)}
                          disabled={isPending || isRefreshingOfficialGroup}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {activeView === "seo" && (
        <section className="card">
          <div className="card-header">
            <h2 className="h5 mb-0">SEO e rodapé</h2>
          </div>
          <div className="card-body d-flex flex-column gap-3">
            <div>
              <label className="form-label" htmlFor="seoPreviewImage">
                Imagem de pré-visualização (Open Graph)
              </label>
              {displaySeoImage && (
                <div className="d-flex align-items-start gap-3 mb-3">
                  <Image
                    src={displaySeoImage ?? ""}
                    alt="Prévia da imagem para redes sociais"
                    width={200}
                    height={120}
                    className="rounded border bg-white"
                    style={{ width: "200px", height: "120px", objectFit: "cover" }}
                    unoptimized
                  />
                  <div className="d-flex flex-column gap-2">
                    <span className="text-secondary small">
                      {seoImagePreview
                        ? "Prévia da nova imagem (ainda não salva)."
                        : "Imagem atual usada nas pré-visualizações de link."}
                    </span>
                    <div className="d-flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={handleRemoveSeoImageClick}
                        disabled={isPending}
                      >
                        Remover imagem
                      </button>
                      {seoImagePreview && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={handleClearSeoImageFile}
                          disabled={isPending}
                        >
                          Descartar imagem nova
                        </button>
                      )}
                      {showCancelSeoRemoval && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={handleCancelSeoImageRemoval}
                          disabled={isPending}
                        >
                          Cancelar remoção
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {!displaySeoImage && (
                <p className="text-secondary small mb-3">
                  Envie uma arte 1200×630 px (JPG, PNG ou WEBP) de até 3 MB para aparecer nas prévias de redes sociais.
                </p>
              )}
              <input
                id="seoPreviewImage"
                name="seoImage"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="form-control"
                onChange={handleSeoImageFileChange}
                disabled={isPending}
              />
              {removeSeoImage && !seoImagePreview && (
                <p className="text-secondary small mb-0 mt-2">
                  A imagem atual será removida ao salvar.
                </p>
              )}
              {showCancelSeoRemoval && !seoImagePreview && (
                <div className="d-flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleCancelSeoImageRemoval}
                    disabled={isPending}
                  >
                    Cancelar remoção
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="form-label" htmlFor="seoTitle">
                Título para mecanismos de busca
              </label>
              <input
                id="seoTitle"
                name="seoTitle"
                type="text"
                maxLength={160}
                className="form-control"
                value={formState.seoTitle ?? ""}
                onChange={handleOptionalChange("seoTitle")}
                placeholder="Automação inteligente para vendas no WhatsApp"
                disabled={isPending}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="seoDescription">
                Descrição (meta description)
              </label>
              <textarea
                id="seoDescription"
                name="seoDescription"
                rows={3}
                maxLength={320}
                className="form-control"
                value={formState.seoDescription ?? ""}
                onChange={handleOptionalChange("seoDescription")}
                placeholder="Escreva um resumo convidativo para aparecer nos resultados de busca."
                disabled={isPending}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="seoKeywords">
                Palavras-chave principais
              </label>
              <textarea
                id="seoKeywords"
                name="seoKeywords"
                rows={3}
                className="form-control"
                value={formState.seoKeywordsText}
                onChange={handleSeoKeywordsChange}
                placeholder="Insira uma palavra-chave por linha ou separada por vírgulas"
                disabled={isPending}
              />
              <p className="text-secondary small mb-0 mt-2">
                Essas palavras serão adicionadas na meta tag <code>keywords</code> e ajudam a contextualizar a página para os buscadores.
              </p>
              {formState.seoKeywords.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mt-3">
                  {formState.seoKeywords.map((keyword) => (
                    <span key={keyword} className="badge bg-primary-subtle text-primary fw-semibold">
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="form-label" htmlFor="seoHighlightKeywords">
                Palavras-chave destacadas na home
              </label>
              <textarea
                id="seoHighlightKeywords"
                name="seoHighlightKeywords"
                rows={3}
                className="form-control"
                value={formState.seoHighlightKeywordsText}
                onChange={handleSeoHighlightKeywordsChange}
                placeholder="Informe os termos que devem aparecer em destaque na página inicial"
                disabled={isPending}
              />
              <p className="text-secondary small mb-0 mt-2">
                Essas palavras serão exibidas em destaque logo abaixo do herói da página inicial para reforçar os termos principais para o usuário (e para o SEO).
              </p>
              {formState.seoHighlightKeywords.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mt-3">
                  {formState.seoHighlightKeywords.map((keyword) => (
                    <span key={keyword} className="badge bg-warning-subtle text-warning-emphasis fw-semibold">
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="form-label" htmlFor="footerText">
                Texto do rodapé
              </label>
              <textarea
                id="footerText"
                name="footerText"
                rows={3}
                maxLength={600}
                className="form-control"
                value={formState.footerText ?? ""}
                onChange={handleOptionalChange("footerText")}
                placeholder="Informe direitos autorais, dados legais ou informações adicionais."
                disabled={isPending}
              />
            </div>
          </div>
        </section>
      )}

      {activeView === "terms" && (
        <section className="card">
          <div className="card-header">
            <h2 className="h5 mb-0">Termos de uso exibidos em /termos</h2>
          </div>
          <div className="card-body">
            <div className="row g-4">
              <div className="col-lg-6 d-flex flex-column gap-3">
                <div>
                  <label className="form-label" htmlFor="termsContent">
                    Conteúdo dos termos
                  </label>
                  <textarea
                    id="termsContent"
                    name="termsContent"
                    rows={16}
                    className="form-control"
                    value={formState.termsContent ?? ""}
                    onChange={handleTermsContentChange}
                    placeholder="Descreva regras de uso, política de reembolso e avisos importantes."
                    disabled={isPending}
                  />
                  <p className="text-secondary small mb-0 mt-2">
                    {termsCharacterCount} caracteres. A página pública /termos exibirá exatamente este texto.
                  </p>
                </div>
                <div className="border rounded p-3 bg-light">
                  <h3 className="h6 mb-2">Dicas rápidas</h3>
                  <ul className="text-secondary small mb-0 ps-3">
                    <li>Use títulos iniciando com <code>#</code> ou <code>##</code> para destacar seções.</li>
                    <li>Crie listas com <code>-</code> no começo da linha para gerar tópicos.</li>
                    <li>Mencione a política de reembolso, riscos de banimento e como acionar suporte.</li>
                  </ul>
                </div>
              </div>
              <div className="col-lg-6">
                <div className="d-flex align-items-center gap-2 mb-3">
                  <h3 className="h6 mb-0">Pré-visualização</h3>
                  {updatedAtLabel && (
                    <span className="badge text-bg-light">Última atualização {updatedAtLabel}</span>
                  )}
                </div>
                <article
                  className="terms-preview border rounded p-4 bg-white shadow-sm h-100"
                  style={{ lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{
                    __html:
                      termsPreviewHtml ||
                      '<p class="text-secondary">Preencha o conteúdo dos termos para gerar a visualização.</p>',
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="d-flex flex-column flex-md-row align-items-md-center gap-3">
        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar alterações"}
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={resetForm} disabled={isPending}>
            Desfazer mudanças
          </button>
        </div>
        {updatedAtLabel && (
          <span className="text-secondary small ms-md-auto">
            Última atualização em {updatedAtLabel}
          </span>
        )}
      </div>
      </form>

      
    </div>
  );
};

export default AdminSiteSettingsForm;
