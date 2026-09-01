"use client";

import { useMemo, useState } from "react";
import { Badge, Form, InputGroup, Table } from "react-bootstrap";

import type { PaymentCharge } from "types/payments";
import { formatCurrency, formatDateTime } from "lib/format";

const getStatusVariant = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "approved" || normalized === "accredited") return "success";
  if (normalized === "pending") return "warning";
  if (["rejected", "cancelled", "cancelado"].includes(normalized)) return "danger";
  return "secondary";
};

const getStatusLabel = (status: string) => {
  switch (status.toLowerCase()) {
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
      return status || "-";
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

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const PaymentsHistory = ({ charges }: { charges: PaymentCharge[] }) => {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string | "all">("all");
  const [status, setStatus] = useState<string | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim();
    const norm = q ? normalize(q) : "";
    return charges.filter((c) => {
      if (provider !== "all" && c.provider !== provider) return false;
      if (status !== "all" && c.status.toLowerCase() !== status) return false;
      if (!norm) return true;
      const blob = [
        c.customerName,
        c.customerWhatsapp,
        c.publicId,
        c.providerPaymentId,
        c.ticketUrl,
      ]
        .filter(Boolean)
        .join(" ");
      return normalize(blob).includes(norm);
    });
  }, [charges, provider, status, query]);

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex flex-column flex-lg-row align-items-lg-end gap-3">
        <Form.Group className="w-100">
          <Form.Label className="small text-secondary">Buscar</Form.Label>
          <InputGroup>
            <Form.Control
              placeholder="Nome, WhatsApp, ID público ou do provedor"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="btn btn-outline-secondary" onClick={() => setQuery("")}>Limpar</button>
            )}
          </InputGroup>
        </Form.Group>
        <Form.Group>
          <Form.Label className="small text-secondary">Origem</Form.Label>
          <Form.Select value={provider} onChange={(e) => setProvider(e.target.value as any)}>
            <option value="all">Todas</option>
            <option value="mercadopago_pix">Pix</option>
            <option value="mercadopago_checkout">Checkout</option>
          </Form.Select>
        </Form.Group>
        <Form.Group>
          <Form.Label className="small text-secondary">Status</Form.Label>
          <Form.Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="all">Todos</option>
            <option value="approved">Aprovado</option>
            <option value="pending">Pendente</option>
            <option value="rejected">Recusado</option>
            <option value="cancelled">Cancelado</option>
          </Form.Select>
        </Form.Group>
      </div>

      <div className="table-responsive">
        <Table hover responsive className="mb-0 align-middle">
          <thead className="table-light">
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Origem</th>
              <th className="text-end">Valor</th>
              <th>Status</th>
              <th>IDs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-secondary">Nenhum pagamento encontrado.</td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id}>
                  <td>{formatDateTime(c.createdAt)}</td>
                  <td>{c.customerName ?? (c.customerWhatsapp ? `@${c.customerWhatsapp}` : "Cliente do bot")}</td>
                  <td>{getProviderLabel(c.provider)}</td>
                  <td className="text-end">{formatCurrency(c.amount)}</td>
                  <td><Badge bg={getStatusVariant(c.status)}>{getStatusLabel(c.status)}</Badge></td>
                  <td className="small">
                    <div><strong>Public:</strong> {c.publicId}</div>
                    <div><strong>Prov.:</strong> {c.providerPaymentId}</div>
                  </td>
                  <td className="text-end">
                    {c.ticketUrl && (
                      <a href={c.ticketUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary">
                        Comprovante
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </div>
  );
};

export default PaymentsHistory;

