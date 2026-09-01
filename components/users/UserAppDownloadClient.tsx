"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Col, Row, Stack } from "react-bootstrap";
import { IconDeviceMobileDown } from "@tabler/icons-react";

import UserAppDownloadModal from "./UserAppDownloadModal";
import type { MobileArtifactsPayload } from "../../types/mobile-artifacts";

type MobileUpdatePayload = {
  android?: {
    latest?: {
      versionName?: string | null;
      versionCode?: number | null;
      url?: string | null;
      sizeBytes?: number | null;
      updatedAt?: string | null;
      assetName?: string | null;
    };
    preferredMode?: "store" | "file";
    storeUrl?: string | null;
    releaseNotes?: string | null;
  };
};

const formatDateTime = (isoDate: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(isoDate));

const UserAppDownloadClient = ({ embedded = false }: { embedded?: boolean }) => {
  const [showModal, setShowModal] = useState(false);
  const [artifacts, setArtifacts] = useState<MobileArtifactsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadArtifacts = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/mobile/update", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Falha ao obter as builds móveis");
        }

        const payload = (await response.json()) as MobileUpdatePayload;
        if (active) {
          const latest = payload.android?.latest;
          setArtifacts({
            preferredAndroidMode: payload.android?.preferredMode ?? "file",
            androidStoreUrl: payload.android?.storeUrl ?? undefined,
            details: payload.android?.releaseNotes ?? undefined,
            android: latest?.url
              ? {
                  platform: "android",
                  type: "apk",
                  fileName: latest.assetName || "botadmin.apk",
                  url: latest.url,
                  sizeBytes: latest.sizeBytes ?? 0,
                  updatedAt: latest.updatedAt || new Date().toISOString(),
                  buildType: "release",
                  versionName: latest.versionName ?? undefined,
                  versionCode: latest.versionCode ?? undefined,
                }
              : undefined,
          });
        }
      } catch (error) {
        console.error("Não foi possível carregar os artefatos móveis:", error);
        if (active) {
          setArtifacts(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadArtifacts();

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Row className="g-4">
        <Col lg={12}>
          <Card className={embedded ? "border-0 shadow-none h-100" : "h-100"}>
            <Card.Header>
              <Stack direction="horizontal" gap={3}>
                <IconDeviceMobileDown size={32} strokeWidth={1.5} />
                <div>
                  <Card.Title as="h1" className="h4 mb-1">
                    Baixe o aplicativo móvel
                  </Card.Title>
                  <Card.Subtitle className="text-secondary">
                    Com o aplicativo você recebe notificações instantâneas, acompanha conversas em tempo real
                    e evita perder vendas quando estiver longe do computador.
                  </Card.Subtitle>
                </div>
              </Stack>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              <div className="alert alert-info mb-0">
                <strong>Vantagens:</strong> notificações push, conversas ao vivo com clientes e experiência mais rápida.
              </div>
              {artifacts?.android ? (
                <div className="d-flex align-items-center gap-2 small text-success">
                  <Badge bg="success" className="text-uppercase">
                    Android
                  </Badge>
                  <span>
                    Último build: {formatDateTime(artifacts.android.updatedAt)}
                  </span>
                </div>
              ) : null}
              {artifacts?.android?.url ? (
                <a
                  className="btn btn-success align-self-start d-flex align-items-center gap-2"
                  href={artifacts.android.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={artifacts.android.fileName}
                >
                  <IconDeviceMobileDown size={18} strokeWidth={1.5} />
                  Baixar APK Android
                </a>
              ) : null}
              <button
                type="button"
                className="btn btn-outline-primary align-self-start d-flex align-items-center gap-2"
                onClick={() => setShowModal(true)}
              >
                <IconDeviceMobileDown size={18} strokeWidth={1.5} />
                Outras opções
              </button>

              <div className="mt-2">
                <h2 className="h6 mb-2">Instalar via APK (Android)</h2>
                <ol className="ps-3 text-secondary d-flex flex-column gap-1 mb-0">
                  <li>Toque em “Selecionar aplicativo” e baixe o arquivo .apk.</li>
                  <li>Ative a instalação de fontes desconhecidas nas configurações do seu aparelho.</li>
                  <li>Abra o arquivo baixado e confirme a instalação.</li>
                </ol>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <UserAppDownloadModal
        show={showModal}
        onHide={() => setShowModal(false)}
        artifacts={artifacts}
        loading={loading}
      />
    </>
  );
};

export default UserAppDownloadClient;
