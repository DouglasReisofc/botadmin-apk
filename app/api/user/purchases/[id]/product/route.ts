import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  PurchaseProductUpdateError,
  updatePurchaseProductDetails,
} from "lib/purchase-history";

const MAX_PRODUCT_DETAILS_LENGTH = 4000;
const MAX_PRODUCT_FILE_PATH_LENGTH = 255;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "user") {
      return NextResponse.json({ message: "Não autorizado." }, { status: 403 });
    }

    const params = await context.params;
    const purchaseId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      return NextResponse.json({ message: "Identificador inválido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || body === null) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const hasProductDetails = Object.prototype.hasOwnProperty.call(body, "productDetails");
    const hasProductFilePath = Object.prototype.hasOwnProperty.call(body, "productFilePath");
    const hasProductId = Object.prototype.hasOwnProperty.call(body, "productId");

    if (!hasProductDetails && !hasProductFilePath && !hasProductId) {
      return NextResponse.json(
        { message: "Informe pelo menos um campo do produto para atualizar." },
        { status: 400 },
      );
    }

    const payload: {
      productDetails?: string;
      productFilePath?: string | null;
      productId?: number | null;
      applyToAllMatchingProductId?: boolean;
    } = {};

    if (hasProductDetails) {
      const rawDetails = (body as { productDetails?: unknown }).productDetails;

      if (typeof rawDetails !== "string") {
        return NextResponse.json(
          { message: "Os detalhes do produto devem ser um texto." },
          { status: 400 },
        );
      }

      const normalizedDetails = rawDetails.trim();

      if (normalizedDetails.length > MAX_PRODUCT_DETAILS_LENGTH) {
        return NextResponse.json(
          {
            message: `Os detalhes do produto podem ter no máximo ${MAX_PRODUCT_DETAILS_LENGTH} caracteres.`,
          },
          { status: 400 },
        );
      }

      payload.productDetails = normalizedDetails;
    }

    if (hasProductFilePath) {
      const rawFilePath = (body as { productFilePath?: unknown }).productFilePath;

      if (typeof rawFilePath !== "string" && rawFilePath !== null) {
        return NextResponse.json(
          { message: "O anexo do produto deve ser uma URL ou ser removido." },
          { status: 400 },
        );
      }

      if (typeof rawFilePath === "string") {
        const normalizedFilePath = rawFilePath.trim();

        if (normalizedFilePath.length > MAX_PRODUCT_FILE_PATH_LENGTH) {
          return NextResponse.json(
            {
              message: `O anexo do produto deve ter no máximo ${MAX_PRODUCT_FILE_PATH_LENGTH} caracteres.`,
            },
            { status: 400 },
          );
        }

        payload.productFilePath = normalizedFilePath.length > 0 ? normalizedFilePath : null;
      } else {
        payload.productFilePath = null;
      }
    }

    if (hasProductId) {
      const rawProductId = (body as { productId?: unknown }).productId;

      if (rawProductId === null) {
        payload.productId = null;
      } else if (typeof rawProductId === "string") {
        const normalizedProductId = rawProductId.trim();

        if (normalizedProductId.length === 0) {
          payload.productId = null;
        } else {
          const parsedProductId = Number.parseInt(normalizedProductId, 10);

          if (!Number.isFinite(parsedProductId) || parsedProductId <= 0) {
            return NextResponse.json(
              { message: "Informe um ID de produto numérico válido." },
              { status: 400 },
            );
          }

          payload.productId = parsedProductId;
        }
      } else if (typeof rawProductId === "number") {
        if (!Number.isFinite(rawProductId) || rawProductId <= 0) {
          return NextResponse.json(
            { message: "Informe um ID de produto numérico válido." },
            { status: 400 },
          );
        }

        payload.productId = Math.trunc(rawProductId);
      } else {
        return NextResponse.json(
          { message: "O ID do produto deve ser numérico." },
          { status: 400 },
        );
      }
    }

    payload.applyToAllMatchingProductId = Boolean(
      (body as { applyToAll?: unknown }).applyToAll,
    );

    const result = await updatePurchaseProductDetails({
      userId: user.id,
      purchaseId,
      ...payload,
    });

    const message = result.appliedToAll
      ? `Produto atualizado para ${result.affectedPurchaseIds.length} compra(s).`
      : payload.applyToAllMatchingProductId
        ? "Nenhuma outra compra com suporte ativo foi atualizada; apenas este cliente recebeu a alteração."
        : "Produto atualizado com sucesso.";

    return NextResponse.json({
      message,
      purchase: result.purchase,
      affectedPurchaseIds: result.affectedPurchaseIds,
      updatedFields: result.updatedFields,
      appliedToAll: result.appliedToAll,
    });
  } catch (error) {
    if (error instanceof PurchaseProductUpdateError) {
      if (error.code === "PURCHASE_NOT_FOUND") {
        return NextResponse.json({ message: error.message }, { status: 404 });
      }

      if (error.code === "PRODUCT_ID_REQUIRED_FOR_BULK_UPDATE") {
        return NextResponse.json({ message: error.message }, { status: 400 });
      }

      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    console.error("Failed to update purchase product details", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o produto. Tente novamente." },
      { status: 500 },
    );
  }
}
