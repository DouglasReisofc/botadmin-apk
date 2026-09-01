"use client";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Updater, isNativeAndroid } from "lib/mobile-updater";

type UpdatePayload = {
  android: {
    latest: { versionName: string | null; versionCode: number | null; url: string | null };
    preferredMode: "store" | "file";
    storeUrl: string | null;
    minVersionCode: number | null;
    required: boolean;
    releaseNotes: string | null;
  };
};

type UpdaterInfo = {
  versionCode: number | null;
  versionName: string | null;
};

const NativeUpdateChecker = () => {
  const [show, setShow] = useState(false);
  const [required, setRequired] = useState(false);
  const [label, setLabel] = useState<string>("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [hasLink, setHasLink] = useState(false);
  const [localVersionName, setLocalVersionName] = useState<string | null>(null);
  const [localVersionCode, setLocalVersionCode] = useState<number | null>(null);
  const [latestVersionName, setLatestVersionName] = useState<string | null>(null);
  const [latestVersionCode, setLatestVersionCode] = useState<number | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    if (!isNativeAndroid()) return; // foco Android

    let mounted = true;
    (async () => {
      try {
        const [r, info] = await Promise.all([
          fetch('/api/mobile/update', { cache: 'no-store' }),
          Updater.getInfo().catch<UpdaterInfo>(() => ({ versionCode: null, versionName: null })),
        ]);
        if (!mounted) return;
        if (!r.ok) return;
        const p = (await r.json()) as UpdatePayload;
        const latestCode = p?.android?.latest?.versionCode ?? null;
        const minCode = p?.android?.minVersionCode ?? null;
        const url = p?.android?.latest?.url ?? null;
        const sUrl = p?.android?.storeUrl ?? null;
        const localCode = info?.versionCode ?? null;
        const localName = info?.versionName ?? null;

        setLocalVersionCode(localCode);
        setLocalVersionName(localName);
        setLatestVersionCode(latestCode);
        setLatestVersionName(p?.android?.latest?.versionName ?? null);

        const linkAvailable = Boolean(sUrl || url);

        // Regras de exibição (defensivas quando localCode é desconhecido)
        if (typeof minCode === 'number' && (localCode == null || localCode < minCode)) {
          setRequired(true); setShow(true); setLabel(`Atualização obrigatória.`); setDownloadUrl(url); setStoreUrl(sUrl); setHasLink(linkAvailable);
          return;
        }
        if (typeof latestCode === 'number' && typeof localCode === 'number' && localCode < latestCode) {
          setRequired(false); setShow(true); setLabel(`Atualização disponível.`); setDownloadUrl(url); setStoreUrl(sUrl); setHasLink(linkAvailable);
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  if (!show) return null;

  const handleUpdate = async () => {
    if (storeUrl) {
      window.open(storeUrl, '_blank');
      return;
    }
    if (downloadUrl) {
      try { await Updater.downloadAndInstall({ url: downloadUrl, fileName: 'update.apk' }); } catch { window.open(downloadUrl, '_blank'); }
    }
  };

  // UI: modal tela cheia quando obrigatório; banner quando opcional
  if (required && show) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)' }}>
        <div className="card" style={{ maxWidth: 480, margin: '20vh auto 0', padding: 16 }}>
          <div className="card-body">
            <h5 className="card-title text-danger">Atualização obrigatória</h5>
            <p className="card-text mb-2">{label}</p>
            {(localVersionName || latestVersionName) && (
              <p className="text-secondary small mb-3">
                {localVersionName ? `Instalada v${localVersionName}` : ''}
                {typeof localVersionCode === 'number' ? ` (code ${localVersionCode})` : ''}
                {(localVersionName || typeof localVersionCode === 'number') && (latestVersionName || typeof latestVersionCode === 'number') ? ' • ' : ''}
                {latestVersionName ? `Disponível v${latestVersionName}` : ''}
                {typeof latestVersionCode === 'number' ? ` (code ${latestVersionCode})` : ''}
              </p>
            )}
            <div className="d-flex justify-content-end">
              <button type="button" className="btn btn-primary" onClick={handleUpdate} disabled={!hasLink}>
                {hasLink ? 'Atualizar agora' : 'Sem link de atualização'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!required && show) {
    return (
      <div style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 1060 }}>
        <div className="alert alert-warning d-flex justify-content-between align-items-center">
          <div>
            <strong>Atualização</strong> — {label}
            {(localVersionName || latestVersionName) && (
              <div className="small text-secondary mt-1">
                {localVersionName ? `Instalada v${localVersionName}` : ''}
                {typeof localVersionCode === 'number' ? ` (code ${localVersionCode})` : ''}
                {(localVersionName || typeof localVersionCode === 'number') && (latestVersionName || typeof latestVersionCode === 'number') ? ' • ' : ''}
                {latestVersionName ? `Disponível v${latestVersionName}` : ''}
                {typeof latestVersionCode === 'number' ? ` (code ${latestVersionCode})` : ''}
              </div>
            )}
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShow(false)}>Depois</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleUpdate} disabled={!hasLink}>
              {hasLink ? 'Atualizar agora' : 'Sem link'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default NativeUpdateChecker;
