"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  InputGroup,
  Modal,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";

import { formatCurrency, formatDateTime } from "lib/format";
import type { PurchaseHistoryEntry, PurchaseMetadata } from "types/purchases";
import type { PaymentCharge, PaymentChargeMetadata } from "types/payments";

interface UserPurchasesViewProps {
  userName: string;
  purchases: PurchaseHistoryEntry[];
  charges: PaymentCharge[];
}

type ViewOption = "purchases" | "payments";

const viewOptions: { value: ViewOption; label: string }[] = [
  { value: "purchases", label: "Histórico de compras" },
  { value: "payments", label: "Pagamentos recebidos" },
];

const NOTE_CHARACTER_LIMIT = 2000;
const PRODUCT_DETAILS_CHARACTER_LIMIT = 4000;

const truncate = (value: string, length = 140) => {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length)}…`;
};

const getStatusVariant = (status: string) => {
  const normalized = status.toLowerCase();

  if (normalized === "approved" || normalized === "accredited") {
    return "success";
  }

  if (normalized === "pending") {
    return "warning";
  }

  if (normalized === "rejected" || normalized === "cancelled" || normalized === "cancelado") {
    return "danger";
  }

  return "secondary";
};

const getStatusLabel = (status: string) => {
  const normalized = status.toLowerCase();

  switch (normalized) {
    case "approved":
    case "accredited":
      return "Aprovado";
    case "pending":
      return "Pendente";
    case "in_process":
      return "Em análise";
    case "rejected":
      return "Recusado";
    case "cancelled":
    case "cancelado":
      return "Cancelado";
    default:
      return normalized || "-";
  }
};

const getProviderLabel = (provider: string) => {
  switch (provider) {
    case "mercadopago_pix":
      return "Pix";
    case "mercadopago_checkout":
      return "Checkout";
    default:
      return provider;
  }
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const metadataToSearchString = (
  metadata: PurchaseMetadata | PaymentChargeMetadata | null | undefined,
): string => {
  if (!metadata) {
    return "";
  }

  const parts: string[] = [];

  if (typeof metadata.adminNote === "string" && metadata.adminNote.trim().length > 0) {
    parts.push(metadata.adminNote);
  }

  const rest = { ...metadata } as Record<string, unknown>;
  delete (rest as { adminNote?: unknown }).adminNote;

  if (Object.keys(rest).length > 0) {
    try {
      parts.push(JSON.stringify(rest));
    } catch (error) {
      console.warn("Failed to stringify metadata for search", error);
    }
  }

  return parts.join(" ");
};

const getAdminNote = (
  metadata: PurchaseMetadata | PaymentChargeMetadata | null | undefined,
): string => {
  if (metadata && typeof metadata.adminNote === "string") {
    return metadata.adminNote;
  }

  return "";
};

const stripAdminNote = (
  metadata: PurchaseMetadata | PaymentChargeMetadata | null | undefined,
): Record<string, unknown> | null => {
  if (!metadata) {
    return null;
  }

  const rest = { ...metadata } as Record<string, unknown>;
  delete (rest as { adminNote?: unknown }).adminNote;

  return Object.keys(rest).length > 0 ? rest : null;
};

const buildSearchBlob = (parts: Array<string | number | null | undefined>) =>
  parts
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .map((value) => String(value))
    .join(" ");

const UserPurchasesView = ({ userName, purchases, charges }: UserPurchasesViewProps) => {
  const [currentView, setCurrentView] = useState<ViewOption>("purchases");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");
  const [validityFilter, setValidityFilter] = useState<"all" | "active" | "expired">("all");
  const [customerFilter, setCustomerFilter] = useState("");
  const [purchaseList, setPurchaseList] = useState(purchases);
  const [chargeList, setChargeList] = useState(charges);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseHistoryEntry | null>(null);
  const [selectedCharge, setSelectedCharge] = useState<PaymentCharge | null>(null);
  const [purchaseNoteDraft, setPurchaseNoteDraft] = useState("");
  const [chargeNoteDraft, setChargeNoteDraft] = useState("");
  const [isSavingPurchaseNote, setIsSavingPurchaseNote] = useState(false);
  const [isSavingChargeNote, setIsSavingChargeNote] = useState(false);
  const [purchaseNoteError, setPurchaseNoteError] = useState<string | null>(null);
  const [chargeNoteError, setChargeNoteError] = useState<string | null>(null);
  const [purchaseNoteSuccess, setPurchaseNoteSuccess] = useState(false);
  const [chargeNoteSuccess, setChargeNoteSuccess] = useState(false);
  const [productDetailsDraft, setProductDetailsDraft] = useState("");
  const [productFilePathDraft, setProductFilePathDraft] = useState("");
  const [productIdDraft, setProductIdDraft] = useState("");
  const [applyProductUpdateToAll, setApplyProductUpdateToAll] = useState(false);
  const [isUpdatingProduct, setIsUpdatingProduct] = useState(false);
  const [productUpdateError, setProductUpdateError] = useState<string | null>(null);
  const [productUpdateSuccess, setProductUpdateSuccess] = useState(false);
  const [productUpdateMessage, setProductUpdateMessage] = useState<string | null>(null);
  const [activePurchaseId, setActivePurchaseId] = useState<number | null>(null);

  const getSupportExpirationDate = useCallback((entry: PurchaseHistoryEntry): Date | null => {
    const duration = entry.categoryDurationDays;
    if (!duration || duration <= 0) {
      return null;
    }

    const purchasedAt = new Date(entry.purchasedAt);
    if (Number.isNaN(purchasedAt.getTime())) {
      return null;
    }

    const expiry = new Date(purchasedAt.getTime());
    expiry.setUTCDate(expiry.getUTCDate() + duration);
    return expiry;
  }, []);

  const isPurchaseWithinSupportWindow = useCallback((entry: PurchaseHistoryEntry): boolean => {
    const expiry = getSupportExpirationDate(entry);
    if (!expiry) {
      return true;
    }
    return expiry.getTime() >= Date.now();
  }, [getSupportExpirationDate]);

  useEffect(() => {
    setPurchaseList(purchases);
  }, [purchases]);

  useEffect(() => {
    setChargeList(charges);
  }, [charges]);

  useEffect(() => {
    if (!selectedPurchase) {
      setPurchaseNoteDraft("");
      setPurchaseNoteError(null);
      setPurchaseNoteSuccess(false);
      setProductDetailsDraft("");
      setProductFilePathDraft("");
      setProductIdDraft("");
      setApplyProductUpdateToAll(false);
      setProductUpdateError(null);
      setProductUpdateSuccess(false);
      setProductUpdateMessage(null);
      setActivePurchaseId(null);
      return;
    }

    setPurchaseNoteDraft(getAdminNote(selectedPurchase.metadata));
    setPurchaseNoteError(null);

    setProductDetailsDraft(selectedPurchase.productDetails);
    setProductFilePathDraft(selectedPurchase.productFilePath ?? "");
    setProductIdDraft(
      typeof selectedPurchase.productId === "number" && Number.isFinite(selectedPurchase.productId)
        ? String(selectedPurchase.productId)
        : "",
    );
    setProductUpdateError(null);

    if (selectedPurchase.id !== activePurchaseId) {
      setPurchaseNoteSuccess(false);
      setProductUpdateSuccess(false);
      setProductUpdateMessage(null);
      setApplyProductUpdateToAll(false);
      setActivePurchaseId(selectedPurchase.id);
    }
  }, [selectedPurchase, activePurchaseId]);

  useEffect(() => {
    if (selectedCharge) {
      setChargeNoteDraft(getAdminNote(selectedCharge.metadata));
      setChargeNoteError(null);
      setChargeNoteSuccess(false);
    } else {
      setChargeNoteDraft("");
    }
  }, [selectedCharge]);

  const purchaseCount = purchaseList.length;
  const chargeCount = chargeList.length;

  const totalPurchaseAmount = useMemo(
    () => purchaseList.reduce((sum, purchase) => sum + purchase.categoryPrice, 0),
    [purchaseList],
  );

  const totalChargeAmount = useMemo(
    () => chargeList.reduce((sum, charge) => sum + (Number.isFinite(charge.amount) ? charge.amount : 0), 0),
    [chargeList],
  );

  const approvedChargeSummary = useMemo(
    () =>
      chargeList.reduce(
        (acc, charge) => {
          const normalizedStatus = charge.status.toLowerCase();
          if (normalizedStatus === "approved" || normalizedStatus === "accredited") {
            acc.count += 1;
            acc.amount += Number.isFinite(charge.amount) ? charge.amount : 0;
          }
          return acc;
        },
        { count: 0, amount: 0 },
      ),
    [chargeList],
  );

  const normalizedQuery = searchTerm.trim().length > 0 ? normalizeText(searchTerm.trim()) : "";
  const hasSearch = normalizedQuery.length > 0;

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of purchaseList) {
      if (p.categoryName) set.add(p.categoryName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [purchaseList]);

  const filteredPurchases = useMemo(() => {
    if (!hasSearch) {
      // still apply explicit filters even without search
      return purchaseList.filter((purchase) => {
        if (categoryFilter !== "all" && purchase.categoryName !== categoryFilter) return false;
        if (validityFilter !== "all") {
          const isActive = isPurchaseWithinSupportWindow(purchase);
          if (validityFilter === "active" && !isActive) return false;
          if (validityFilter === "expired" && isActive) return false;
        }
        if (customerFilter.trim()) {
          const blob = buildSearchBlob([purchase.customerName, purchase.customerWhatsapp]);
          if (!normalizeText(blob).includes(normalizeText(customerFilter.trim()))) return false;
        }
        return true;
      });
    }

    return purchaseList.filter((purchase) => {
      if (categoryFilter !== "all" && purchase.categoryName !== categoryFilter) return false;
      if (validityFilter !== "all") {
        const isActive = isPurchaseWithinSupportWindow(purchase);
        if (validityFilter === "active" && !isActive) return false;
        if (validityFilter === "expired" && isActive) return false;
      }
      if (customerFilter.trim()) {
        const blobC = buildSearchBlob([purchase.customerName, purchase.customerWhatsapp]);
        if (!normalizeText(blobC).includes(normalizeText(customerFilter.trim()))) return false;
      }
      const blob = buildSearchBlob([
        purchase.customerName,
        purchase.customerWhatsapp,
        purchase.categoryName,
        purchase.categoryDescription,
        purchase.productDetails,
        purchase.productFilePath,
        purchase.categoryId,
        purchase.categoryPrice,
        purchase.currency,
        purchase.productId,
        purchase.purchasedAt,
        metadataToSearchString(purchase.metadata),
      ]);

      if (!blob) {
        return false;
      }

      return normalizeText(blob).includes(normalizedQuery);
    });
  }, [
    hasSearch,
    normalizedQuery,
    purchaseList,
    categoryFilter,
    validityFilter,
    customerFilter,
    isPurchaseWithinSupportWindow,
  ]);

  const filteredCharges = useMemo(() => {
    if (!hasSearch) {
      return chargeList;
    }

    return chargeList.filter((charge) => {
      const blob = buildSearchBlob([
        charge.customerName,
        charge.customerWhatsapp,
        charge.provider,
        charge.providerPaymentId,
        charge.status,
        charge.amount,
        charge.currency,
        charge.publicId,
        charge.qrCode,
        charge.ticketUrl,
        charge.createdAt,
        charge.updatedAt,
        metadataToSearchString(charge.metadata),
      ]);

      if (!blob) {
        return false;
      }

      return normalizeText(blob).includes(normalizedQuery);
    });
  }, [chargeList, hasSearch, normalizedQuery]);

  const filteredPurchaseAmount = useMemo(
    () => filteredPurchases.reduce((sum, purchase) => sum + purchase.categoryPrice, 0),
    [filteredPurchases],
  );

  const filteredChargeAmount = useMemo(
    () => filteredCharges.reduce((sum, charge) => sum + (Number.isFinite(charge.amount) ? charge.amount : 0), 0),
    [filteredCharges],
  );

  const handleSavePurchaseNote = async () => {
    if (!selectedPurchase) {
      return;
    }

    setIsSavingPurchaseNote(true);
    setPurchaseNoteError(null);
    setPurchaseNoteSuccess(false);

    try {
      const response = await fetch(`/api/user/purchases/${selectedPurchase.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adminNote: purchaseNoteDraft }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || typeof data !== "object" || !("purchase" in data)) {
        throw new Error(
          data && typeof data === "object" && "message" in data && typeof data.message === "string"
            ? data.message
            : "Não foi possível salvar a anotação.",
        );
      }

      const updatedPurchase = data.purchase as PurchaseHistoryEntry;

      setPurchaseList((previous) =>
        previous.map((entry) => (entry.id === updatedPurchase.id ? updatedPurchase : entry)),
      );
      setSelectedPurchase(updatedPurchase);
      setPurchaseNoteSuccess(true);
    } catch (error) {
      console.error("Failed to update purchase note", error);
      setPurchaseNoteError(
        error instanceof Error ? error.message : "Não foi possível salvar a anotação.",
      );
    } finally {
      setIsSavingPurchaseNote(false);
    }
  };

  const handleUpdateProductDetails = async () => {
    if (!selectedPurchase) {
      return;
    }

    setIsUpdatingProduct(true);
    setProductUpdateError(null);
    setProductUpdateSuccess(false);
    setProductUpdateMessage(null);

    const originalDetails = selectedPurchase.productDetails;
    const originalFilePath = selectedPurchase.productFilePath ?? "";
    const originalProductId =
      typeof selectedPurchase.productId === "number" && Number.isFinite(selectedPurchase.productId)
        ? String(selectedPurchase.productId)
        : "";

    const normalizedDetails = productDetailsDraft.trim();
    const normalizedFilePath = productFilePathDraft.trim();
    const normalizedOriginalFilePath = originalFilePath.trim();
    const normalizedProductIdInput = productIdDraft.trim();
    const normalizedOriginalProductId = originalProductId.trim();

    const payload: Record<string, unknown> = {};

    if (productDetailsDraft !== originalDetails) {
      payload.productDetails = normalizedDetails;
    }

    if (normalizedFilePath !== normalizedOriginalFilePath) {
      payload.productFilePath = normalizedFilePath.length > 0 ? normalizedFilePath : null;
    }

    if (normalizedProductIdInput !== normalizedOriginalProductId) {
      if (normalizedProductIdInput.length === 0) {
        payload.productId = null;
      } else {
        const parsedProductId = Number.parseInt(normalizedProductIdInput, 10);

        if (!Number.isFinite(parsedProductId) || parsedProductId <= 0) {
          setProductUpdateError("Informe um ID de produto numérico válido.");
          setIsUpdatingProduct(false);
          return;
        }

        payload.productId = parsedProductId;
      }
    }

    if (Object.keys(payload).length === 0) {
      setProductUpdateError("Nenhuma alteração foi detectada para atualizar o produto.");
      setIsUpdatingProduct(false);
      return;
    }

    payload.applyToAll = Boolean(applyProductUpdateToAll && selectedPurchase.productId);

    try {
      const response = await fetch(`/api/user/purchases/${selectedPurchase.id}/product`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || typeof data !== "object" || !("purchase" in data)) {
        throw new Error(
          data && typeof data === "object" && "message" in data && typeof data.message === "string"
            ? data.message
            : "Não foi possível atualizar o produto.",
        );
      }

      const updatedPurchase = data.purchase as PurchaseHistoryEntry;
      const affectedPurchaseIdsRaw = (data as { affectedPurchaseIds?: unknown }).affectedPurchaseIds;
      const affectedPurchaseIds = Array.isArray(affectedPurchaseIdsRaw)
        ? (affectedPurchaseIdsRaw as number[])
        : [updatedPurchase.id];
      const updatedFields = ((data as { updatedFields?: unknown }).updatedFields ?? {}) as {
        productDetails?: string;
        productFilePath?: string | null;
        productId?: number | null;
      };

      const affectedSet = new Set<number>(affectedPurchaseIds);

      setPurchaseList((previous) =>
        previous.map((entry) => {
          if (!affectedSet.has(entry.id)) {
            return entry;
          }

          const nextEntry: PurchaseHistoryEntry = { ...entry };

          if (Object.prototype.hasOwnProperty.call(updatedFields, "productDetails")) {
            nextEntry.productDetails = updatedFields.productDetails ?? "";
          }

          if (Object.prototype.hasOwnProperty.call(updatedFields, "productFilePath")) {
            nextEntry.productFilePath = updatedFields.productFilePath ?? null;
          }

          if (Object.prototype.hasOwnProperty.call(updatedFields, "productId")) {
            nextEntry.productId =
              typeof updatedFields.productId === "number" && Number.isFinite(updatedFields.productId)
                ? updatedFields.productId
                : null;
          }

          return nextEntry;
        }),
      );

      setSelectedPurchase(updatedPurchase);
      setProductUpdateSuccess(true);
      const messageFromServer = (data as { message?: unknown }).message;
      setProductUpdateMessage(
        typeof messageFromServer === "string" && messageFromServer.trim().length > 0
          ? messageFromServer
          : "Produto atualizado com sucesso.",
      );
      setApplyProductUpdateToAll(false);
    } catch (error) {
      console.error("Failed to update purchase product", error);
      setProductUpdateError(
        error instanceof Error ? error.message : "Não foi possível atualizar o produto.",
      );
    } finally {
      setIsUpdatingProduct(false);
    }
  };

  const handleSaveChargeNote = async () => {
    if (!selectedCharge) {
      return;
    }

    setIsSavingChargeNote(true);
    setChargeNoteError(null);
    setChargeNoteSuccess(false);

    try {
      const response = await fetch(`/api/user/charges/${selectedCharge.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adminNote: chargeNoteDraft }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || typeof data !== "object" || !("charge" in data)) {
        throw new Error(
          data && typeof data === "object" && "message" in data && typeof data.message === "string"
            ? data.message
            : "Não foi possível salvar a anotação.",
        );
      }

      const updatedCharge = data.charge as PaymentCharge;

      setChargeList((previous) =>
        previous.map((entry) => (entry.id === updatedCharge.id ? updatedCharge : entry)),
      );
      setSelectedCharge(updatedCharge);
      setChargeNoteSuccess(true);
    } catch (error) {
      console.error("Failed to update charge note", error);
      setChargeNoteError(
        error instanceof Error ? error.message : "Não foi possível salvar a anotação.",
      );
    } finally {
      setIsSavingChargeNote(false);
    }
  };

  const purchaseNoteOriginal = selectedPurchase ? getAdminNote(selectedPurchase.metadata) : "";
  const chargeNoteOriginal = selectedCharge ? getAdminNote(selectedCharge.metadata) : "";
  const productDetailsOriginal = selectedPurchase?.productDetails ?? "";
  const productFilePathOriginal = selectedPurchase?.productFilePath ?? "";
  const productIdOriginal =
    selectedPurchase && typeof selectedPurchase.productId === "number" && Number.isFinite(selectedPurchase.productId)
      ? String(selectedPurchase.productId)
      : "";
  const normalizedProductFilePathDraft = productFilePathDraft.trim();
  const normalizedProductFilePathOriginal = productFilePathOriginal.trim();
  const normalizedProductIdDraft = productIdDraft.trim();
  const normalizedProductIdOriginal = productIdOriginal.trim();
  const hasProductChanges = Boolean(selectedPurchase)
    && (productDetailsDraft !== productDetailsOriginal
      || normalizedProductFilePathDraft !== normalizedProductFilePathOriginal
      || normalizedProductIdDraft !== normalizedProductIdOriginal);
  const selectedPurchaseExpiration = selectedPurchase ? getSupportExpirationDate(selectedPurchase) : null;
  const selectedPurchaseIsActive = selectedPurchase ? isPurchaseWithinSupportWindow(selectedPurchase) : false;
  const hasLinkedProduct = Boolean(selectedPurchase && selectedPurchase.productId);
  const eligibleBulkCount = hasLinkedProduct && selectedPurchase
    ? purchaseList.filter(
      (entry) => entry.id !== selectedPurchase.id
        && entry.productId === selectedPurchase.productId
        && isPurchaseWithinSupportWindow(entry),
    ).length
    : 0;
  const canBulkUpdateProduct = hasLinkedProduct && eligibleBulkCount > 0;
  useEffect(() => {
    if (!canBulkUpdateProduct && applyProductUpdateToAll) {
      setApplyProductUpdateToAll(false);
    }
  }, [canBulkUpdateProduct, applyProductUpdateToAll]);
  const isPurchaseNoteDirty = purchaseNoteDraft !== purchaseNoteOriginal;
  const isChargeNoteDirty = chargeNoteDraft !== chargeNoteOriginal;
  const isProductUpdateDisabled = !hasProductChanges || isUpdatingProduct;
  const purchaseNoteCharacterCount = purchaseNoteDraft.length;
  const chargeNoteCharacterCount = chargeNoteDraft.length;
  const productDetailsCharacterCount = productDetailsDraft.length;

  const openPurchaseDetails = (purchase: PurchaseHistoryEntry) => {
    setSelectedCharge(null);
    setSelectedPurchase(purchase);
  };

  const openChargeDetails = (charge: PaymentCharge) => {
    setSelectedPurchase(null);
    setSelectedCharge(charge);
  };

  const closePurchaseModal = () => setSelectedPurchase(null);
  const closeChargeModal = () => setSelectedCharge(null);

  const purchaseHeaderSummary = hasSearch
    ? filteredPurchases.length === 0
      ? "Nenhuma compra encontrada com os critérios informados."
      : `${filteredPurchases.length} compra(s) filtradas • Receita filtrada de ${formatCurrency(filteredPurchaseAmount)}`
    : purchaseCount === 0
      ? "Nenhuma compra registrada ainda."
      : `${purchaseCount} compra(s) registradas • Receita acumulada de ${formatCurrency(totalPurchaseAmount)}`;

  const chargeHeaderSummary = hasSearch
    ? filteredCharges.length === 0
      ? "Nenhum pagamento encontrado com os critérios informados."
      : `${filteredCharges.length} pagamento(s) filtrados • Total filtrado de ${formatCurrency(filteredChargeAmount)}`
    : chargeCount === 0
      ? "Nenhum pagamento confirmado até o momento."
      : `${chargeCount} pagamento(s) • Total creditado de ${formatCurrency(totalChargeAmount)}`;

  const activeResultsCount = currentView === "purchases" ? filteredPurchases.length : filteredCharges.length;
  const totalResultsCount = currentView === "purchases" ? purchaseCount : chargeCount;

  const searchHelperText = hasSearch
    ? `Mostrando ${activeResultsCount} de ${totalResultsCount} ${currentView === "purchases" ? "compra(s)" : "pagamento(s)"}.`
    : "Busque por nome, número do WhatsApp, identificadores, status ou detalhes de cada registro.";

  return (
    <div className="d-flex flex-column gap-4">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-between gap-3">
          <div>
            <h1 className="mb-1">Vendas</h1>
            <p className="text-secondary mb-0">{userName}, gerencie as vendas do robô com filtros e busca.</p>
          </div>
          <Form.Group className="w-100 w-lg-auto mb-0">
            <Form.Label className="fw-semibold text-secondary text-uppercase small mb-1">Visualizar</Form.Label>
            <Form.Select
              value={currentView}
              onChange={(event) => setCurrentView(event.target.value as ViewOption)}
            >
              {viewOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </div>

        <Row xs={1} md={3} className="g-3">
          <Col>
            <Card className="h-100">
              <Card.Body>
                <small className="text-secondary text-uppercase fw-semibold">Compras registradas</small>
                <h3 className="h4 mt-2 mb-1">{purchaseCount}</h3>
                <p className="text-secondary mb-0 small">
                  Receita acumulada de {formatCurrency(totalPurchaseAmount)}
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col>
            <Card className="h-100">
              <Card.Body>
                <small className="text-secondary text-uppercase fw-semibold">Pagamentos registrados</small>
                <h3 className="h4 mt-2 mb-1">{chargeCount}</h3>
                <p className="text-secondary mb-0 small">
                  Total creditado de {formatCurrency(totalChargeAmount)}
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col>
            <Card className="h-100">
              <Card.Body>
                <small className="text-secondary text-uppercase fw-semibold">Pagamentos aprovados</small>
                <h3 className="h4 mt-2 mb-1">{approvedChargeSummary.count}</h3>
                <p className="text-secondary mb-0 small">
                  Receita confirmada de {formatCurrency(approvedChargeSummary.amount)}
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Form.Group className="d-flex flex-column flex-lg-row align-items-lg-end gap-3 mb-0">
          <div className="w-100">
            <Form.Label className="fw-semibold text-secondary text-uppercase small mb-1">
              Pesquisa inteligente
            </Form.Label>
            <InputGroup>
              <InputGroup.Text
                id="purchases-search-addon"
                className="bg-transparent border-end-0 text-secondary"
              >
                <span aria-hidden="true">🔍</span>
              </InputGroup.Text>
              <Form.Control
                type="search"
                placeholder="Busque por nome, número, ID ou status"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Pesquisar compras e pagamentos"
                aria-describedby="purchases-search-addon"
                className="border-start-0"
              />
              {hasSearch && (
                <Button
                  variant="outline-secondary"
                  onClick={() => setSearchTerm("")}
                  aria-label="Limpar pesquisa"
                >
                  Limpar
                </Button>
              )}
            </InputGroup>
            <Form.Text className="text-secondary">{searchHelperText}</Form.Text>
          </div>
          {currentView === "purchases" && (
            <>
              <Form.Group className="mb-0">
                <Form.Label className="fw-semibold text-secondary text-uppercase small mb-1">Categoria</Form.Label>
                <Form.Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)}>
                  <option value="all">Todas</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-0">
                <Form.Label className="fw-semibold text-secondary text-uppercase small mb-1">Validade</Form.Label>
                <Form.Select value={validityFilter} onChange={(e) => setValidityFilter(e.target.value as any)}>
                  <option value="all">Todas</option>
                  <option value="active">Com suporte ativo</option>
                  <option value="expired">Expiradas</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-0">
                <Form.Label className="fw-semibold text-secondary text-uppercase small mb-1">Cliente</Form.Label>
                <Form.Control
                  placeholder="Nome ou WhatsApp"
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                />
              </Form.Group>
            </>
          )}
        </Form.Group>
      </div>

      {currentView === "purchases" ? (
        <Card>
          <Card.Header className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-between gap-3">
            <div>
              <h2 className="h5 mb-0">Histórico de compras</h2>
              <small className="text-secondary">{purchaseHeaderSummary}</small>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="table-responsive">
              <Table hover responsive className="mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Categoria</th>
                    <th className="text-end">Valor</th>
                    <th>Detalhes</th>
                    <th className="text-end">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-secondary">
                        {hasSearch
                          ? "Nenhuma compra encontrada. Ajuste a busca ou limpe os filtros para visualizar outras compras."
                          : "Assim que os clientes comprarem pelo bot, o histórico aparecerá por aqui."}
                      </td>
                    </tr>
                  ) : (
                    filteredPurchases.map((purchase) => {
                      const customerLabel = purchase.customerName
                        ?? (purchase.customerWhatsapp ? `@${purchase.customerWhatsapp}` : "Cliente do bot");
                      const adminNote = getAdminNote(purchase.metadata);
                      const hasAdminNote = adminNote.trim().length > 0;

                      return (
                        <tr key={purchase.id}>
                          <td>{formatDateTime(purchase.purchasedAt)}</td>
                          <td>{customerLabel}</td>
                          <td>
                            <strong className="d-block">{purchase.categoryName}</strong>
                            {purchase.categoryDescription && (
                              <small className="text-secondary">
                                {truncate(purchase.categoryDescription, 80)}
                              </small>
                            )}
                          </td>
                          <td className="text-end">{formatCurrency(purchase.categoryPrice)}</td>
                          <td>
                            <small className="text-secondary d-block">
                              {truncate(purchase.productDetails, 120)}
                            </small>
                            {purchase.metadata && typeof purchase.metadata.balanceAfterPurchase === "number" && (
                              <small className="text-secondary d-block mt-2">
                                Saldo após compra: {formatCurrency(purchase.metadata.balanceAfterPurchase as number)}
                              </small>
                            )}
                            {purchase.productFilePath && (
                              <Badge bg="light" text="dark" className="mt-2">
                                Conteúdo com anexo
                              </Badge>
                            )}
                          </td>
                          <td className="text-end">
                            <div className="d-flex flex-wrap justify-content-end gap-2">
                              {hasAdminNote && (
                                <Badge bg="info" text="dark">
                                  Nota
                                </Badge>
                              )}
                              <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={() => openPurchaseDetails(purchase)}
                              >
                                Detalhes
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>
          </Card.Body>
        </Card>
      ) : (
        <Card>
          <Card.Header className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-between gap-3">
            <div>
              <h2 className="h5 mb-0">Pagamentos recebidos</h2>
              <small className="text-secondary">{chargeHeaderSummary}</small>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="table-responsive">
              <Table hover responsive className="mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th className="text-end">Valor</th>
                    <th>Status</th>
                    <th>Origem</th>
                    <th>Atualizado em</th>
                    <th className="text-end">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCharges.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-secondary">
                        {hasSearch
                          ? "Nenhum pagamento encontrado. Ajuste a busca ou limpe os filtros para visualizar outras cobranças."
                          : "Confirmaremos automaticamente os pagamentos aprovados e eles aparecerão aqui."}
                      </td>
                    </tr>
                  ) : (
                    filteredCharges.map((charge) => {
                      const customerLabel = charge.customerName
                        ?? (charge.customerWhatsapp ? `@${charge.customerWhatsapp}` : "Cliente do bot");
                      const statusVariant = getStatusVariant(charge.status);
                      const statusLabel = getStatusLabel(charge.status);
                      const providerLabel = getProviderLabel(charge.provider);
                      const adminNote = getAdminNote(charge.metadata);
                      const hasAdminNote = adminNote.trim().length > 0;

                      return (
                        <tr key={charge.id}>
                          <td>{formatDateTime(charge.createdAt)}</td>
                          <td>{customerLabel}</td>
                          <td className="text-end">{formatCurrency(charge.amount)}</td>
                          <td>
                            <Badge bg={statusVariant} className="text-capitalize">
                              {statusLabel}
                            </Badge>
                          </td>
                          <td>{providerLabel}</td>
                          <td>{formatDateTime(charge.updatedAt)}</td>
                          <td className="text-end">
                            <div className="d-flex flex-wrap justify-content-end gap-2">
                              {hasAdminNote && (
                                <Badge bg="info" text="dark">
                                  Nota
                                </Badge>
                              )}
                              <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={() => openChargeDetails(charge)}
                              >
                                Detalhes
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>
          </Card.Body>
        </Card>
      )}

      <Modal show={Boolean(selectedPurchase)} onHide={closePurchaseModal} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Detalhes da compra</Modal.Title>
        </Modal.Header>
        {selectedPurchase && (
          <>
            <Modal.Body className="d-flex flex-column gap-4">
              <div>
                <h3 className="h6 text-uppercase text-secondary mb-2">Resumo</h3>
                <dl className="row mb-0 small">
                  <dt className="col-sm-4 text-secondary text-uppercase">Data da compra</dt>
                  <dd className="col-sm-8 text-dark">{formatDateTime(selectedPurchase.purchasedAt)}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Cliente</dt>
                  <dd className="col-sm-8 text-dark">
                    {selectedPurchase.customerName
                      ?? (selectedPurchase.customerWhatsapp
                        ? `@${selectedPurchase.customerWhatsapp}`
                        : "Cliente do bot")}
                  </dd>
                  {selectedPurchase.customerWhatsapp && (
                    <>
                      <dt className="col-sm-4 text-secondary text-uppercase">WhatsApp</dt>
                      <dd className="col-sm-8 text-dark">@{selectedPurchase.customerWhatsapp}</dd>
                    </>
                  )}
                  <dt className="col-sm-4 text-secondary text-uppercase">Categoria</dt>
                  <dd className="col-sm-8 text-dark">{selectedPurchase.categoryName}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Valor</dt>
                  <dd className="col-sm-8 text-dark">{formatCurrency(selectedPurchase.categoryPrice)}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Suporte contratado</dt>
                  <dd className="col-sm-8 text-dark">
                    {selectedPurchase.categoryDurationDays && selectedPurchase.categoryDurationDays > 0
                      ? `${selectedPurchase.categoryDurationDays} dia(s)`
                      : "Sem prazo definido"}
                  </dd>
                  {selectedPurchaseExpiration && (
                    <>
                      <dt className="col-sm-4 text-secondary text-uppercase">Vencimento do suporte</dt>
                      <dd className={`col-sm-8 ${selectedPurchaseIsActive ? "text-dark" : "text-danger"}`}>
                        {formatDateTime(selectedPurchaseExpiration.toISOString())}
                        {!selectedPurchaseIsActive && " (vencido)"}
                      </dd>
                    </>
                  )}
                  <dt className="col-sm-4 text-secondary text-uppercase">Detalhes do produto</dt>
                  <dd className="col-sm-8 text-dark">
                    <div className="text-break">{selectedPurchase.productDetails}</div>
                  </dd>
                  {selectedPurchase.metadata && typeof selectedPurchase.metadata.balanceAfterPurchase === "number" && (
                    <>
                      <dt className="col-sm-4 text-secondary text-uppercase">Saldo após compra</dt>
                      <dd className="col-sm-8 text-dark">
                        {formatCurrency(selectedPurchase.metadata.balanceAfterPurchase as number)}
                      </dd>
                    </>
                  )}
                  {selectedPurchase.productFilePath && (
                    <>
                      <dt className="col-sm-4 text-secondary text-uppercase">Anexo</dt>
                      <dd className="col-sm-8 text-dark">{selectedPurchase.productFilePath}</dd>
                    </>
                  )}
                </dl>
              </div>

              <div>
                <h3 className="h6 text-uppercase text-secondary mb-2">Atualizar produto entregue</h3>
                {productUpdateSuccess && productUpdateMessage && (
                  <Alert variant="success" onClose={() => setProductUpdateSuccess(false)} dismissible>
                    {productUpdateMessage}
                  </Alert>
                )}
                {productUpdateError && (
                  <Alert variant="danger" onClose={() => setProductUpdateError(null)} dismissible>
                    {productUpdateError}
                  </Alert>
                )}
                <Form.Group controlId="purchase-product-details" className="mb-3">
                  <Form.Label className="fw-semibold">Detalhes do produto</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={productDetailsDraft}
                    onChange={(event) => setProductDetailsDraft(event.target.value)}
                    maxLength={PRODUCT_DETAILS_CHARACTER_LIMIT}
                    placeholder="Atualize o conteúdo que foi entregue ao cliente."
                    disabled={isUpdatingProduct}
                  />
                  <Form.Text className="text-secondary">
                    {productDetailsCharacterCount}/{PRODUCT_DETAILS_CHARACTER_LIMIT} caracteres disponíveis.
                  </Form.Text>
                </Form.Group>
                <Form.Group controlId="purchase-product-file" className="mb-3">
                  <Form.Label className="fw-semibold">Anexo ou link</Form.Label>
                  <Form.Control
                    type="text"
                    value={productFilePathDraft}
                    onChange={(event) => setProductFilePathDraft(event.target.value)}
                    placeholder="Cole a nova URL ou deixe em branco para remover o anexo."
                    disabled={isUpdatingProduct}
                  />
                  <Form.Text className="text-secondary">
                    Aceite links diretos ou caminhos internos configurados pela sua equipe.
                  </Form.Text>
                </Form.Group>
                <Form.Group controlId="purchase-product-id" className="mb-3">
                  <Form.Label className="fw-semibold">ID do produto (opcional)</Form.Label>
                  <Form.Control
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={productIdDraft}
                    onChange={(event) => setProductIdDraft(event.target.value)}
                    placeholder="Informe o novo identificador numérico do produto, se necessário."
                    disabled={isUpdatingProduct}
                  />
                  <Form.Text className="text-secondary">Use apenas números.</Form.Text>
                </Form.Group>
                <Form.Check
                  type="switch"
                  id="purchase-product-apply-to-all"
                  className="mb-1"
                  label="Aplicar atualização para todas as compras com suporte ativo deste produto"
                  checked={applyProductUpdateToAll && canBulkUpdateProduct}
                  onChange={(event) => setApplyProductUpdateToAll(event.target.checked)}
                  disabled={!canBulkUpdateProduct || isUpdatingProduct}
                />
                <Form.Text className="text-secondary">
                  {canBulkUpdateProduct
                    ? `Os dados serão sincronizados em ${eligibleBulkCount} compra(s) com suporte ativo. Compras vencidas não serão alteradas.`
                    : hasLinkedProduct
                      ? "Nenhuma outra compra com suporte ativo foi encontrada para este produto. Compras vencidas não serão alteradas."
                      : "Disponível apenas para registros vinculados a um produto cadastrado."}
                </Form.Text>
                {!selectedPurchaseIsActive && (
                  <div className="text-danger small mt-2">
                    Esta compra está com o suporte expirado; apenas registros ainda válidos receberão a atualização.
                  </div>
                )}
              </div>

              {(() => {
                const metadataWithoutNote = stripAdminNote(selectedPurchase.metadata);
                if (!metadataWithoutNote) {
                  return null;
                }
                return (
                  <div>
                    <h3 className="h6 text-uppercase text-secondary mb-2">Dados adicionais</h3>
                    <pre className="bg-light rounded small p-3 mb-0 text-break">
                      {JSON.stringify(metadataWithoutNote, null, 2)}
                    </pre>
                  </div>
                );
              })()}

              <div>
                <h3 className="h6 text-uppercase text-secondary mb-2">Nota interna</h3>
                {purchaseNoteSuccess && (
                  <Alert variant="success" onClose={() => setPurchaseNoteSuccess(false)} dismissible>
                    Anotação salva com sucesso.
                  </Alert>
                )}
                {purchaseNoteError && (
                  <Alert variant="danger" onClose={() => setPurchaseNoteError(null)} dismissible>
                    {purchaseNoteError}
                  </Alert>
                )}
                <Form.Group controlId="purchase-note" className="mb-2">
                  <Form.Label className="visually-hidden">Nota interna</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={purchaseNoteDraft}
                    onChange={(event) => setPurchaseNoteDraft(event.target.value)}
                    maxLength={NOTE_CHARACTER_LIMIT}
                    placeholder="Adicione observações para sua equipe, como comprovantes recebidos ou ajustes necessários."
                  />
                  <Form.Text className="text-secondary">
                    Esta anotação é privada e fica visível apenas para a sua equipe.
                  </Form.Text>
                </Form.Group>
                <div className="d-flex justify-content-between align-items-center small text-secondary">
                  <span>{purchaseNoteCharacterCount}/{NOTE_CHARACTER_LIMIT}</span>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="d-flex flex-column flex-lg-row align-items-stretch align-items-lg-center justify-content-lg-between gap-2">
              <Button
                variant="outline-secondary"
                onClick={closePurchaseModal}
                disabled={isSavingPurchaseNote || isUpdatingProduct}
                className="w-100 w-lg-auto"
              >
                Fechar
              </Button>
              <div className="d-flex flex-column flex-lg-row gap-2 w-100 w-lg-auto">
                <Button
                  variant="success"
                  onClick={handleUpdateProductDetails}
                  disabled={isProductUpdateDisabled}
                  className="w-100 w-lg-auto"
                >
                  {isUpdatingProduct && <Spinner animation="border" size="sm" className="me-2" />}Atualizar produto
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSavePurchaseNote}
                  disabled={!isPurchaseNoteDirty || isSavingPurchaseNote}
                  className="w-100 w-lg-auto"
                >
                  {isSavingPurchaseNote && <Spinner animation="border" size="sm" className="me-2" />}Salvar nota
                </Button>
              </div>
            </Modal.Footer>
          </>
        )}
      </Modal>

      <Modal show={Boolean(selectedCharge)} onHide={closeChargeModal} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Detalhes do pagamento</Modal.Title>
        </Modal.Header>
        {selectedCharge && (
          <>
            <Modal.Body className="d-flex flex-column gap-4">
              <div>
                <h3 className="h6 text-uppercase text-secondary mb-2">Resumo</h3>
                <dl className="row mb-0 small">
                  <dt className="col-sm-4 text-secondary text-uppercase">Criado em</dt>
                  <dd className="col-sm-8 text-dark">{formatDateTime(selectedCharge.createdAt)}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Última atualização</dt>
                  <dd className="col-sm-8 text-dark">{formatDateTime(selectedCharge.updatedAt)}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Cliente</dt>
                  <dd className="col-sm-8 text-dark">
                    {selectedCharge.customerName
                      ?? (selectedCharge.customerWhatsapp
                        ? `@${selectedCharge.customerWhatsapp}`
                        : "Cliente do bot")}
                  </dd>
                  {selectedCharge.customerWhatsapp && (
                    <>
                      <dt className="col-sm-4 text-secondary text-uppercase">WhatsApp</dt>
                      <dd className="col-sm-8 text-dark">@{selectedCharge.customerWhatsapp}</dd>
                    </>
                  )}
                  <dt className="col-sm-4 text-secondary text-uppercase">Valor</dt>
                  <dd className="col-sm-8 text-dark">{formatCurrency(selectedCharge.amount)}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Status</dt>
                  <dd className="col-sm-8 text-dark">
                    <Badge bg={getStatusVariant(selectedCharge.status)} className="text-capitalize">
                      {getStatusLabel(selectedCharge.status)}
                    </Badge>
                  </dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">Origem</dt>
                  <dd className="col-sm-8 text-dark">{getProviderLabel(selectedCharge.provider)}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">ID público</dt>
                  <dd className="col-sm-8 text-dark">{selectedCharge.publicId}</dd>
                  <dt className="col-sm-4 text-secondary text-uppercase">ID no provedor</dt>
                  <dd className="col-sm-8 text-dark">{selectedCharge.providerPaymentId}</dd>
                  {selectedCharge.ticketUrl && (
                    <>
                      <dt className="col-sm-4 text-secondary text-uppercase">Comprovante</dt>
                      <dd className="col-sm-8 text-dark">
                        <a href={selectedCharge.ticketUrl} target="_blank" rel="noopener noreferrer">
                          Abrir comprovante
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
              </div>

              {(() => {
                const metadataWithoutNote = stripAdminNote(selectedCharge.metadata);
                if (!metadataWithoutNote) {
                  return null;
                }
                return (
                  <div>
                    <h3 className="h6 text-uppercase text-secondary mb-2">Dados adicionais</h3>
                    <pre className="bg-light rounded small p-3 mb-0 text-break">
                      {JSON.stringify(metadataWithoutNote, null, 2)}
                    </pre>
                  </div>
                );
              })()}

              <div>
                <h3 className="h6 text-uppercase text-secondary mb-2">Nota interna</h3>
                {chargeNoteSuccess && (
                  <Alert variant="success" onClose={() => setChargeNoteSuccess(false)} dismissible>
                    Anotação salva com sucesso.
                  </Alert>
                )}
                {chargeNoteError && (
                  <Alert variant="danger" onClose={() => setChargeNoteError(null)} dismissible>
                    {chargeNoteError}
                  </Alert>
                )}
                <Form.Group controlId="charge-note" className="mb-2">
                  <Form.Label className="visually-hidden">Nota interna</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={chargeNoteDraft}
                    onChange={(event) => setChargeNoteDraft(event.target.value)}
                    maxLength={NOTE_CHARACTER_LIMIT}
                    placeholder="Registre aprovações manuais, confirmações externas ou qualquer observação relevante."
                  />
                  <Form.Text className="text-secondary">
                    Estas notas ajudam o time a acompanhar a evolução de cada pagamento.
                  </Form.Text>
                </Form.Group>
                <div className="d-flex justify-content-between align-items-center small text-secondary">
                  <span>{chargeNoteCharacterCount}/{NOTE_CHARACTER_LIMIT}</span>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="d-flex justify-content-between align-items-center">
              <Button variant="outline-secondary" onClick={closeChargeModal} disabled={isSavingChargeNote}>
                Fechar
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveChargeNote}
                disabled={!isChargeNoteDirty || isSavingChargeNote}
              >
                {isSavingChargeNote && <Spinner animation="border" size="sm" className="me-2" />}Salvar nota
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </div>
  );
};

export default UserPurchasesView;
