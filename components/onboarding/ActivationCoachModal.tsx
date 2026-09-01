"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  IconArrowRight,
  IconBrandWhatsapp,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconLock,
  IconSparkles,
  IconTopologyStar,
} from "@tabler/icons-react";

type PlanStatus = {
  plan: { name?: string | null } | null;
  status: "active" | "pending" | "expired" | "inactive";
  isTrial?: boolean;
};

type ActivationCoachModalProps = {
  planStatus: PlanStatus;
  connectedInstances: number;
  activeGroupCount: number;
  variant?: "modal" | "inline";
};

const STORAGE_KEY = "botadmin.onboarding.v4.completed";
const GROUP_MANAGEMENT_PATH = "/dashboard/user?section=conversations";
const GROUP_MANAGEMENT_BASE_PATH = "/dashboard/user";
const START_GIF = "https://media.tenor.com/y3YgQ53poMsAAAAi/hey-hi.gif";
const DONE_GIF = "https://media.tenor.com/9fBPR6lTnrMAAAAi/pengu-pudgy.gif";

type ChecklistStep = {
  key: "plan" | "instance" | "group";
  title: string;
  description: string;
  href: string;
  done: boolean;
  accent: string;
};

const StepPill = ({
  step,
  isNext,
  disabled,
  onNavigate,
}: {
  step: ChecklistStep;
  isNext: boolean;
  disabled: boolean;
  onNavigate: (href: string) => void;
}) => (
  <div
    className="d-flex align-items-start gap-3 p-3 rounded-3 bg-white shadow-sm border h-100 flex-column flex-md-row"
    style={{ minHeight: 148 }}
  >
    <div
      className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: step.accent,
        color: "#0b132b",
        boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
      }}
    >
      {step.done ? <IconCheck size={24} stroke={2} /> : <IconTopologyStar size={24} stroke={2.2} />}
    </div>
    <div className="flex-grow-1 w-100">
      <div className="d-flex align-items-center gap-2 flex-wrap">
        <span className="fw-semibold">{step.title}</span>
        {step.done ? (
          <span className="badge bg-success-subtle text-success">feito</span>
        ) : isNext ? (
          <span className="badge bg-primary-subtle text-primary">próximo</span>
        ) : null}
      </div>
      <p className="mb-2 text-secondary small">{step.description}</p>
      <button
        type="button"
        className={`btn btn-sm fw-semibold ${step.done ? "btn-outline-dark" : "btn-outline-primary"} ${
          disabled ? "disabled" : ""
        }`}
        disabled={disabled}
        onClick={() => onNavigate(step.href)}
      >
        {step.done ? "Revisar" : "Começar"}
      </button>
    </div>
  </div>
);

const ActivationCoachModal = ({
  planStatus,
  connectedInstances,
  activeGroupCount,
  variant = "modal",
}: ActivationCoachModalProps) => {
  const router = useRouter();
  const hasPlan =
    Boolean(planStatus.plan) &&
    (planStatus.status === "active" || planStatus.status === "pending" || planStatus.isTrial);

  const steps: ChecklistStep[] = [
    {
      key: "plan",
      title: "Ative seu grupo",
      description: hasPlan
        ? "Grupo liberado. Você pode renovar pela tela de conversas."
        : "Escolha um grupo no chat para liberar o robô.",
      href: GROUP_MANAGEMENT_PATH,
      done: Boolean(hasPlan),
      accent: "linear-gradient(135deg, #ffe29f 0%, #ffa99f 50%, #ff719a 100%)",
    },
    {
      key: "instance",
      title: "Conecte seu WhatsApp",
      description: connectedInstances > 0
        ? "Instância conectada. Pode parear novas contas se precisar."
        : "Pareie sua conta no painel para o robô responder no seu número.",
      href: "/dashboard/user/configurar-bot",
      done: connectedInstances > 0,
      accent: "linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)",
    },
    {
      key: "group",
      title: "Cadastre seu grupo",
      description: activeGroupCount > 0
        ? "Grupo configurado. Ajuste prefixo, filtros e boas-vindas."
        : "Informe em qual grupo o robô deve atuar e configure as regras.",
      href: GROUP_MANAGEMENT_PATH,
      done: activeGroupCount > 0,
      accent: "linear-gradient(135deg, #6ce3b2 0%, #0aa06a 100%)",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const nextStepKey = steps.find((s) => !s.done)?.key;
  const progressPct = Math.round((doneCount / steps.length) * 100);

  const canStart = (stepKey: ChecklistStep["key"], done: boolean): boolean => {
    if (done) return true;
    const order = steps.map((s) => s.key);
    const idx = order.indexOf(stepKey);
    if (idx <= 0) return true;
    return order.slice(0, idx).every((key) => steps.find((s) => s.key === key)?.done);
  };

  const [hasAcknowledged, setHasAcknowledged] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") {
        return true;
      }
    }
    return allDone;
  });
  const [isMobile, setIsMobile] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname() || "";
  const isPlanPage = pathname?.startsWith(GROUP_MANAGEMENT_BASE_PATH);
  const skipChecklistOnPlanPage = isPlanPage && Boolean(planStatus.plan);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    setHasAcknowledged(stored === "1" || allDone);
    const check = () => setIsMobile(window.innerWidth <= 820);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [allDone]);

  const pendingStep = steps.find((step) => !step.done) ?? null;
	  const allowedPathForPending =
	    pendingStep?.key === "plan"
	      ? GROUP_MANAGEMENT_BASE_PATH
      : pendingStep?.key === "instance"
      ? "/dashboard/user/configurar-bot"
      : pendingStep?.key === "group"
      ? GROUP_MANAGEMENT_BASE_PATH
      : null;
  const isOnAllowedPath =
    allowedPathForPending && pathname ? pathname.startsWith(allowedPathForPending) : false;

  const shouldShowChecklist =
    variant === "modal"
      ? Boolean(!skipChecklistOnPlanPage && !allDone && !isOnAllowedPath)
      : Boolean(!allDone);
  const shouldShowCongrats =
    variant === "modal" ? Boolean(!skipChecklistOnPlanPage && allDone && !hasAcknowledged) : false;
  const shouldRender = variant === "modal" ? shouldShowChecklist || shouldShowCongrats : shouldShowChecklist;

  useEffect(() => {
    if (mounted && allDone && !hasAcknowledged) {
      localStorage.setItem(STORAGE_KEY, "1");
      setHasAcknowledged(true);
    }
  }, [mounted, allDone, hasAcknowledged]);

  useEffect(() => {
    if (variant !== "modal") return;
    if (typeof document === "undefined") return;
    const content = document.getElementById("content");
    if (shouldRender) {
      document.body.style.overflow = "hidden";
      document.body.classList.add("checklist-active");
      content?.classList.add("checklist-blur");
    } else {
      document.body.style.overflow = "";
      document.body.classList.remove("checklist-active");
      content?.classList.remove("checklist-blur");
    }
    return () => {
      document.body.style.overflow = "";
      document.body.classList.remove("checklist-active");
      content?.classList.remove("checklist-blur");
    };
  }, [shouldRender]);

  const handleDismiss = () => {
    if (!allDone) return;
    localStorage.setItem(STORAGE_KEY, "1");
    setHasAcknowledged(true);
  };

  const handleNavigate = (href: string) => {
    router.push(href);
  };

  if (variant === "inline") {
    if (!shouldRender) return null;
    if (allDone) return null;
    const nextStep = steps.find((step) => !step.done);
    if (!nextStep) return null;

    return (
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body p-3 p-md-4">
          <div className="d-flex flex-column flex-lg-row align-items-lg-center gap-3">
            <div className="d-flex align-items-center gap-3">
              <div
                className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #10b26c 0%, #0b9f61 50%, #087248 100%)",
                  color: "#fff",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                }}
              >
                <IconSparkles size={24} stroke={2} />
              </div>
              <div>
                <p className="mb-1 text-uppercase small text-secondary" style={{ letterSpacing: "0.08em" }}>
                  Checklist rápido
                </p>
                <h2 className="h5 mb-1 fw-bold">Ative seu robô em 3 passos</h2>
                <p className="mb-0 text-secondary">
                  Conclua o básico para liberar o Bot Admin funcionando no seu grupo.
                </p>
              </div>
            </div>
            <div className="ms-lg-auto w-100 w-lg-auto">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <small className="text-secondary fw-bold">Progresso</small>
                <small className="text-secondary fw-bold">{progressPct}%</small>
              </div>
              <div className="progress" style={{ height: 6 }}>
                <div
                  className="progress-bar bg-success"
                  role="progressbar"
                  style={{ width: `${progressPct}%` }}
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          </div>

          <div className="mt-3">
            <StepPill
              step={nextStep}
              isNext
              disabled={!canStart(nextStep.key, nextStep.done)}
              onNavigate={handleNavigate}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!shouldRender || !mounted || typeof document === "undefined") return null;

  const heroGif = allDone ? DONE_GIF : START_GIF;
  const title = allDone ? "Tudo pronto! ✅" : "Ative seu robô em 3 passos ✨";
  const subtitle = allDone
    ? "Agora vá ao grupo e digite o prefixo + menu (ex.: /menu) para testar o robô."
    : "Conclua o básico para liberar o Bot Admin funcionando no seu grupo. São menos de 2 minutos.";

  const goTo = (dir: "next" | "prev") => {
    setCurrentSlide((prev) => {
      const next = dir === "next" ? prev + 1 : prev - 1;
      if (next < 0) return steps.length - 1;
      if (next >= steps.length) return 0;
      return next;
    });
  };

  const overlay = (
    <div
      className="checklist-overlay position-fixed"
      style={{
        background: "rgba(7, 12, 26, 0.82)",
        backdropFilter: "blur(16px)",
        zIndex: 9700,
        overflowY: "auto",
        alignItems: "flex-start",
        paddingTop: isMobile ? 32 : 64,
      }}
    >
      <div
        className="card border-0 shadow-lg w-100"
        style={{
          maxWidth: 1100,
          borderRadius: "22px",
          overflow: "hidden",
          marginTop: isMobile ? 12 : 0,
        }}
      >
        <div
          className="p-3 p-md-4 text-white"
          style={{
            background: "linear-gradient(135deg, #10b26c 0%, #0b9f61 50%, #087248 100%)",
          }}
        >
          <div className="d-flex flex-column flex-md-row align-items-md-center gap-3">
            <div className="d-flex align-items-center gap-2">
              <div
                className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.12)",
                  boxShadow: "0 8px 22px rgba(0,0,0,0.18)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  minWidth: 60,
                  minHeight: 60,
                }}
              >
                <IconBrandWhatsapp size={32} />
              </div>
              <div>
                <p className="text-uppercase mb-1 small" style={{ letterSpacing: "0.08em" }}>
                  Checklist rápido
                </p>
                <h2 className="h5 mb-1 d-flex align-items-center gap-2 text-white fw-bold">{title}</h2>
                <p className="mb-0 text-white fw-semibold" style={{ opacity: 0.92 }}>
                  {subtitle}
                </p>
              </div>
            </div>
            <div className="ms-md-auto d-flex align-items-center gap-3">
              {!allDone && (
                <div className="badge d-flex align-items-center gap-1" style={{ background: "#ffe7c2", color: "#a45b00" }}>
                  <IconLock size={16} /> Finalize os passos para liberar tudo
                </div>
              )}
              <div
                style={{
                  width: 90,
                  height: 90,
                  borderRadius: "14px",
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.2)",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                }}
              >
                <img src={heroGif} alt="Checklist visual" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            </div>
          </div>
          {!allDone && (
            <div className="mt-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <small className="text-white fw-bold">Progresso</small>
                <small className="text-white fw-bold">{progressPct}%</small>
              </div>
              <div className="progress" style={{ height: 6, background: "rgba(255,255,255,0.2)" }}>
                <div
                  className="progress-bar bg-success"
                  role="progressbar"
                  style={{ width: `${progressPct}%` }}
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-3 p-md-4 bg-light">
          {allDone ? (
            <div className="d-flex flex-column flex-md-row align-items-center gap-3">
              <div
                className="d-inline-flex align-items-center justify-content-center rounded-4 border bg-white shadow-sm"
                style={{ width: 140, height: 140, overflow: "hidden" }}
              >
                <img src={heroGif} alt="Fluxo concluído" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div className="text-center text-md-start">
                <h3 className="h5 mb-1 text-success">Parabéns! Checklist concluído.</h3>
                <p className="mb-2 text-secondary">
                  Vá ao seu grupo e digite o prefixo + menu (ex.: /menu) para testar o robô agora mesmo.
                </p>
                <div className="d-flex flex-column flex-sm-row gap-2 justify-content-center justify-content-md-start">
                  <button className="btn btn-success fw-semibold" onClick={() => router.push("/dashboard/user")}>
                    Ir para o painel
                  </button>
                  <button className="btn btn-outline-secondary" onClick={handleDismiss}>
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {isMobile ? (
                <div className="position-relative">
                  <div className="d-flex position-relative overflow-hidden">
                    <div
                      className="d-flex w-100"
                      style={{
                        transition: "transform 0.4s ease",
                        transform: `translateX(-${currentSlide * 100}%)`,
                      }}
                    >
                      {steps.map((step) => (
                        <div key={step.key} style={{ minWidth: "100%", paddingRight: 12 }}>
                          <StepPill
                            step={step}
                            isNext={step.key === nextStepKey}
                            disabled={!canStart(step.key, step.done)}
                            onNavigate={handleNavigate}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="d-flex justify-content-between align-items-center mt-3">
                    <div className="d-flex gap-1">
                      {steps.map((step, idx) => (
                        <button
                          key={step.key}
                          className={`btn btn-sm ${idx === currentSlide ? "btn-primary" : "btn-outline-secondary"}`}
                          style={{ borderRadius: 999, width: idx === currentSlide ? 34 : 26, height: 8, padding: 0 }}
                          onClick={() => setCurrentSlide(idx)}
                          aria-label={`Ir para passo ${idx + 1}`}
                        />
                      ))}
                    </div>
                    <div className="d-flex gap-2">
                      <button className="btn btn-outline-secondary btn-sm" onClick={() => goTo("prev")}>
                        <IconChevronLeft size={16} />
                      </button>
                      <button className="btn btn-outline-secondary btn-sm" onClick={() => goTo("next")}>
                        <IconChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="row g-3">
                  {steps.map((step) => (
                    <div className="col-md-4" key={step.key}>
                      <StepPill
                        step={step}
                        isNext={step.key === nextStepKey}
                        disabled={!canStart(step.key, step.done)}
                        onNavigate={handleNavigate}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="d-flex flex-column flex-md-row gap-3 align-items-start align-items-md-center justify-content-between mt-4">
                <div>
                  <p className="mb-1 fw-semibold text-dark">Dúvidas? Fale com a gente e vamos configurar juntos.</p>
                  <p className="mb-0 text-secondary small">Este lembrete permanece até concluir todos os passos.</p>
                </div>
                <div className="d-flex flex-column flex-sm-row gap-2 w-100 w-sm-auto">
                  <button
                    className="btn btn-primary fw-semibold d-flex align-items-center justify-content-center gap-2 w-100"
                    onClick={() =>
                      handleNavigate(
	                        nextStepKey === "plan"
	                          ? GROUP_MANAGEMENT_PATH
                          : nextStepKey === "instance"
                          ? "/dashboard/user/configurar-bot"
                          : GROUP_MANAGEMENT_PATH,
                      )
                    }
                  >
                    <span>Continuar</span>
                    <IconArrowRight size={18} />
                  </button>
                  <button className="btn btn-outline-secondary disabled" aria-disabled>
                    Concluir para fechar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  try {
    return createPortal(overlay, document.body);
  } catch {
    return null;
  }
};

export default ActivationCoachModal;
