/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from "react-bootstrap";

import type { BotGroup } from "types/bot-groups";
import type {
  UserRaffle,
  UserRaffleSummary,
  UserRaffleTicket,
  UserRaffleAnnouncementMedia,
} from "types/user-raffles";
import { formatCurrency, formatDateTime } from "lib/format";
import { normalizeJid } from "lib/whatsapp";

type AnnouncementMediaState = UserRaffleAnnouncementMedia;

const DEFAULT_ANNOUNCEMENT_TEMPLATE = [
  "🎉 Nova rifa aberta: *{{title}}*",
  "• Valor por número: {{price}}",
  "• Total de números: {{numbersTotal}}",
  "• Ganhadores: {{winnersCount}}",
  "",
  "Quem quiser participar, faça sua fézinha e boa sorte!",
  "",
  "👉 Para garantir seus números, envie:",
  "*{{commandPrefix}}comprarrifa 1*",
  "(troque o 1 pela quantidade desejada).",
  "🍀 Boa sorte a todos!",
].join("\n");

const DEFAULT_FINAL_TEMPLATE = [
  "🎉 Resultado da rifa *{{title}}*",
  "{{winnerList}}",
  "",
  "Parabéns aos ganhadores e obrigado a todos que participaram!",
].join("\n");

const ANNOUNCEMENT_PLACEHOLDER_HINT =
  "Use {{title}}, {{price}}, {{numbersTotal}}, {{winnersCount}}, {{numbersAvailable}}, {{commandPrefix}} e {{buyCommand}} para preencher automaticamente os dados.";
const FINAL_PLACEHOLDER_HINT = "Use {{title}}, {{winnerList}}, {{winnerNames}} e {{winnerNumbers}} para personalizar a mensagem de resultado.";

const inferMediaTypeFromFile = (file: File): "image" | "video" | "audio" | "document" => {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const serializeMediaForPayload = (
  media: AnnouncementMediaState | null | undefined,
): Record<string, string | null> | null => {
  if (!media) {
    return null;
  }
  return {
    path: media.path,
    mediaType: media.mediaType,
    mimeType: media.mimeType,
    fileName: media.fileName,
  };
};

const mapAnnouncementMedia = (
  media: UserRaffleAnnouncementMedia | null | undefined,
): AnnouncementMediaState | null => (media ? { ...media } : null);

const removeUploadedMedia = async (path: string | null | undefined) => {
  if (!path) {
    return;
  }
  try {
    await fetch(`/api/user/raffles/upload?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  } catch {
    // ignore cleanup errors
  }
};

interface UserRaffleManagerProps {
  groups: BotGroup[];
  initialRaffles: UserRaffleSummary[];
  pixConfigured: boolean;
  initialError?: string | null;
}

type CreateFormState = {
  title: string;
  description: string;
  price: string;
  numbersTotal: string;
  winnersCount: string;
  groupIds: number[];
  announcementMessage: string;
  announcementMedia: AnnouncementMediaState | null;
  announcementMentionAll: boolean;
  finalMessage: string;
};

const emptyForm: CreateFormState = {
  title: "",
  description: "",
  price: "",
  numbersTotal: "",
  winnersCount: "1",
  groupIds: [],
  announcementMessage: DEFAULT_ANNOUNCEMENT_TEMPLATE,
  announcementMedia: null,
  announcementMentionAll: true,
  finalMessage: DEFAULT_FINAL_TEMPLATE,
};

type EditFormState = {
  title: string;
  description: string;
  price: string;
  numbersTotal: string;
  winnersCount: string;
  groupIds: number[];
  announcementMessage: string;
  announcementMedia: AnnouncementMediaState | null;
  announcementMentionAll: boolean;
  finalMessage: string;
};

const emptyEditForm: EditFormState = {
  title: "",
  description: "",
  price: "",
  numbersTotal: "",
  winnersCount: "",
  groupIds: [],
  announcementMessage: DEFAULT_ANNOUNCEMENT_TEMPLATE,
  announcementMedia: null,
  announcementMentionAll: true,
  finalMessage: DEFAULT_FINAL_TEMPLATE,
};

const statusVariant: Record<UserRaffleSummary["status"], string> = {
  active: "success",
  selling: "primary",
  sold_out: "warning",
  completed: "secondary",
  cancelled: "danger",
  draft: "secondary",
};

const statusLabel: Record<UserRaffleSummary["status"], string> = {
  active: "Ativa",
  selling: "Em andamento",
  sold_out: "Aguardando sorteio",
  completed: "Finalizada",
  cancelled: "Cancelada",
  draft: "Rascunho",
};

const ticketLabel = (ticket: UserRaffleTicket): string => {
  switch (ticket.status) {
    case "available":
      return "Disponível";
    case "reserved":
      return "Reservado";
    case "paid":
      return "Pago";
    case "cancelled":
      return "Cancelado";
    default:
      return ticket.status;
  }
};

const UserRaffleManager = ({
  groups,
  initialRaffles,
  pixConfigured,
  initialError = null,
}: UserRaffleManagerProps) => {
  const [raffles, setRaffles] = useState<UserRaffleSummary[]>(initialRaffles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRaffle, setDetailRaffle] = useState<UserRaffle | null>(null);
  const [detailSuccess, setDetailSuccess] = useState<string | null>(null);
  const [drawModalOpen, setDrawModalOpen] = useState(false);
  const [drawModalTarget, setDrawModalTarget] = useState<UserRaffleSummary | null>(null);
  const [drawModalAnnounce, setDrawModalAnnounce] = useState(true);
  const [drawModalError, setDrawModalError] = useState<string | null>(null);
  const [drawSubmitting, setDrawSubmitting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const [createMediaUploading, setCreateMediaUploading] = useState(false);
  const [createPendingMediaPath, setCreatePendingMediaPath] = useState<string | null>(null);
  const [editMediaUploading, setEditMediaUploading] = useState(false);
  const [editPendingMediaPath, setEditPendingMediaPath] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>(emptyEditForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const minimumNumbersTotal = detailRaffle ? detailRaffle.reservedCount + detailRaffle.soldCount : 0;
  const [deletingRaffleId, setDeletingRaffleId] = useState<number | null>(null);
  const [releasingRaffleId, setReleasingRaffleId] = useState<number | null>(null);

  useEffect(() => {
    if (!showCreateModal && createPendingMediaPath) {
      void removeUploadedMedia(createPendingMediaPath);
      setCreatePendingMediaPath(null);
    }
  }, [showCreateModal, createPendingMediaPath]);

  useEffect(() => {
    if (!showEditModal && editPendingMediaPath) {
      void removeUploadedMedia(editPendingMediaPath);
      setEditPendingMediaPath(null);
    }
  }, [showEditModal, editPendingMediaPath]);

  const uploadAnnouncementMedia = useCallback(
    async (file: File, previousPath?: string | null) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mediaType", inferMediaTypeFromFile(file));
      if (previousPath) {
        formData.append("previousPath", previousPath);
      }
      const response = await fetch("/api/user/raffles/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.message === "string" ? data.message : "Não foi possível enviar a mídia da rifa.",
        );
      }
      return data.media as AnnouncementMediaState;
    },
    [],
  );

  const handleCreateMediaChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      setCreateMediaUploading(true);
      try {
        const media = await uploadAnnouncementMedia(file, createPendingMediaPath ?? undefined);
        setCreatePendingMediaPath(media.path);
        setCreateForm((prev) => ({ ...prev, announcementMedia: media }));
      } catch (error) {
        console.error(error);
        setCreateError(error instanceof Error ? error.message : "Não foi possível enviar a mídia.");
      } finally {
        setCreateMediaUploading(false);
        event.target.value = "";
      }
    },
    [uploadAnnouncementMedia, createPendingMediaPath],
  );

  const handleRemoveCreateMedia = useCallback(async () => {
    const currentPath = createForm.announcementMedia?.path ?? null;
    if (currentPath) {
      await removeUploadedMedia(currentPath);
    }
    setCreatePendingMediaPath(null);
    setCreateForm((prev) => ({ ...prev, announcementMedia: null }));
  }, [createForm.announcementMedia]);

  const handleEditMediaChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      setEditMediaUploading(true);
      try {
        const media = await uploadAnnouncementMedia(file, editPendingMediaPath ?? undefined);
        setEditPendingMediaPath(media.path);
        setEditForm((prev) => ({ ...prev, announcementMedia: media }));
      } catch (error) {
        console.error(error);
        setEditError(error instanceof Error ? error.message : "Não foi possível enviar a mídia.");
      } finally {
        setEditMediaUploading(false);
        event.target.value = "";
      }
    },
    [uploadAnnouncementMedia, editPendingMediaPath],
  );

  const handleRemoveEditMedia = useCallback(async () => {
    if (!detailRaffle) {
      return;
    }
    const originalPath = detailRaffle.metadata?.announcement?.media?.path ?? null;
    const currentPath = editForm.announcementMedia?.path ?? null;

    if (editPendingMediaPath && currentPath === editPendingMediaPath) {
      await removeUploadedMedia(editPendingMediaPath);
      setEditPendingMediaPath(null);
      // Reverte para mídia original, se existir
      setEditForm((prev) => ({
        ...prev,
        announcementMedia: mapAnnouncementMedia(detailRaffle.metadata?.announcement?.media),
      }));
      return;
    }

    if (currentPath && currentPath !== originalPath) {
      await removeUploadedMedia(currentPath);
    }

    setEditPendingMediaPath(null);
    setEditForm((prev) => ({ ...prev, announcementMedia: null }));
  }, [detailRaffle, editForm.announcementMedia, editPendingMediaPath]);

  const groupOptions = useMemo(() =>
    groups.map((group) => ({
      id: group.id,
      label: `${group.name} (${group.remoteId || "sem ID"})`,
    })),
  [groups]);

  const refreshRaffles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/user/raffles");
      if (!response.ok) {
        throw new Error("Falha ao buscar rifas");
      }
      const data = (await response.json()) as { raffles: UserRaffleSummary[] };
      setRaffles(Array.isArray(data.raffles) ? data.raffles : []);
    } catch (err) {
      console.error(err);
      setError("Não foi possível atualizar a lista de rifas.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenCreate = () => {
    setCreateForm(emptyForm);
    setCreateError(null);
    setCreatePendingMediaPath(null);
    setShowCreateModal(true);
  };

  const handleSubmitCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const payload = {
        title: createForm.title.trim(),
        description: createForm.description.trim() || null,
        price: Number(createForm.price.replace(",", ".")),
        numbersTotal: Number(createForm.numbersTotal),
        winnersCount: Number(createForm.winnersCount),
        groupIds: createForm.groupIds,
        announcement: {
          message: createForm.announcementMessage.trim(),
          media: serializeMediaForPayload(createForm.announcementMedia),
          mentionAll: createForm.announcementMentionAll,
        },
        finalization: {
          message: createForm.finalMessage.trim(),
        },
      };
      const response = await fetch("/api/user/raffles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível criar a rifa.");
      }
      setCreatePendingMediaPath(null);
      setShowCreateModal(false);
      setCreateForm(emptyForm);
      await refreshRaffles();
    } catch (err) {
      console.error(err);
      setCreateError(err instanceof Error ? err.message : "Não foi possível criar a rifa.");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const changeRaffleStatus = useCallback(
    async (
      raffleId: number,
      status: UserRaffleSummary["status"],
    ): Promise<{ raffle: UserRaffleSummary | null; message: string | null }> => {
      setStatusUpdating(true);
      try {
        const response = await fetch(`/api/user/raffles/${raffleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível atualizar a rifa.");
        }
        if (data?.raffle) {
          const summary = data.raffle as UserRaffleSummary;
          setDetailRaffle((prev) => {
            if (!prev || prev.id !== raffleId) {
              return prev;
            }
            return {
              ...prev,
              status: summary.status,
              reservedCount: summary.reservedCount,
              soldCount: summary.soldCount,
              numbersTotal: summary.numbersTotal,
              winnersCount: summary.winnersCount,
              groups: summary.groups,
              groupJids: summary.groups
                .map((group) => normalizeJid(group.remoteId))
                .filter((jid, index, array) => jid && array.indexOf(jid) === index),
              winners: summary.winners,
              drawnAt: summary.drawnAt,
              updatedAt: summary.updatedAt,
            };
          });
        }
        await refreshRaffles();
        return {
          raffle: data?.raffle ? (data.raffle as UserRaffleSummary) : null,
          message: typeof data?.message === "string" ? data.message : null,
        };
      } finally {
        setStatusUpdating(false);
      }
    },
    [refreshRaffles],
  );

  const loadRaffleDetails = useCallback(async (raffleId: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetailSuccess(null);
    try {
      const response = await fetch(`/api/user/raffles/${raffleId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível carregar a rifa.");
      }
      setDetailRaffle(data.raffle as UserRaffle);
      setDetailModalOpen(true);
    } catch (err) {
      console.error(err);
      setDetailError(err instanceof Error ? err.message : "Não foi possível abrir os detalhes da rifa.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleCancelRaffle = useCallback(async (raffleId: number) => {
    try {
      setError(null);
      await changeRaffleStatus(raffleId, "cancelled");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Não foi possível cancelar a rifa.");
    }
  }, [changeRaffleStatus]);

  const handleCancelFromDetail = useCallback(async () => {
    if (!detailRaffle) {
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Tem certeza que deseja cancelar esta rifa?")) {
      return;
    }
    try {
      setDetailError(null);
      setDetailSuccess(null);
      const result = await changeRaffleStatus(detailRaffle.id, "cancelled");
      setDetailSuccess(result.message ?? "Rifa cancelada com sucesso.");
      setDetailModalOpen(true);
    } catch (err) {
      console.error(err);
      setDetailError(err instanceof Error ? err.message : "Não foi possível cancelar a rifa.");
    }
  }, [changeRaffleStatus, detailRaffle]);

  const handleDeleteRaffle = useCallback(
    async (raffleId: number) => {
      if (typeof window !== "undefined" && !window.confirm("Deseja realmente excluir esta rifa? Esta ação não pode ser desfeita.")) {
        return;
      }
      setDeletingRaffleId(raffleId);
      try {
        const response = await fetch(`/api/user/raffles/${raffleId}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível excluir a rifa.");
        }
        await refreshRaffles();
        if (detailRaffle && detailRaffle.id === raffleId) {
          setDetailModalOpen(false);
          setDetailRaffle(null);
          setDetailSuccess(data?.message ?? "Rifa excluída com sucesso.");
        }
        setError(null);
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Não foi possível excluir a rifa.";
        if (detailRaffle && detailRaffle.id === raffleId) {
          setDetailError(message);
        } else {
          setError(message);
        }
      } finally {
        setDeletingRaffleId(null);
      }
    },
    [detailRaffle, refreshRaffles],
  );

  const handleReleaseReservations = useCallback(
    async (raffleId: number) => {
      setReleasingRaffleId(raffleId);
      try {
        const response = await fetch(`/api/user/raffles/${raffleId}/release`, {
          method: "POST",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível liberar as reservas.");
        }
        await refreshRaffles();
        await loadRaffleDetails(raffleId);
        setDetailError(null);
        setDetailSuccess(typeof data?.message === "string" ? data.message : "Reservas liberadas com sucesso.");
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Não foi possível liberar as reservas.";
        setDetailError(message);
      } finally {
        setReleasingRaffleId(null);
      }
    },
    [loadRaffleDetails, refreshRaffles],
  );

  const executeDraw = useCallback(
    async (params: { raffleId: number; announce: boolean; showDetail?: boolean }) => {
      const { raffleId, announce, showDetail = true } = params;
      setDrawSubmitting(true);
      try {
        if (showDetail) {
          setDetailError(null);
          setDetailSuccess(null);
        }
        setDrawModalError(null);

        const response = await fetch(`/api/user/raffles/${raffleId}/draw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ announce }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível sortear a rifa.");
        }

        const successMessage =
          typeof data?.message === "string" && data.message.trim()
            ? data.message
            : "Rifa sorteada com sucesso.";

        await refreshRaffles();

        if (showDetail) {
          await loadRaffleDetails(raffleId);
          setDetailSuccess(successMessage);
        } else if (detailRaffle && detailRaffle.id === raffleId && data?.raffle) {
          setDetailRaffle(data.raffle as UserRaffle);
        }

        return true;
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Não foi possível sortear a rifa.";
        if (showDetail) {
          setDetailError(message);
          setDrawModalError(message);
        } else {
          setDrawModalError(message);
        }
        return false;
      } finally {
        setDrawSubmitting(false);
      }
    },
    [detailRaffle, loadRaffleDetails, refreshRaffles],
  );

  const handleOpenDrawModal = useCallback(
    (raffle: UserRaffleSummary) => {
      setDrawModalTarget(raffle);
      setDrawModalAnnounce(raffle.groups.length > 0);
      setDrawModalError(null);
      setDrawModalOpen(true);
    },
    [],
  );

  const handleCloseDrawModal = useCallback(() => {
    if (drawSubmitting) {
      return;
    }
    setDrawModalOpen(false);
    setDrawModalTarget(null);
    setDrawModalError(null);
    setDrawModalAnnounce(true);
  }, [drawSubmitting]);

  const handleConfirmDraw = useCallback(async () => {
    if (!drawModalTarget) {
      return;
    }
    const success = await executeDraw({
      raffleId: drawModalTarget.id,
      announce: drawModalAnnounce,
      showDetail: true,
    });
    if (success) {
      setDrawModalOpen(false);
      setDrawModalTarget(null);
      setDrawModalAnnounce(true);
      setDrawModalError(null);
    }
  }, [drawModalAnnounce, drawModalTarget, executeDraw]);

  const handleOpenEdit = useCallback(() => {
    if (!detailRaffle) {
      return;
    }
    const announcement = detailRaffle.metadata?.announcement;
    const finalization = detailRaffle.metadata?.finalization;
    setEditForm({
      title: detailRaffle.title,
      description: detailRaffle.description ?? "",
      price: detailRaffle.price.toString(),
      numbersTotal: detailRaffle.numbersTotal.toString(),
      winnersCount: detailRaffle.winnersCount.toString(),
      groupIds: detailRaffle.groups.map((group) => group.groupId),
      announcementMessage: announcement?.message ?? DEFAULT_ANNOUNCEMENT_TEMPLATE,
      announcementMedia: mapAnnouncementMedia(announcement?.media),
      announcementMentionAll: announcement?.mentionAll ?? true,
      finalMessage: finalization?.message ?? DEFAULT_FINAL_TEMPLATE,
    });
    setEditError(null);
    setDetailSuccess(null);
    setEditPendingMediaPath(null);
    setShowEditModal(true);
  }, [detailRaffle]);

  const handleSubmitEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detailRaffle) {
      return;
    }
    setEditError(null);
    setEditSubmitting(true);
    setDetailSuccess(null);

    const title = editForm.title.trim();
    if (!title) {
      setEditError("Informe o título da rifa.");
      setEditSubmitting(false);
      return;
    }

    const price = Number(editForm.price.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      setEditError("Informe um valor válido para o preço.");
      setEditSubmitting(false);
      return;
    }

    const numbersTotal = Number(editForm.numbersTotal);
    if (!Number.isFinite(numbersTotal) || numbersTotal < 1 || !Number.isInteger(numbersTotal)) {
      setEditError("Informe uma quantidade inteira válida de números.");
      setEditSubmitting(false);
      return;
    }
    if (numbersTotal < minimumNumbersTotal) {
      setEditError(`A quantidade total não pode ser menor que ${minimumNumbersTotal}.`);
      setEditSubmitting(false);
      return;
    }

    const winnersCount = Number(editForm.winnersCount);
    if (!Number.isFinite(winnersCount) || winnersCount < 1 || !Number.isInteger(winnersCount)) {
      setEditError("Informe uma quantidade inteira válida de ganhadores.");
      setEditSubmitting(false);
      return;
    }

    const originalMediaPath = detailRaffle.metadata?.announcement?.media?.path ?? null;
    let announcementMediaPayload: Record<string, string | null> | null | undefined;
    if (editPendingMediaPath) {
      announcementMediaPayload = serializeMediaForPayload(editForm.announcementMedia);
    } else if (!editForm.announcementMedia && originalMediaPath) {
      announcementMediaPayload = null;
    }

    const payload: Record<string, unknown> = {
      title,
      description: editForm.description.trim() ? editForm.description.trim() : null,
      price,
      numbersTotal,
      winnersCount,
      groupIds: editForm.groupIds,
      announcement: {
        message: editForm.announcementMessage.trim(),
        mentionAll: editForm.announcementMentionAll,
      },
      finalization: {
        message: editForm.finalMessage.trim(),
      },
    };

    if (announcementMediaPayload !== undefined) {
      (payload.announcement as Record<string, unknown>).media = announcementMediaPayload;
    }

    const targetId = detailRaffle.id;

    try {
      const response = await fetch(`/api/user/raffles/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível atualizar a rifa.");
      }
      await refreshRaffles();
      await loadRaffleDetails(targetId);
      setShowEditModal(false);
      setDetailError(null);
      setDetailSuccess(data?.message ?? "Rifa atualizada com sucesso.");
      setEditForm(emptyEditForm);
      setEditPendingMediaPath(null);
    } catch (err) {
      console.error(err);
      setEditError(err instanceof Error ? err.message : "Não foi possível atualizar a rifa.");
    } finally {
      setEditSubmitting(false);
    }
  };

  const renderTickets = (tickets: UserRaffleTicket[]) => (
    <div className="raffle-ticket-list border rounded p-2" style={{ maxHeight: "320px", overflowY: "auto" }}>
      <Table size="sm" responsive>
        <thead>
          <tr>
            <th>Número</th>
            <th>Status</th>
            <th>Participante</th>
            <th>Telefone</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.number}>
              <td>{ticket.number}</td>
              <td>{ticketLabel(ticket)}</td>
              <td>{ticket.customerName || "—"}</td>
              <td>{ticket.customerWhatsapp || "—"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="h4 mb-1">Rifas do bot</h1>
          <p className="text-secondary mb-0">
            Configure rifas pagas para vender números via Pix e realizar sorteios automáticos quando todas as vagas forem preenchidas.
          </p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!pixConfigured}>
          Nova rifa
        </Button>
      </div>

      {!pixConfigured && (
        <Alert variant="warning" className="mb-4">
          Configure o Pix (Mercado Pago ou PoloPag) em <strong>Pagamentos &gt; Gateways</strong> para liberar a venda das rifas automaticamente.
        </Alert>
      )}

      {error && (
        <Alert variant="danger" className="mb-4" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}

      <Card>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h6 mb-0">Rifas cadastradas</h2>
            <Button size="sm" variant="outline-secondary" onClick={refreshRaffles} disabled={loading}>
              {loading ? <Spinner animation="border" size="sm" /> : "Atualizar"}
            </Button>
          </div>

          {raffles.length === 0 ? (
            <p className="text-muted mb-0">Nenhuma rifa cadastrada até o momento.</p>
          ) : (
            <div className="table-responsive">
              <Table hover className="mb-0">
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Status</th>
                    <th>Números</th>
                    <th>Ganhadores</th>
                    <th>Grupos</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {raffles.map((raffle) => (
                    <tr key={raffle.id}>
                      <td>
                        <div className="fw-semibold">{raffle.title}</div>
                        <div className="text-muted small">Criada em {formatDateTime(raffle.createdAt)}</div>
                      </td>
                      <td>
                        <Badge bg={statusVariant[raffle.status]}>{statusLabel[raffle.status]}</Badge>
                      </td>
                      <td>
                        <div>{`${raffle.soldCount}/${raffle.numbersTotal}`}</div>
                        <div className="text-muted small">Reservados: {raffle.reservedCount}</div>
                      </td>
                      <td>{raffle.winnersCount}</td>
                      <td>{raffle.groups.length > 0 ? raffle.groups.length : "—"}</td>
                      <td className="d-flex gap-2">
                        <Button size="sm" variant="outline-primary" onClick={() => loadRaffleDetails(raffle.id)}>
                          Detalhes
                        </Button>
                        {raffle.status !== "completed" &&
                          raffle.status !== "cancelled" &&
                          raffle.soldCount > 0 && (
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => handleOpenDrawModal(raffle)}
                              disabled={drawSubmitting || statusUpdating}
                            >
                              Sortear/Finalizar
                            </Button>
                          )}
                        {raffle.status !== "completed" && raffle.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => handleCancelRaffle(raffle.id)}
                            disabled={statusUpdating}
                          >
                            Cancelar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteRaffle(raffle.id)}
                          disabled={deletingRaffleId === raffle.id}
                        >
                          {deletingRaffleId === raffle.id ? "Excluindo..." : "Excluir"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <Modal show={showCreateModal} onHide={() => setShowCreateModal(false)} centered>
        <Form onSubmit={handleSubmitCreate}>
          <Modal.Header closeButton>
            <Modal.Title>Criar nova rifa</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {createError && (
              <Alert variant="danger" onClose={() => setCreateError(null)} dismissible>
                {createError}
              </Alert>
            )}
            <Form.Group className="mb-3" controlId="raffleTitle">
              <Form.Label>Título</Form.Label>
              <Form.Control
                value={createForm.title}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="raffleDescription">
              <Form.Label>Descrição</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={createForm.description}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </Form.Group>
            <Row className="mb-3">
              <Col md={6}>
                <Form.Group controlId="rafflePrice">
                  <Form.Label>Valor por número (R$)</Form.Label>
                  <Form.Control
                    type="number"
                    min="0"
                    step="0.01"
                    value={createForm.price}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, price: event.target.value }))}
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="raffleNumbers">
                  <Form.Label>Quantidade de números</Form.Label>
                  <Form.Control
                    type="number"
                    min="1"
                    value={createForm.numbersTotal}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, numbersTotal: event.target.value }))}
                    required
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3" controlId="raffleWinners">
              <Form.Label>Quantidade de ganhadores</Form.Label>
              <Form.Control
                type="number"
                min="1"
                value={createForm.winnersCount}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, winnersCount: event.target.value }))}
                required
              />
            </Form.Group>
            <Form.Group className="mb-0" controlId="raffleGroups">
              <Form.Label>Grupos onde a rifa estará disponível</Form.Label>
              <Form.Select
                multiple
                value={createForm.groupIds.map((id) => id.toString())}
                onChange={(event) => {
                  const options = Array.from(event.target.selectedOptions).map((option) => Number(option.value));
                  setCreateForm((prev) => ({ ...prev, groupIds: options }));
                }}
              >
                {groupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <hr className="my-4" />
            <Form.Group className="mb-3" controlId="raffleAnnouncementMessage">
              <Form.Label>Mensagem de divulgação</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={createForm.announcementMessage}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, announcementMessage: event.target.value }))
                }
              />
              <Form.Text className="text-muted">{ANNOUNCEMENT_PLACEHOLDER_HINT}</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="raffleAnnouncementMedia">
              <Form.Label>Mídia opcional</Form.Label>
              {createForm.announcementMedia ? (
                <div className="d-flex flex-column gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <span>{createForm.announcementMedia.fileName ?? "Mídia selecionada"}</span>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={handleRemoveCreateMedia}
                      disabled={createMediaUploading}
                    >
                      Remover
                    </Button>
                  </div>
                  {createForm.announcementMedia.mediaType === "image" && createForm.announcementMedia.url ? (
                    <img
                      src={createForm.announcementMedia.url}
                      alt="Pré-visualização da mídia"
                      className="img-fluid rounded"
                      style={{ maxHeight: 160 }}
                    />
                  ) : null}
                </div>
              ) : (
                <Form.Control
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf"
                  onChange={handleCreateMediaChange}
                  disabled={createMediaUploading}
                />
              )}
              {createMediaUploading ? (
                <Form.Text className="text-muted">Enviando mídia...</Form.Text>
              ) : null}
            </Form.Group>
            <Form.Check
              className="mb-3"
              type="switch"
              id="raffleAnnouncementMentionAll"
              label="Mencionar todos os participantes do(s) grupo(s)"
              checked={createForm.announcementMentionAll}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, announcementMentionAll: event.target.checked }))
              }
            />
            <Form.Group className="mb-0" controlId="raffleFinalMessage">
              <Form.Label>Mensagem de finalização</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={createForm.finalMessage}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, finalMessage: event.target.value }))
                }
              />
              <Form.Text className="text-muted">{FINAL_PLACEHOLDER_HINT}</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowCreateModal(false)} disabled={createSubmitting}>
              Fechar
            </Button>
            <Button type="submit" disabled={createSubmitting || !pixConfigured}>
              {createSubmitting ? <Spinner animation="border" size="sm" /> : "Criar rifa"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={showEditModal}
        onHide={() => {
          setShowEditModal(false);
          setEditError(null);
        }}
        centered
      >
        <Form onSubmit={handleSubmitEdit}>
          <Modal.Header closeButton>
            <Modal.Title>Editar rifa</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {editError && (
              <Alert variant="danger" onClose={() => setEditError(null)} dismissible>
                {editError}
              </Alert>
            )}
            <Form.Group className="mb-3" controlId="editRaffleTitle">
              <Form.Label>Título</Form.Label>
              <Form.Control
                value={editForm.title}
                onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                required
                disabled={editSubmitting}
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="editRaffleDescription">
              <Form.Label>Descrição</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={editForm.description}
                onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                disabled={editSubmitting}
              />
            </Form.Group>
            <Row className="mb-3">
              <Col md={6}>
                <Form.Group controlId="editRafflePrice">
                  <Form.Label>Valor por número (R$)</Form.Label>
                  <Form.Control
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.price}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, price: event.target.value }))}
                    required
                    disabled={editSubmitting}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="editRaffleNumbers">
                  <Form.Label>Quantidade total de números</Form.Label>
                  <Form.Control
                    type="number"
                    min={Math.max(1, minimumNumbersTotal)}
                    value={editForm.numbersTotal}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, numbersTotal: event.target.value }))}
                    required
                    disabled={editSubmitting}
                  />
                  <Form.Text className="text-secondary">
                    Para adicionar novos números, aumente o total. Mínimo atual: {Math.max(1, minimumNumbersTotal)}.
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3" controlId="editRaffleWinners">
              <Form.Label>Quantidade de ganhadores</Form.Label>
              <Form.Control
                type="number"
                min="1"
                value={editForm.winnersCount}
                onChange={(event) => setEditForm((prev) => ({ ...prev, winnersCount: event.target.value }))}
                required
                disabled={editSubmitting}
              />
            </Form.Group>
            <Form.Group className="mb-0" controlId="editRaffleGroups">
              <Form.Label>Grupos onde a rifa estará disponível</Form.Label>
              <Form.Select
                multiple
                value={editForm.groupIds.map((id) => id.toString())}
                onChange={(event) => {
                  const options = Array.from(event.target.selectedOptions).map((option) => Number(option.value));
                  setEditForm((prev) => ({ ...prev, groupIds: options }));
                }}
                disabled={editSubmitting}
              >
                {groupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              </Form.Select>
              <Form.Text className="text-secondary">
                Se nenhum grupo for selecionado, a rifa ficará disponível para todos os grupos do bot.
              </Form.Text>
            </Form.Group>
            <hr className="my-4" />
            <Form.Group className="mb-3" controlId="editAnnouncementMessage">
              <Form.Label>Mensagem de divulgação</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={editForm.announcementMessage}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, announcementMessage: event.target.value }))
                }
                disabled={editSubmitting}
              />
              <Form.Text className="text-muted">{ANNOUNCEMENT_PLACEHOLDER_HINT}</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="editAnnouncementMedia">
              <Form.Label>Mídia opcional</Form.Label>
              {editForm.announcementMedia ? (
                <div className="d-flex flex-column gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <span>{editForm.announcementMedia.fileName ?? "Mídia selecionada"}</span>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={handleRemoveEditMedia}
                      disabled={editSubmitting || editMediaUploading}
                    >
                      Remover
                    </Button>
                  </div>
                  {editForm.announcementMedia.mediaType === "image" && editForm.announcementMedia.url ? (
                    <img
                      src={editForm.announcementMedia.url}
                      alt="Pré-visualização da mídia"
                      className="img-fluid rounded"
                      style={{ maxHeight: 160 }}
                    />
                  ) : null}
                </div>
              ) : (
                <Form.Control
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf"
                  onChange={handleEditMediaChange}
                  disabled={editSubmitting || editMediaUploading}
                />
              )}
              {editMediaUploading ? (
                <Form.Text className="text-muted">Enviando mídia...</Form.Text>
              ) : null}
            </Form.Group>
            <Form.Check
              className="mb-3"
              type="switch"
              id="editAnnouncementMentionAll"
              label="Mencionar todos os participantes do(s) grupo(s)"
              checked={editForm.announcementMentionAll}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, announcementMentionAll: event.target.checked }))
              }
              disabled={editSubmitting}
            />
            <Form.Group className="mb-0" controlId="editFinalMessage">
              <Form.Label>Mensagem de finalização</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={editForm.finalMessage}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, finalMessage: event.target.value }))
                }
                disabled={editSubmitting}
              />
              <Form.Text className="text-muted">{FINAL_PLACEHOLDER_HINT}</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="outline-secondary"
              type="button"
              onClick={() => {
                setShowEditModal(false);
                setEditError(null);
              }}
              disabled={editSubmitting}
            >
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={editSubmitting}>
              {editSubmitting ? <Spinner animation="border" size="sm" /> : "Salvar alterações"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={drawModalOpen}
        onHide={handleCloseDrawModal}
        centered
        backdrop={drawSubmitting ? "static" : true}
        keyboard={!drawSubmitting}
      >
        <Modal.Header closeButton={!drawSubmitting}>
          <Modal.Title>Sortear rifa</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {drawModalError && (
            <Alert variant="danger" onClose={() => setDrawModalError(null)} dismissible>
              {drawModalError}
            </Alert>
          )}
          {drawModalTarget ? (
            <div className="d-flex flex-column gap-3">
              <p className="mb-0">
                Confirme o sorteio e a finalização da rifa{" "}
                <strong>{drawModalTarget.title}</strong>.
              </p>
              <div className="bg-light rounded p-3">
                <div className="small text-muted">Resumo rápido</div>
                <ul className="mb-0 ps-3">
                  <li>Números vendidos: {drawModalTarget.soldCount}</li>
                  <li>Reservas ativas: {drawModalTarget.reservedCount}</li>
                  <li>Ganhadores configurados: {drawModalTarget.winnersCount}</li>
                </ul>
              </div>
              {drawModalTarget.groups.length > 0 ? (
                <Form.Check
                  type="switch"
                  id="draw-modal-announce"
                  label="Anunciar resultado nos grupos"
                  checked={drawModalAnnounce}
                  onChange={(event) => setDrawModalAnnounce(event.target.checked)}
                  disabled={drawSubmitting}
                />
              ) : (
                <div className="text-secondary small">
                  Nenhum grupo associado. O anúncio por voz fica disponível no painel de notificações.
                </div>
              )}
            </div>
          ) : (
            <div className="text-secondary">Selecione uma rifa com números pagos para realizar o sorteio.</div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleCloseDrawModal} disabled={drawSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="success"
            onClick={handleConfirmDraw}
            disabled={drawSubmitting || !drawModalTarget}
          >
            {drawSubmitting ? <Spinner animation="border" size="sm" /> : "Sortear e finalizar"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={detailModalOpen}
        onHide={() => {
          setDetailModalOpen(false);
          setDetailError(null);
          setDetailSuccess(null);
        }}
        size="lg"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Detalhes da rifa</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detailLoading && (
            <div className="d-flex justify-content-center py-4">
              <Spinner animation="border" />
            </div>
          )}
          {detailError && (
            <Alert variant="danger" onClose={() => setDetailError(null)} dismissible>
              {detailError}
            </Alert>
          )}
          {detailSuccess && (
            <Alert variant="success" onClose={() => setDetailSuccess(null)} dismissible>
              {detailSuccess}
            </Alert>
          )}
          {detailRaffle && !detailLoading && (
            <div className="d-flex flex-column gap-3">
              <div>
                <h3 className="h5 mb-1">{detailRaffle.title}</h3>
                {detailRaffle.description && <p className="mb-2">{detailRaffle.description}</p>}
                <div className="text-muted small">
                  Valor por número: {formatCurrency(detailRaffle.price)} · Criada em {formatDateTime(detailRaffle.createdAt)}
                </div>
              </div>

              <Row>
                <Col md={4}>
                  <Card>
                    <Card.Body>
                      <div className="text-muted small">Números vendidos</div>
                      <div className="h4 mb-0">{detailRaffle.soldCount}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={4}>
                  <Card>
                    <Card.Body>
                      <div className="text-muted small">Reservas ativas</div>
                      <div className="h4 mb-0">{detailRaffle.reservedCount}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={4}>
                  <Card>
                    <Card.Body>
                      <div className="text-muted small">Status</div>
                      <Badge bg={statusVariant[detailRaffle.status]}>{statusLabel[detailRaffle.status]}</Badge>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>

              <div>
                <h4 className="h6">Participantes</h4>
                {renderTickets(detailRaffle.tickets)}
              </div>

              {detailRaffle.winners && detailRaffle.winners.length > 0 && (
                <div>
                  <h4 className="h6">Ganhadores</h4>
                  <ul className="mb-0">
                    {detailRaffle.winners.map((winner, index) => (
                      <li key={`${winner.number}-${index}`}>
                        Número {winner.number} — {winner.customerName || "Participante"}
                        {winner.customerWhatsapp ? ` (${winner.customerWhatsapp})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer className="d-flex flex-wrap gap-2 justify-content-between">
          <div className="d-flex flex-wrap gap-2">
            <Button
              variant="outline-secondary"
              onClick={() => setDetailModalOpen(false)}
              disabled={drawSubmitting || statusUpdating}
            >
              Fechar
            </Button>
            {detailRaffle && (
              <Button
                variant="outline-primary"
                onClick={handleOpenEdit}
                disabled={drawSubmitting || statusUpdating || deletingRaffleId === detailRaffle.id}
              >
                Editar rifa
              </Button>
            )}
            {detailRaffle && (
              <Button
                variant="danger"
                onClick={() => handleDeleteRaffle(detailRaffle.id)}
                disabled={deletingRaffleId === detailRaffle.id}
              >
                {deletingRaffleId === detailRaffle.id ? "Excluindo..." : "Excluir rifa"}
              </Button>
            )}
            {detailRaffle && detailRaffle.status !== "completed" && detailRaffle.status !== "cancelled" && (
              <Button
                variant="outline-danger"
                onClick={handleCancelFromDetail}
                disabled={statusUpdating || drawSubmitting || deletingRaffleId === detailRaffle.id}
              >
                Cancelar rifa
              </Button>
            )}
            {detailRaffle && detailRaffle.reservedCount > 0 && (
              <Button
                variant="outline-warning"
                onClick={() => handleReleaseReservations(detailRaffle.id)}
                disabled={releasingRaffleId === detailRaffle.id || deletingRaffleId === detailRaffle.id}
              >
                {releasingRaffleId === detailRaffle.id ? "Liberando..." : "Liberar reservas"}
              </Button>
            )}
          </div>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default UserRaffleManager;
