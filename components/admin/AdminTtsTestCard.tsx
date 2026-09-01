"use client";

import { useState } from "react";
import { NOTIFICATION_VOICE_OPTIONS, DEFAULT_NOTIFICATION_VOICE } from "data/notification-audio";

const AdminTtsTestCard = () => {
  const [text, setText] = useState("Olá! Esta é uma prévia de voz.");
  const [voice, setVoice] = useState<string>(DEFAULT_NOTIFICATION_VOICE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = async () => {
    setError(null);
    if (!text.trim()) return;
    setLoading(true);
    try {
      const url = new URL("/api/tts", window.location.origin);
      url.searchParams.set("texto", text.trim());
      url.searchParams.set("voz", voice);
      const r = await fetch(url.toString(), { cache: "no-store" });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.mensagem || `Erro HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.onended = () => URL.revokeObjectURL(objectUrl);
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gerar áudio.");
    }
    setLoading(false);
  };

  return (
    <section className="card">
      <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
        <h2 className="h5 mb-0">Teste de TTS (voz nas notificações)</h2>
        <span className="text-secondary small">Endpoint: /api/tts</span>
      </div>
      <div className="card-body d-flex flex-column gap-3">
        <div className="row g-3">
          <div className="col-md-8">
            <label className="form-label">Texto</label>
            <textarea className="form-control" rows={2} value={text} onChange={(e) => setText(e.currentTarget.value)} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Voz</label>
            <select className="form-select" value={voice} onChange={(e) => setVoice(e.currentTarget.value)}>
              {NOTIFICATION_VOICE_OPTIONS.map((opt) => (
                <option value={opt.value} key={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <div className="alert alert-danger py-2 mb-0">{error}</div>}
        <div>
          <button type="button" className="btn btn-primary" onClick={play} disabled={loading || !text.trim()}>
            {loading ? "Gerando..." : "Ouvir"}
          </button>
        </div>
        <p className="text-secondary small mb-0">
          Este teste usa a mesma voz e o mesmo backend configurados para as notificações por voz. O áudio não é salvo; serve apenas como prévia.
        </p>
      </div>
    </section>
  );
};

export default AdminTtsTestCard;

