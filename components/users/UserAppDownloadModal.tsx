"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, ListGroup, Modal, Spinner, Stack } from "react-bootstrap";
import { Capacitor } from "@capacitor/core";
import { Updater } from "lib/mobile-updater";
import {
  IconBrandAndroid,
  IconBrandApple,
  IconDownload,
} from "@tabler/icons-react";

import type { MobileArtifactsPayload } from "../../types/mobile-artifacts";

interface UserAppDownloadModalProps {
  show: boolean;
  onHide: () => void;
  artifacts?: MobileArtifactsPayload | null;
  loading?: boolean;
}

type PlatformId = "android" | "ios" | "windows";

interface PlatformOption {
  id: PlatformId;
  title: string;
  subtitle: string;
  icon: JSX.Element;
  downloadUrl?: string;
  updatedAt?: string;
  sizeLabel?: string;
  commands: string[];
  isStore?: boolean;
}

const formatFileSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || value % 1 === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTime = (isoDate: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(isoDate));

const UserAppDownloadModal = ({ show, onHide, artifacts, loading }: UserAppDownloadModalProps) => {
  const androidUrl = useMemo(() => {
    if (artifacts?.preferredAndroidMode === "store" && artifacts.androidStoreUrl) return artifacts.androidStoreUrl;
    return artifacts?.android?.url;
  }, [artifacts?.preferredAndroidMode, artifacts?.androidStoreUrl, artifacts?.android?.url]);

  const iosUrl = useMemo(() => {
    if (artifacts?.preferredIosMode === "store" && artifacts.iosStoreUrl) return artifacts.iosStoreUrl;
    return artifacts?.ios?.url;
  }, [artifacts?.preferredIosMode, artifacts?.iosStoreUrl, artifacts?.ios?.url]);

  const windowsUrl = useMemo(() => {
    if (artifacts?.preferredWindowsMode === "store" && artifacts.windowsStoreUrl) return artifacts.windowsStoreUrl;
    return artifacts?.windows?.url;
  }, [artifacts?.preferredWindowsMode, artifacts?.windowsStoreUrl, artifacts?.windows?.url]);

  const options = useMemo<PlatformOption[]>(
    () => [
      {
        id: "android",
        title: "Aplicativo Android",
        subtitle: "Baixe o APK ou abra na Play Store.",
        icon: <IconBrandAndroid size={28} strokeWidth={1.5} />,
        downloadUrl: androidUrl,
        updatedAt: artifacts?.android?.updatedAt,
        sizeLabel: artifacts?.android ? formatFileSize(artifacts.android.sizeBytes) : undefined,
        commands: ["npm run build:web", "npm run mobile:android"],
        isStore: artifacts?.preferredAndroidMode === 'store' && Boolean(artifacts?.androidStoreUrl),
      },
      {
        id: "ios",
        title: "Aplicativo iOS",
        subtitle: "Abra na App Store ou disponibilize o .ipa para testes.",
        icon: <IconBrandApple size={28} strokeWidth={1.5} />,
        downloadUrl: iosUrl,
        updatedAt: artifacts?.ios?.updatedAt,
        sizeLabel: artifacts?.ios ? formatFileSize(artifacts.ios.sizeBytes) : undefined,
        commands: ["npm run build:web", "npm run cap:ios"],
        isStore: artifacts?.preferredIosMode === 'store' && Boolean(artifacts?.iosStoreUrl),
      },
      {
        id: "windows",
        title: "Aplicativo Windows",
        subtitle: "Disponibilize um instalador .exe/.msi ou um link externo.",
        icon: <IconDownload size={28} strokeWidth={1.5} />,
        downloadUrl: windowsUrl,
        updatedAt: artifacts?.windows?.updatedAt,
        sizeLabel: artifacts?.windows ? formatFileSize(artifacts.windows.sizeBytes) : undefined,
        commands: ["# gerar pacote desktop"],
        isStore: artifacts?.preferredWindowsMode === 'store' && Boolean(artifacts?.windowsStoreUrl),
      },
    ],
    [
      androidUrl,
      iosUrl,
      windowsUrl,
      artifacts?.android,
      artifacts?.ios,
      artifacts?.windows,
      artifacts?.preferredAndroidMode,
      artifacts?.preferredIosMode,
      artifacts?.preferredWindowsMode,
      artifacts?.androidStoreUrl,
      artifacts?.iosStoreUrl,
      artifacts?.windowsStoreUrl,
    ]
  );

  const [tempHref, setTempHref] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [nativePlatform, setNativePlatform] = useState<string>("web");
  useEffect(() => {
    return () => {
      if (tempHref) URL.revokeObjectURL(tempHref);
    };
  }, [tempHref]);

  // Detect Capacitor/native environment
  useEffect(() => {
    let mounted = true;
    (async () => {
      const isN = Capacitor.isNativePlatform?.() || false;
      const plat = Capacitor.getPlatform?.() || "web";
      if (mounted) { setIsNative(!!isN); setNativePlatform(String(plat)); }
    })();
    return () => { mounted = false; };
  }, []);

  const isAndroid = (nativePlatform === 'android') || (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent));

  const handleDownload = async (url: string | undefined, suggestedName: string) => {
    if (!url) return;
    // No navegador (web), não exibir lógica de progresso: deixar o fluxo nativo do browser
    if (!isNative) {
      window.open(url, '_blank');
      return;
    }
    try {
      if (isNative && isAndroid) {
        // Use native plugin to baixar e abrir instalador
        try {
          await Updater.downloadAndInstall({ url, fileName: suggestedName || 'app-release.apk' });
        } catch (_error) {
          window.open(url, '_blank');
        }
        return;
      }

      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok || !r.body) throw new Error(`Falha HTTP ${r.status}`);
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
        }
      }
      const blob = new Blob(chunks);
      const href = URL.createObjectURL(blob);
      setTempHref(href);
      // Dispara o download
      const a = document.createElement('a');
      a.href = href;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Evita tentativas de instalação no navegador; instrução permanece no cartão principal
    } catch (e) {
      console.error('Falha ao baixar arquivo', e);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          <IconDownload size={20} strokeWidth={1.5} />
          <span>Selecionar plataforma</span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-secondary">
          Escolha qual versão do aplicativo deseja disponibilizar. Os projetos
          nativos acompanham o dashboard web automaticamente e podem ser
          distribuídos pelas lojas oficiais ou via download direto.
        </p>
        {artifacts?.details && (
          <div className="alert alert-info" role="note">
            {artifacts.details}
          </div>
        )}
        <ListGroup as="ul" variant="flush" className="gap-3">
          {options.map((option) => (
            <ListGroup.Item
              key={option.id}
              as="li"
              className="border rounded p-3 d-flex flex-column gap-3"
            >
              <Stack direction="horizontal" gap={3} className="align-items-start">
                <span className="bg-light rounded-circle p-2 text-primary">
                  {option.icon}
                </span>
                <div className="flex-grow-1">
                  <h5 className="mb-0">{option.title}</h5>
                  <small className="text-secondary d-block mt-1">
                    {option.subtitle}
                  </small>
                </div>
                {option.downloadUrl ? (
                  option.isStore ? (
                    <Button
                      as={Link}
                      href={option.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="primary"
                      className="d-flex align-items-center gap-2"
                    >
                      <IconDownload size={18} strokeWidth={1.5} />
                      Abrir
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleDownload(option.downloadUrl, `${option.id}-${artifacts?.[option.id]?.fileName || 'app'}`)}
                      variant="primary"
                      className="d-flex align-items-center gap-2"
                    >
                      <IconDownload size={18} strokeWidth={1.5} />
                      Baixar
                    </Button>
                  )
                ) : loading ? (
                  <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                ) : (
                  <span className="text-muted small text-end">
                    Ainda não há builds disponíveis para esta plataforma.
                  </span>
                )}
              </Stack>
              {option.downloadUrl && option.updatedAt ? (
                <div className="d-flex flex-wrap gap-3 small text-secondary">
                  <span>Atualizado em: <strong>{formatDateTime(option.updatedAt)}</strong></span>
                  {artifacts?.[option.id]?.versionName && (
                    <span>Versão: <strong>v{artifacts?.[option.id]?.versionName}</strong>{typeof artifacts?.[option.id]?.versionCode === 'number' ? ` (code ${artifacts?.[option.id]?.versionCode})` : ''}</span>
                  )}
                  {option.sizeLabel ? (
                    <span>
                      Tamanho: <strong>{option.sizeLabel}</strong>
                    </span>
                  ) : null}
                  {/* Versão instalada será exibida pelo app usando componente dedicado se necessário */}
                </div>
              ) : null}
              {/* Instruções técnicas removidas para manter o foco no download para o usuário final */}
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Modal.Body>
    </Modal>
  );
};

export default UserAppDownloadModal;
