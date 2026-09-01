"use client";

import { useMemo, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import Image from "next/image";
import { IconQuestionMark } from "@tabler/icons-react";

import type { FieldTutorial } from "types/tutorials";

type TutorialTriggerProps = {
  label: string;
  tutorial?: FieldTutorial;
  buttonVariant?: string;
  buttonSize?: "sm" | "lg";
  className?: string;
  children?: React.ReactNode;
  iconOnly?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
};

const renderDescription = (description?: string) => {
  if (!description?.trim()) {
    return <p className="mb-0 text-secondary">Nenhum conteúdo foi cadastrado para este tutorial.</p>;
  }

  return description
    .split(/\n{2,}/)
    .map((paragraph, index) => (
      <p key={index} className="mb-2 text-secondary">
        {paragraph.trim()}
      </p>
    ));
};

const renderMedia = (tutorial?: FieldTutorial) => {
  if (!tutorial?.mediaUrl) {
    return null;
  }

  const src = tutorial.mediaUrl;
  const isVideo =
    tutorial.mediaType === "video" ||
    /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|ogv)(\?.*)?$/i.test(src);
  const isImage =
    tutorial.mediaType === "image" ||
    /\.(png|jpe?g|gif|webp|bmp|svg|apng)(\?.*)?$/i.test(src);

  if (isVideo) {
    return (
      <video
        controls
        src={src}
        className="w-100 rounded border"
        style={{ maxHeight: "60vh", objectFit: "contain" }}
      />
    );
  }

  if (isImage) {
    return (
      <Image
        src={src}
        alt="Pré-visualização do tutorial"
        width={960}
        height={540}
        className="img-fluid rounded border"
        style={{ width: "100%", height: "auto", maxHeight: "60vh", objectFit: "contain" }}
        unoptimized
      />
    );
  }

  return (
    <a href={src} target="_blank" rel="noreferrer" className="text-break">
      Abrir mídia
    </a>
  );
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const TutorialTrigger = ({
  label,
  tutorial,
  buttonVariant = "outline-secondary",
  buttonSize = "sm",
  className,
  children,
  iconOnly = false,
  ariaLabel,
  disabled,
}: TutorialTriggerProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const buttonContent = useMemo(() => {
    if (children) {
      return children;
    }

    return (
      <>
        <IconQuestionMark size={16} strokeWidth={1.75} />
        {!iconOnly ? <span className="fw-semibold">Tutorial</span> : null}
      </>
    );
  }, [children, iconOnly]);

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize}
        className={className}
        onClick={() => setIsOpen(true)}
        aria-label={ariaLabel ?? `Abrir tutorial sobre ${label}`}
        disabled={disabled}
      >
        {buttonContent}
      </Button>

      <Modal show={isOpen} onHide={() => setIsOpen(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{tutorial?.title || `Tutorial - ${label}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          {renderMedia(tutorial)}
          {renderDescription(tutorial?.description)}
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between align-items-center">
          <span className="text-secondary small">
            Última atualização em {formatDateTime(tutorial?.updatedAt)}
          </span>
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default TutorialTrigger;
