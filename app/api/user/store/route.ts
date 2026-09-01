import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  connectBotStoreCentralCart,
  connectBotStoreSmm,
  connectBotStoreWwPanel,
  deliverBotStoreProductManually,
  deleteBotStoreCategory,
  deleteBotStoreInventoryItem,
  deleteBotStoreProduct,
  deleteBotStoreSmmService,
  deleteBotStoreSmmServices,
  deleteBotStoreWwPanelOffer,
  disconnectBotStoreCentralCart,
  disconnectBotStoreSmm,
  disconnectBotStoreWwPanel,
  getBotStoreSnapshot,
  bulkUpdateBotStoreSmmServices,
  importBotStoreSmmServices,
  manageBotStoreWwPanelClient,
  manageBotStoreSmmOrder,
  revealBotStoreWwPanelClientPassword,
  reissueBotStoreOrder,
  saveBotStoreCategory,
  saveBotStoreInventory,
  saveBotStoreProduct,
  saveBotStoreSmmService,
  saveBotStoreWwPanelOffer,
  setBotStoreInventoryStatus,
  sendBotStoreMenuToCustomer,
  sendBotStoreProductToCustomer,
  syncBotStoreSmm,
  searchBotStoreSmmCatalog,
  updateBotStoreForUser,
  updateBotStoreCustomer,
  updateBotStoreInventoryItem,
} from "lib/bot-store";

const readInstanceId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const readBody = async (request: Request) => {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }
    const instanceId = readInstanceId(
      new URL(request.url).searchParams.get("instanceId"),
    );
    if (!instanceId) {
      return NextResponse.json(
        { message: "Selecione um perfil do WhatsApp." },
        { status: 400 },
      );
    }
    return NextResponse.json(await getBotStoreSnapshot(user.id, instanceId));
  } catch (error) {
    console.error("[bot-store] Falha ao carregar loja", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a loja.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }
    const body = await readBody(request);
    if (!body) {
      return NextResponse.json(
        { message: "Payload inválido." },
        { status: 400 },
      );
    }
    const instanceId = readInstanceId(body.instanceId);
    if (!instanceId) {
      return NextResponse.json(
        { message: "Selecione um perfil do WhatsApp." },
        { status: 400 },
      );
    }
    await updateBotStoreForUser(user.id, instanceId, body);
    return NextResponse.json({
      message: "Configurações da loja salvas.",
      ...(await getBotStoreSnapshot(user.id, instanceId)),
    });
  } catch (error) {
    console.error("[bot-store] Falha ao salvar loja", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a loja.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "Não autenticado." },
        { status: 401 },
      );
    }
    const body = await readBody(request);
    if (!body) {
      return NextResponse.json(
        { message: "Payload inválido." },
        { status: 400 },
      );
    }
    const instanceId = readInstanceId(body.instanceId);
    const action = String(body.action || "")
      .trim()
      .toLowerCase();
    if (!instanceId) {
      return NextResponse.json(
        { message: "Selecione um perfil do WhatsApp." },
        { status: 400 },
      );
    }
    if (action === "save_category") {
      await saveBotStoreCategory(
        user.id,
        instanceId,
        readRecord(body.category),
      );
    } else if (action === "delete_category") {
      await deleteBotStoreCategory(
        user.id,
        instanceId,
        readInstanceId(body.categoryId),
      );
    } else if (action === "save_product") {
      await saveBotStoreProduct(user.id, instanceId, readRecord(body.product));
    } else if (action === "delete_product") {
      await deleteBotStoreProduct(
        user.id,
        instanceId,
        readInstanceId(body.productId),
      );
    } else if (action === "save_inventory") {
      await saveBotStoreInventory(
        user.id,
        instanceId,
        readRecord(body.inventory),
      );
    } else if (action === "update_inventory") {
      await updateBotStoreInventoryItem(
        user.id,
        instanceId,
        readRecord(body.inventory),
      );
    } else if (action === "set_inventory_status") {
      await setBotStoreInventoryStatus(
        user.id,
        instanceId,
        readInstanceId(body.inventoryId),
        String(body.status || ""),
      );
    } else if (action === "delete_inventory") {
      await deleteBotStoreInventoryItem(
        user.id,
        instanceId,
        readInstanceId(body.inventoryId),
      );
    } else if (action === "update_customer") {
      await updateBotStoreCustomer(
        user.id,
        instanceId,
        readRecord(body.customer),
      );
    } else if (action === "send_store_menu") {
      await sendBotStoreMenuToCustomer(
        user.id,
        instanceId,
        String(body.customerJid || ""),
      );
    } else if (action === "send_store_product") {
      await sendBotStoreProductToCustomer(
        user.id,
        instanceId,
        String(body.customerJid || ""),
        readInstanceId(body.productId),
      );
    } else if (action === "deliver_store_product") {
      await deliverBotStoreProductManually(
        user.id,
        instanceId,
        String(body.customerJid || ""),
        readInstanceId(body.productId),
        typeof body.customerName === "string" ? body.customerName : null,
      );
    } else if (action === "reissue_store_order") {
      await reissueBotStoreOrder(
        user.id,
        instanceId,
        readInstanceId(body.orderId),
      );
    } else if (
      action === "connect_central_cart" ||
      action === "sync_central_cart"
    ) {
      const centralCart = readRecord(body.centralCart);
      return NextResponse.json(
        await connectBotStoreCentralCart(user.id, instanceId, centralCart),
      );
    } else if (action === "disconnect_central_cart") {
      await disconnectBotStoreCentralCart(user.id, instanceId);
    } else if (
      action === "connect_wwpanel" ||
      action === "sync_wwpanel"
    ) {
      await connectBotStoreWwPanel(
        user.id,
        instanceId,
        readRecord(body.wwPanel),
      );
    } else if (action === "disconnect_wwpanel") {
      await disconnectBotStoreWwPanel(user.id, instanceId);
    } else if (action === "connect_smm") {
      await connectBotStoreSmm(
        user.id,
        instanceId,
        readRecord(body.smm),
      );
    } else if (action === "sync_smm") {
      await syncBotStoreSmm(user.id, instanceId, readRecord(body.smm));
    } else if (action === "disconnect_smm") {
      await disconnectBotStoreSmm(user.id, instanceId);
    } else if (action === "save_smm_service") {
      await saveBotStoreSmmService(
        user.id,
        instanceId,
        readRecord(body.service),
      );
    } else if (action === "delete_smm_service") {
      await deleteBotStoreSmmService(
        user.id,
        instanceId,
        readInstanceId(body.serviceId),
      );
    } else if (action === "delete_smm_services") {
      const serviceIds = Array.isArray(body.serviceIds)
        ? body.serviceIds.map(readInstanceId).filter((id) => id > 0)
        : [];
      await deleteBotStoreSmmServices(user.id, instanceId, serviceIds);
    } else if (action === "search_smm_catalog") {
      return NextResponse.json(
        await searchBotStoreSmmCatalog(
          user.id,
          instanceId,
          readRecord(body.catalog),
        ),
      );
    } else if (action === "import_smm_services") {
      await importBotStoreSmmServices(
        user.id,
        instanceId,
        readRecord(body.services),
      );
    } else if (action === "bulk_update_smm_services") {
      await bulkUpdateBotStoreSmmServices(
        user.id,
        instanceId,
        readRecord(body.services),
      );
    } else if (
      [
        "sync_smm_order",
        "refill_smm_order",
        "sync_smm_refill",
        "cancel_smm_order",
      ].includes(action)
    ) {
      await manageBotStoreSmmOrder(
        user.id,
        instanceId,
        action,
        readRecord(body.order),
      );
    } else if (action === "save_wwpanel_offer") {
      await saveBotStoreWwPanelOffer(
        user.id,
        instanceId,
        readRecord(body.offer),
      );
    } else if (action === "delete_wwpanel_offer") {
      await deleteBotStoreWwPanelOffer(
        user.id,
        instanceId,
        readInstanceId(body.offerId),
      );
    } else if (action === "reveal_wwpanel_password") {
      const password = await revealBotStoreWwPanelClientPassword(
        user.id,
        instanceId,
        readInstanceId(body.clientId),
      );
      return NextResponse.json({
        message: "Senha liberada.",
        password,
      });
    } else if (
      [
        "renew_wwpanel_client",
        "edit_wwpanel_client",
        "recreate_wwpanel_client",
        "delete_wwpanel_client",
        "manage_wwpanel_plan",
        "activate_wwpanel_app",
      ].includes(action)
    ) {
      await manageBotStoreWwPanelClient(
        user.id,
        instanceId,
        action,
        readRecord(body.client),
      );
    } else {
      return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
    }
    return NextResponse.json({
      message: "Loja atualizada.",
      ...(await getBotStoreSnapshot(user.id, instanceId)),
    });
  } catch (error) {
    console.error("[bot-store] Falha na ação da loja", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a loja.",
      },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
