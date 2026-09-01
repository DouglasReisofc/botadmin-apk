"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Image from "next/image";

import type {
  AdminMobileOnboardingSlide,
  AdminMobileSettings,
} from "types/admin-mobile";
import type { MobileArtifactsPayload } from "types/mobile-artifacts";
import type { AdminSiteSettings } from "types/admin-site";

type SigningStatus = {
  hasKeystore: boolean;
  updatedAt: string | null;
  keyAlias?: string;
};

const toSigningStatus = (value: unknown): SigningStatus | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.hasKeystore !== "boolean") return null;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : null;
  const keyAlias = typeof record.keyAlias === "string" ? record.keyAlias : undefined;
  return {
    hasKeystore: record.hasKeystore,
    updatedAt,
    keyAlias,
  };
};

type Feedback = { type: "success" | "error"; message: string } | null;

const MAX_ONBOARDING_SLIDES = 5;

type SlideEditorState = {
  id: string;
  title: string;
  description: string;
  buttonLabel: string;
  imageUrl: string | null;
  imageStoragePath: string | null;
  file: File | null;
  previewUrl: string | null;
  removeImage: boolean;
};

const generateClientSlideId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `slide-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
};

const buildFallbackSlides = (
  site: AdminSiteSettings,
): AdminMobileOnboardingSlide[] => {
  const slides: AdminMobileOnboardingSlide[] = [];

  if (site.heroTitle || site.heroSubtitle) {
    slides.push({
      id: "hero",
      title: site.heroTitle || site.siteName || "Bem-vindo",
      description:
        site.heroSubtitle ??
        "Gerencie sua operação com notificações e acompanhe tudo em tempo real.",
      buttonLabel: "Próximo",
      imageUrl: site.heroImageUrl ?? null,
      imageStoragePath: null,
    });
  }

  if (Array.isArray(site.features) && site.features.length > 0) {
    const [firstFeature] = site.features;
    slides.push({
      id: "feature",
      title: firstFeature?.title ?? "Automação inteligente",
      description:
        firstFeature?.description ??
        "Defina regras, receba alertas e mantenha seus clientes sempre atendidos.",
      buttonLabel: "Continuar",
      imageUrl: null,
      imageStoragePath: null,
    });
  }

  slides.push({
    id: "cta",
    title: site.ctaTitle ?? "Tudo pronto para começar?",
    description:
      site.ctaDescription ??
      "Faça login no app, receba notificações e acompanhe seu negócio de qualquer lugar.",
    buttonLabel: "Começar",
    imageUrl: null,
    imageStoragePath: null,
  });

  return slides.slice(0, MAX_ONBOARDING_SLIDES);
};

const createEditorSlides = (
  slides: AdminMobileOnboardingSlide[],
  site: AdminSiteSettings,
): SlideEditorState[] => {
  const baseSlides =
    slides && slides.length > 0 ? slides : buildFallbackSlides(site);

  return baseSlides.slice(0, MAX_ONBOARDING_SLIDES).map((slide, index, array) => {
    const fallbackButton =
      index === array.length - 1 ? "Começar" : "Próximo";
    return {
      id: slide.id || generateClientSlideId(),
      title: slide.title,
      description: slide.description,
      buttonLabel: slide.buttonLabel || fallbackButton,
      imageUrl: slide.imageUrl ?? null,
      imageStoragePath: slide.imageStoragePath ?? null,
      file: null,
      previewUrl: null,
      removeImage: false,
    };
  });
};

interface Props {
  initialMobile: AdminMobileSettings;
  initialSite: AdminSiteSettings;
}

const AdminMobileSettingsForm = ({ initialMobile, initialSite }: Props) => {
  const [mobile, setMobile] = useState(initialMobile);
  const [site, setSite] = useState(initialSite);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Mobile meta state
  const [appName, setAppName] = useState(mobile.appName);
  const [packageName, setPackageName] = useState(mobile.packageName);
  const [versionCode, setVersionCode] = useState(String(mobile.versionCode));
  const [versionName, setVersionName] = useState(mobile.versionName);
  const [serverUrl, setServerUrl] = useState(mobile.serverUrl ?? "");
  const [minVersionCode, setMinVersionCode] = useState<string>(
    mobile.minVersionCode?.toString?.() ?? "",
  );
  const [releaseNotes, setReleaseNotes] = useState<string>(
    mobile.releaseNotes ?? "",
  );

  const [onboardingEnabled, setOnboardingEnabled] = useState<boolean>(
    !!mobile.onboardingEnabled,
  );
  const [onboardingSlides, setOnboardingSlides] = useState<SlideEditorState[]>(
    () => createEditorSlides(mobile.onboardingSlides, site),
  );

  const cleanupSlidePreviews = useCallback((slides: SlideEditorState[]) => {
    slides.forEach((slide) => {
      if (slide.previewUrl) {
        URL.revokeObjectURL(slide.previewUrl);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      cleanupSlidePreviews(onboardingSlides);
    };
  }, [cleanupSlidePreviews, onboardingSlides]);

  const loadSlidesFromSettings = useCallback(
    (settings: AdminMobileSettings, currentSite: AdminSiteSettings) => {
      setOnboardingEnabled(!!settings.onboardingEnabled);
      setOnboardingSlides((prev) => {
        cleanupSlidePreviews(prev);
        return createEditorSlides(settings.onboardingSlides, currentSite);
      });
    },
    [cleanupSlidePreviews],
  );

  const updateSlide = useCallback(
    (index: number, updater: (slide: SlideEditorState) => SlideEditorState) => {
      setOnboardingSlides((prev) =>
        prev.map((slide, idx) => {
          if (idx !== index) return slide;
          const next = updater(slide);
          if (slide.previewUrl && slide.previewUrl !== next.previewUrl) {
            URL.revokeObjectURL(slide.previewUrl);
          }
          return next;
        }),
      );
    },
    [],
  );

  const moveSlide = useCallback((index: number, direction: "up" | "down") => {
    setOnboardingSlides((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  }, []);

  const removeSlide = useCallback((index: number) => {
    setOnboardingSlides((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      const next = prev.filter((_, idx) => idx !== index);
      const removed = prev[index];
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }, []);

  const addSlide = useCallback(() => {
    setOnboardingSlides((prev) => {
      if (prev.length >= MAX_ONBOARDING_SLIDES) {
        return prev;
      }
      return [
        ...prev,
        {
          id: generateClientSlideId(),
          title: "",
          description: "",
          buttonLabel: prev.length === 0 ? "Começar" : "Próximo",
          imageUrl: null,
          imageStoragePath: null,
          file: null,
          previewUrl: null,
          removeImage: false,
        },
      ];
    });
  }, []);

  const handleSlideChange = useCallback(
    (
      index: number,
      field: "title" | "description" | "buttonLabel",
      value: string,
    ) => {
      updateSlide(index, (slide) => ({
        ...slide,
        [field]: value,
      }));
    },
    [updateSlide],
  );

  const handleSlideFileChange = useCallback(
    (index: number, file: File | null) => {
      updateSlide(index, (slide) => ({
        ...slide,
        file,
        previewUrl: file ? URL.createObjectURL(file) : null,
        removeImage: file ? false : slide.removeImage,
      }));
    },
    [updateSlide],
  );

  const handleSlideRemoveImageToggle = useCallback(
    (index: number, checked: boolean) => {
      updateSlide(index, (slide) => ({
        ...slide,
        removeImage: checked,
        file: checked ? null : slide.file,
        previewUrl: checked ? null : slide.previewUrl,
      }));
    },
    [updateSlide],
  );

  // Icon state
  const [appIconFile, setAppIconFile] = useState<File | null>(null);
  const [appIconPreview, setAppIconPreview] = useState<string | null>(null);
  const [removeAppIcon, setRemoveAppIcon] = useState(false);

  // Keystore state
  const [keyStatus, setKeyStatus] = useState<SigningStatus | null>(null);
  const [busyKs, setBusyKs] = useState(false);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [keyAlias, setKeyAlias] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [storePassword, setStorePassword] = useState("");
  // Distribution state
  const [details, setDetails] = useState<string>("");
  const [androidMode, setAndroidMode] = useState<"store" | "file">("file");
  const [androidStoreUrl, setAndroidStoreUrl] = useState<string>("");
  const [androidFile, setAndroidFile] = useState<File | null>(null);
  const [removeAndroidFile, setRemoveAndroidFile] = useState(false);

  const [iosMode, setIosMode] = useState<"store" | "file">("store");
  const [iosStoreUrl, setIosStoreUrl] = useState<string>("");
  const [iosFile, setIosFile] = useState<File | null>(null);
  const [removeIosFile, setRemoveIosFile] = useState(false);

  const [windowsMode, setWindowsMode] = useState<"store" | "file">("store");
  const [windowsStoreUrl, setWindowsStoreUrl] = useState<string>("");
  const [windowsFile, setWindowsFile] = useState<File | null>(null);
  const [removeWindowsFile, setRemoveWindowsFile] = useState(false);

  useEffect(() => {
    if (!appIconFile) { setAppIconPreview(null); return; }
    const url = URL.createObjectURL(appIconFile);
    setAppIconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [appIconFile]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/mobile/signing", { cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (active) {
          if (r.ok) {
            const status = toSigningStatus(d);
            if (status) {
              setKeyStatus(status);
              if (status.keyAlias) {
                setKeyAlias((prev) => (prev ? prev : status.keyAlias ?? prev));
              }
            } else {
              setKeyStatus(null);
            }
          } else {
            setKeyStatus(null);
          }
        }
      } catch {
        if (active) setKeyStatus(null);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch('/api/admin/mobile/artifacts', { cache: 'no-store' });
        if (!mounted) return;
        if (r.ok) {
          const j = (await r.json()) as MobileArtifactsPayload;
          setDetails(j.details ?? "");
          setAndroidMode(j.preferredAndroidMode ?? (j.androidStoreUrl ? 'store' : 'file'));
          setAndroidStoreUrl(j.androidStoreUrl ?? "");
          setIosMode(j.preferredIosMode ?? (j.iosStoreUrl ? 'store' : 'file'));
          setIosStoreUrl(j.iosStoreUrl ?? "");
          setWindowsMode(j.preferredWindowsMode ?? (j.windowsStoreUrl ? 'store' : 'file'));
          setWindowsStoreUrl(j.windowsStoreUrl ?? "");
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);
  const formattedUpdatedAt = useMemo(
    () =>
      mobile.updatedAt
        ? new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(mobile.updatedAt))
        : null,
    [mobile.updatedAt],
  );
  const canAddSlide = onboardingSlides.length < MAX_ONBOARDING_SLIDES;
  const displayAppIcon = removeAppIcon ? null : (appIconPreview ?? site.mobileAppIconUrl);

  const submitMobile = (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("appName", appName);
        fd.set("packageName", packageName);
        fd.set("versionCode", versionCode);
        fd.set("versionName", versionName);
        fd.set("serverUrl", serverUrl);
        fd.set("minVersionCode", minVersionCode);
        fd.set("releaseNotes", releaseNotes);
        fd.set("onboardingEnabled", String(onboardingEnabled));

        const slidesPayload = onboardingSlides.map((slide) => ({
          id: slide.id,
          title: slide.title,
          description: slide.description,
          buttonLabel: slide.buttonLabel?.trim() || null,
          imageStoragePath: slide.removeImage ? null : slide.imageStoragePath,
          removeImage: slide.removeImage,
        }));

        fd.set(
          "onboardingSlides",
          JSON.stringify(slidesPayload),
        );

        onboardingSlides.forEach((slide, index) => {
          if (slide.file) {
            fd.set(`onboardingSlideImage[${index}]`, slide.file);
          }
          if (slide.removeImage) {
            fd.set(`onboardingSlideRemoveImage[${index}]`, "true");
          }
        });

        const r = await fetch("/api/admin/mobile/settings", { method: "PUT", body: fd });
        const p = await r.json().catch(() => null);
        if (!r.ok) throw new Error(p?.message || "Falha ao salvar as configurações do app.");
        const updatedSettings = p.settings as AdminMobileSettings;
        setMobile(updatedSettings);
        loadSlidesFromSettings(updatedSettings, site);
        setFeedback({ type: "success", message: p?.message || "Configurações atualizadas." });
      } catch (e) {
        setFeedback({ type: "error", message: e instanceof Error ? e.message : "Erro ao salvar." });
      }
    });
  };

  const submitIcon = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const fd = new FormData();
      if (appIconFile) fd.set("appIcon", appIconFile);
      fd.set("removeAppIcon", String(removeAppIcon));
      // Enviar campos obrigatórios do /api/admin/site para não falhar validação
      fd.set("siteName", site.siteName);
      fd.set("tagline", site.tagline ?? "");
      fd.set("supportEmail", site.supportEmail ?? "");
      fd.set("supportPhone", site.supportPhone ?? "");
      fd.set("heroTitle", site.heroTitle ?? "");
      fd.set("heroSubtitle", site.heroSubtitle ?? "");
      fd.set("heroButtonLabel", site.heroButtonLabel ?? "");
      fd.set("heroButtonUrl", site.heroButtonUrl ?? "");
      fd.set("seoTitle", site.seoTitle ?? "");
      fd.set("seoDescription", site.seoDescription ?? "");
      fd.set("footerText", site.footerText ?? "");
      const r = await fetch("/api/admin/site", { method: "PUT", body: fd });
      const p = await r.json().catch(() => null);
      if (!r.ok) throw new Error(p?.message || "Falha ao salvar ícone.");
      setSite(p.settings as AdminSiteSettings);
      setAppIconFile(null);
      setAppIconPreview(null);
      setRemoveAppIcon(false);
      setFeedback({ type: "success", message: "Ícone atualizado." });
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "Erro ao salvar ícone." });
    }
  };
  
  const saveKeystore = async (e: FormEvent) => {
    e.preventDefault(); setBusyKs(true); setFeedback(null);
    try {
      const fd = new FormData();
      if (keyFile) fd.set("keystore", keyFile);
      fd.set("keyAlias", keyAlias); fd.set("keyPassword", keyPassword); fd.set("storePassword", storePassword);
      const r = await fetch("/api/admin/mobile/signing", { method: "PUT", body: fd });
      const p = await r.json().catch(() => null);
      if (!r.ok) throw new Error(p?.message || "Falha ao salvar keystore.");
      setKeyStatus({ hasKeystore: true, updatedAt: p?.meta?.updatedAt || new Date().toISOString(), keyAlias: p?.meta?.keyAlias });
      setKeyFile(null);
      // mantém alias salvo na interface, limpa apenas senhas
      setKeyAlias(p?.meta?.keyAlias || keyAlias);
      setKeyPassword("");
      setStorePassword("");
      setFeedback({ type: "success", message: p?.message || "Keystore salvo." });
    } catch (e) {
      setFeedback({ type: "error", message: e instanceof Error ? e.message : "Erro ao salvar keystore." });
    } finally { setBusyKs(false); }
  };

  const removeKeystore = async () => {
    setBusyKs(true); setFeedback(null);
    try { const r = await fetch("/api/admin/mobile/signing", { method: "DELETE" }); const p = await r.json().catch(() => null); if (!r.ok) throw new Error(p?.message || "Falha ao remover keystore."); setKeyStatus({ hasKeystore: false, updatedAt: null }); setFeedback({ type: "success", message: p?.message || "Keystore removido." }); }
    catch (e) { setFeedback({ type: "error", message: e instanceof Error ? e.message : "Erro ao remover." }); }
    finally { setBusyKs(false); }
  };

  return (
    <div className="d-flex flex-column gap-4">
      <section className="card">
        <div className="card-header">
          <h2 className="h5 mb-0">Metadados do aplicativo</h2>
        </div>
        <form className="card-body d-flex flex-column gap-3" onSubmit={submitMobile}>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="appName">Nome do app</label>
              <input id="appName" className="form-control" value={appName} onChange={e => setAppName(e.currentTarget.value)} maxLength={120} required disabled={isPending} />
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="packageName">Nome do pacote</label>
              <input id="packageName" className="form-control" value={packageName} onChange={e => setPackageName(e.currentTarget.value)} required disabled={isPending} />
            </div>
          </div>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="versionCode">Version code</label>
              <input id="versionCode" type="number" min={1} className="form-control" value={versionCode} onChange={e => setVersionCode(e.currentTarget.value)} required disabled={isPending} />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="versionName">Version name</label>
              <input id="versionName" className="form-control" value={versionName} onChange={e => setVersionName(e.currentTarget.value)} required disabled={isPending} />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="serverUrl">URL do servidor do app</label>
              <input id="serverUrl" className="form-control" value={serverUrl} onChange={e => setServerUrl(e.currentTarget.value)} placeholder="https://seu-dominio.com" disabled={isPending} />
            </div>
          </div>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="minVersionCode">Versão mínima (code)</label>
              <input id="minVersionCode" type="number" min={1} className="form-control" value={minVersionCode} onChange={e => setMinVersionCode(e.currentTarget.value)} placeholder="Opcional" />
            </div>
            <div className="col-md-8">
              <label className="form-label" htmlFor="releaseNotes">Notas de versão</label>
              <textarea id="releaseNotes" rows={2} className="form-control" value={releaseNotes} onChange={e => setReleaseNotes(e.currentTarget.value)} placeholder="O que há de novo nesta versão?" />
            </div>
          </div>
          <div className="rounded border p-3 bg-light">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <h3 className="h6 mb-1">Onboarding inicial (slides)</h3>
                <p className="text-secondary mb-0 small">
                  Mostra telas introdutórias com swipe e botão &quot;Próximo&quot; ao abrir o app pela primeira vez.
                </p>
              </div>
              <div className="form-check form-switch m-0">
                <input
                  id="onboardingEnabled"
                  className="form-check-input"
                  type="checkbox"
                  checked={onboardingEnabled}
                  onChange={(e) => setOnboardingEnabled(e.currentTarget.checked)}
                />
                <label className="form-check-label ms-2" htmlFor="onboardingEnabled">
                  {onboardingEnabled ? "Onboarding ativo" : "Onboarding desativado"}
                </label>
              </div>
            </div>
            <div className="d-flex flex-column gap-3 mt-3">
              {onboardingSlides.map((slide, index) => {
                const previewSrc = slide.previewUrl ?? (!slide.removeImage ? slide.imageUrl : null);
                const canMoveUp = index > 0;
                const canMoveDown = index < onboardingSlides.length - 1;
                return (
                  <div key={slide.id} className="border rounded-3 p-3 bg-white d-flex flex-column gap-3">
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                      <h4 className="h6 mb-0">Slide {index + 1}</h4>
                      <div className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => moveSlide(index, "up")}
                          disabled={!canMoveUp}
                        >
                          Subir
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => moveSlide(index, "down")}
                          disabled={!canMoveDown}
                        >
                          Descer
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => removeSlide(index)}
                          disabled={onboardingSlides.length <= 1}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Título</label>
                        <input
                          className="form-control"
                          value={slide.title}
                          onChange={(e) =>
                            handleSlideChange(index, "title", e.currentTarget.value)
                          }
                          maxLength={120}
                          placeholder="Apresente a principal vantagem"
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Texto do botão</label>
                        <input
                          className="form-control"
                          value={slide.buttonLabel}
                          onChange={(e) =>
                            handleSlideChange(
                              index,
                              "buttonLabel",
                              e.currentTarget.value,
                            )
                          }
                          maxLength={40}
                          placeholder={index === onboardingSlides.length - 1 ? "Começar" : "Próximo"}
                        />
                      </div>
                      <div className="col-12">
                        <label className="form-label">Descrição</label>
                        <textarea
                          className="form-control"
                          rows={3}
                          value={slide.description}
                          onChange={(e) =>
                            handleSlideChange(
                              index,
                              "description",
                              e.currentTarget.value,
                            )
                          }
                          maxLength={400}
                          placeholder="Explique rapidamente o benefício para o usuário."
                        />
                      </div>
                    </div>
                    <div className="d-flex flex-column flex-md-row gap-3 align-items-start">
                      <div className="d-flex flex-column align-items-center gap-2">
                        <div
                          className="rounded border bg-light d-flex align-items-center justify-content-center"
                          style={{ width: "140px", height: "140px" }}
                        >
                          {previewSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewSrc}
                              alt={`Prévia do slide ${index + 1}`}
                              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <span className="text-secondary small text-center px-2">
                              Sem imagem
                            </span>
                          )}
                        </div>
                        {slide.removeImage && !slide.previewUrl && (
                          <span className="text-danger small text-center">
                            A imagem será removida.
                          </span>
                        )}
                      </div>
                      <div className="flex-grow-1 d-flex flex-column gap-2">
                        <label className="form-label">Imagem (opcional)</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="form-control"
                          onChange={(e) =>
                            handleSlideFileChange(
                              index,
                              e.currentTarget.files?.[0] ?? null,
                            )
                          }
                        />
                        {(slide.imageUrl || slide.previewUrl) && (
                          <div className="form-check">
                            <input
                              id={`remove-slide-img-${slide.id}`}
                              className="form-check-input"
                              type="checkbox"
                              checked={slide.removeImage}
                              onChange={(e) =>
                                handleSlideRemoveImageToggle(
                                  index,
                                  e.currentTarget.checked,
                                )
                              }
                            />
                            <label
                              className="form-check-label"
                              htmlFor={`remove-slide-img-${slide.id}`}
                            >
                              Remover imagem deste slide
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={addSlide}
                  disabled={!canAddSlide}
                >
                  Adicionar slide
                </button>
                {!canAddSlide && (
                  <span className="text-secondary small ms-2">
                    Limite máximo de {MAX_ONBOARDING_SLIDES} slides atingido.
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={isPending}>{isPending ? "Salvando..." : "Salvar"}</button>
            {mobile.updatedAt && <span className="text-secondary small">Última atualização em {formattedUpdatedAt}</span>}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="h5 mb-0">Ícone do aplicativo</h2>
        </div>
        <form className="card-body d-flex flex-column gap-3" onSubmit={submitIcon} encType="multipart/form-data">
          {displayAppIcon ? (
            <div className="d-flex align-items-center gap-3">
              <Image src={displayAppIcon} alt="Ícone" width={96} height={96} className="rounded border bg-white" style={{ width: "96px", height: "96px", objectFit: "contain" }} unoptimized />
              <div className="d-flex flex-column gap-2">
                <span className="text-secondary small">{appIconPreview ? "Prévia do novo ícone" : "Ícone atual"}</span>
                <div className="d-flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setRemoveAppIcon(true)}>Remover ícone</button>
                  {appIconPreview && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setAppIconFile(null); setAppIconPreview(null); setRemoveAppIcon(false); }}>Descartar ícone novo</button>}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-secondary small mb-0">Nenhum ícone configurado.</p>
          )}
          <input type="file" name="appIcon" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="form-control" onChange={(e) => setAppIconFile(e.currentTarget.files?.[0] ?? null)} />
          <div className="d-flex flex-wrap gap-2">
            <button type="submit" className="btn btn-outline-primary">Salvar ícone</button>
            {removeAppIcon && !appIconPreview && <span className="text-secondary small">O ícone atual será removido.</span>}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="h5 mb-0">Assinatura Android (Keystore)</h2>
        </div>
        <form className="card-body d-flex flex-column gap-3" onSubmit={saveKeystore} encType="multipart/form-data">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <p className="text-secondary mb-0">Status: {keyStatus?.hasKeystore ? "Keystore configurado" : "Nenhum keystore salvo"}{keyStatus?.updatedAt ? ` • Atualizado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(keyStatus.updatedAt))}` : ""}</p>
            {keyStatus?.hasKeystore && (
              <a className="btn btn-sm btn-outline-secondary" href="/api/admin/mobile/signing?download=1">Baixar keystore</a>
            )}
          </div>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="keystore">Arquivo do keystore</label>
              <input id="keystore" name="keystore" type="file" accept=".jks,.keystore,.p12,.pfx,application/octet-stream" className="form-control" onChange={(e) => setKeyFile(e.currentTarget.files?.[0] ?? null)} disabled={busyKs} />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="alias">Alias</label>
              <input id="alias" className="form-control" value={keyAlias} onChange={(e) => setKeyAlias(e.currentTarget.value)} disabled={busyKs} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="storePass">Senha do keystore</label>
              <input id="storePass" type="password" className="form-control" value={storePassword} onChange={(e) => setStorePassword(e.currentTarget.value)} disabled={busyKs} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="keyPass">Senha do alias</label>
              <input id="keyPass" type="password" className="form-control" value={keyPassword} onChange={(e) => setKeyPassword(e.currentTarget.value)} disabled={busyKs} />
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busyKs}>{busyKs ? "Salvando..." : "Salvar keystore"}</button>
            <button type="button" className="btn btn-outline-danger" disabled={busyKs || !keyStatus?.hasKeystore} onClick={removeKeystore}>Remover keystore</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="h5 mb-0">Distribuição e download</h2>
        </div>
        <form className="card-body d-flex flex-column gap-4" onSubmit={async (e) => {
          e.preventDefault(); setFeedback(null);
          try {
            const fd = new FormData();
            fd.set('details', details);
            fd.set('androidMode', androidMode);
            fd.set('androidStoreUrl', androidStoreUrl);
            fd.set('removeAndroidFile', String(removeAndroidFile));
            if (androidFile) fd.set('androidFile', androidFile);
            fd.set('iosMode', iosMode);
            fd.set('iosStoreUrl', iosStoreUrl);
            fd.set('removeIosFile', String(removeIosFile));
            if (iosFile) fd.set('iosFile', iosFile);
            fd.set('windowsMode', windowsMode);
            fd.set('windowsStoreUrl', windowsStoreUrl);
            fd.set('removeWindowsFile', String(removeWindowsFile));
            if (windowsFile) fd.set('windowsFile', windowsFile);
            const r = await fetch('/api/admin/mobile/artifacts', { method: 'PUT', body: fd });
            const j = await r.json().catch(() => null);
            if (!r.ok) throw new Error(j?.message || 'Falha ao salvar.');
            setFeedback({ type: 'success', message: 'Opções de download atualizadas.' });
            setAndroidFile(null); setRemoveAndroidFile(false);
            setIosFile(null); setRemoveIosFile(false);
            setWindowsFile(null); setRemoveWindowsFile(false);
          } catch (e) {
            setFeedback({ type: 'error', message: e instanceof Error ? e.message : 'Erro ao salvar.' });
          }
        }}>
          <div className="row g-3">
            <div className="col-md-12">
              <label className="form-label">Texto de detalhes (aparece no modal de download)</label>
              <textarea className="form-control" rows={3} value={details} onChange={e => setDetails(e.currentTarget.value)} />
            </div>
          </div>
          <div className="row g-3">
            <div className="col-lg-4">
              <div className="border rounded p-3 h-100">
                <h6 className="mb-2">Android</h6>
                <div className="d-flex gap-2 mb-2">
                  <select className="form-select form-select-sm" value={androidMode} onChange={e => setAndroidMode(e.currentTarget.value === 'store' ? 'store' : 'file')}>
                    <option value="file">Arquivo (.apk)</option>
                    <option value="store">Link (Play Store)</option>
                  </select>
                </div>
                {androidMode === 'store' ? (
                  <input className="form-control" placeholder="https://play.google.com/..." value={androidStoreUrl} onChange={e => setAndroidStoreUrl(e.currentTarget.value)} />
                ) : (
                  <>
                    <input type="file" className="form-control" accept=".apk,application/vnd.android.package-archive" onChange={e => setAndroidFile(e.currentTarget.files?.[0] ?? null)} />
                    <div className="form-check mt-2">
                      <input id="rm-apk" className="form-check-input" type="checkbox" checked={removeAndroidFile} onChange={e => setRemoveAndroidFile(e.currentTarget.checked)} />
                      <label className="form-check-label" htmlFor="rm-apk">Remover APK atual</label>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="col-lg-4">
              <div className="border rounded p-3 h-100">
                <h6 className="mb-2">iOS</h6>
                <div className="d-flex gap-2 mb-2">
                  <select className="form-select form-select-sm" value={iosMode} onChange={e => setIosMode(e.currentTarget.value === 'file' ? 'file' : 'store')}>
                    <option value="store">Link (App Store)</option>
                    <option value="file">Arquivo (.ipa)</option>
                  </select>
                </div>
                {iosMode === 'store' ? (
                  <input className="form-control" placeholder="https://apps.apple.com/..." value={iosStoreUrl} onChange={e => setIosStoreUrl(e.currentTarget.value)} />
                ) : (
                  <>
                    <input type="file" className="form-control" accept=".ipa,application/octet-stream" onChange={e => setIosFile(e.currentTarget.files?.[0] ?? null)} />
                    <div className="form-check mt-2">
                      <input id="rm-ipa" className="form-check-input" type="checkbox" checked={removeIosFile} onChange={e => setRemoveIosFile(e.currentTarget.checked)} />
                      <label className="form-check-label" htmlFor="rm-ipa">Remover IPA atual</label>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="col-lg-4">
              <div className="border rounded p-3 h-100">
                <h6 className="mb-2">Windows</h6>
                <div className="d-flex gap-2 mb-2">
                  <select className="form-select form-select-sm" value={windowsMode} onChange={e => setWindowsMode(e.currentTarget.value === 'file' ? 'file' : 'store')}>
                    <option value="store">Link externo</option>
                    <option value="file">Arquivo (.exe/.msi)</option>
                  </select>
                </div>
                {windowsMode === 'store' ? (
                  <input className="form-control" placeholder="https://..." value={windowsStoreUrl} onChange={e => setWindowsStoreUrl(e.currentTarget.value)} />
                ) : (
                  <>
                    <input type="file" className="form-control" accept=".exe,.msi,.zip,application/octet-stream" onChange={e => setWindowsFile(e.currentTarget.files?.[0] ?? null)} />
                    <div className="form-check mt-2">
                      <input id="rm-win" className="form-check-input" type="checkbox" checked={removeWindowsFile} onChange={e => setRemoveWindowsFile(e.currentTarget.checked)} />
                      <label className="form-check-label" htmlFor="rm-win">Remover instalador atual</label>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary">Salvar distribuição</button>
          </div>
        </form>
      </section>

      {feedback && (
        <div className={`alert ${feedback.type === "success" ? "alert-success" : "alert-danger"}`}>{feedback.message}</div>
      )}
    </div>
  );
};

export default AdminMobileSettingsForm;

