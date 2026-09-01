import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import path from "path";

import { ResultSetHeader, RowDataPacket } from "mysql2";

import { getInstanceById, getInstanceForUser } from "lib/bot-instances";
import { getDb } from "lib/db";
import {
  createMercadoPagoPixCharge,
  createPoloPagPixCharge,
  getMercadoPagoPixConfigForUser,
  getPoloPagPixConfigForUser,
} from "lib/payments";
import { deleteUploadedFile, resolveUploadedFileUrl } from "lib/uploads";
import {
  DEFAULT_LIST_MESSAGE_TRANSPORT,
  sendInteractiveButtons,
  sendListMessage,
  sendMediaMessage,
  sendTextMessage,
  type ListMessageCard,
  type ListMessageRow,
  type WuzapiClient,
} from "lib/wuzapi";
import {
  activateWwPanelApp,
  activateWwPanelTrial,
  createWwPanelClient,
  createWwPanelTrial,
  decryptWwPanelSecret,
  deleteWwPanelClient,
  editWwPanelClient,
  encryptWwPanelSecret,
  extendWwPanelClient,
  getWwPanelAccount,
  isWwPanelAppName,
  manageWwPanelClientPlan,
  recreateWwPanelClient,
  sanitizeWwPanelAccount,
  WWPANEL_API_BASE,
  wwPanelPublicCatalog,
  type WwPanelClient,
} from "lib/wwpanel";
import {
  SMMHYPE_API_BASE,
  addSmmOrder,
  calculateSmmPrice,
  cancelSmmOrders,
  decryptSmmSecret,
  encryptSmmSecret,
  fetchUsdBrlRate,
  getSmmBalance,
  getSmmOrderStatus,
  getSmmRefillStatus,
  getSmmServices,
  requestSmmRefill,
  smmServiceQuantityFromInput,
  smmServiceUsesFixedPrice,
  type SmmAddOrderInput,
} from "lib/smmhype";
import type { PaymentCharge } from "types/payments";

export const CENTRAL_CART_API_BASE = "https://api.centralcart.io/v1";
export const CENTRAL_CART_WEBHOOK_SCOPES = [
  "ORDER_CREATED",
  "ORDER_APPROVED",
  "ORDER_REJECTED",
  "ORDER_ABANDONED",
  "ORDER_REFUNDED",
  "ORDER_CHARGEDBACK",
] as const;

const DEFAULT_STORE_COMMANDS = [
  "loja",
  "store",
  "catalogo",
  "catálogo",
  "comprar",
];
const STORE_ACTION_PREFIX = "botstore:";
const STORE_CACHE_TTL_MS = 90_000;

type JsonRecord = Record<string, unknown>;

type BotStoreRow = RowDataPacket & {
  id: number;
  user_id: number;
  instance_id: number;
  enabled: number | boolean;
  auto_open_private: number | boolean;
  name: string;
  description: string | null;
  image_path: string | null;
  commands: string | null;
  menu_config: string | null;
  payment_provider: string | null;
  central_cart_api_key: string | null;
  central_cart_api_base: string | null;
  central_cart_mode: string | null;
  central_cart_gateway: string | null;
  central_cart_app: string | null;
  central_cart_webhook: string | null;
  central_cart_last_sync_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreCategoryRow = RowDataPacket & {
  id: number;
  store_id: number;
  name: string;
  description: string | null;
  image_path: string | null;
  position: number;
  enabled: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreProductRow = RowDataPacket & {
  id: number;
  store_id: number;
  category_id: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  price_cents: number;
  image_path: string | null;
  enabled: number | boolean;
  position: number;
  metadata: string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type LegacyBotStoreProductRow = RowDataPacket & {
  id: number;
  store_id: number;
  name: string;
  delivery_type: string | null;
  delivery_value: string | null;
  delivery_file_path: string | null;
  delivery_file_name: string | null;
  delivery_mime_type: string | null;
  stock: number | null;
};

type BotStoreInventoryRow = RowDataPacket & {
  id: number;
  store_id: number;
  product_id: number;
  item_type: string;
  label: string | null;
  delivery_value: string | null;
  delivery_file_path: string | null;
  delivery_file_name: string | null;
  delivery_mime_type: string | null;
  status: string;
  order_id: number | null;
  reserved_until: Date | string | null;
  delivered_at: Date | string | null;
  metadata: string | null;
  max_uses: number;
  used_count: number;
  reserved_uses?: number;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreOrderRow = RowDataPacket & {
  id: number;
  public_id: string;
  store_id: number;
  product_id: number | null;
  provider: string;
  external_order_id: string | null;
  customer_jid: string;
  customer_name: string | null;
  customer_phone: string | null;
  quantity: number;
  total_cents: number;
  status: string;
  payment_charge_public_id: string | null;
  checkout_url: string | null;
  metadata: string | null;
  delivered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreCustomerRow = RowDataPacket & {
  id: number;
  store_id: number;
  customer_jid: string;
  customer_name: string | null;
  customer_phone: string | null;
  avatar_url: string | null;
  balance_cents: number;
  notes: string | null;
  blocked: number | boolean;
  orders_count: number;
  paid_orders_count: number;
  total_spent_cents: number;
  last_order_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreWwPanelIntegrationRow = RowDataPacket & {
  id: number;
  store_id: number;
  enabled: number | boolean;
  api_key_encrypted: string | null;
  api_key_hint: string | null;
  account_snapshot: string | null;
  last_verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreWwPanelOfferRow = RowDataPacket & {
  id: number;
  store_id: number;
  name: string;
  description: string | null;
  price_cents: number;
  image_path: string | null;
  enabled: number | boolean;
  position: number;
  is_trial: number | boolean;
  days: number | null;
  months: number | null;
  plan_id: number;
  package_p2p: string;
  package_iptv: number;
  access_iptv: number;
  access_nexus: number;
  addons: string | null;
  country: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreWwPanelClientRow = RowDataPacket & {
  id: number;
  store_id: number;
  offer_id: number | null;
  order_id: number | null;
  customer_jid: string;
  customer_name: string | null;
  customer_phone: string | null;
  external_id: string;
  username: string;
  password_encrypted: string;
  expires_at: Date | string | null;
  status: string;
  provider_payload: string | null;
  is_trial?: number | boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreSmmIntegrationRow = RowDataPacket & {
  id: number;
  store_id: number;
  enabled: number | boolean;
  api_base: string;
  api_key_encrypted: string | null;
  api_key_hint: string | null;
  provider_balance: number | string | null;
  provider_currency: string | null;
  fx_mode: string;
  usd_brl_rate: number | string;
  markup_percent: number | string;
  fixed_markup_cents: number;
  minimum_profit_cents: number;
  last_fx_at: Date | string | null;
  last_catalog_sync_at: Date | string | null;
  last_verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreSmmServiceRow = RowDataPacket & {
  id: number;
  store_id: number;
  provider_service_id: number;
  name: string;
  category: string;
  custom_name: string | null;
  custom_category: string | null;
  custom_description: string | null;
  service_type: string;
  provider_rate: number | string;
  min_quantity: number;
  max_quantity: number;
  sale_min_quantity: number | null;
  sale_max_quantity: number | null;
  refill: number | boolean;
  cancel: number | boolean;
  dripfeed: number | boolean;
  imported: number | boolean;
  enabled: number | boolean;
  position: number;
  custom_sale_rate_cents: number | null;
  provider_snapshot: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotStoreSmmOrderRow = RowDataPacket & {
  id: number;
  store_id: number;
  order_id: number;
  service_id: number;
  provider_order_id: string | null;
  customer_jid: string;
  target: string;
  quantity: number;
  request_payload: string | null;
  provider_cost: number | string;
  provider_currency: string;
  sale_total_cents: number;
  status: string;
  start_count: string | null;
  remains: string | null;
  refill_id: string | null;
  refill_status: string | null;
  provider_snapshot: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  service_name?: string | null;
  service_category?: string | null;
  service_type?: string | null;
};

export type CentralCartApp = {
  id?: number | string;
  name?: string;
  url?: string;
  logo?: string | null;
};

export type CentralCartPackage = {
  id?: number | string;
  category_id?: number | string | null;
  position?: number;
  enabled?: boolean;
  name?: string;
  slug?: string;
  price?: number;
  inventory_amount?: number | null;
  description?: string | null;
  image?: string | null;
  parent_id?: number | string | null;
  is_variation_parent?: boolean;
};

export type CentralCartCategory = {
  id?: number | string;
  parent_id?: number | string | null;
  name?: string;
  description?: string | null;
  slug?: string;
  position?: number;
  hide_category?: boolean;
  hide_subcategory?: boolean;
  image?: string | null;
  sub_categories?: CentralCartCategory[];
  packages?: CentralCartPackage[];
};

export type CentralCartCatalog = {
  app: CentralCartApp | null;
  categories: CentralCartCategory[];
  allCategories: CentralCartCategory[];
  packages: CentralCartPackage[];
};

export type BotStore = ReturnType<typeof mapStore>;
export type BotStoreCategory = ReturnType<typeof mapCategory>;
export type BotStoreProduct = ReturnType<typeof mapProduct>;
export type BotStoreInventoryItem = ReturnType<typeof mapInventoryItem>;
export type BotStoreOrder = ReturnType<typeof mapOrder>;
export type BotStoreCustomer = ReturnType<typeof mapCustomer>;

type BotStoreMenuTemplate = {
  title: string;
  body: string;
  footer: string;
  listButton: string;
  imagePath: string | null;
  buyButton?: string;
  backButton?: string;
  categoryRow?: string;
  productRow?: string;
  trialUsedBody?: string;
  trialUsedButton?: string;
  macPromptBody?: string;
  macAccessBody?: string;
  macAccessButton?: string;
  macAppBody?: string;
  macAppButton?: string;
  appActivatedBody?: string;
  linkPromptBody?: string;
  quantityPromptBody?: string;
  detailsPromptBody?: string;
  orderSummaryBody?: string;
  orderCreatedBody?: string;
  statusBody?: string;
};

type BotStoreMenuConfig = {
  root: BotStoreMenuTemplate;
  category: BotStoreMenuTemplate;
  product: BotStoreMenuTemplate;
  iptv: BotStoreMenuTemplate;
  smm: BotStoreMenuTemplate;
  delivery: BotStoreMenuTemplate;
};

const DEFAULT_STORE_MENU_CONFIG: BotStoreMenuConfig = {
  root: {
    title: "{{store}}",
    body: [
      "Olá {{pushname}},",
      "",
      "É um prazer atendê-lo pelo nosso canal oficial {{store}}.",
      "",
      "Saldo disponível: {{saldo_cliente}}",
      "Número do WhatsApp: {{numero_cliente}}",
      "",
      "Escolha uma das opções abaixo para continuar e aproveitar nossas ofertas digitais.",
    ].join("\n"),
    footer: "Selecione uma das opções para continuar seu atendimento.",
    listButton: "Ver categorias",
    imagePath: null,
    categoryRow: "{{count}} {{countLabel}} · {{description}}",
    productRow: "{{price}} · {{stock}}",
  },
  category: {
    title: "{{category}}",
    body: "{{description}}",
    footer: "Escolha o serviço que melhor atende o que você precisa.",
    listButton: "Ver serviços",
    imagePath: null,
    productRow: "{{price}} · {{stock}}",
  },
  product: {
    title: "{{product}}",
    body: "💰 {{price}}\n{{stock}}\n\n{{description}}",
    footer: "{{store}}",
    listButton: "",
    imagePath: null,
    buyButton: "Comprar agora 🛒",
    backButton: "Voltar à loja ↩️",
  },
  iptv: {
    title: "Planos IPTV",
    body: "Escolha um plano, crie seu teste ou gerencie seus acessos.",
    footer: "{{store}}",
    listButton: "Abrir IPTV 📺",
    imagePath: null,
    buyButton: "Comprar agora 🛒",
    backButton: "Voltar à loja ↩️",
    productRow: "{{price}} · {{validity}} · {{screens}}",
    trialUsedBody:
      "Este número já utilizou o teste gratuito.\nEscolha um plano para continuar assistindo.",
    trialUsedButton: "Voltar aos planos ↩️",
    macPromptBody:
      "📺 *Ativar {{app}}*\n\nEnvie agora o *MAC* ou identificador exibido no aplicativo.\nPara sair, envie *cancelar*.",
    macAccessBody:
      "Encontrei o MAC *{{mac}}*.\nEscolha o acesso IPTV que deseja ativar.",
    macAccessButton: "Escolher acesso 👤",
    macAppBody:
      "Acesso *{{usuario}}* selecionado.\nAgora escolha o aplicativo que deseja ativar.",
    macAppButton: "Escolher aplicativo 📺",
    appActivatedBody:
      "✅ *Aplicativo ativado*\n📺 {{app}}\n👤 {{usuario}}\n🔗 {{mac}}",
  },
  smm: {
    title: "Painel SMM",
    body:
      "Impulsione suas redes com entrega automática.\n\nEscolha uma categoria para continuar.",
    footer: "{{store}} · preços em reais",
    listButton: "Abrir serviços 🚀",
    imagePath: null,
    buyButton: "Continuar pedido 🛒",
    backButton: "Voltar à loja ↩️",
    categoryRow: "{{count}} {{countLabel}} disponíveis",
    productRow: "{{price}} por 1.000 · mínimo {{min}}",
    linkPromptBody:
      "🔗 *{{service}}*\n\nEnvie o link do perfil, publicação ou página que receberá o serviço.\n\nPara sair, envie *cancelar*.",
    quantityPromptBody:
      "🔢 *{{service}}*\n\nEnvie a quantidade entre *{{min}}* e *{{max}}*.",
    detailsPromptBody:
      "📝 *{{service}}*\n\n{{instructions}}\n\nPara sair, envie *cancelar*.",
    orderSummaryBody:
      "🚀 *{{service}}*\n\n🔗 {{target}}\n📦 Quantidade: {{quantity}}\n💰 Total: {{price}}\n\nConfirme para gerar o pagamento.",
    orderCreatedBody:
      "✅ *Pedido SMM recebido*\n\n🆔 {{pedido}}\n🚀 {{service}}\n📦 {{quantity}}\n💰 {{price}}\n📊 Status: {{status}}",
    statusBody:
      "📊 *Status do pedido*\n\n🆔 {{pedido}}\n🚀 {{service}}\n📦 Restante: {{remains}}\n⚙️ {{status}}",
  },
  delivery: {
    title: "",
    body: [
      "🔰 COMPRA EFETUADA COM SUCESSO 🔰",
      "🧰 Serviço: {{produto}}",
      "💸 Valor: {{valor}}",
      "📅 Data Da Compra:",
      "{{data_compra}}",
      "",
      "ℹ️ DADOS:",
      "{{dados}}",
    ].join("\n"),
    footer: "",
    listButton: "",
    imagePath: null,
  },
};

const ensureTasks = new Map<string, Promise<void>>();
let ensured = false;

const runEnsure = async () => {
  if (ensured) return;
  const running = ensureTasks.get("bot-store");
  if (running) return running;

  const task = (async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_stores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        auto_open_private TINYINT(1) NOT NULL DEFAULT 1,
        name VARCHAR(160) NOT NULL DEFAULT 'Minha loja',
        description TEXT NULL,
        image_path TEXT NULL,
        commands TEXT NULL,
        menu_config LONGTEXT NULL,
        payment_provider VARCHAR(40) NULL,
        central_cart_api_key TEXT NULL,
        central_cart_api_base VARCHAR(255) NULL,
        central_cart_mode VARCHAR(20) NOT NULL DEFAULT 'live',
        central_cart_gateway VARCHAR(40) NOT NULL DEFAULT 'OTHER',
        central_cart_app LONGTEXT NULL,
        central_cart_webhook LONGTEXT NULL,
        central_cart_last_sync_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_stores_instance_unique (instance_id),
        KEY bot_stores_user_idx (user_id)
      ) ENGINE=InnoDB
    `);
    const [storeAutoOpenRows] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_stores LIKE 'auto_open_private'",
    );
    if (!storeAutoOpenRows.length) {
      await db.query(
        "ALTER TABLE bot_stores ADD COLUMN auto_open_private TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled",
      );
    }
    const [storeMenuConfigRows] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_stores LIKE 'menu_config'",
    );
    if (!storeMenuConfigRows.length) {
      await db.query(
        "ALTER TABLE bot_stores ADD COLUMN menu_config LONGTEXT NULL AFTER commands",
      );
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        name VARCHAR(160) NOT NULL,
        description TEXT NULL,
        image_path TEXT NULL,
        position INT NOT NULL DEFAULT 0,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY bot_store_categories_store_idx (store_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        category_id INT NULL,
        name VARCHAR(180) NOT NULL,
        sku VARCHAR(100) NULL,
        description TEXT NULL,
        price_cents INT NOT NULL DEFAULT 0,
        image_path TEXT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        position INT NOT NULL DEFAULT 0,
        metadata LONGTEXT NULL,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY bot_store_products_store_idx (store_id),
        KEY bot_store_products_category_idx (category_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_inventory_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        product_id INT NOT NULL,
        item_type VARCHAR(30) NOT NULL DEFAULT 'code',
        label VARCHAR(160) NULL,
        delivery_value LONGTEXT NULL,
        delivery_file_path TEXT NULL,
        delivery_file_name VARCHAR(255) NULL,
        delivery_mime_type VARCHAR(160) NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'available',
        max_uses INT NOT NULL DEFAULT 1,
        used_count INT NOT NULL DEFAULT 0,
        order_id INT NULL,
        reserved_until TIMESTAMP NULL,
        delivered_at TIMESTAMP NULL,
        metadata LONGTEXT NULL,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY bot_store_inventory_store_idx (store_id),
        KEY bot_store_inventory_product_idx (product_id),
        KEY bot_store_inventory_status_idx (store_id, product_id, status),
        KEY bot_store_inventory_order_idx (order_id)
      ) ENGINE=InnoDB
    `);
    const [inventoryColumnRows] = await db.query<
      Array<RowDataPacket & { Field: string }>
    >("SHOW COLUMNS FROM bot_store_inventory_items");
    const inventoryColumns = new Set(
      inventoryColumnRows.map((row) => String(row.Field || "").toLowerCase()),
    );
    if (!inventoryColumns.has("max_uses")) {
      await db.query(
        "ALTER TABLE bot_store_inventory_items ADD COLUMN max_uses INT NOT NULL DEFAULT 1 AFTER status",
      );
    }
    if (!inventoryColumns.has("used_count")) {
      await db.query(
        "ALTER TABLE bot_store_inventory_items ADD COLUMN used_count INT NOT NULL DEFAULT 0 AFTER max_uses",
      );
    }
    if (!inventoryColumns.has("deleted_at")) {
      await db.query(
        "ALTER TABLE bot_store_inventory_items ADD COLUMN deleted_at TIMESTAMP NULL AFTER metadata",
      );
    }
    await db.query(
      `UPDATE bot_store_inventory_items
       SET used_count = 1, max_uses = GREATEST(max_uses, 1)
       WHERE status = 'delivered' AND used_count = 0`,
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_inventory_allocations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        order_id INT NOT NULL,
        inventory_id INT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        status VARCHAR(30) NOT NULL DEFAULT 'reserved',
        expires_at TIMESTAMP NULL,
        delivered_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_inventory_allocation_unique (order_id, inventory_id),
        KEY bot_store_inventory_allocation_store_idx (store_id),
        KEY bot_store_inventory_allocation_item_idx (inventory_id, status),
        KEY bot_store_inventory_allocation_order_idx (order_id, status)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      INSERT IGNORE INTO bot_store_inventory_allocations (
        store_id, order_id, inventory_id, quantity, status, expires_at
      )
      SELECT store_id, order_id, id, 1, 'reserved', reserved_until
      FROM bot_store_inventory_items
      WHERE status = 'reserved' AND order_id IS NOT NULL
    `);
    await db.query(`
      UPDATE bot_store_inventory_items
      SET status = 'available', order_id = NULL, reserved_until = NULL
      WHERE status = 'reserved'
    `);
    const [productColumnRows] = await db.query<
      Array<RowDataPacket & { Field: string }>
    >("SHOW COLUMNS FROM bot_store_products");
    const productColumns = new Set(
      productColumnRows.map((row) => String(row.Field || "").toLowerCase()),
    );
    if (!productColumns.has("deleted_at")) {
      await db.query(
        "ALTER TABLE bot_store_products ADD COLUMN deleted_at TIMESTAMP NULL AFTER metadata",
      );
    }
    const legacyColumns = [
      "delivery_type",
      "delivery_value",
      "delivery_file_path",
      "delivery_file_name",
      "delivery_mime_type",
      "stock",
      "inventory_mode",
    ].filter((column) => productColumns.has(column));
    if (legacyColumns.length) {
      const columnOrNull = (column: string, fallback = "NULL") =>
        productColumns.has(column) ? column : `${fallback} AS ${column}`;
      const legacyFilters = [
        productColumns.has("delivery_value")
          ? "delivery_value IS NOT NULL"
          : "",
        productColumns.has("delivery_file_path")
          ? "delivery_file_path IS NOT NULL"
          : "",
        productColumns.has("stock") ? "stock IS NOT NULL" : "",
        productColumns.has("inventory_mode") ? "inventory_mode = 'legacy'" : "",
      ].filter(Boolean);
      const [legacyProducts] = legacyFilters.length
        ? await db.query<LegacyBotStoreProductRow[]>(
            `SELECT id, store_id, name,
                    ${columnOrNull("delivery_type", "'text'")},
                    ${columnOrNull("delivery_value")},
                    ${columnOrNull("delivery_file_path")},
                    ${columnOrNull("delivery_file_name")},
                    ${columnOrNull("delivery_mime_type")},
                    ${columnOrNull("stock")}
             FROM bot_store_products
             WHERE ${legacyFilters.join(" OR ")}`,
          )
        : [[] as LegacyBotStoreProductRow[]];
      for (const product of legacyProducts) {
        const [countRows] = await db.query<
          Array<RowDataPacket & { total: number }>
        >(
          "SELECT COUNT(*) AS total FROM bot_store_inventory_items WHERE product_id = ?",
          [product.id],
        );
        const hasInventory = Number(countRows[0]?.total || 0) > 0;
        const hasDeliverable = Boolean(
          product.delivery_value || product.delivery_file_path,
        );
        if (!hasInventory && hasDeliverable) {
          const legacyStock =
            product.stock == null ? null : Math.max(0, Number(product.stock));
          const quantity =
            legacyStock === 0 ? 1 : Math.max(1, legacyStock || 1);
          const status = legacyStock === 0 ? "disabled" : "available";
          const itemType = product.delivery_file_path
            ? "file"
            : product.delivery_type === "url"
              ? "url"
              : "text";
          for (let offset = 0; offset < quantity; offset += 250) {
            const batchSize = Math.min(250, quantity - offset);
            const values = Array.from({ length: batchSize }, () => [
              product.store_id,
              product.id,
              itemType,
              product.name,
              product.delivery_value,
              product.delivery_file_path,
              product.delivery_file_name,
              product.delivery_mime_type,
              status,
              JSON.stringify({ migratedFromProduct: true }),
            ]);
            await db.query(
              `INSERT INTO bot_store_inventory_items (
                 store_id, product_id, item_type, label, delivery_value,
                 delivery_file_path, delivery_file_name, delivery_mime_type,
                 status, metadata
               ) VALUES ${values
                 .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                 .join(", ")}`,
              values.flat(),
            );
          }
        }
      }
      await db.query(
        `ALTER TABLE bot_store_products ${legacyColumns
          .map((column) => `DROP COLUMN ${column}`)
          .join(", ")}`,
      );
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        public_id VARCHAR(64) NOT NULL,
        store_id INT NOT NULL,
        product_id INT NULL,
        provider VARCHAR(40) NOT NULL,
        external_order_id VARCHAR(160) NULL,
        customer_jid VARCHAR(160) NOT NULL,
        customer_name VARCHAR(180) NULL,
        customer_phone VARCHAR(32) NULL,
        quantity INT NOT NULL DEFAULT 1,
        total_cents INT NOT NULL DEFAULT 0,
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
        payment_charge_public_id VARCHAR(64) NULL,
        checkout_url TEXT NULL,
        metadata LONGTEXT NULL,
        delivered_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_orders_public_unique (public_id),
        KEY bot_store_orders_store_idx (store_id),
        KEY bot_store_orders_charge_idx (payment_charge_public_id),
        KEY bot_store_orders_external_idx (external_order_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      UPDATE bot_store_inventory_allocations
      SET status = 'released', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'reserved'
        AND order_id IN (
          SELECT id FROM bot_store_orders
          WHERE status IN ('pending', 'failed', 'credited')
        )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        customer_jid VARCHAR(160) NOT NULL,
        customer_name VARCHAR(180) NULL,
        customer_phone VARCHAR(32) NULL,
        avatar_url TEXT NULL,
        balance_cents INT NOT NULL DEFAULT 0,
        notes TEXT NULL,
        blocked TINYINT(1) NOT NULL DEFAULT 0,
        last_order_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_customers_jid_unique (store_id, customer_jid),
        KEY bot_store_customers_phone_idx (store_id, customer_phone),
        KEY bot_store_customers_updated_idx (store_id, updated_at)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      INSERT IGNORE INTO bot_store_customers (
        store_id, customer_jid, customer_name, customer_phone, last_order_at
      )
      SELECT store_id, customer_jid, MAX(customer_name), MAX(customer_phone),
             MAX(created_at)
      FROM bot_store_orders
      GROUP BY store_id, customer_jid
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        event_key VARCHAR(255) NOT NULL,
        event_type VARCHAR(80) NOT NULL,
        payload LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_events_key_unique (event_key),
        KEY bot_store_events_store_idx (store_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_wwpanel_integrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        api_key_encrypted LONGTEXT NULL,
        api_key_hint VARCHAR(32) NULL,
        account_snapshot LONGTEXT NULL,
        last_verified_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_wwpanel_store_unique (store_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_wwpanel_offers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        name VARCHAR(180) NOT NULL,
        description TEXT NULL,
        price_cents INT NOT NULL DEFAULT 0,
        image_path TEXT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        position INT NOT NULL DEFAULT 0,
        is_trial TINYINT(1) NOT NULL DEFAULT 0,
        days INT NULL,
        months INT NULL,
        plan_id INT NOT NULL DEFAULT 2,
        package_p2p VARCHAR(64) NOT NULL DEFAULT '64399dca5ea59e8a1de2b083',
        package_iptv INT NOT NULL DEFAULT 30,
        access_iptv INT NOT NULL DEFAULT 1,
        access_nexus INT NOT NULL DEFAULT 0,
        addons LONGTEXT NULL,
        country VARCHAR(100) NOT NULL DEFAULT 'Brasil',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY bot_store_wwpanel_offers_store_idx (store_id),
        KEY bot_store_wwpanel_offers_enabled_idx (store_id, enabled, position)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_wwpanel_clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        offer_id INT NULL,
        order_id INT NULL,
        customer_jid VARCHAR(160) NOT NULL,
        customer_name VARCHAR(180) NULL,
        customer_phone VARCHAR(32) NULL,
        external_id VARCHAR(160) NOT NULL,
        username VARCHAR(255) NOT NULL,
        password_encrypted LONGTEXT NOT NULL,
        expires_at TIMESTAMP NULL,
        status VARCHAR(40) NOT NULL DEFAULT 'active',
        provider_payload LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_wwpanel_order_unique (order_id),
        UNIQUE KEY bot_store_wwpanel_external_unique (store_id, external_id),
        KEY bot_store_wwpanel_customer_idx (store_id, customer_jid),
        KEY bot_store_wwpanel_offer_idx (store_id, offer_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_smm_integrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        api_base VARCHAR(255) NOT NULL DEFAULT 'https://smmhype.com/api/v2',
        api_key_encrypted LONGTEXT NULL,
        api_key_hint VARCHAR(32) NULL,
        provider_balance DECIMAL(18,6) NULL,
        provider_currency VARCHAR(12) NOT NULL DEFAULT 'USD',
        fx_mode VARCHAR(20) NOT NULL DEFAULT 'auto',
        usd_brl_rate DECIMAL(12,6) NOT NULL DEFAULT 5.500000,
        markup_percent DECIMAL(9,4) NOT NULL DEFAULT 40.0000,
        fixed_markup_cents INT NOT NULL DEFAULT 0,
        minimum_profit_cents INT NOT NULL DEFAULT 100,
        last_fx_at TIMESTAMP NULL,
        last_catalog_sync_at TIMESTAMP NULL,
        last_verified_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_smm_store_unique (store_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_smm_services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        provider_service_id INT NOT NULL,
        name VARCHAR(500) NOT NULL,
        category VARCHAR(500) NOT NULL,
        custom_name VARCHAR(500) NULL,
        custom_category VARCHAR(500) NULL,
        custom_description TEXT NULL,
        service_type VARCHAR(100) NOT NULL DEFAULT 'Default',
        provider_rate DECIMAL(18,6) NOT NULL DEFAULT 0,
        min_quantity INT NOT NULL DEFAULT 1,
        max_quantity INT NOT NULL DEFAULT 1,
        sale_min_quantity INT NULL,
        sale_max_quantity INT NULL,
        refill TINYINT(1) NOT NULL DEFAULT 0,
        cancel TINYINT(1) NOT NULL DEFAULT 0,
        dripfeed TINYINT(1) NOT NULL DEFAULT 0,
        imported TINYINT(1) NOT NULL DEFAULT 0,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        position INT NOT NULL DEFAULT 0,
        custom_sale_rate_cents INT NULL,
        provider_snapshot LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_smm_service_unique (store_id, provider_service_id),
        KEY bot_store_smm_service_enabled_idx (store_id, enabled, category),
        KEY bot_store_smm_service_category_idx (store_id, category)
      ) ENGINE=InnoDB
    `);
    const [smmServiceColumnRows] = await db.query<
      Array<RowDataPacket & { Field: string }>
    >("SHOW COLUMNS FROM bot_store_smm_services");
    const smmServiceColumns = new Set(
      smmServiceColumnRows.map((row) =>
        String(row.Field || "").toLowerCase(),
      ),
    );
    if (!smmServiceColumns.has("custom_name")) {
      await db.query(
        "ALTER TABLE bot_store_smm_services ADD COLUMN custom_name VARCHAR(500) NULL AFTER name",
      );
    }
    if (!smmServiceColumns.has("custom_category")) {
      await db.query(
        "ALTER TABLE bot_store_smm_services ADD COLUMN custom_category VARCHAR(500) NULL AFTER category",
      );
    }
    if (!smmServiceColumns.has("custom_description")) {
      await db.query(
        "ALTER TABLE bot_store_smm_services ADD COLUMN custom_description TEXT NULL AFTER custom_category",
      );
    }
    if (!smmServiceColumns.has("sale_min_quantity")) {
      await db.query(
        "ALTER TABLE bot_store_smm_services ADD COLUMN sale_min_quantity INT NULL AFTER max_quantity",
      );
    }
    if (!smmServiceColumns.has("sale_max_quantity")) {
      await db.query(
        "ALTER TABLE bot_store_smm_services ADD COLUMN sale_max_quantity INT NULL AFTER sale_min_quantity",
      );
    }
    if (!smmServiceColumns.has("imported")) {
      await db.query(
        "ALTER TABLE bot_store_smm_services ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER dripfeed",
      );
      await db.query(
        "UPDATE bot_store_smm_services SET imported = 1",
      );
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_smm_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        order_id INT NOT NULL,
        service_id INT NOT NULL,
        provider_order_id VARCHAR(160) NULL,
        customer_jid VARCHAR(160) NOT NULL,
        target TEXT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        request_payload LONGTEXT NULL,
        provider_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
        provider_currency VARCHAR(12) NOT NULL DEFAULT 'USD',
        sale_total_cents INT NOT NULL DEFAULT 0,
        status VARCHAR(80) NOT NULL DEFAULT 'pending_payment',
        start_count VARCHAR(160) NULL,
        remains VARCHAR(160) NULL,
        refill_id VARCHAR(160) NULL,
        refill_status VARCHAR(100) NULL,
        provider_snapshot LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bot_store_smm_order_unique (order_id),
        UNIQUE KEY bot_store_smm_provider_order_unique (store_id, provider_order_id),
        KEY bot_store_smm_customer_idx (store_id, customer_jid),
        KEY bot_store_smm_status_idx (store_id, status),
        KEY bot_store_smm_service_idx (store_id, service_id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_store_customer_states (
        store_id INT NOT NULL,
        customer_jid VARCHAR(160) NOT NULL,
        state_key VARCHAR(80) NOT NULL,
        payload LONGTEXT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (store_id, customer_jid),
        KEY bot_store_customer_states_expiry_idx (expires_at)
      ) ENGINE=InnoDB
    `);
    ensured = true;
  })().finally(() => ensureTasks.delete("bot-store"));

  ensureTasks.set("bot-store", task);
  return task;
};

export const ensureBotStoreTables = runEnsure;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const iso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const bool = (value: unknown) => value === true || value === 1 || value === "1";
const cleanText = (value: unknown, max = 10_000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const cleanNullable = (value: unknown, max = 10_000) =>
  cleanText(value, max) || null;
const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};
const normalizePhone = (value: string) => value.replace(/\D+/g, "");
const normalizeId = (value: unknown) =>
  value === null || value === undefined ? "" : String(value).trim();

const normalizeMenuTemplate = (
  value: unknown,
  fallback: BotStoreMenuTemplate,
): BotStoreMenuTemplate => {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  const text = (key: keyof BotStoreMenuTemplate, max = 4_000) =>
    source[key] === undefined
      ? String(fallback[key] ?? "")
      : cleanText(source[key], max);
  return {
    title: text("title", 180) || fallback.title,
    body: text("body"),
    footer: text("footer", 180),
    listButton: text("listButton", 80),
    imagePath:
      source.imagePath === undefined
        ? fallback.imagePath
        : cleanNullable(source.imagePath, 2_000),
    buyButton: text("buyButton", 80) || fallback.buyButton,
    backButton: text("backButton", 80) || fallback.backButton,
    categoryRow: text("categoryRow", 240) || fallback.categoryRow,
    productRow: text("productRow", 240) || fallback.productRow,
    trialUsedBody: text("trialUsedBody") || fallback.trialUsedBody,
    trialUsedButton:
      text("trialUsedButton", 80) || fallback.trialUsedButton,
    macPromptBody: text("macPromptBody") || fallback.macPromptBody,
    macAccessBody: text("macAccessBody") || fallback.macAccessBody,
    macAccessButton:
      text("macAccessButton", 80) || fallback.macAccessButton,
    macAppBody: text("macAppBody") || fallback.macAppBody,
    macAppButton: text("macAppButton", 80) || fallback.macAppButton,
    appActivatedBody:
      text("appActivatedBody") || fallback.appActivatedBody,
    linkPromptBody: text("linkPromptBody") || fallback.linkPromptBody,
    quantityPromptBody:
      text("quantityPromptBody") || fallback.quantityPromptBody,
    detailsPromptBody:
      text("detailsPromptBody") || fallback.detailsPromptBody,
    orderSummaryBody:
      text("orderSummaryBody") || fallback.orderSummaryBody,
    orderCreatedBody:
      text("orderCreatedBody") || fallback.orderCreatedBody,
    statusBody: text("statusBody") || fallback.statusBody,
  };
};

const normalizeStoreMenuConfig = (value: unknown): BotStoreMenuConfig => {
  const parsed = parseJson<JsonRecord>(value, {});
  const normalizedRoot = normalizeMenuTemplate(
    parsed.root,
    DEFAULT_STORE_MENU_CONFIG.root,
  );
  const normalizedCategory = normalizeMenuTemplate(
    parsed.category,
    DEFAULT_STORE_MENU_CONFIG.category,
  );
  const normalizedProduct = normalizeMenuTemplate(
    parsed.product,
    DEFAULT_STORE_MENU_CONFIG.product,
  );
  const legacyRoot =
    normalizedRoot.title === "{{store}}" &&
    normalizedRoot.body === "{{description}}" &&
    normalizedRoot.footer === "Compra e entrega pelo WhatsApp" &&
    normalizedRoot.listButton === "Ver produtos";
  const legacyCategory =
    normalizedCategory.title === "{{category}}" &&
    normalizedCategory.body === "{{description}}" &&
    normalizedCategory.footer === "{{store}}" &&
    normalizedCategory.listButton === "Ver produtos";
  const categoryUsesPreviousDefault =
    normalizedCategory.title === "Escolha um serviço" &&
    normalizedCategory.body ===
      "Selecione o serviço desejado para {{category}}." &&
    normalizedCategory.footer ===
      "Escolha o serviço que melhor atende o que você precisa." &&
    normalizedCategory.listButton === "Ver serviços";
  const rootUsesLegacyProductRow =
    normalizedRoot.productRow === "{{price}} · {{description}}";
  const categoryUsesLegacyProductRow =
    normalizedCategory.productRow === "{{price}} · {{description}}";
  const productUsesPreviousBody =
    normalizedProduct.body ===
    "{{description}}\n\n💰 {{price}}\n{{stock}}";
  const productUsesPreviousBuyButton =
    normalizedProduct.buyButton === "Comprar agora";
  const productUsesPreviousBackButton =
    normalizedProduct.backButton === "Voltar à loja";
  return {
    root: legacyRoot
      ? {
          ...normalizedRoot,
          body: DEFAULT_STORE_MENU_CONFIG.root.body,
          footer: DEFAULT_STORE_MENU_CONFIG.root.footer,
          listButton: DEFAULT_STORE_MENU_CONFIG.root.listButton,
          productRow: DEFAULT_STORE_MENU_CONFIG.root.productRow,
        }
      : {
          ...normalizedRoot,
          productRow: rootUsesLegacyProductRow
            ? DEFAULT_STORE_MENU_CONFIG.root.productRow
            : normalizedRoot.productRow,
        },
    category: legacyCategory || categoryUsesPreviousDefault
      ? {
          ...normalizedCategory,
          title: DEFAULT_STORE_MENU_CONFIG.category.title,
          body: DEFAULT_STORE_MENU_CONFIG.category.body,
          footer: DEFAULT_STORE_MENU_CONFIG.category.footer,
          listButton: DEFAULT_STORE_MENU_CONFIG.category.listButton,
          productRow: DEFAULT_STORE_MENU_CONFIG.category.productRow,
        }
      : {
          ...normalizedCategory,
          productRow: categoryUsesLegacyProductRow
            ? DEFAULT_STORE_MENU_CONFIG.category.productRow
            : normalizedCategory.productRow,
        },
    product: {
      ...normalizedProduct,
      body: productUsesPreviousBody
        ? DEFAULT_STORE_MENU_CONFIG.product.body
        : normalizedProduct.body,
      buyButton: productUsesPreviousBuyButton
        ? DEFAULT_STORE_MENU_CONFIG.product.buyButton
        : normalizedProduct.buyButton,
      backButton: productUsesPreviousBackButton
        ? DEFAULT_STORE_MENU_CONFIG.product.backButton
        : normalizedProduct.backButton,
    },
    iptv: normalizeMenuTemplate(
      parsed.iptv,
      DEFAULT_STORE_MENU_CONFIG.iptv,
    ),
    smm: normalizeMenuTemplate(parsed.smm, DEFAULT_STORE_MENU_CONFIG.smm),
    delivery: normalizeMenuTemplate(
      parsed.delivery,
      DEFAULT_STORE_MENU_CONFIG.delivery,
    ),
  };
};

const publicMenuTemplate = (template: BotStoreMenuTemplate) => ({
  ...template,
  imageUrl: template.imagePath
    ? resolveUploadedFileUrl(template.imagePath)
    : null,
});

const renderStoreTemplate = (
  template: string | null | undefined,
  values: Record<string, string | number | null | undefined>,
) =>
  String(template || "")
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
      String(values[key] ?? ""),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+·\s*$/g, "")
    .trim();

const templateMediaUrl = (template: BotStoreMenuTemplate) =>
  template.imagePath ? resolveUploadedFileUrl(template.imagePath) : null;

const mapStore = (row: BotStoreRow) => {
  const commands = parseJson<string[]>(row.commands, DEFAULT_STORE_COMMANDS)
    .map((entry) => cleanText(entry, 40).toLowerCase())
    .filter((entry, index, list) => entry && list.indexOf(entry) === index);
  const app = parseJson<CentralCartApp | null>(row.central_cart_app, null);
  const webhook = parseJson<JsonRecord | null>(row.central_cart_webhook, null);
  const menuConfig = normalizeStoreMenuConfig(row.menu_config);
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    instanceId: Number(row.instance_id),
    enabled: bool(row.enabled),
    autoOpenPrivate:
      row.auto_open_private === undefined ? true : bool(row.auto_open_private),
    name: row.name || "Minha loja",
    description: row.description,
    imagePath: row.image_path,
    imageUrl: row.image_path ? resolveUploadedFileUrl(row.image_path) : null,
    commands: commands.length ? commands : DEFAULT_STORE_COMMANDS,
    menuConfig: {
      root: publicMenuTemplate(menuConfig.root),
      category: publicMenuTemplate(menuConfig.category),
      product: publicMenuTemplate(menuConfig.product),
      iptv: publicMenuTemplate(menuConfig.iptv),
      smm: publicMenuTemplate(menuConfig.smm),
      delivery: publicMenuTemplate(menuConfig.delivery),
    },
    paymentProvider: row.payment_provider || null,
    centralCart: {
      connected: Boolean(row.central_cart_api_key),
      apiKey: row.central_cart_api_key || null,
      apiKeyHint: row.central_cart_api_key
        ? `${row.central_cart_api_key.slice(0, 4)}...${row.central_cart_api_key.slice(-4)}`
        : null,
      apiBase: row.central_cart_api_base || CENTRAL_CART_API_BASE,
      mode: row.central_cart_mode === "import" ? "import" : "live",
      checkoutGateway: row.central_cart_gateway || "OTHER",
      app,
      webhook,
      lastSyncAt: iso(row.central_cart_last_sync_at),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
};

const mapCategory = (row: BotStoreCategoryRow) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  name: row.name,
  description: row.description,
  imagePath: row.image_path,
  imageUrl: row.image_path ? resolveUploadedFileUrl(row.image_path) : null,
  position: Number(row.position || 0),
  enabled: bool(row.enabled),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapProduct = (row: BotStoreProductRow) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  categoryId: row.category_id == null ? null : Number(row.category_id),
  name: row.name,
  sku: row.sku,
  description: row.description,
  priceCents: Number(row.price_cents || 0),
  price: Number(row.price_cents || 0) / 100,
  imagePath: row.image_path,
  imageUrl: row.image_path ? resolveUploadedFileUrl(row.image_path) : null,
  enabled: bool(row.enabled),
  position: Number(row.position || 0),
  metadata: parseJson<JsonRecord>(row.metadata, {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapInventoryItem = (row: BotStoreInventoryRow) => {
  const maxUses = Math.max(1, Number(row.max_uses || 1));
  const usedCount = Math.max(0, Number(row.used_count || 0));
  const reservedUses = Math.max(0, Number(row.reserved_uses || 0));
  const remainingUses = Math.max(0, maxUses - usedCount - reservedUses);
  const status =
    row.status === "disabled"
      ? "disabled"
      : usedCount >= maxUses
        ? "delivered"
        : reservedUses > 0 && remainingUses === 0
          ? "reserved"
          : "available";
  return {
    id: Number(row.id),
    storeId: Number(row.store_id),
    productId: Number(row.product_id),
    itemType: row.item_type || "code",
    label: row.label,
    deliveryValue: row.delivery_value,
    deliveryFilePath: row.delivery_file_path,
    deliveryFileUrl: row.delivery_file_path
      ? resolveUploadedFileUrl(row.delivery_file_path)
      : null,
    deliveryFileName: row.delivery_file_name,
    deliveryMimeType: row.delivery_mime_type,
    status,
    maxUses,
    usedCount,
    reservedUses,
    remainingUses,
    orderId: row.order_id == null ? null : Number(row.order_id),
    reservedUntil: iso(row.reserved_until),
    deliveredAt: iso(row.delivered_at),
    metadata: parseJson<JsonRecord>(row.metadata, {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
};

const mapOrder = (row: BotStoreOrderRow) => ({
  id: Number(row.id),
  publicId: row.public_id,
  storeId: Number(row.store_id),
  productId: row.product_id == null ? null : Number(row.product_id),
  provider: row.provider,
  externalOrderId: row.external_order_id,
  customerJid: row.customer_jid,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  quantity: Number(row.quantity || 1),
  totalCents: Number(row.total_cents || 0),
  total: Number(row.total_cents || 0) / 100,
  status: row.status,
  paymentChargePublicId: row.payment_charge_public_id,
  checkoutUrl: row.checkout_url,
  metadata: parseJson<JsonRecord>(row.metadata, {}),
  deliveredAt: iso(row.delivered_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapCustomer = (row: BotStoreCustomerRow) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  customerJid: row.customer_jid,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  avatarUrl: row.avatar_url,
  balanceCents: Number(row.balance_cents || 0),
  balance: Number(row.balance_cents || 0) / 100,
  notes: row.notes,
  blocked: bool(row.blocked),
  ordersCount: Number(row.orders_count || 0),
  paidOrdersCount: Number(row.paid_orders_count || 0),
  totalSpentCents: Number(row.total_spent_cents || 0),
  totalSpent: Number(row.total_spent_cents || 0) / 100,
  lastOrderAt: iso(row.last_order_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapWwPanelOffer = (row: BotStoreWwPanelOfferRow) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  name: row.name,
  description: row.description,
  priceCents: Number(row.price_cents || 0),
  price: Number(row.price_cents || 0) / 100,
  imagePath: row.image_path,
  imageUrl: row.image_path ? resolveUploadedFileUrl(row.image_path) : null,
  enabled: bool(row.enabled),
  position: Number(row.position || 0),
  isTrial: bool(row.is_trial),
  days: row.days == null ? null : Number(row.days),
  months: row.months == null ? null : Number(row.months),
  planId: Number(row.plan_id || 2),
  packageP2p: row.package_p2p,
  packageIptv: Number(row.package_iptv || 30),
  accessIptv: Number(row.access_iptv || 1),
  accessNexus: Number(row.access_nexus || 0),
  addons: parseJson<number[]>(row.addons, []).map(Number).filter(Number.isFinite),
  country: row.country || "Brasil",
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapWwPanelClient = (row: BotStoreWwPanelClientRow) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  offerId: row.offer_id == null ? null : Number(row.offer_id),
  orderId: row.order_id == null ? null : Number(row.order_id),
  customerJid: row.customer_jid,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  externalId: row.external_id,
  username: row.username,
  passwordHint: row.password_encrypted ? "••••••••" : null,
  expiresAt: iso(row.expires_at),
  status: row.status,
  isTrial:
    row.is_trial == null
      ? bool(parseJson<JsonRecord>(row.provider_payload, {}).isTrial)
      : bool(row.is_trial),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapSmmService = (
  row: BotStoreSmmServiceRow,
  integration?: BotStoreSmmIntegration | null,
) => {
  const providerRate = Number(row.provider_rate || 0);
  const providerMin = Math.max(1, Number(row.min_quantity || 1));
  const providerMax = Math.max(providerMin, Number(row.max_quantity || 1));
  const saleMin =
    row.sale_min_quantity == null
      ? providerMin
      : Math.max(providerMin, Number(row.sale_min_quantity));
  const saleMax =
    row.sale_max_quantity == null
      ? providerMax
      : Math.min(providerMax, Number(row.sale_max_quantity));
  const customSaleRateCents =
    row.custom_sale_rate_cents == null
      ? null
      : Number(row.custom_sale_rate_cents);
  const estimate = integration
    ? calculateSmmPrice({
        providerRate,
        serviceType: row.service_type,
        quantity: smmServiceUsesFixedPrice(row.service_type) ? 1 : 1_000,
        usdBrlRate: integration.usdBrlRate,
        markupPercent: integration.markupPercent,
        fixedMarkupCents: integration.fixedMarkupCents,
        minimumProfitCents: integration.minimumProfitCents,
        customSaleRateCents,
      })
    : null;
  return {
    id: Number(row.id),
    storeId: Number(row.store_id),
    providerServiceId: Number(row.provider_service_id),
    name: row.custom_name || row.name,
    category: row.custom_category || row.category,
    description: row.custom_description,
    providerName: row.name,
    providerCategory: row.category,
    serviceType: row.service_type || "Default",
    providerRate,
    min: Math.min(saleMin, saleMax),
    max: Math.max(saleMin, saleMax),
    providerMin,
    providerMax,
    refill: bool(row.refill),
    cancel: bool(row.cancel),
    dripfeed: bool(row.dripfeed),
    imported: bool(row.imported),
    enabled: bool(row.enabled),
    position: Number(row.position || 0),
    customSaleRateCents,
    estimatedSaleCents: estimate?.totalCents ?? null,
    providerSnapshot: parseJson<JsonRecord>(row.provider_snapshot, {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
};

const mapSmmOrder = (row: BotStoreSmmOrderRow) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  orderId: Number(row.order_id),
  serviceId: Number(row.service_id),
  providerOrderId: row.provider_order_id,
  customerJid: row.customer_jid,
  target: row.target,
  quantity: Number(row.quantity || 1),
  requestPayload: parseJson<JsonRecord>(row.request_payload, {}),
  providerCost: Number(row.provider_cost || 0),
  providerCurrency: row.provider_currency || "USD",
  saleTotalCents: Number(row.sale_total_cents || 0),
  status: row.status || "pending_payment",
  startCount: row.start_count,
  remains: row.remains,
  refillId: row.refill_id,
  refillStatus: row.refill_status,
  providerSnapshot: parseJson<JsonRecord>(row.provider_snapshot, {}),
  serviceName: row.service_name || "Serviço SMM",
  serviceCategory: row.service_category || "SMM",
  serviceType: row.service_type || "Default",
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

type BotStoreWwPanelIntegration = {
  id: number;
  storeId: number;
  enabled: boolean;
  apiKey: string | null;
  apiKeyHint: string | null;
  account: JsonRecord | null;
  lastVerifiedAt: string | null;
};

type BotStoreSmmIntegration = {
  id: number;
  storeId: number;
  enabled: boolean;
  apiBase: string;
  apiKey: string | null;
  apiKeyHint: string | null;
  providerBalance: number | null;
  providerCurrency: string;
  fxMode: "auto" | "manual";
  usdBrlRate: number;
  markupPercent: number;
  fixedMarkupCents: number;
  minimumProfitCents: number;
  lastFxAt: string | null;
  lastCatalogSyncAt: string | null;
  lastVerifiedAt: string | null;
};

const getWwPanelIntegration = async (
  storeId: number,
): Promise<BotStoreWwPanelIntegration | null> => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelIntegrationRow[]>(
    "SELECT * FROM bot_store_wwpanel_integrations WHERE store_id = ? LIMIT 1",
    [storeId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    storeId: Number(row.store_id),
    enabled: bool(row.enabled),
    apiKey: row.api_key_encrypted
      ? decryptWwPanelSecret(row.api_key_encrypted)
      : null,
    apiKeyHint: row.api_key_hint,
    account: row.account_snapshot
      ? sanitizeWwPanelAccount(
          parseJson<JsonRecord | null>(row.account_snapshot, null),
        )
      : null,
    lastVerifiedAt: iso(row.last_verified_at),
  };
};

const listWwPanelOffers = async (
  storeId: number,
  includeDisabled = true,
) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelOfferRow[]>(
    `SELECT * FROM bot_store_wwpanel_offers
     WHERE store_id = ? ${includeDisabled ? "" : "AND enabled = 1"}
     ORDER BY position ASC, id ASC`,
    [storeId],
  );
  return rows.map(mapWwPanelOffer);
};

const seedDefaultWwPanelOffers = async (storeId: number) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<
    Array<RowDataPacket & { total: number; trials: number }>
  >(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) AS trials
     FROM bot_store_wwpanel_offers
     WHERE store_id = ?`,
    [storeId],
  );
  const total = Number(rows[0]?.total || 0);
  if (Number(rows[0]?.trials || 0) === 0) {
    await db.query(
      `INSERT INTO bot_store_wwpanel_offers (
         store_id, name, description, price_cents, image_path, enabled,
         position, is_trial, days, months, plan_id, package_p2p,
         package_iptv, access_iptv, access_nexus, addons, country
       ) VALUES (
         ?, 'Teste IPTV', 'Teste temporário para validar canais e compatibilidade.',
         0, NULL, 1, 0, 1, 1, NULL, 2, '64399dca5ea59e8a1de2b083',
         30, 1, 0, '[]', 'Brasil'
       )`,
      [storeId],
    );
  }
  if (total > 0) return;
  await db.query(
    `INSERT INTO bot_store_wwpanel_offers (
       store_id, name, description, price_cents, image_path, enabled,
       position, is_trial, days, months, plan_id, package_p2p,
       package_iptv, access_iptv, access_nexus, addons, country
     ) VALUES (
       ?, 'IPTV Mensal', 'Modelo de plano mensal. Defina o preço antes de publicar.',
       0, NULL, 0, 10, 0, NULL, 1, 2, '64399dca5ea59e8a1de2b083',
       30, 1, 0, '[]', 'Brasil'
     )`,
    [storeId],
  );
};

const listWwPanelClients = async (storeId: number) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelClientRow[]>(
    `SELECT c.*, o.is_trial
     FROM bot_store_wwpanel_clients c
     LEFT JOIN bot_store_wwpanel_offers o
       ON o.id = c.offer_id AND o.store_id = c.store_id
     WHERE c.store_id = ?
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1000`,
    [storeId],
  );
  return rows.map(mapWwPanelClient);
};

const listCustomerWwPanelClients = async (
  storeId: number,
  customerJid: string,
) => {
  await runEnsure();
  const db = getDb();
  const phone = normalizePhone(customerJid);
  const [rows] = await db.query<BotStoreWwPanelClientRow[]>(
    `SELECT c.*, o.is_trial
     FROM bot_store_wwpanel_clients c
     LEFT JOIN bot_store_wwpanel_offers o
       ON o.id = c.offer_id AND o.store_id = c.store_id
     WHERE c.store_id = ?
       AND c.status NOT IN ('deleted', 'cancelled')
       AND (c.customer_jid = ? OR (? <> '' AND c.customer_phone = ?))
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 40`,
    [storeId, customerJid, phone, phone],
  );
  return rows.map(mapWwPanelClient);
};

const getSmmIntegration = async (
  storeId: number,
): Promise<BotStoreSmmIntegration | null> => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmIntegrationRow[]>(
    "SELECT * FROM bot_store_smm_integrations WHERE store_id = ? LIMIT 1",
    [storeId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    storeId: Number(row.store_id),
    enabled: bool(row.enabled),
    apiBase: row.api_base || SMMHYPE_API_BASE,
    apiKey: row.api_key_encrypted
      ? decryptSmmSecret(row.api_key_encrypted)
      : null,
    apiKeyHint: row.api_key_hint,
    providerBalance:
      row.provider_balance == null ? null : Number(row.provider_balance),
    providerCurrency: row.provider_currency || "USD",
    fxMode: row.fx_mode === "manual" ? "manual" : "auto",
    usdBrlRate: Math.max(0.01, Number(row.usd_brl_rate || 5.5)),
    markupPercent: Math.max(0, Number(row.markup_percent || 0)),
    fixedMarkupCents: Math.max(0, Number(row.fixed_markup_cents || 0)),
    minimumProfitCents: Math.max(
      0,
      Number(row.minimum_profit_cents || 0),
    ),
    lastFxAt: iso(row.last_fx_at),
    lastCatalogSyncAt: iso(row.last_catalog_sync_at),
    lastVerifiedAt: iso(row.last_verified_at),
  };
};

const listSmmServices = async (
  storeId: number,
  integration: BotStoreSmmIntegration | null,
  options: {
    enabledOnly?: boolean;
    importedOnly?: boolean;
    limit?: number;
  } = {},
) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmServiceRow[]>(
    `SELECT * FROM bot_store_smm_services
     WHERE store_id = ?
       ${options.importedOnly === false ? "" : "AND imported = 1"}
       ${options.enabledOnly ? "AND enabled = 1" : ""}
     ORDER BY enabled DESC, position ASC, category ASC, name ASC
     LIMIT ?`,
    [storeId, Math.max(1, Math.min(10_000, options.limit || 10_000))],
  );
  return rows.map((row) => mapSmmService(row, integration));
};

const getSmmService = async (
  storeId: number,
  serviceId: number,
  enabledOnly = false,
) => {
  const integration = await getSmmIntegration(storeId);
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmServiceRow[]>(
    `SELECT * FROM bot_store_smm_services
     WHERE id = ? AND store_id = ? AND imported = 1
       ${enabledOnly ? "AND enabled = 1" : ""}
     LIMIT 1`,
    [serviceId, storeId],
  );
  return rows[0] ? mapSmmService(rows[0], integration) : null;
};

const listSmmOrders = async (storeId: number, limit = 300) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmOrderRow[]>(
    `SELECT smm.*, service.name AS service_name,
            service.category AS service_category,
            service.service_type AS service_type
     FROM bot_store_smm_orders smm
     LEFT JOIN bot_store_smm_services service
       ON service.id = smm.service_id AND service.store_id = smm.store_id
     WHERE smm.store_id = ?
     ORDER BY smm.created_at DESC, smm.id DESC
     LIMIT ?`,
    [storeId, Math.max(1, Math.min(1_000, limit))],
  );
  return rows.map(mapSmmOrder);
};

const countSmmCatalog = async (storeId: number) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<
    Array<RowDataPacket & { total: number }>
  >(
    "SELECT COUNT(*) AS total FROM bot_store_smm_services WHERE store_id = ?",
    [storeId],
  );
  return Number(rows[0]?.total || 0);
};

const publicSmmIntegration = (
  integration: BotStoreSmmIntegration | null,
) => ({
  connected: Boolean(integration?.apiKey),
  enabled: integration?.enabled ?? false,
  apiBase: integration?.apiBase || SMMHYPE_API_BASE,
  apiKeyHint: integration?.apiKeyHint ?? null,
  providerBalance: integration?.providerBalance ?? null,
  providerCurrency: integration?.providerCurrency || "USD",
  fxMode: integration?.fxMode || "auto",
  usdBrlRate: integration?.usdBrlRate || 5.5,
  markupPercent: integration?.markupPercent || 0,
  fixedMarkupCents: integration?.fixedMarkupCents || 0,
  minimumProfitCents: integration?.minimumProfitCents || 0,
  lastFxAt: integration?.lastFxAt ?? null,
  lastCatalogSyncAt: integration?.lastCatalogSyncAt ?? null,
  lastVerifiedAt: integration?.lastVerifiedAt ?? null,
});

const refreshSmmFxRate = async (
  integration: BotStoreSmmIntegration,
  force = false,
) => {
  if (integration.fxMode === "manual") return integration.usdBrlRate;
  const last = integration.lastFxAt
    ? new Date(integration.lastFxAt).getTime()
    : 0;
  if (!force && last > Date.now() - 6 * 60 * 60 * 1_000) {
    return integration.usdBrlRate;
  }
  try {
    const fx = await fetchUsdBrlRate();
    const db = getDb();
    await db.query(
      `UPDATE bot_store_smm_integrations
       SET usd_brl_rate = ?, last_fx_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ?`,
      [fx.rate, integration.storeId],
    );
    return fx.rate;
  } catch {
    return integration.usdBrlRate;
  }
};

const formatMoney = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );

const meaningfulCustomerName = (value: unknown) => {
  const name = cleanNullable(value, 180);
  if (!name) return null;
  const normalized = name.trim().toLocaleLowerCase("pt-BR");
  if (
    [
      "cliente",
      "customer",
      "contato",
      "contact",
      "usuário",
      "usuario",
    ].includes(normalized)
  ) {
    return null;
  }
  if (
    /^\+?\d[\d\s().-]{7,}$/.test(name) ||
    /@(?:s\.whatsapp\.net|c\.us)$/i.test(name)
  ) {
    return null;
  }
  return name;
};

const getStoreCustomerTemplateValues = async (
  storeId: number,
  customerJid: string,
  customerName?: string | null,
) => {
  await runEnsure();
  const jid = cleanText(customerJid, 160);
  const suppliedName = meaningfulCustomerName(customerName);
  const suppliedPhone = normalizePhone(jid) || null;
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_store_customers (
        store_id, customer_jid, customer_name, customer_phone
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        customer_name = COALESCE(NULLIF(VALUES(customer_name), ''), customer_name),
        customer_phone = COALESCE(NULLIF(VALUES(customer_phone), ''), customer_phone),
        updated_at = CURRENT_TIMESTAMP
    `,
    [storeId, jid, suppliedName, suppliedPhone],
  );
  const [rows] = await db.query<
    Array<
      RowDataPacket & {
        customer_name: string | null;
        customer_phone: string | null;
        balance_cents: number;
        conversation_name: string | null;
      }
    >
  >(
    `
      SELECT customer.customer_name,
             customer.customer_phone,
             customer.balance_cents,
             (
               SELECT conversation.title
               FROM bot_stores store
               JOIN bot_whatsapp_conversations conversation
                 ON conversation.user_id = store.user_id
                AND conversation.instance_id = store.instance_id
               WHERE store.id = ?
                 AND conversation.chat_jid = customer.customer_jid
                 AND conversation.title IS NOT NULL
                 AND conversation.title <> ''
               ORDER BY conversation.updated_at DESC
               LIMIT 1
             ) AS conversation_name
      FROM bot_store_customers customer
      WHERE customer.store_id = ? AND customer.customer_jid = ?
      LIMIT 1
    `,
    [storeId, storeId, jid],
  );
  const customer = rows[0];
  const name =
    suppliedName ||
    meaningfulCustomerName(customer?.conversation_name) ||
    meaningfulCustomerName(customer?.customer_name) ||
    "Cliente";
  const phone =
    normalizePhone(customer?.customer_phone || "") || suppliedPhone || "";
  return {
    nome_cliente: name,
    nomecliente: name,
    pushname: name,
    numero_cliente: phone ? `+${phone}` : "",
    saldo_cliente: formatMoney(Number(customer?.balance_cents || 0)),
  };
};

const formatAvailableStock = (stock: number | null | undefined) => {
  if (stock == null) return "disponível";
  const amount = Math.max(0, Number(stock || 0));
  return `${amount} ${amount === 1 ? "disponível" : "disponíveis"}`;
};

const productTemplateValues = (
  product: BotStoreProduct & { stock?: number | null },
) => ({
  product: product.name,
  price: formatMoney(product.priceCents),
  stock: formatAvailableStock(product.stock),
  description: product.description,
});

const stripHtml = (input: string | null | undefined) =>
  (input ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const getBotStoreByInstance = async (
  instanceId: number,
): Promise<BotStore | null> => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreRow[]>(
    "SELECT * FROM bot_stores WHERE instance_id = ? LIMIT 1",
    [instanceId],
  );
  return rows.length ? mapStore(rows[0]) : null;
};

export const getBotStoreForUser = async (
  userId: number,
  instanceId: number,
  createIfMissing = false,
): Promise<BotStore | null> => {
  await runEnsure();
  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance) throw new Error("Perfil do WhatsApp não encontrado.");
  let store = await getBotStoreByInstance(instance.id);
  if (store || !createIfMissing) return store;

  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_stores (user_id, instance_id, name, description, commands)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)
    `,
    [
      userId,
      instance.id,
      `Loja ${instance.name || instance.phone || "WhatsApp"}`,
      "Produtos digitais com entrega pelo WhatsApp.",
      JSON.stringify(DEFAULT_STORE_COMMANDS),
    ],
  );
  store = await getBotStoreByInstance(instance.id);
  return store;
};

export const listBotStoreCategories = async (
  storeId: number,
  includeDisabled = true,
) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreCategoryRow[]>(
    `
      SELECT * FROM bot_store_categories
      WHERE store_id = ? ${includeDisabled ? "" : "AND enabled = 1"}
      ORDER BY position ASC, name ASC, id ASC
    `,
    [storeId],
  );
  return rows.map(mapCategory);
};

const expireStoreInventoryAllocations = async (
  storeId: number,
  productId?: number | null,
) => {
  const db = getDb();
  const params: unknown[] = [storeId];
  const productFilter =
    productId && productId > 0
      ? "AND inventory_id IN (SELECT id FROM bot_store_inventory_items WHERE product_id = ?)"
      : "";
  if (productFilter) params.push(productId);
  await db.query(
    `UPDATE bot_store_inventory_allocations
     SET status = 'released', updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ? AND status = 'reserved'
       AND order_id IN (
         SELECT id FROM bot_store_orders
         WHERE status IN ('pending', 'failed', 'credited')
       )
       ${productFilter}`,
    params,
  );
  await db.query(
    `UPDATE bot_store_inventory_allocations
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ? AND status = 'reserved'
       AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
       ${productFilter}`,
    params,
  );
};

export const listBotStoreProducts = async (
  storeId: number,
  options: {
    categoryId?: number | null;
    includeDisabled?: boolean;
    includeDeleted?: boolean;
  } = {},
) => {
  await runEnsure();
  const db = getDb();
  await expireStoreInventoryAllocations(storeId);
  const filters = ["store_id = ?"];
  const params: unknown[] = [storeId];
  if (!options.includeDeleted) filters.push("deleted_at IS NULL");
  if (typeof options.categoryId === "number" && options.categoryId > 0) {
    filters.push("category_id = ?");
    params.push(options.categoryId);
  }
  if (!options.includeDisabled) filters.push("enabled = 1");
  const [rows] = await db.query<BotStoreProductRow[]>(
    `
      SELECT * FROM bot_store_products
      WHERE ${filters.join(" AND ")}
      ORDER BY position ASC, name ASC, id ASC
    `,
    params,
  );
  const [counts] = await db.query<
    Array<
      RowDataPacket & {
        product_id: number;
        available_count: number;
        reserved_count: number;
        delivered_count: number;
        disabled_count: number;
      }
    >
  >(
    `SELECT item.product_id,
            SUM(
              CASE WHEN item.status <> 'disabled'
                THEN GREATEST(item.max_uses - item.used_count - COALESCE(reserved.quantity, 0), 0)
                ELSE 0
              END
            ) AS available_count,
            SUM(COALESCE(reserved.quantity, 0)) AS reserved_count,
            SUM(item.used_count) AS delivered_count,
            SUM(
              CASE WHEN item.status = 'disabled'
                THEN GREATEST(item.max_uses - item.used_count, 0)
                ELSE 0
              END
            ) AS disabled_count
     FROM bot_store_inventory_items item
     LEFT JOIN (
       SELECT inventory_id, SUM(quantity) AS quantity
       FROM bot_store_inventory_allocations
       WHERE store_id = ? AND status = 'reserved'
         AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
       GROUP BY inventory_id
     ) reserved ON reserved.inventory_id = item.id
     WHERE item.store_id = ? AND item.deleted_at IS NULL
     GROUP BY item.product_id`,
    [storeId, storeId],
  );
  const inventoryByProduct = new Map(
    counts.map((row) => [
      Number(row.product_id),
      {
        available: Number(row.available_count || 0),
        reserved: Number(row.reserved_count || 0),
        delivered: Number(row.delivered_count || 0),
        disabled: Number(row.disabled_count || 0),
      },
    ]),
  );
  return rows.map((row) => {
    const product = mapProduct(row);
    const inventory = inventoryByProduct.get(product.id) || {
      available: 0,
      reserved: 0,
      delivered: 0,
      disabled: 0,
    };
    return {
      ...product,
      inventory,
      stock: inventory.available,
    };
  });
};

export const listBotStoreInventory = async (
  storeId: number,
  options: {
    productId?: number | null;
    status?: string | null;
    limit?: number;
  } = {},
) => {
  await runEnsure();
  const db = getDb();
  await expireStoreInventoryAllocations(storeId, options.productId);
  const filters = ["store_id = ?", "deleted_at IS NULL"];
  const params: unknown[] = [storeId];
  const productId = toInt(options.productId);
  if (productId > 0) {
    filters.push("product_id = ?");
    params.push(productId);
  }
  const status = cleanText(options.status, 30).toLowerCase();
  if (["available", "reserved", "delivered", "disabled"].includes(status)) {
    filters.push("status = ?");
    params.push(status);
  }
  params.push(Math.max(1, Math.min(2_000, toInt(options.limit, 1_000))));
  const [rows] = await db.query<BotStoreInventoryRow[]>(
    `SELECT item.*,
            COALESCE(reserved.quantity, 0) AS reserved_uses
     FROM bot_store_inventory_items item
     LEFT JOIN (
       SELECT inventory_id, SUM(quantity) AS quantity
       FROM bot_store_inventory_allocations
       WHERE store_id = ? AND status = 'reserved'
         AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
       GROUP BY inventory_id
     ) reserved ON reserved.inventory_id = item.id
     WHERE ${filters.map((filter) => `item.${filter}`).join(" AND ")}
     ORDER BY
       CASE item.status
         WHEN 'available' THEN 0
         WHEN 'reserved' THEN 1
         WHEN 'delivered' THEN 2
         ELSE 3
       END,
       item.created_at DESC, item.id DESC
     LIMIT ?`,
    [storeId, ...params],
  );
  return rows.map(mapInventoryItem);
};

export const listBotStoreOrders = async (storeId: number, limit = 100) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreOrderRow[]>(
    `
      SELECT * FROM bot_store_orders
      WHERE store_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [storeId, Math.max(1, Math.min(300, Math.floor(limit)))],
  );
  return rows.map(mapOrder);
};

export const listBotStoreCustomers = async (store: BotStore) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreCustomerRow[]>(
    `
      SELECT customer.*,
             COUNT(orders.id) AS orders_count,
             SUM(CASE WHEN orders.status IN ('paid', 'approved', 'delivered', 'credited')
                      THEN 1 ELSE 0 END) AS paid_orders_count,
             SUM(CASE WHEN orders.status IN ('paid', 'approved', 'delivered', 'credited')
                      THEN orders.total_cents ELSE 0 END) AS total_spent_cents,
             COALESCE(
               NULLIF(customer.avatar_url, ''),
               (
                 SELECT conversation.avatar_url
                 FROM bot_whatsapp_conversations conversation
                 WHERE conversation.user_id = ?
                   AND conversation.instance_id = ?
                   AND (
                     conversation.chat_jid = customer.customer_jid
                     OR (
                       customer.customer_phone IS NOT NULL
                       AND customer.customer_phone <> ''
                       AND REPLACE(REPLACE(REPLACE(REPLACE(
                         COALESCE(conversation.phone, ''), '+', ''
                       ), ' ', ''), '-', ''), '(', '') LIKE CONCAT('%', customer.customer_phone)
                     )
                   )
                   AND conversation.avatar_url IS NOT NULL
                   AND conversation.avatar_url <> ''
                 ORDER BY conversation.updated_at DESC
                 LIMIT 1
               )
             ) AS avatar_url,
             COALESCE(
               NULLIF(customer.customer_name, ''),
               (
                 SELECT conversation.title
                 FROM bot_whatsapp_conversations conversation
                 WHERE conversation.user_id = ?
                   AND conversation.instance_id = ?
                   AND conversation.chat_jid = customer.customer_jid
                 ORDER BY conversation.updated_at DESC
                 LIMIT 1
               )
             ) AS customer_name
      FROM bot_store_customers customer
      LEFT JOIN bot_store_orders orders
        ON orders.store_id = customer.store_id
       AND orders.customer_jid = customer.customer_jid
      WHERE customer.store_id = ?
      GROUP BY customer.id
      ORDER BY COALESCE(customer.last_order_at, customer.updated_at) DESC,
               customer.id DESC
    `,
    [store.userId, store.instanceId, store.userId, store.instanceId, store.id],
  );
  return rows.map(mapCustomer);
};

export const getBotStoreSnapshot = async (
  userId: number,
  instanceId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Não foi possível criar a loja deste perfil.");
  const [
    categories,
    products,
    inventory,
    orders,
    customers,
    wwPanelIntegration,
    wwPanelOffers,
    wwPanelClients,
    smmIntegration,
  ] =
    await Promise.all([
      listBotStoreCategories(store.id),
      listBotStoreProducts(store.id, { includeDisabled: true }),
      listBotStoreInventory(store.id, { limit: 2_000 }),
      listBotStoreOrders(store.id),
      listBotStoreCustomers(store),
      getWwPanelIntegration(store.id),
      listWwPanelOffers(store.id),
      listWwPanelClients(store.id),
      getSmmIntegration(store.id),
    ]);
  const [smmServices, smmOrders, smmCatalogCount] = await Promise.all([
    listSmmServices(store.id, smmIntegration),
    listSmmOrders(store.id),
    countSmmCatalog(store.id),
  ]);
  let centralCatalog: CentralCartCatalog | null = null;
  let centralCartError: string | null = null;
  if (store.centralCart.connected) {
    try {
      centralCatalog = await loadCentralCartCatalog(store);
    } catch (error) {
      centralCartError =
        error instanceof Error
          ? error.message
          : "Não foi possível sincronizar a Central Cart.";
    }
  }
  return {
    store: publicStore(store),
    categories,
    products,
    inventory,
    orders,
    customers,
    wwPanel: {
      connected: Boolean(wwPanelIntegration?.apiKey),
      enabled: wwPanelIntegration?.enabled ?? false,
      apiKeyHint: wwPanelIntegration?.apiKeyHint ?? null,
      account: wwPanelIntegration?.account ?? null,
      lastVerifiedAt: wwPanelIntegration?.lastVerifiedAt ?? null,
      apiBase: WWPANEL_API_BASE,
      catalog: wwPanelPublicCatalog(),
    },
    wwPanelOffers,
    wwPanelClients,
    smm: publicSmmIntegration(smmIntegration),
    smmServices,
    smmOrders,
    smmCatalogCount,
    centralCatalog,
    centralCartError,
  };
};

const publicStore = (store: BotStore) => {
  const { apiKey: _apiKey, webhook, ...publicCentralCart } = store.centralCart;

  return {
    ...store,
    centralCart: {
      ...publicCentralCart,
      webhook: webhook
        ? {
            id: webhook.id,
            name: webhook.name,
            url: webhook.url,
            scopes: webhook.scopes,
          }
        : null,
    },
  };
};

const deleteStoreUploadWhenUnused = async (
  filePath: string | null | undefined,
) => {
  const normalized = cleanText(filePath, 2_000);
  if (!normalized) return;
  const db = getDb();
  const [rows] = await db.query<Array<RowDataPacket & { total: number }>>(
    `SELECT
       (SELECT COUNT(*) FROM bot_stores WHERE image_path = ?) +
       (SELECT COUNT(*) FROM bot_store_categories WHERE image_path = ?) +
       (SELECT COUNT(*) FROM bot_store_products WHERE image_path = ?) +
       (SELECT COUNT(*) FROM bot_store_inventory_items WHERE delivery_file_path = ?) +
       (SELECT COUNT(*) FROM bot_store_wwpanel_offers WHERE image_path = ?)
       AS total`,
    [normalized, normalized, normalized, normalized, normalized],
  );
  if (Number(rows[0]?.total || 0) === 0) {
    await deleteUploadedFile(normalized).catch((error) => {
      console.warn("[bot-store] Falha ao remover upload sem referência", {
        filePath: normalized,
        error,
      });
    });
  }
};

export const updateBotStoreForUser = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const commands = Array.isArray(payload.commands)
    ? payload.commands
        .map((entry) => cleanText(entry, 40).toLowerCase())
        .filter((entry, index, list) => entry && list.indexOf(entry) === index)
    : store.commands;
  const provider = cleanText(payload.paymentProvider, 40).toLowerCase();
  const nextMenuConfig =
    payload.menuConfig === undefined
      ? {
          root: normalizeMenuTemplate(
            store.menuConfig.root,
            DEFAULT_STORE_MENU_CONFIG.root,
          ),
          category: normalizeMenuTemplate(
            store.menuConfig.category,
            DEFAULT_STORE_MENU_CONFIG.category,
          ),
          product: normalizeMenuTemplate(
            store.menuConfig.product,
            DEFAULT_STORE_MENU_CONFIG.product,
          ),
          iptv: normalizeMenuTemplate(
            store.menuConfig.iptv,
            DEFAULT_STORE_MENU_CONFIG.iptv,
          ),
          delivery: normalizeMenuTemplate(
            store.menuConfig.delivery,
            DEFAULT_STORE_MENU_CONFIG.delivery,
          ),
        }
      : normalizeStoreMenuConfig(payload.menuConfig);
  const previousImagePath = store.imagePath;
  const nextImagePath =
    payload.imagePath === undefined
      ? store.imagePath
      : cleanNullable(payload.imagePath, 2_000);
  const db = getDb();
  await db.query(
    `
      UPDATE bot_stores
      SET enabled = ?, auto_open_private = ?, name = ?, description = ?,
          image_path = ?, commands = ?, menu_config = ?,
          payment_provider = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [
      payload.enabled === undefined
        ? store.enabled
          ? 1
          : 0
        : payload.enabled
          ? 1
          : 0,
      payload.autoOpenPrivate === undefined
        ? store.autoOpenPrivate
          ? 1
          : 0
        : payload.autoOpenPrivate
          ? 1
          : 0,
      cleanText(payload.name, 160) || store.name,
      payload.description === undefined
        ? store.description
        : cleanNullable(payload.description),
      nextImagePath,
      JSON.stringify(commands.length ? commands : DEFAULT_STORE_COMMANDS),
      JSON.stringify(nextMenuConfig),
      ["mercadopago_pix", "polopag_pix"].includes(provider)
        ? provider
        : store.paymentProvider,
      store.id,
      userId,
    ],
  );
  if (previousImagePath && previousImagePath !== nextImagePath) {
    await deleteStoreUploadWhenUnused(previousImagePath);
  }
  return getBotStoreByInstance(instanceId);
};

export const saveBotStoreCategory = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const name = cleanText(payload.name, 160);
  if (!name) throw new Error("Informe o nome da categoria.");
  const id = toInt(payload.id);
  const db = getDb();
  let previousImagePath: string | null = null;
  if (id > 0) {
    const [currentRows] = await db.query<BotStoreCategoryRow[]>(
      "SELECT * FROM bot_store_categories WHERE id = ? AND store_id = ? LIMIT 1",
      [id, store.id],
    );
    if (!currentRows.length) throw new Error("Categoria não encontrada.");
    previousImagePath = currentRows[0].image_path;
    await db.query(
      `
        UPDATE bot_store_categories
        SET name = ?, description = ?, image_path = ?, position = ?, enabled = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ?
      `,
      [
        name,
        cleanNullable(payload.description),
        cleanNullable(payload.imagePath, 2_000),
        toInt(payload.position),
        payload.enabled === false ? 0 : 1,
        id,
        store.id,
      ],
    );
  } else {
    await db.query(
      `
        INSERT INTO bot_store_categories
          (store_id, name, description, image_path, position, enabled)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        store.id,
        name,
        cleanNullable(payload.description),
        cleanNullable(payload.imagePath, 2_000),
        toInt(payload.position),
        payload.enabled === false ? 0 : 1,
      ],
    );
  }
  const nextImagePath = cleanNullable(payload.imagePath, 2_000);
  if (previousImagePath && previousImagePath !== nextImagePath) {
    await deleteStoreUploadWhenUnused(previousImagePath);
  }
  return listBotStoreCategories(store.id);
};

export const deleteBotStoreCategory = async (
  userId: number,
  instanceId: number,
  categoryId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [categoryRows] = await db.query<BotStoreCategoryRow[]>(
    "SELECT * FROM bot_store_categories WHERE id = ? AND store_id = ? LIMIT 1",
    [categoryId, store.id],
  );
  await db.query(
    "UPDATE bot_store_products SET category_id = NULL WHERE store_id = ? AND category_id = ?",
    [store.id, categoryId],
  );
  await db.query(
    "DELETE FROM bot_store_categories WHERE id = ? AND store_id = ?",
    [categoryId, store.id],
  );
  await deleteStoreUploadWhenUnused(categoryRows[0]?.image_path);
};

export const saveBotStoreProduct = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const id = toInt(payload.id);
  let current: BotStoreProductRow | null = null;
  if (id > 0) {
    const [rows] = await db.query<BotStoreProductRow[]>(
      "SELECT * FROM bot_store_products WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1",
      [id, store.id],
    );
    current = rows[0] || null;
    if (!current) throw new Error("Produto não encontrado.");
  }
  const previousImagePath = current?.image_path || null;
  const name = cleanText(payload.name, 180);
  if (!name) throw new Error("Informe o nome do produto.");
  const priceCents =
    payload.priceCents !== undefined
      ? Math.max(0, toInt(payload.priceCents))
      : Math.max(0, Math.round(Number(payload.price || 0) * 100));
  const categoryId = toInt(payload.categoryId);
  const params = [
    categoryId > 0 ? categoryId : null,
    name,
    cleanNullable(payload.sku, 100),
    cleanNullable(payload.description),
    priceCents,
    payload.imagePath === undefined
      ? (current?.image_path ?? null)
      : cleanNullable(payload.imagePath, 2_000),
    payload.enabled === false ? 0 : 1,
    toInt(payload.position),
    JSON.stringify(
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : {},
    ),
  ];
  const nextImagePath = params[5] as string | null;
  if (id > 0) {
    await db.query(
      `
        UPDATE bot_store_products
        SET category_id = ?, name = ?, sku = ?, description = ?, price_cents = ?,
            image_path = ?, enabled = ?, position = ?, metadata = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ? AND deleted_at IS NULL
      `,
      [...params, id, store.id],
    );
  } else {
    await db.query(
      `
        INSERT INTO bot_store_products (
          category_id, name, sku, description, price_cents, image_path,
          enabled, position, metadata, store_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [...params, store.id],
    );
  }
  if (previousImagePath && previousImagePath !== nextImagePath) {
    await deleteStoreUploadWhenUnused(previousImagePath);
  }
  return listBotStoreProducts(store.id, { includeDisabled: true });
};

export const deleteBotStoreProduct = async (
  userId: number,
  instanceId: number,
  productId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [productRows] = await db.query<BotStoreProductRow[]>(
    "SELECT * FROM bot_store_products WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1",
    [productId, store.id],
  );
  if (!productRows.length) throw new Error("Produto não encontrado.");
  const [orders] = await db.query<Array<RowDataPacket & { total: number }>>(
    "SELECT COUNT(*) AS total FROM bot_store_orders WHERE store_id = ? AND product_id = ?",
    [store.id, productId],
  );
  if (Number(orders[0]?.total || 0) > 0) {
    await db.query(
      `UPDATE bot_store_products
       SET enabled = 0, deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ? AND deleted_at IS NULL`,
      [productId, store.id],
    );
    await db.query(
      `UPDATE bot_store_inventory_items
       SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ? AND product_id = ? AND deleted_at IS NULL`,
      [store.id, productId],
    );
    return;
  }
  const [inventoryRows] = await db.query<BotStoreInventoryRow[]>(
    "SELECT * FROM bot_store_inventory_items WHERE store_id = ? AND product_id = ?",
    [store.id, productId],
  );
  await db.query(
    `DELETE FROM bot_store_inventory_allocations
     WHERE store_id = ? AND inventory_id IN (
       SELECT id FROM bot_store_inventory_items
       WHERE store_id = ? AND product_id = ?
     )`,
    [store.id, store.id, productId],
  );
  await db.query(
    "DELETE FROM bot_store_inventory_items WHERE store_id = ? AND product_id = ?",
    [store.id, productId],
  );
  await db.query(
    "DELETE FROM bot_store_products WHERE id = ? AND store_id = ?",
    [productId, store.id],
  );
  const paths = new Set<string>();
  if (productRows[0]?.image_path) paths.add(productRows[0].image_path);
  for (const item of inventoryRows) {
    if (item.delivery_file_path) paths.add(item.delivery_file_path);
  }
  for (const filePath of paths) {
    await deleteStoreUploadWhenUnused(filePath);
  }
};

const normalizeInventoryType = (value: unknown) => {
  const type = cleanText(value, 30).toLowerCase();
  return ["code", "text", "url", "file", "license"].includes(type)
    ? type
    : "code";
};

const assertInventoryProduct = async (storeId: number, productId: number) => {
  const db = getDb();
  const [rows] = await db.query<BotStoreProductRow[]>(
    "SELECT * FROM bot_store_products WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1",
    [productId, storeId],
  );
  if (!rows.length) throw new Error("Produto do estoque não encontrado.");
  return mapProduct(rows[0]);
};

export const saveBotStoreInventory = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const productId = toInt(payload.productId);
  await assertInventoryProduct(store.id, productId);
  const itemType = normalizeInventoryType(payload.itemType);
  const label = cleanNullable(payload.label, 160);
  const sharedValue = cleanNullable(payload.deliveryValue, 30_000);
  const sharedFilePath = cleanNullable(payload.deliveryFilePath, 2_000);
  const sharedFileName = cleanNullable(payload.deliveryFileName, 255);
  const sharedMimeType = cleanNullable(payload.deliveryMimeType, 160);
  const sharedMaxUses = Math.max(
    1,
    Math.min(100_000, toInt(payload.maxUses, 1)),
  );
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  const values = Array.isArray(payload.values)
    ? payload.values
    : typeof payload.values === "string"
      ? payload.values.split(/\r?\n/)
      : [];
  const normalizedItems: Array<{
    itemType: string;
    label: string | null;
    deliveryValue: string | null;
    deliveryFilePath: string | null;
    deliveryFileName: string | null;
    deliveryMimeType: string | null;
    maxUses: number;
    metadata: JsonRecord;
  }> = requestedItems
    .map<JsonRecord>((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as JsonRecord)
        : { deliveryValue: entry },
    )
    .map((entry) => ({
      itemType: normalizeInventoryType(entry.itemType || itemType),
      label: cleanNullable(entry.label, 160) || label,
      deliveryValue: cleanNullable(entry.deliveryValue, 30_000) || sharedValue,
      deliveryFilePath:
        cleanNullable(entry.deliveryFilePath, 2_000) || sharedFilePath,
      deliveryFileName:
        cleanNullable(entry.deliveryFileName, 255) || sharedFileName,
      deliveryMimeType:
        cleanNullable(entry.deliveryMimeType, 160) || sharedMimeType,
      maxUses: Math.max(
        1,
        Math.min(100_000, toInt(entry.maxUses, sharedMaxUses)),
      ),
      metadata:
        entry.metadata && typeof entry.metadata === "object"
          ? (entry.metadata as JsonRecord)
          : {},
    }));
  for (const value of values) {
    const deliveryValue = cleanNullable(value, 30_000);
    if (!deliveryValue) continue;
    normalizedItems.push({
      itemType,
      label,
      deliveryValue,
      deliveryFilePath: sharedFilePath,
      deliveryFileName: sharedFileName,
      deliveryMimeType: sharedMimeType,
      maxUses: sharedMaxUses,
      metadata: {},
    });
  }
  if (!normalizedItems.length && (sharedValue || sharedFilePath)) {
    const quantity = Math.max(1, Math.min(1_000, toInt(payload.quantity, 1)));
    for (let index = 0; index < quantity; index += 1) {
      normalizedItems.push({
        itemType,
        label,
        deliveryValue: sharedValue,
        deliveryFilePath: sharedFilePath,
        deliveryFileName: sharedFileName,
        deliveryMimeType: sharedMimeType,
        maxUses: sharedMaxUses,
        metadata: {},
      });
    }
  }
  if (!normalizedItems.length) {
    throw new Error("Informe ao menos um item para abastecer o estoque.");
  }
  if (normalizedItems.length > 2_000) {
    throw new Error("Envie no máximo 2.000 itens por abastecimento.");
  }
  for (const item of normalizedItems) {
    if (item.itemType === "file" && !item.deliveryFilePath) {
      throw new Error("Selecione o arquivo que será entregue.");
    }
    if (item.itemType !== "file" && !item.deliveryValue) {
      throw new Error("Informe o conteúdo de cada item do estoque.");
    }
  }
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO bot_store_inventory_items (
           store_id, product_id, item_type, label, delivery_value,
           delivery_file_path, delivery_file_name, delivery_mime_type,
           status, max_uses, used_count, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, 0, ?)`,
        [
          store.id,
          productId,
          item.itemType,
          item.label,
          item.deliveryValue,
          item.deliveryFilePath,
          item.deliveryFileName,
          item.deliveryMimeType,
          item.maxUses,
          JSON.stringify(item.metadata),
        ],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return listBotStoreInventory(store.id, { productId, limit: 2_000 });
};

export const updateBotStoreInventoryItem = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const id = toInt(payload.id);
  const db = getDb();
  const [rows] = await db.query<BotStoreInventoryRow[]>(
    "SELECT * FROM bot_store_inventory_items WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1",
    [id, store.id],
  );
  const current = rows[0];
  if (!current) throw new Error("Item de estoque não encontrado.");
  if (current.status === "delivered") {
    throw new Error("Um item totalmente consumido não pode ser alterado.");
  }
  const itemType = normalizeInventoryType(
    payload.itemType || current.item_type,
  );
  const deliveryValue =
    payload.deliveryValue === undefined
      ? current.delivery_value
      : cleanNullable(payload.deliveryValue, 30_000);
  const deliveryFilePath =
    payload.deliveryFilePath === undefined
      ? current.delivery_file_path
      : cleanNullable(payload.deliveryFilePath, 2_000);
  if (itemType === "file" && !deliveryFilePath) {
    throw new Error("Selecione o arquivo que será entregue.");
  }
  if (itemType !== "file" && !deliveryValue) {
    throw new Error("Informe o conteúdo do item.");
  }
  const [reservedRows] = await db.query<
    Array<RowDataPacket & { reserved_uses: number }>
  >(
    `SELECT COALESCE(SUM(quantity), 0) AS reserved_uses
     FROM bot_store_inventory_allocations
     WHERE inventory_id = ? AND status = 'reserved'
       AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)`,
    [id],
  );
  const reservedUses = Number(reservedRows[0]?.reserved_uses || 0);
  const minimumUses = Math.max(
    1,
    Number(current.used_count || 0) + reservedUses,
  );
  const maxUses =
    payload.maxUses === undefined
      ? Math.max(1, Number(current.max_uses || 1))
      : Math.max(1, Math.min(100_000, toInt(payload.maxUses, 1)));
  if (maxUses < minimumUses) {
    throw new Error(
      `Este item já possui ${minimumUses} uso(s) consumido(s) ou reservado(s).`,
    );
  }
  await db.query(
    `UPDATE bot_store_inventory_items
     SET item_type = ?, label = ?, delivery_value = ?, delivery_file_path = ?,
         delivery_file_name = ?, delivery_mime_type = ?, max_uses = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ? AND deleted_at IS NULL`,
    [
      itemType,
      payload.label === undefined
        ? current.label
        : cleanNullable(payload.label, 160),
      deliveryValue,
      deliveryFilePath,
      payload.deliveryFileName === undefined
        ? current.delivery_file_name
        : cleanNullable(payload.deliveryFileName, 255),
      payload.deliveryMimeType === undefined
        ? current.delivery_mime_type
        : cleanNullable(payload.deliveryMimeType, 160),
      maxUses,
      id,
      store.id,
    ],
  );
  if (
    current.delivery_file_path &&
    current.delivery_file_path !== deliveryFilePath
  ) {
    await deleteStoreUploadWhenUnused(current.delivery_file_path);
  }
};

export const setBotStoreInventoryStatus = async (
  userId: number,
  instanceId: number,
  inventoryId: number,
  status: string,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const nextStatus = cleanText(status, 30).toLowerCase();
  if (!["available", "disabled"].includes(nextStatus)) {
    throw new Error("Status de estoque inválido.");
  }
  const db = getDb();
  await expireStoreInventoryAllocations(store.id);
  const [rows] = await db.query<
    Array<
      BotStoreInventoryRow & {
        reserved_uses: number;
      }
    >
  >(
    `SELECT item.*,
            COALESCE(SUM(
              CASE WHEN allocation.status = 'reserved'
                AND (allocation.expires_at IS NULL OR allocation.expires_at >= CURRENT_TIMESTAMP)
                THEN allocation.quantity ELSE 0 END
            ), 0) AS reserved_uses
     FROM bot_store_inventory_items item
     LEFT JOIN bot_store_inventory_allocations allocation
       ON allocation.inventory_id = item.id
     WHERE item.id = ? AND item.store_id = ? AND item.deleted_at IS NULL
     GROUP BY item.id
     LIMIT 1`,
    [inventoryId, store.id],
  );
  const item = rows[0];
  if (!item) throw new Error("Item de estoque não encontrado.");
  if (Number(item.used_count || 0) >= Number(item.max_uses || 1)) {
    throw new Error("Itens totalmente consumidos permanecem no histórico.");
  }
  if (nextStatus === "disabled" && Number(item.reserved_uses || 0) > 0) {
    throw new Error(
      "Este item está reservado em um pedido e não pode ser pausado agora.",
    );
  }
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE bot_store_inventory_items
     SET status = ?, order_id = NULL, reserved_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ? AND deleted_at IS NULL
       AND status IN ('available', 'disabled')
       AND used_count < max_uses`,
    [nextStatus, inventoryId, store.id],
  );
  if (!result.affectedRows) {
    throw new Error("Itens já entregues permanecem no histórico.");
  }
};

export const deleteBotStoreInventoryItem = async (
  userId: number,
  instanceId: number,
  inventoryId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [rows] = await db.query<BotStoreInventoryRow[]>(
    "SELECT * FROM bot_store_inventory_items WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1",
    [inventoryId, store.id],
  );
  const item = rows[0];
  if (!item) throw new Error("Item de estoque não encontrado.");
  const [allocationRows] = await db.query<
    Array<RowDataPacket & { total: number }>
  >(
    `SELECT COUNT(*) AS total
     FROM bot_store_inventory_allocations
     WHERE inventory_id = ? AND status IN ('reserved', 'delivered')`,
    [inventoryId],
  );
  if (
    Number(item.used_count || 0) > 0 ||
    Number(allocationRows[0]?.total || 0) > 0
  ) {
    await db.query(
      `UPDATE bot_store_inventory_items
       SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ? AND deleted_at IS NULL`,
      [inventoryId, store.id],
    );
    return;
  }
  await db.query(
    `DELETE FROM bot_store_inventory_allocations
     WHERE store_id = ? AND inventory_id = ?`,
    [store.id, inventoryId],
  );
  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM bot_store_inventory_items
     WHERE id = ? AND store_id = ? AND deleted_at IS NULL
       AND status IN ('available', 'disabled')
       AND used_count = 0`,
    [inventoryId, store.id],
  );
  if (!result.affectedRows) {
    throw new Error(
      "Somente itens disponíveis ou desativados podem ser excluídos.",
    );
  }
  await deleteStoreUploadWhenUnused(item.delivery_file_path);
};

const centralCatalogCache = new Map<
  number,
  { expiresAt: number; catalog: CentralCartCatalog }
>();

const centralFetch = async <T>(
  store: BotStore,
  endpoint: string,
  init?: RequestInit,
): Promise<T> => {
  const apiKey = store.centralCart.apiKey;
  if (!apiKey) throw new Error("Central Cart não configurada.");
  const response = await fetch(`${store.centralCart.apiBase}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const record = data && typeof data === "object" ? (data as JsonRecord) : {};
    throw new Error(
      cleanText(record.message, 500) ||
        `Central Cart retornou HTTP ${response.status}.`,
    );
  }
  return data as T;
};

const collectCategories = (items: CentralCartCategory[]) => {
  const result: CentralCartCategory[] = [];
  const visit = (list: CentralCartCategory[]) => {
    for (const item of list) {
      result.push(item);
      visit(item.sub_categories || []);
    }
  };
  visit(items);
  return result;
};

export const loadCentralCartCatalog = async (
  store: BotStore,
  force = false,
): Promise<CentralCartCatalog> => {
  const cached = centralCatalogCache.get(store.id);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.catalog;
  const [app, categories, packagesPayload] = await Promise.all([
    centralFetch<CentralCartApp>(store, "/app"),
    centralFetch<CentralCartCategory[]>(
      store,
      "/app/category?packages=true&include_subcategories=true",
    ),
    centralFetch<CentralCartPackage[] | { data?: CentralCartPackage[] }>(
      store,
      "/package?all=true",
    ),
  ]);
  const allCategories = collectCategories(categories);
  const packageMap = new Map<string, CentralCartPackage>();
  for (const category of allCategories) {
    for (const item of category.packages || []) {
      const id = normalizeId(item.id);
      if (id) packageMap.set(id, { ...(packageMap.get(id) || {}), ...item });
    }
  }
  const flat = Array.isArray(packagesPayload)
    ? packagesPayload
    : packagesPayload.data || [];
  for (const item of flat) {
    const id = normalizeId(item.id);
    if (id) packageMap.set(id, { ...(packageMap.get(id) || {}), ...item });
  }
  const catalog = {
    app,
    categories,
    allCategories,
    packages: Array.from(packageMap.values()).sort(
      (a, b) => Number(a.position || 0) - Number(b.position || 0),
    ),
  };
  centralCatalogCache.set(store.id, {
    expiresAt: Date.now() + STORE_CACHE_TTL_MS,
    catalog,
  });
  return catalog;
};

const centralWebhookEndpoint = (instanceId: number) => {
  const base = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://botadmin.shop"
  ).replace(/\/+$/, "");
  return `${base}/api/webhooks/central-cart/${instanceId}`;
};

const configureCentralWebhook = async (store: BotStore) => {
  const url = centralWebhookEndpoint(store.instanceId);
  const name = `${store.name || "BotAdmin"} - Central Cart`;
  const existing = await centralFetch<Array<JsonRecord>>(
    store,
    "/app/webhooks",
  );
  const current = existing.find((entry) => cleanText(entry.url, 2_000) === url);
  const body = JSON.stringify({
    name,
    url,
    scopes: CENTRAL_CART_WEBHOOK_SCOPES,
  });
  const webhook =
    current && normalizeId(current.id)
      ? await centralFetch<JsonRecord>(
          store,
          `/app/webhooks/${normalizeId(current.id)}`,
          {
            method: "PATCH",
            body,
          },
        )
      : await centralFetch<JsonRecord>(store, "/app/webhooks", {
          method: "POST",
          body,
        });
  return {
    ...webhook,
    url,
    secret:
      cleanText(webhook.secret, 2_000) ||
      cleanText(current?.secret, 2_000) ||
      null,
  };
};

export const connectBotStoreCentralCart = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const apiKey =
    cleanText(payload.apiKey, 4_000) || store.centralCart.apiKey || "";
  if (!apiKey) throw new Error("Informe a chave da API da Central Cart.");
  const apiBase = cleanText(payload.apiBase, 255) || CENTRAL_CART_API_BASE;
  const mode = payload.mode === "import" ? "import" : "live";
  const gateway =
    cleanText(payload.checkoutGateway ?? payload.gateway, 40).toUpperCase() ||
    "OTHER";
  const db = getDb();
  await db.query(
    `
      UPDATE bot_stores
      SET central_cart_api_key = ?, central_cart_api_base = ?,
          central_cart_mode = ?, central_cart_gateway = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [apiKey, apiBase, mode, gateway, store.id, userId],
  );
  const connected = await getBotStoreByInstance(instanceId);
  if (!connected) throw new Error("Não foi possível salvar a Central Cart.");
  const catalog = await loadCentralCartCatalog(connected, true);
  const webhook = await configureCentralWebhook(connected);
  await db.query(
    `
      UPDATE bot_stores
      SET central_cart_app = ?, central_cart_webhook = ?,
          central_cart_last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(catalog.app || {}), JSON.stringify(webhook), connected.id],
  );
  centralCatalogCache.delete(connected.id);
  return getBotStoreSnapshot(userId, instanceId);
};

export const disconnectBotStoreCentralCart = async (
  userId: number,
  instanceId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) return;
  const db = getDb();
  await db.query(
    `
      UPDATE bot_stores
      SET central_cart_api_key = NULL, central_cart_app = NULL,
          central_cart_webhook = NULL, central_cart_last_sync_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [store.id, userId],
  );
  centralCatalogCache.delete(store.id);
};

const wwPanelApiKeyForStore = async (storeId: number) => {
  const integration = await getWwPanelIntegration(storeId);
  if (!integration?.enabled || !integration.apiKey) {
    throw new Error("WWPanel não está conectado ou está pausado.");
  }
  return integration.apiKey;
};

export const connectBotStoreWwPanel = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const current = await getWwPanelIntegration(store.id);
  const apiKey =
    cleanText(payload.apiKey, 16_000) || current?.apiKey || "";
  if (!apiKey) throw new Error("Informe a API key do WWPanel.");
  const account = await getWwPanelAccount(apiKey);
  const encrypted = encryptWwPanelSecret(apiKey);
  const hint = `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`;
  const enabled = payload.enabled === undefined ? true : bool(payload.enabled);
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_store_wwpanel_integrations (
        store_id, enabled, api_key_encrypted, api_key_hint,
        account_snapshot, last_verified_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        api_key_encrypted = VALUES(api_key_encrypted),
        api_key_hint = VALUES(api_key_hint),
        account_snapshot = VALUES(account_snapshot),
        last_verified_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `,
    [store.id, enabled ? 1 : 0, encrypted, hint, JSON.stringify(account)],
  );
  await seedDefaultWwPanelOffers(store.id);
};

export const disconnectBotStoreWwPanel = async (
  userId: number,
  instanceId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) return;
  const db = getDb();
  await db.query(
    `UPDATE bot_store_wwpanel_integrations
     SET enabled = 0, api_key_encrypted = NULL, api_key_hint = NULL,
         account_snapshot = NULL, last_verified_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ?`,
    [store.id],
  );
};

export const saveBotStoreWwPanelOffer = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const id = Math.max(0, toInt(payload.id));
  const name = cleanText(payload.name, 180);
  if (!name) throw new Error("Informe o nome da oferta IPTV.");
  const priceCents = Math.max(
    0,
    toInt(
      payload.priceCents ??
        Math.round(Number(payload.price || 0) * 100),
    ),
  );
  const isTrial = bool(payload.isTrial);
  const days = Math.max(0, toInt(payload.days));
  const months = Math.max(0, toInt(payload.months));
  if (!isTrial && days <= 0 && months <= 0) {
    throw new Error("Informe a validade da oferta em dias ou meses.");
  }
  const catalog = wwPanelPublicCatalog();
  const planId = toInt(payload.planId, 2);
  const packageIptv = toInt(payload.packageIptv, 30);
  const packageP2p =
    cleanText(payload.packageP2p, 64) || "64399dca5ea59e8a1de2b083";
  if (!catalog.plans.some((entry) => entry.id === planId)) {
    throw new Error("Plano WWPanel inválido.");
  }
  if (!catalog.iptvPackages.some((entry) => entry.id === packageIptv)) {
    throw new Error("Pacote IPTV inválido.");
  }
  if (!catalog.p2pPackages.some((entry) => entry.id === packageP2p)) {
    throw new Error("Pacote P2P inválido.");
  }
  const addons = Array.isArray(payload.addons)
    ? payload.addons
        .map(Number)
        .filter(
          (value, index, list) =>
            Number.isFinite(value) &&
            catalog.addons.some((entry) => entry.id === value) &&
            list.indexOf(value) === index,
        )
    : [];
  const imagePath = cleanNullable(payload.imagePath, 2_000);
  const values = [
    name,
    cleanNullable(payload.description, 8_000),
    priceCents,
    imagePath,
    bool(payload.enabled) ? 1 : 0,
    Math.max(0, toInt(payload.position)),
    isTrial ? 1 : 0,
    days > 0 ? days : null,
    months > 0 ? months : null,
    planId,
    packageP2p,
    packageIptv,
    Math.max(1, toInt(payload.accessIptv, 1)),
    Math.max(0, toInt(payload.accessNexus)),
    JSON.stringify(addons),
    cleanText(payload.country, 100) || "Brasil",
  ];
  const db = getDb();
  let previousImagePath: string | null = null;
  if (id) {
    const [rows] = await db.query<BotStoreWwPanelOfferRow[]>(
      "SELECT * FROM bot_store_wwpanel_offers WHERE id = ? AND store_id = ? LIMIT 1",
      [id, store.id],
    );
    if (!rows.length) throw new Error("Oferta IPTV não encontrada.");
    previousImagePath = rows[0].image_path;
    await db.query(
      `UPDATE bot_store_wwpanel_offers
       SET name = ?, description = ?, price_cents = ?, image_path = ?,
           enabled = ?, position = ?, is_trial = ?, days = ?, months = ?,
           plan_id = ?, package_p2p = ?, package_iptv = ?,
           access_iptv = ?, access_nexus = ?, addons = ?, country = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [...values, id, store.id],
    );
  } else {
    await db.query(
      `INSERT INTO bot_store_wwpanel_offers (
         store_id, name, description, price_cents, image_path, enabled,
         position, is_trial, days, months, plan_id, package_p2p,
         package_iptv, access_iptv, access_nexus, addons, country
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [store.id, ...values],
    );
  }
  if (previousImagePath && previousImagePath !== imagePath) {
    await deleteStoreUploadWhenUnused(previousImagePath);
  }
};

export const deleteBotStoreWwPanelOffer = async (
  userId: number,
  instanceId: number,
  offerId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelOfferRow[]>(
    "SELECT * FROM bot_store_wwpanel_offers WHERE id = ? AND store_id = ? LIMIT 1",
    [offerId, store.id],
  );
  if (!rows.length) throw new Error("Oferta IPTV não encontrada.");
  const [clientRows] = await db.query<Array<RowDataPacket & { total: number }>>(
    "SELECT COUNT(*) AS total FROM bot_store_wwpanel_clients WHERE offer_id = ? AND store_id = ?",
    [offerId, store.id],
  );
  if (Number(clientRows[0]?.total || 0) > 0) {
    await db.query(
      `UPDATE bot_store_wwpanel_offers
       SET enabled = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [offerId, store.id],
    );
    return;
  }
  await db.query(
    "DELETE FROM bot_store_wwpanel_offers WHERE id = ? AND store_id = ?",
    [offerId, store.id],
  );
  await deleteStoreUploadWhenUnused(rows[0].image_path);
};

const getOwnedWwPanelClient = async (
  userId: number,
  instanceId: number,
  clientId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelClientRow[]>(
    "SELECT * FROM bot_store_wwpanel_clients WHERE id = ? AND store_id = ? LIMIT 1",
    [clientId, store.id],
  );
  if (!rows.length) throw new Error("Cliente IPTV não encontrado.");
  return { store, row: rows[0], apiKey: await wwPanelApiKeyForStore(store.id) };
};

export const revealBotStoreWwPanelClientPassword = async (
  userId: number,
  instanceId: number,
  clientId: number,
) => {
  const { row } = await getOwnedWwPanelClient(
    userId,
    instanceId,
    clientId,
  );
  if (row.status === "deleted" || row.status === "cancelled") {
    throw new Error("Este acesso IPTV não está mais disponível.");
  }
  const password = decryptWwPanelSecret(row.password_encrypted);
  if (!password) throw new Error("Senha IPTV não encontrada.");
  return password;
};

export const manageBotStoreWwPanelClient = async (
  userId: number,
  instanceId: number,
  action: string,
  payload: JsonRecord,
) => {
  const clientId = Math.max(0, toInt(payload.clientId));
  const { store, row, apiKey } = await getOwnedWwPanelClient(
    userId,
    instanceId,
    clientId,
  );
  const db = getDb();
  if (action === "renew_wwpanel_client") {
    const days = Math.max(0, toInt(payload.days));
    const months = Math.max(0, toInt(payload.months));
    if (!days && !months) throw new Error("Informe dias ou meses para renovar.");
    const updated = await extendWwPanelClient(apiKey, row.external_id, {
      ...(months > 0 ? { months } : { days }),
    });
    await db.query(
      `UPDATE bot_store_wwpanel_clients
       SET password_encrypted = ?, expires_at = ?, provider_payload = ?,
           status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [
        encryptWwPanelSecret(updated.password),
        updated.expDate,
        JSON.stringify(updated.raw),
        row.id,
        store.id,
      ],
    );
  } else if (action === "edit_wwpanel_client") {
    const password =
      cleanText(payload.password, 255) ||
      decryptWwPanelSecret(row.password_encrypted);
    const whatsapp =
      cleanText(payload.whatsapp, 64) || row.customer_phone || "";
    const country = cleanText(payload.country, 100) || "Brasil";
    const saleValue =
      payload.saleValue === undefined || payload.saleValue === null
        ? undefined
        : Math.max(0, Number(payload.saleValue || 0));
    const updated = await editWwPanelClient(apiKey, row.external_id, {
      password,
      whatsapp,
      country,
      notes: cleanText(payload.notes, 1_000),
      sale_value: saleValue,
    });
    await db.query(
      `UPDATE bot_store_wwpanel_clients
       SET password_encrypted = ?, customer_phone = ?, provider_payload = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [
        encryptWwPanelSecret(password),
        normalizePhone(whatsapp),
        JSON.stringify(updated),
        row.id,
        store.id,
      ],
    );
  } else if (action === "recreate_wwpanel_client") {
    const password = cleanText(payload.password, 255);
    if (!password) throw new Error("Informe a nova senha.");
    const updated = await recreateWwPanelClient(
      apiKey,
      row.external_id,
      password,
    );
    await db.query(
      `UPDATE bot_store_wwpanel_clients
       SET password_encrypted = ?, provider_payload = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [
        encryptWwPanelSecret(updated.password),
        JSON.stringify(updated.raw),
        row.id,
        store.id,
      ],
    );
  } else if (action === "delete_wwpanel_client") {
    await deleteWwPanelClient(apiKey, row.external_id);
    await db.query(
      `UPDATE bot_store_wwpanel_clients
       SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [row.id, store.id],
    );
  } else if (action === "manage_wwpanel_plan") {
    await manageWwPanelClientPlan(apiKey, row.external_id, {
      planId: toInt(payload.planId, 2),
      access: Math.max(1, toInt(payload.accessIptv, 1)),
      access_nexus: Math.max(0, toInt(payload.accessNexus)),
      package_p2p: cleanText(payload.packageP2p, 64),
      package_iptv: toInt(payload.packageIptv, 30),
      addons: Array.isArray(payload.addons)
        ? payload.addons.map(Number).filter(Number.isFinite)
        : [],
    });
  } else if (action === "activate_wwpanel_app") {
    const nameApp = cleanText(payload.nameApp, 40);
    if (!isWwPanelAppName(nameApp)) {
      throw new Error("Aplicativo WWPanel inválido.");
    }
    const mac = cleanText(payload.mac, 100);
    const namePlaylist = cleanText(payload.namePlaylist, 180);
    if (!mac || !namePlaylist) {
      throw new Error("Informe o identificador e o nome da playlist.");
    }
    await activateWwPanelApp(apiKey, {
      clientId: row.external_id,
      nameApp,
      mac,
      namePlaylist,
    });
  } else {
    throw new Error("Ação WWPanel inválida.");
  }
};

const requireSmmIntegration = async (storeId: number) => {
  const integration = await getSmmIntegration(storeId);
  if (!integration?.enabled || !integration.apiKey) {
    throw new Error("Painel SMM não está conectado ou está pausado.");
  }
  return integration;
};

const syncSmmCatalog = async (
  integration: BotStoreSmmIntegration,
  _options: { enableNewServices?: boolean } = {},
) => {
  if (!integration.apiKey) throw new Error("Informe a API key do painel SMM.");
  const services = await getSmmServices(
    integration.apiKey,
    integration.apiBase,
  );
  const db = getDb();
  for (let offset = 0; offset < services.length; offset += 200) {
    const chunk = services.slice(offset, offset + 200);
    const values = chunk.map((service) => [
      integration.storeId,
      service.service,
      service.name,
      service.category,
      service.type,
      service.rate,
      service.min,
      service.max,
      service.refill ? 1 : 0,
      service.cancel ? 1 : 0,
      service.dripfeed ? 1 : 0,
      0,
      JSON.stringify(service.raw),
    ]);
    await db.query(
      `INSERT INTO bot_store_smm_services (
         store_id, provider_service_id, name, category, service_type,
         provider_rate, min_quantity, max_quantity, refill, cancel, dripfeed,
         enabled, provider_snapshot
       ) VALUES ${values
         .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
         .join(", ")}
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         category = VALUES(category),
         service_type = VALUES(service_type),
         provider_rate = VALUES(provider_rate),
         min_quantity = VALUES(min_quantity),
         max_quantity = VALUES(max_quantity),
         refill = VALUES(refill),
         cancel = VALUES(cancel),
         dripfeed = VALUES(dripfeed),
         provider_snapshot = VALUES(provider_snapshot),
         updated_at = CURRENT_TIMESTAMP`,
      values.flat(),
    );
  }
  await db.query(
    `UPDATE bot_store_smm_integrations
     SET last_catalog_sync_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ?`,
    [integration.storeId],
  );
  return services.length;
};

export const connectBotStoreSmm = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId, true);
  if (!store) throw new Error("Loja não encontrada.");
  const current = await getSmmIntegration(store.id);
  const apiKey = cleanText(payload.apiKey, 16_000) || current?.apiKey || "";
  if (!apiKey) throw new Error("Informe a API key da SMMHype.");
  const balance = await getSmmBalance(apiKey, SMMHYPE_API_BASE);
  const fxMode =
    cleanText(payload.fxMode, 20).toLowerCase() === "manual"
      ? "manual"
      : "auto";
  let usdBrlRate = Math.max(
    0.01,
    Number(payload.usdBrlRate || current?.usdBrlRate || 5.5),
  );
  let refreshedFx = false;
  if (fxMode === "auto") {
    try {
      const fx = await fetchUsdBrlRate();
      usdBrlRate = fx.rate;
      refreshedFx = true;
    } catch {
      // Keep the last persisted quote so a temporary FX outage cannot stop sales.
    }
  }
  const markupPercent = Math.max(
    0,
    Math.min(
      10_000,
      Number(payload.markupPercent ?? current?.markupPercent ?? 40),
    ),
  );
  const fixedMarkupCents = Math.max(
    0,
    toInt(payload.fixedMarkupCents, current?.fixedMarkupCents || 0),
  );
  const minimumProfitCents = Math.max(
    0,
    toInt(payload.minimumProfitCents, current?.minimumProfitCents || 100),
  );
  const enabled = payload.enabled === undefined ? true : bool(payload.enabled);
  const encrypted = encryptSmmSecret(apiKey);
  const hint = `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`;
  const db = getDb();
  await db.query(
    `INSERT INTO bot_store_smm_integrations (
       store_id, enabled, api_base, api_key_encrypted, api_key_hint,
       provider_balance, provider_currency, fx_mode, usd_brl_rate,
       markup_percent, fixed_markup_cents, minimum_profit_cents,
       last_fx_at, last_verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${
       refreshedFx ? "CURRENT_TIMESTAMP" : "NULL"
     }, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       api_base = VALUES(api_base),
       api_key_encrypted = VALUES(api_key_encrypted),
       api_key_hint = VALUES(api_key_hint),
       provider_balance = VALUES(provider_balance),
       provider_currency = VALUES(provider_currency),
       fx_mode = VALUES(fx_mode),
       usd_brl_rate = VALUES(usd_brl_rate),
       markup_percent = VALUES(markup_percent),
       fixed_markup_cents = VALUES(fixed_markup_cents),
       minimum_profit_cents = VALUES(minimum_profit_cents),
       last_fx_at = ${
         refreshedFx ? "CURRENT_TIMESTAMP" : "last_fx_at"
       },
       last_verified_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [
      store.id,
      enabled ? 1 : 0,
      SMMHYPE_API_BASE,
      encrypted,
      hint,
      balance.balance,
      balance.currency,
      fxMode,
      usdBrlRate,
      markupPercent,
      fixedMarkupCents,
      minimumProfitCents,
    ],
  );
  const integration = await getSmmIntegration(store.id);
  if (!integration) throw new Error("Não foi possível salvar a integração SMM.");
  const synced =
    payload.syncCatalog === false
      ? 0
      : await syncSmmCatalog(integration, {
          enableNewServices:
            payload.enableNewServices === undefined
              ? true
              : bool(payload.enableNewServices),
        });
  return { balance, synced };
};

export const disconnectBotStoreSmm = async (
  userId: number,
  instanceId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) return;
  const db = getDb();
  await db.query(
    `UPDATE bot_store_smm_integrations
     SET enabled = 0, api_key_encrypted = NULL, api_key_hint = NULL,
         provider_balance = NULL, last_verified_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ?`,
    [store.id],
  );
};

export const syncBotStoreSmm = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const integration = await requireSmmIntegration(store.id);
  const balance = await getSmmBalance(
    integration.apiKey!,
    integration.apiBase,
  );
  const usdBrlRate = await refreshSmmFxRate(integration, true);
  const synced = await syncSmmCatalog(
    { ...integration, usdBrlRate },
    { enableNewServices: bool(payload.enableNewServices) },
  );
  const db = getDb();
  await db.query(
    `UPDATE bot_store_smm_integrations
     SET provider_balance = ?, provider_currency = ?,
         last_verified_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ?`,
    [balance.balance, balance.currency, store.id],
  );
  return { balance, synced, usdBrlRate };
};

export const saveBotStoreSmmService = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const serviceId = toInt(payload.serviceId || payload.id);
  if (!serviceId) throw new Error("Serviço SMM inválido.");
  const current = await getSmmService(store.id, serviceId);
  if (!current) throw new Error("Serviço SMM não encontrado.");
  const customSaleRateCents =
    payload.customSaleRateCents === null ||
    payload.customSaleRateCents === undefined ||
    String(payload.customSaleRateCents).trim() === ""
      ? null
      : Math.max(1, toInt(payload.customSaleRateCents));
  const name = Object.prototype.hasOwnProperty.call(payload, "name")
    ? cleanNullable(payload.name, 500)
    : current.name;
  const category = Object.prototype.hasOwnProperty.call(payload, "category")
    ? cleanNullable(payload.category, 500)
    : current.category;
  const description = Object.prototype.hasOwnProperty.call(
    payload,
    "description",
  )
    ? cleanNullable(payload.description, 8_000)
    : current.description;
  const requestedMin = Math.max(
    current.providerMin,
    toInt(payload.min, current.min),
  );
  const requestedMax = Math.min(
    current.providerMax,
    toInt(payload.max, current.max),
  );
  if (requestedMin > requestedMax) {
    throw new Error(
      `O limite mínimo deve ficar entre ${current.providerMin} e ${current.providerMax}.`,
    );
  }
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE bot_store_smm_services
     SET custom_name = ?, custom_category = ?, custom_description = ?,
         sale_min_quantity = ?, sale_max_quantity = ?,
         enabled = ?, position = ?, custom_sale_rate_cents = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ? AND imported = 1`,
    [
      name,
      category,
      description,
      requestedMin,
      requestedMax,
      bool(payload.enabled) ? 1 : 0,
      toInt(payload.position),
      customSaleRateCents,
      serviceId,
      store.id,
    ],
  );
  if (!result.affectedRows) throw new Error("Serviço SMM não encontrado.");
};

export const searchBotStoreSmmCatalog = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const integration = await requireSmmIntegration(store.id);
  const query = cleanText(payload.query, 500);
  const category = cleanNullable(payload.category, 500);
  const exactId = /^\d+$/.test(query) ? Number(query) : 0;
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  const filters = ["store_id = ?"];
  const values: Array<string | number> = [store.id];
  if (category) {
    filters.push("category = ?");
    values.push(category);
  }
  if (query) {
    filters.push(
      exactId
        ? "(provider_service_id = ? OR name LIKE ? OR category LIKE ?)"
        : "(name LIKE ? OR category LIKE ?)",
    );
    if (exactId) values.push(exactId);
    values.push(like, like);
  }
  const limit = Math.max(1, Math.min(200, toInt(payload.limit, 100)));
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmServiceRow[]>(
    `SELECT * FROM bot_store_smm_services
     WHERE ${filters.join(" AND ")}
     ORDER BY imported ASC, category ASC, name ASC
     LIMIT ?`,
    [...values, limit],
  );
  return {
    services: rows.map((row) => mapSmmService(row, integration)),
    total: await countSmmCatalog(store.id),
  };
};

export const importBotStoreSmmServices = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const integration = await requireSmmIntegration(store.id);
  const providerServiceIds = Array.from(
    new Set(
      (Array.isArray(payload.providerServiceIds)
        ? payload.providerServiceIds
        : [payload.providerServiceId]
      )
        .map((value) => toInt(value))
        .filter((value) => value > 0),
    ),
  ).slice(0, 500);
  if (!providerServiceIds.length) {
    throw new Error("Selecione pelo menos um serviço da API.");
  }
  await syncSmmCatalog(integration);
  const db = getDb();
  let imported = 0;
  for (let offset = 0; offset < providerServiceIds.length; offset += 200) {
    const chunk = providerServiceIds.slice(offset, offset + 200);
    const [result] = await db.query<ResultSetHeader>(
      `UPDATE bot_store_smm_services
       SET imported = 1, enabled = 1, updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ?
         AND provider_service_id IN (${chunk.map(() => "?").join(", ")})`,
      [store.id, ...chunk],
    );
    imported += Number(result.affectedRows || 0);
  }
  if (!imported) {
    throw new Error("Nenhum dos serviços selecionados existe na SMMHype.");
  }
  return { imported };
};

export const deleteBotStoreSmmService = async (
  userId: number,
  instanceId: number,
  serviceId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE bot_store_smm_services
     SET imported = 0, enabled = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ? AND imported = 1`,
    [serviceId, store.id],
  );
  if (!result.affectedRows) throw new Error("Serviço SMM não encontrado.");
};

export const deleteBotStoreSmmServices = async (
  userId: number,
  instanceId: number,
  serviceIds: number[],
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const ids = Array.from(
    new Set(
      serviceIds
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).slice(0, 1_000);
  if (!ids.length) throw new Error("Selecione ao menos um serviço SMM.");
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE bot_store_smm_services
     SET imported = 0, enabled = 0, updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ? AND imported = 1
       AND id IN (${ids.map(() => "?").join(", ")})`,
    [store.id, ...ids],
  );
  return { deleted: Number(result.affectedRows || 0) };
};

export const bulkUpdateBotStoreSmmServices = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const category = cleanNullable(payload.category, 500);
  const enabled = bool(payload.enabled);
  const db = getDb();
  await db.query(
    `UPDATE bot_store_smm_services
     SET enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ? AND imported = 1
       ${category ? "AND COALESCE(custom_category, category) = ?" : ""}`,
    category
      ? [enabled ? 1 : 0, store.id, category]
      : [enabled ? 1 : 0, store.id],
  );
};

const getSmmOrderById = async (storeId: number, smmOrderId: number) => {
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmOrderRow[]>(
    `SELECT smm.*, service.name AS service_name,
            service.category AS service_category,
            service.service_type AS service_type
     FROM bot_store_smm_orders smm
     LEFT JOIN bot_store_smm_services service
       ON service.id = smm.service_id AND service.store_id = smm.store_id
     WHERE smm.id = ? AND smm.store_id = ?
     LIMIT 1`,
    [smmOrderId, storeId],
  );
  return rows[0] ? mapSmmOrder(rows[0]) : null;
};

const syncSmmOrderStatus = async (
  integration: BotStoreSmmIntegration,
  smmOrderId: number,
) => {
  const order = await getSmmOrderById(integration.storeId, smmOrderId);
  if (!order?.providerOrderId) {
    throw new Error("O pedido ainda não foi enviado ao painel SMM.");
  }
  const remote = await getSmmOrderStatus(
    integration.apiKey!,
    order.providerOrderId,
    integration.apiBase,
  );
  const db = getDb();
  await db.query(
    `UPDATE bot_store_smm_orders
     SET status = ?, start_count = ?, remains = ?,
         provider_cost = COALESCE(?, provider_cost),
         provider_currency = COALESCE(?, provider_currency),
         provider_snapshot = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ?`,
    [
      remote.status,
      remote.startCount,
      remote.remains,
      remote.charge,
      remote.currency,
      JSON.stringify(remote.raw),
      order.id,
      integration.storeId,
    ],
  );
  return remote;
};

export const manageBotStoreSmmOrder = async (
  userId: number,
  instanceId: number,
  action: string,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const integration = await requireSmmIntegration(store.id);
  const smmOrderId = toInt(payload.smmOrderId || payload.orderId);
  const order = await getSmmOrderById(store.id, smmOrderId);
  if (!order) throw new Error("Pedido SMM não encontrado.");
  const db = getDb();
  if (action === "sync_smm_order") {
    await syncSmmOrderStatus(integration, order.id);
    return;
  }
  if (!order.providerOrderId) {
    throw new Error("O pedido ainda não foi enviado ao painel SMM.");
  }
  if (action === "refill_smm_order") {
    const service = await getSmmService(store.id, order.serviceId);
    if (!service?.refill) throw new Error("Este serviço não aceita reposição.");
    const refill = await requestSmmRefill(
      integration.apiKey!,
      order.providerOrderId,
      integration.apiBase,
    );
    await db.query(
      `UPDATE bot_store_smm_orders
       SET refill_id = ?, refill_status = 'Pending',
           provider_snapshot = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [refill.refill, JSON.stringify(refill.raw), order.id, store.id],
    );
    return;
  }
  if (action === "sync_smm_refill") {
    if (!order.refillId) throw new Error("Este pedido não possui reposição.");
    const status = await getSmmRefillStatus(
      integration.apiKey!,
      order.refillId,
      integration.apiBase,
    );
    await db.query(
      `UPDATE bot_store_smm_orders
       SET refill_status = ?, provider_snapshot = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [
        cleanText(status.status, 100) || "Unknown",
        JSON.stringify(status),
        order.id,
        store.id,
      ],
    );
    return;
  }
  if (action === "cancel_smm_order") {
    const service = await getSmmService(store.id, order.serviceId);
    if (!service?.cancel) throw new Error("Este serviço não aceita cancelamento.");
    const result = await cancelSmmOrders(
      integration.apiKey!,
      [order.providerOrderId],
      integration.apiBase,
    );
    await db.query(
      `UPDATE bot_store_smm_orders
       SET status = 'Cancel requested', provider_snapshot = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [JSON.stringify(result), order.id, store.id],
    );
    return;
  }
  throw new Error("Ação SMM inválida.");
};

const getLocalProduct = async (
  storeId: number,
  productId: number,
  options: { includeDeleted?: boolean } = {},
) => {
  const products = await listBotStoreProducts(storeId, {
    includeDisabled: true,
    includeDeleted: options.includeDeleted,
  });
  return products.find((product) => product.id === productId) || null;
};

const getWwPanelOffer = async (storeId: number, offerId: number) => {
  const offers = await listWwPanelOffers(storeId, true);
  return offers.find((offer) => offer.id === offerId) || null;
};

const getStoreCustomerState = async (
  storeId: number,
  customerJid: string,
) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<
    Array<
      RowDataPacket & {
        state_key: string;
        payload: string | null;
        expires_at: Date | string;
      }
    >
  >(
    `SELECT state_key, payload, expires_at
     FROM bot_store_customer_states
     WHERE store_id = ? AND customer_jid = ? AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [storeId, customerJid],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    key: row.state_key,
    payload: parseJson<JsonRecord>(row.payload, {}),
  };
};

const setStoreCustomerState = async (
  storeId: number,
  customerJid: string,
  key: string,
  payload: JsonRecord,
) => {
  await runEnsure();
  const db = getDb();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);
  await db.query(
    `INSERT INTO bot_store_customer_states (
       store_id, customer_jid, state_key, payload, expires_at
     ) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       state_key = VALUES(state_key), payload = VALUES(payload),
       expires_at = VALUES(expires_at), updated_at = CURRENT_TIMESTAMP`,
    [storeId, customerJid, key, JSON.stringify(payload), expiresAt],
  );
};

const clearStoreCustomerState = async (
  storeId: number,
  customerJid: string,
) => {
  const db = getDb();
  await db.query(
    "DELETE FROM bot_store_customer_states WHERE store_id = ? AND customer_jid = ?",
    [storeId, customerJid],
  );
};

const customerAlreadyUsedWwPanelTrial = async (
  storeId: number,
  customerJid: string,
) => {
  const db = getDb();
  const phone = normalizePhone(customerJid);
  const [rows] = await db.query<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total
     FROM bot_store_wwpanel_clients c
     INNER JOIN bot_store_wwpanel_offers o
       ON o.id = c.offer_id AND o.store_id = c.store_id
     WHERE c.store_id = ? AND o.is_trial = 1
       AND c.status NOT IN ('deleted', 'cancelled')
       AND (c.customer_jid = ? OR (? <> '' AND c.customer_phone = ?))`,
    [storeId, customerJid, phone, phone],
  );
  return Number(rows[0]?.total || 0) > 0;
};

const createOrder = async (payload: {
  storeId: number;
  productId?: number | null;
  provider: string;
  externalOrderId?: string | null;
  customerJid: string;
  customerName?: string | null;
  quantity?: number;
  totalCents: number;
  status?: string;
  paymentChargePublicId?: string | null;
  checkoutUrl?: string | null;
  metadata?: JsonRecord;
}) => {
  await runEnsure();
  const publicId = randomUUID();
  const db = getDb();
  const customerPhone = normalizePhone(payload.customerJid) || null;
  await db.query(
    `
      INSERT INTO bot_store_customers (
        store_id, customer_jid, customer_name, customer_phone, last_order_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        customer_name = COALESCE(NULLIF(VALUES(customer_name), ''), customer_name),
        customer_phone = COALESCE(NULLIF(VALUES(customer_phone), ''), customer_phone),
        last_order_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      payload.storeId,
      payload.customerJid,
      payload.customerName || null,
      customerPhone,
    ],
  );
  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_store_orders (
        public_id, store_id, product_id, provider, external_order_id,
        customer_jid, customer_name, customer_phone, quantity, total_cents,
        status, payment_charge_public_id, checkout_url, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      publicId,
      payload.storeId,
      payload.productId || null,
      payload.provider,
      payload.externalOrderId || null,
      payload.customerJid,
      payload.customerName || null,
      customerPhone,
      Math.max(1, payload.quantity || 1),
      Math.max(0, payload.totalCents),
      payload.status || "pending",
      payload.paymentChargePublicId || null,
      payload.checkoutUrl || null,
      JSON.stringify(payload.metadata || {}),
    ],
  );
  const [rows] = await db.query<BotStoreOrderRow[]>(
    "SELECT * FROM bot_store_orders WHERE public_id = ? LIMIT 1",
    [publicId],
  );
  return mapOrder(rows[0]);
};

export const updateBotStoreCustomer = async (
  userId: number,
  instanceId: number,
  payload: JsonRecord,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const customerJid = cleanText(payload.customerJid, 160);
  if (!customerJid) throw new Error("Cliente não informado.");
  const customerPhone =
    cleanNullable(payload.customerPhone, 32) ||
    normalizePhone(customerJid) ||
    null;
  const balanceMode = cleanText(payload.balanceMode, 20).toLowerCase() || "set";
  const requestedBalanceCents =
    payload.balanceCents !== undefined
      ? toInt(payload.balanceCents)
      : Math.round(Number(payload.balance || 0) * 100);
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_store_customers (
        store_id, customer_jid, customer_name, customer_phone, avatar_url,
        balance_cents, notes, blocked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        customer_name = COALESCE(NULLIF(VALUES(customer_name), ''), customer_name),
        customer_phone = COALESCE(NULLIF(VALUES(customer_phone), ''), customer_phone),
        avatar_url = COALESCE(NULLIF(VALUES(avatar_url), ''), avatar_url),
        balance_cents = CASE ?
          WHEN 'credit' THEN GREATEST(0, balance_cents + VALUES(balance_cents))
          WHEN 'debit' THEN GREATEST(0, balance_cents - VALUES(balance_cents))
          ELSE GREATEST(0, VALUES(balance_cents))
        END,
        notes = VALUES(notes),
        blocked = VALUES(blocked),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      store.id,
      customerJid,
      cleanNullable(payload.customerName, 180),
      customerPhone,
      cleanNullable(payload.avatarUrl, 2_000),
      Math.max(0, requestedBalanceCents),
      cleanNullable(payload.notes),
      payload.blocked === true ? 1 : 0,
      balanceMode,
    ],
  );
  return listBotStoreCustomers(store);
};

const ensureBotStoreCustomerCanBuy = async (
  storeId: number,
  customerJid: string,
) => {
  const db = getDb();
  const [rows] = await db.query<
    Array<RowDataPacket & { blocked: number | boolean }>
  >(
    `SELECT blocked
     FROM bot_store_customers
     WHERE store_id = ? AND customer_jid = ?
     LIMIT 1`,
    [storeId, cleanText(customerJid, 160)],
  );
  if (rows.length && bool(rows[0].blocked)) {
    throw new Error(
      "As compras automáticas deste cliente estão bloqueadas. Fale com o atendimento.",
    );
  }
};

const getOrderByCharge = async (chargePublicId: string) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreOrderRow[]>(
    "SELECT * FROM bot_store_orders WHERE payment_charge_public_id = ? LIMIT 1",
    [chargePublicId],
  );
  return rows.length ? mapOrder(rows[0]) : null;
};

const getOrderByPublicId = async (publicId: string) => {
  await runEnsure();
  const db = getDb();
  const [rows] = await db.query<BotStoreOrderRow[]>(
    "SELECT * FROM bot_store_orders WHERE public_id = ? LIMIT 1",
    [publicId],
  );
  return rows.length ? mapOrder(rows[0]) : null;
};

const attachChargeToOrder = async (orderId: number, charge: PaymentCharge) => {
  const db = getDb();
  const [rows] = await db.query<BotStoreOrderRow[]>(
    "SELECT metadata FROM bot_store_orders WHERE id = ? LIMIT 1",
    [orderId],
  );
  const metadata = {
    ...parseJson<JsonRecord>(rows[0]?.metadata, {}),
    chargeProvider: charge.provider,
  };
  await db.query(
    `UPDATE bot_store_orders
     SET payment_charge_public_id = ?, checkout_url = ?,
         metadata = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      charge.publicId,
      charge.ticketUrl || null,
      JSON.stringify(metadata),
      orderId,
    ],
  );
};

const failPendingOrder = async (storeId: number, orderId: number) => {
  const db = getDb();
  await db.query(
    `UPDATE bot_store_orders
     SET status = 'failed', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ? AND status IN ('pending', 'processing')`,
    [orderId, storeId],
  );
  await releaseOrderInventory(storeId, orderId);
};

const isStoreInventoryUnavailableError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes("estoque insuficiente") ||
    message.includes("sem itens disponíveis") ||
    message.includes("produto indisponível")
  );
};

const isStoreMediaError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes("mídia") ||
    message.includes("midia") ||
    message.includes("media") ||
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("arquivo armazenado")
  );
};

type StoreListMessageParams = Parameters<typeof sendListMessage>[1];
type StoreButtonMessageParams = Parameters<typeof sendInteractiveButtons>[1];

const sendStoreListMessage = async (
  client: WuzapiClient,
  params: StoreListMessageParams,
) => {
  try {
    return await sendListMessage(client, params);
  } catch (error) {
    const hasMedia =
      Boolean(params.media) ||
      Boolean(params.cards?.some((card) => Boolean(card.media)));
    if (!hasMedia || !isStoreMediaError(error)) throw error;
    console.warn("[bot-store] Mídia do menu indisponível; reenviando sem header", {
      to: params.to,
      error: error instanceof Error ? error.message : String(error),
    });
    return sendListMessage(client, {
      ...params,
      media: null,
      cards: params.cards?.map((card) => ({ ...card, media: null })),
    });
  }
};

const sendStoreButtonMessage = async (
  client: WuzapiClient,
  params: StoreButtonMessageParams,
) => {
  try {
    return await sendInteractiveButtons(client, params);
  } catch (error) {
    if (!params.headerMedia || !isStoreMediaError(error)) throw error;
    console.warn(
      "[bot-store] Mídia do produto indisponível; reenviando sem header",
      {
        to: params.to,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return sendInteractiveButtons(client, {
      ...params,
      headerMedia: undefined,
    });
  }
};

const getStoreClient = async (store: BotStore): Promise<WuzapiClient> => {
  const instance = await getInstanceById(store.instanceId);
  if (!instance?.serverBaseUrl || !instance.token) {
    throw new Error("A instância da loja não está conectada.");
  }
  return { baseUrl: instance.serverBaseUrl, token: instance.token };
};

const deliveryMediaType = (mime: string | null, fileName: string | null) => {
  const value = `${mime || ""} ${fileName || ""}`.toLowerCase();
  if (/image\/|\.(png|jpe?g|gif|webp)\b/.test(value)) return "image" as const;
  if (/video\/|\.(mp4|mov|mkv|webm)\b/.test(value)) return "video" as const;
  if (/audio\/|\.(mp3|ogg|wav|m4a|aac)\b/.test(value)) return "audio" as const;
  return "document" as const;
};

const markOrderDelivered = async (orderId: number, status = "delivered") => {
  const db = getDb();
  await db.query(
    `
      UPDATE bot_store_orders
      SET status = ?, delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [status, orderId],
  );
};

const reserveInventoryForOrder = async (
  storeId: number,
  productId: number,
  orderId: number,
  quantity: number,
) => {
  await expireStoreInventoryAllocations(storeId, productId);
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const amount = Math.max(1, Math.min(100, Math.floor(quantity)));
    const [rows] = await connection.query<BotStoreInventoryRow[]>(
      `SELECT * FROM bot_store_inventory_items
       WHERE store_id = ? AND product_id = ? AND deleted_at IS NULL
         AND status <> 'disabled'
         AND used_count < max_uses
       ORDER BY created_at ASC, id ASC
       FOR UPDATE`,
      [storeId, productId],
    );
    const ids = rows.map((row) => Number(row.id));
    const reservedByItem = new Map<number, number>();
    if (ids.length) {
      const [reservedRows] = await connection.query<
        Array<
          RowDataPacket & {
            inventory_id: number;
            reserved_uses: number;
          }
        >
      >(
        `SELECT inventory_id, SUM(quantity) AS reserved_uses
         FROM bot_store_inventory_allocations
         WHERE inventory_id IN (${ids.map(() => "?").join(",")})
           AND status = 'reserved'
           AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
         GROUP BY inventory_id`,
        ids,
      );
      for (const row of reservedRows) {
        reservedByItem.set(
          Number(row.inventory_id),
          Number(row.reserved_uses || 0),
        );
      }
    }
    let pending = amount;
    const allocations: Array<{
      row: BotStoreInventoryRow;
      quantity: number;
      allocationId: number;
    }> = [];
    for (const row of rows) {
      if (pending <= 0) break;
      const reserved = reservedByItem.get(Number(row.id)) || 0;
      const capacity = Math.max(
        0,
        Number(row.max_uses || 1) - Number(row.used_count || 0) - reserved,
      );
      if (!capacity) continue;
      const allocationQuantity = Math.min(capacity, pending);
      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO bot_store_inventory_allocations (
           store_id, order_id, inventory_id, quantity, status, expires_at
         ) VALUES (?, ?, ?, ?, 'reserved',
                   DATE_ADD(NOW(), INTERVAL 120 MINUTE))
         ON DUPLICATE KEY UPDATE
           quantity = VALUES(quantity), status = 'reserved',
           expires_at = VALUES(expires_at), delivered_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [storeId, orderId, row.id, allocationQuantity],
      );
      const allocationId =
        Number(result.insertId || 0) ||
        Number(
          (
            await connection.query<Array<RowDataPacket & { id: number }>>(
              `SELECT id FROM bot_store_inventory_allocations
               WHERE order_id = ? AND inventory_id = ? LIMIT 1`,
              [orderId, row.id],
            )
          )[0][0]?.id || 0,
        );
      allocations.push({
        row,
        quantity: allocationQuantity,
        allocationId,
      });
      pending -= allocationQuantity;
    }
    if (pending > 0) {
      const available = amount - pending;
      throw new Error(
        available
          ? `Estoque insuficiente. Restam ${available} uso(s) disponível(is).`
          : "Este produto está sem itens disponíveis no estoque.",
      );
    }
    await connection.commit();
    return allocations.map(
      ({ row, quantity: allocatedQuantity, allocationId }) => ({
        ...mapInventoryItem(row),
        allocationId,
        allocatedQuantity,
        allocationStatus: "reserved",
      }),
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const releaseOrderInventory = async (storeId: number, orderId: number) => {
  const db = getDb();
  await db.query(
    `UPDATE bot_store_inventory_allocations
     SET status = 'released', updated_at = CURRENT_TIMESTAMP
     WHERE store_id = ? AND order_id = ? AND status = 'reserved'`,
    [storeId, orderId],
  );
};

const listOrderInventory = async (storeId: number, orderId: number) => {
  const db = getDb();
  const [rows] = await db.query<
    Array<
      BotStoreInventoryRow & {
        allocation_id: number;
        allocation_quantity: number;
        allocation_status: string;
      }
    >
  >(
    `SELECT item.*, allocation.id AS allocation_id,
            allocation.quantity AS allocation_quantity,
            allocation.status AS allocation_status
     FROM bot_store_inventory_allocations allocation
     INNER JOIN bot_store_inventory_items item
       ON item.id = allocation.inventory_id
     WHERE allocation.store_id = ? AND allocation.order_id = ?
       AND allocation.status IN ('reserved', 'delivered')
     ORDER BY allocation.id ASC`,
    [storeId, orderId],
  );
  return rows.map((row) => ({
    ...mapInventoryItem(row),
    allocationId: Number(row.allocation_id),
    allocatedQuantity: Math.max(1, Number(row.allocation_quantity || 1)),
    allocationStatus: row.allocation_status,
  }));
};

const getStoreCustomerBalanceCents = async (
  storeId: number,
  customerJid: string,
) => {
  const db = getDb();
  const [rows] = await db.query<
    Array<RowDataPacket & { balance_cents: number }>
  >(
    `SELECT balance_cents
     FROM bot_store_customers
     WHERE store_id = ? AND customer_jid = ?
     LIMIT 1`,
    [storeId, cleanText(customerJid, 160)],
  );
  return Math.max(0, Number(rows[0]?.balance_cents || 0));
};

const debitStoreCustomerBalanceForOrder = async (
  storeId: number,
  orderId: number,
  customerJid: string,
  amountCents: number,
) => {
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const amount = Math.max(0, Math.floor(amountCents));
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE bot_store_customers
       SET balance_cents = balance_cents - ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ? AND customer_jid = ?
         AND balance_cents >= ?`,
      [amount, storeId, cleanText(customerJid, 160), amount],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.query(
      `UPDATE bot_store_orders
       SET status = 'paid', provider = 'balance',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [orderId, storeId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const creditPaidOrderToCustomerBalance = async (
  store: BotStore,
  orderId: number,
) => {
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<BotStoreOrderRow[]>(
      `SELECT * FROM bot_store_orders
       WHERE id = ? AND store_id = ?
       LIMIT 1 FOR UPDATE`,
      [orderId, store.id],
    );
    if (!rows.length) {
      await connection.rollback();
      return { credited: false, balanceCents: 0, order: null };
    }
    const order = mapOrder(rows[0]);
    if (
      order.deliveredAt ||
      order.status === "delivered" ||
      order.status === "credited"
    ) {
      const [customerRows] = await connection.query<
        Array<RowDataPacket & { balance_cents: number }>
      >(
        `SELECT balance_cents FROM bot_store_customers
         WHERE store_id = ? AND customer_jid = ? LIMIT 1`,
        [store.id, order.customerJid],
      );
      await connection.commit();
      return {
        credited: false,
        balanceCents: Math.max(
          0,
          Number(customerRows[0]?.balance_cents || 0),
        ),
        order,
      };
    }
    const amount = Math.max(0, order.totalCents);
    await connection.query(
      `INSERT INTO bot_store_customers (
         store_id, customer_jid, customer_name, customer_phone,
         balance_cents, last_order_at
       ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         customer_name = COALESCE(NULLIF(VALUES(customer_name), ''), customer_name),
         customer_phone = COALESCE(NULLIF(VALUES(customer_phone), ''), customer_phone),
         balance_cents = balance_cents + VALUES(balance_cents),
         last_order_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        store.id,
        order.customerJid,
        order.customerName,
        order.customerPhone,
        amount,
      ],
    );
    await connection.query(
      `UPDATE bot_store_orders
       SET status = 'credited', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [order.id, store.id],
    );
    await connection.query(
      `UPDATE bot_store_inventory_allocations
       SET status = 'released', updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ? AND order_id = ? AND status = 'reserved'`,
      [store.id, order.id],
    );
    const [customerRows] = await connection.query<
      Array<RowDataPacket & { balance_cents: number }>
    >(
      `SELECT balance_cents FROM bot_store_customers
       WHERE store_id = ? AND customer_jid = ? LIMIT 1`,
      [store.id, order.customerJid],
    );
    await connection.commit();
    return {
      credited: true,
      balanceCents: Math.max(0, Number(customerRows[0]?.balance_cents || 0)),
      order,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const formatStorePurchaseDate = (value: Date | string | null | undefined) => {
  const parsed = value instanceof Date ? value : new Date(value || Date.now());
  const safeDate = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(safeDate);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  return `${part("day")}/${part("month")}/${part("year")} às ${part("hour")}:${part("minute")}:${part("second")}`;
};

type BotStoreAllocatedInventoryItem = Awaited<
  ReturnType<typeof listOrderInventory>
>[number];

const inventoryDeliveryData = (
  productName: string,
  items: BotStoreAllocatedInventoryItem[],
) =>
  items
    .map((item) => {
      const value = item.deliveryValue?.trim();
      if (value) return value;
      if (item.deliveryFileUrl) {
        return `📎 ${item.deliveryFileName || item.label || productName}: ${item.deliveryFileUrl}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

const renderStoreDeliveryMessage = async (params: {
  store: BotStore;
  customerJid: string;
  customerName?: string | null;
  productName: string;
  totalCents: number;
  purchaseDate?: Date | string | null;
  orderId?: string | null;
  data: string;
}) => {
  const customer = await getStoreCustomerTemplateValues(
    params.store.id,
    params.customerJid,
    params.customerName,
  );
  const template = params.store.menuConfig.delivery;
  const values = {
    ...customer,
    store: params.store.name,
    loja: params.store.name,
    product: params.productName,
    produto: params.productName,
    price: formatMoney(params.totalCents),
    valor: formatMoney(params.totalCents),
    purchase_date: formatStorePurchaseDate(params.purchaseDate),
    data_compra: formatStorePurchaseDate(params.purchaseDate),
    order: params.orderId || "",
    pedido: params.orderId || "",
    delivery: params.data,
    dados: params.data,
  };
  const configuredTemplate = [template.title, template.body, template.footer]
    .filter((entry) => entry?.trim())
    .join("\n\n");
  const includesDeliveryData = /\{\{\s*(?:dados|delivery)\s*\}\}/i.test(
    configuredTemplate,
  );
  const rendered = renderStoreTemplate(
    configuredTemplate || DEFAULT_STORE_MENU_CONFIG.delivery.body,
    values,
  );
  return includesDeliveryData
    ? rendered
    : `${rendered}\n\nℹ️ DADOS:\n${params.data}`.trim();
};

const sendStoreDelivery = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  customerName?: string | null;
  productName: string;
  totalCents: number;
  purchaseDate?: Date | string | null;
  orderId?: string | null;
  data: string;
  attachment?: {
    url: string;
    fileName: string;
    mimeType?: string | null;
  } | null;
}) => {
  const body = await renderStoreDeliveryMessage({
    store: params.store,
    customerJid: params.to,
    customerName: params.customerName,
    productName: params.productName,
    totalCents: params.totalCents,
    purchaseDate: params.purchaseDate,
    orderId: params.orderId,
    data: params.data,
  });
  if (!params.attachment) {
    await sendTextMessage(params.client, { to: params.to, body });
    return;
  }
  await sendMediaMessage(params.client, {
    to: params.to,
    media: params.attachment.url,
    mediaType: deliveryMediaType(
      params.attachment.mimeType ?? null,
      params.attachment.fileName,
    ),
    filename: params.attachment.fileName,
    mimeType: params.attachment.mimeType || undefined,
    caption: body,
    useExternalUrl: true,
  }).catch(async () => {
    await sendTextMessage(params.client, {
      to: params.to,
      body: `${body}\n${params.attachment!.url}`.trim(),
    });
  });
};

const markInventoryDelivered = async (
  storeId: number,
  orderId: number,
  inventory: BotStoreAllocatedInventoryItem[],
) => {
  const pending = inventory.filter(
    (item) => item.allocationStatus !== "delivered",
  );
  if (!pending.length) return;
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of pending) {
      await connection.query(
        `UPDATE bot_store_inventory_items
         SET used_count = LEAST(max_uses, used_count + ?),
             status = CASE
               WHEN used_count + ? >= max_uses THEN 'delivered'
               ELSE 'available'
             END,
             delivered_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ?`,
        [item.allocatedQuantity, item.allocatedQuantity, item.id, storeId],
      );
      await connection.query(
        `UPDATE bot_store_inventory_allocations
         SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ? AND order_id = ?`,
        [item.allocationId, storeId, orderId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deliverLocalOrder = async (store: BotStore, order: BotStoreOrder) => {
  if (order.deliveredAt) return;
  const product = order.productId
    ? await getLocalProduct(store.id, order.productId, {
        includeDeleted: true,
      })
    : null;
  if (!product) throw new Error("Produto da venda não foi encontrado.");
  const client = await getStoreClient(store);
  let inventory = await listOrderInventory(store.id, order.id);
  if (!inventory.length) {
    inventory = await reserveInventoryForOrder(
      store.id,
      product.id,
      order.id,
      order.quantity,
    );
  }
  const pendingInventory = inventory.filter(
    (item) => item.allocationStatus !== "delivered",
  );
  if (!pendingInventory.length) {
    await markOrderDelivered(order.id);
    return;
  }
  const deliveryData = inventoryDeliveryData(product.name, pendingInventory);
  if (!deliveryData) throw new Error("O item de estoque não possui entrega.");
  const onlyItem = pendingInventory.length === 1 ? pendingInventory[0] : null;
  await sendStoreDelivery({
    store,
    client,
    to: order.customerJid,
    customerName: order.customerName,
    productName: product.name,
    totalCents:
      order.totalCents > 0
        ? order.totalCents
        : product.priceCents * Math.max(1, order.quantity),
    purchaseDate: order.createdAt,
    orderId: order.publicId.slice(0, 8).toUpperCase(),
    data: deliveryData,
    attachment:
      onlyItem?.itemType === "file" &&
      onlyItem.deliveryFileUrl &&
      !onlyItem.deliveryValue
        ? {
            url: onlyItem.deliveryFileUrl,
            fileName:
              onlyItem.deliveryFileName ||
              path.basename(onlyItem.deliveryFileUrl),
            mimeType: onlyItem.deliveryMimeType,
          }
        : null,
  });
  await markInventoryDelivered(store.id, order.id, inventory);
  await markOrderDelivered(order.id);
};

const findWwPanelClientByOrder = async (
  storeId: number,
  orderId: number,
): Promise<(BotStoreWwPanelClientRow & { password: string }) | null> => {
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelClientRow[]>(
    `SELECT * FROM bot_store_wwpanel_clients
     WHERE store_id = ? AND order_id = ?
     LIMIT 1`,
    [storeId, orderId],
  );
  const row = rows[0];
  return row
    ? {
        ...row,
        password: decryptWwPanelSecret(row.password_encrypted),
      }
    : null;
};

const wwPanelDeliveryData = (
  client: {
    username: string;
    password: string;
    expiresAt: Date | string | null;
  },
  offer: Awaited<ReturnType<typeof getWwPanelOffer>>,
) => {
  const expiresAt = client.expiresAt ? new Date(client.expiresAt) : null;
  const validity =
    expiresAt && Number.isFinite(expiresAt.getTime())
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(expiresAt)
      : offer?.months
        ? `${offer.months} ${offer.months === 1 ? "mês" : "meses"}`
        : `${offer?.days || 0} ${offer?.days === 1 ? "dia" : "dias"}`;
  return [
    `├👤 Usuário: ${client.username}`,
    `├🔑 Senha: ${client.password}`,
    `├📅 Validade: ${validity}`,
    `└📺 Telas: ${offer?.accessIptv || 1}`,
  ].join("\n");
};

const deliverWwPanelOrder = async (
  store: BotStore,
  order: BotStoreOrder,
) => {
  if (order.deliveredAt) return;
  const offerId = Math.max(0, toInt(order.metadata.wwPanelOfferId));
  const offer = await getWwPanelOffer(store.id, offerId);
  if (!offer) throw new Error("Oferta IPTV da venda não foi encontrada.");
  const apiKey = await wwPanelApiKeyForStore(store.id);
  const db = getDb();
  let provisioned = await findWwPanelClientByOrder(store.id, order.id);
  if (!provisioned) {
    const [claim] = await db.query<ResultSetHeader>(
      `UPDATE bot_store_orders
       SET status = 'provisioning', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?
         AND status IN ('pending', 'processing', 'paid', 'provision_failed')`,
      [order.id, store.id],
    );
    if (!claim.affectedRows) {
      throw new Error("Provisionamento IPTV já está em andamento.");
    }
    let remote: WwPanelClient;
    try {
      remote = offer.isTrial
        ? await createWwPanelTrial(apiKey, {
            testDuration: Math.max(1, offer.days || 1),
            package_p2p: offer.packageP2p,
            package_iptv: offer.packageIptv,
            notes: `BotAdmin ${order.publicId}`,
          })
        : await createWwPanelClient(apiKey, {
            isTrial: 0,
            whatsapp: order.customerPhone || normalizePhone(order.customerJid),
            country: offer.country,
            ...(offer.months && offer.months > 0
              ? { months: offer.months }
              : { days: Math.max(1, offer.days || 1) }),
            planId: offer.planId,
            package_p2p: offer.packageP2p,
            package_iptv: offer.packageIptv,
            access_iptv: offer.accessIptv,
            access_nexus: offer.accessNexus,
            addons: offer.addons,
            notes: `BotAdmin ${order.publicId}`,
          });
    } catch (error) {
      await db.query(
        `UPDATE bot_store_orders
         SET status = 'provision_failed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ?`,
        [order.id, store.id],
      );
      throw error;
    }
    await db.query(
      `INSERT INTO bot_store_wwpanel_clients (
         store_id, offer_id, order_id, customer_jid, customer_name,
         customer_phone, external_id, username, password_encrypted,
         expires_at, status, provider_payload
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE
         external_id = VALUES(external_id),
         username = VALUES(username),
         password_encrypted = VALUES(password_encrypted),
         expires_at = VALUES(expires_at),
         status = 'active',
         provider_payload = VALUES(provider_payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        store.id,
        offer.id,
        order.id,
        order.customerJid,
        order.customerName,
        order.customerPhone || normalizePhone(order.customerJid),
        remote.id,
        remote.username,
        encryptWwPanelSecret(remote.password),
        remote.expDate,
        JSON.stringify(remote.raw),
      ],
    );
    await db.query(
      `UPDATE bot_store_orders
       SET external_order_id = ?, status = 'provisioned',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [remote.id, order.id, store.id],
    );
    provisioned = await findWwPanelClientByOrder(store.id, order.id);
  }
  if (!provisioned) {
    throw new Error("Não foi possível persistir as credenciais IPTV.");
  }
  const client = await getStoreClient(store);
  await sendStoreDelivery({
    store,
    client,
    to: order.customerJid,
    customerName: order.customerName,
    productName: offer.name,
    totalCents: order.totalCents,
    purchaseDate: order.createdAt,
    orderId: order.publicId.slice(0, 8).toUpperCase(),
    data: wwPanelDeliveryData(
      {
        username: provisioned.username,
        password: provisioned.password,
        expiresAt: provisioned.expires_at,
      },
      offer,
    ),
  });
  await markOrderDelivered(order.id);
};

const deliverWwPanelRenewalOrder = async (
  store: BotStore,
  order: BotStoreOrder,
) => {
  if (order.deliveredAt) return;
  const offerId = Math.max(0, toInt(order.metadata.wwPanelOfferId));
  const clientId = Math.max(0, toInt(order.metadata.wwPanelClientId));
  const offer = await getWwPanelOffer(store.id, offerId);
  if (!offer || offer.isTrial) {
    throw new Error("Plano de renovação IPTV inválido.");
  }
  const db = getDb();
  const [rows] = await db.query<BotStoreWwPanelClientRow[]>(
    `SELECT c.*, o.is_trial
     FROM bot_store_wwpanel_clients c
     LEFT JOIN bot_store_wwpanel_offers o
       ON o.id = c.offer_id AND o.store_id = c.store_id
     WHERE c.id = ? AND c.store_id = ?
     LIMIT 1`,
    [clientId, store.id],
  );
  const current = rows[0];
  if (!current || current.status === "deleted") {
    throw new Error("Acesso IPTV não encontrado.");
  }
  const apiKey = await wwPanelApiKeyForStore(store.id);
  const wasTrial =
    bool(current.is_trial) ||
    bool(parseJson<JsonRecord>(current.provider_payload, {}).isTrial);
  const updated = wasTrial
    ? await activateWwPanelTrial(apiKey, current.external_id, {
        ...(offer.months && offer.months > 0
          ? { months: offer.months }
          : { days: Math.max(1, offer.days || 1) }),
        planId: offer.planId,
        whatsapp:
          current.customer_phone || normalizePhone(current.customer_jid),
        country: offer.country,
        package_p2p: offer.packageP2p,
        package_iptv: offer.packageIptv,
        access_iptv: offer.accessIptv,
        access_nexus: offer.accessNexus,
      })
    : await extendWwPanelClient(apiKey, current.external_id, {
        ...(offer.months && offer.months > 0
          ? { months: offer.months }
          : { days: Math.max(1, offer.days || 1) }),
      });
  await db.query(
    `UPDATE bot_store_wwpanel_clients
     SET offer_id = ?, password_encrypted = ?, expires_at = ?,
         status = 'active', provider_payload = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND store_id = ?`,
    [
      offer.id,
      encryptWwPanelSecret(updated.password),
      updated.expDate,
      JSON.stringify(updated.raw),
      current.id,
      store.id,
    ],
  );
  const client = await getStoreClient(store);
  await sendStoreDelivery({
    store,
    client,
    to: order.customerJid,
    customerName: order.customerName,
    productName: `Renovação ${offer.name}`,
    totalCents: order.totalCents,
    purchaseDate: order.createdAt,
    orderId: order.publicId.slice(0, 8).toUpperCase(),
    data: wwPanelDeliveryData(
      {
        username: updated.username,
        password: updated.password,
        expiresAt: updated.expDate,
      },
      offer,
    ),
  });
  await markOrderDelivered(order.id);
};

const deliverSmmOrder = async (store: BotStore, order: BotStoreOrder) => {
  if (order.deliveredAt) return;
  const integration = await requireSmmIntegration(store.id);
  const db = getDb();
  const [rows] = await db.query<BotStoreSmmOrderRow[]>(
    `SELECT * FROM bot_store_smm_orders
     WHERE store_id = ? AND order_id = ?
     LIMIT 1`,
    [store.id, order.id],
  );
  const smmRow = rows[0];
  if (!smmRow) throw new Error("Dados do pedido SMM não encontrados.");
  const service = await getSmmService(store.id, smmRow.service_id);
  if (!service) throw new Error("Serviço SMM não encontrado.");
  let providerOrderId = cleanText(smmRow.provider_order_id, 160);
  if (!providerOrderId) {
    const [claim] = await db.query<ResultSetHeader>(
      `UPDATE bot_store_orders
       SET status = 'provisioning', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?
         AND status IN ('pending', 'processing', 'paid', 'provision_failed')`,
      [order.id, store.id],
    );
    if (!claim.affectedRows) {
      throw new Error("Provisionamento SMM já está em andamento.");
    }
    const requestPayload = parseJson<SmmAddOrderInput>(
      smmRow.request_payload,
      {
        service: service.providerServiceId,
        link: smmRow.target,
        quantity: smmRow.quantity,
      },
    );
    try {
      const remote = await addSmmOrder(
        integration.apiKey!,
        {
          ...requestPayload,
          service: service.providerServiceId,
          link: requestPayload.link || smmRow.target,
        },
        integration.apiBase,
      );
      providerOrderId = remote.order;
      await db.query(
        `UPDATE bot_store_smm_orders
         SET provider_order_id = ?, status = 'Pending',
             provider_snapshot = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ? AND provider_order_id IS NULL`,
        [remote.order, JSON.stringify(remote.raw), smmRow.id, store.id],
      );
      await db.query(
        `UPDATE bot_store_orders
         SET external_order_id = ?, status = 'provisioned',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ?`,
        [remote.order, order.id, store.id],
      );
    } catch (error) {
      await db.query(
        `UPDATE bot_store_orders
         SET status = 'provision_failed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ?`,
        [order.id, store.id],
      );
      await db.query(
        `UPDATE bot_store_smm_orders
         SET status = 'Provision failed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND store_id = ?`,
        [smmRow.id, store.id],
      );
      throw error;
    }
  }
  if (!providerOrderId) {
    throw new Error("O painel SMM não confirmou o pedido.");
  }
  const client = await getStoreClient(store);
  const menu = normalizeMenuTemplate(
    store.menuConfig.smm,
    DEFAULT_STORE_MENU_CONFIG.smm,
  );
  const body =
    renderStoreTemplate(menu.orderCreatedBody, {
      store: store.name,
      service: service.name,
      category: service.category,
      target: smmRow.target,
      quantity: smmRow.quantity,
      price: formatMoney(smmRow.sale_total_cents),
      order: providerOrderId,
      pedido: providerOrderId,
      status: "Pendente",
    }) ||
    [
      "✅ *Pedido SMM criado*",
      `🧰 ${service.name}`,
      `🔗 ${smmRow.target}`,
      `📦 Quantidade: ${smmRow.quantity}`,
      `🆔 Pedido: ${providerOrderId}`,
    ].join("\n");
  await sendStoreButtonMessage(client, {
    to: order.customerJid,
    title: "Pedido confirmado",
    body,
    footer: store.name,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}smm-order:${smmRow.id}`,
        text: "Acompanhar pedido 🔎",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}root`,
        text: menu.backButton || "Voltar à loja ↩️",
        type: "quick_reply",
      },
    ],
  });
  await markOrderDelivered(order.id);
};

export const processBotStoreApprovedCharge = async (
  charge: PaymentCharge,
): Promise<boolean> => {
  const context = charge.metadata?.context;
  if (!context || context.type !== "bot_store_purchase") return false;
  const order =
    (await getOrderByCharge(charge.publicId)) ||
    (context.orderPublicId
      ? await getOrderByPublicId(String(context.orderPublicId))
      : null);
  if (!order) return false;
  const storeId = Number(context.storeId || order.storeId);
  const db = getDb();
  const [rows] = await db.query<BotStoreRow[]>(
    "SELECT * FROM bot_stores WHERE id = ? LIMIT 1",
    [storeId],
  );
  if (!rows.length) return false;
  const store = mapStore(rows[0]);
  if (
    order.deliveredAt ||
    order.status === "delivered" ||
    order.status === "credited"
  ) {
    return true;
  }
  await db.query(
    `UPDATE bot_store_orders
     SET status = 'paid', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status NOT IN ('delivered', 'credited')`,
    [order.id],
  );
  try {
    if (order.metadata.integration === "wwpanel_renewal") {
      await deliverWwPanelRenewalOrder(store, { ...order, status: "paid" });
    } else if (order.metadata.integration === "wwpanel") {
      await deliverWwPanelOrder(store, { ...order, status: "paid" });
    } else if (order.metadata.integration === "smm") {
      await deliverSmmOrder(store, { ...order, status: "paid" });
    } else {
      await deliverLocalOrder(store, { ...order, status: "paid" });
    }
  } catch (error) {
    if (
      order.metadata.integration === "wwpanel" ||
      order.metadata.integration === "wwpanel_renewal" ||
      order.metadata.integration === "smm"
    ) {
      throw error;
    }
    if (!isStoreInventoryUnavailableError(error)) throw error;
    const credit = await creditPaidOrderToCustomerBalance(store, order.id);
    if (credit.credited && credit.order) {
      const client = await getStoreClient(store);
      await sendTextMessage(client, {
        to: credit.order.customerJid,
        body: [
          "✅ *Pagamento confirmado*",
          "",
          "Este produto esgotou antes da confirmação do pagamento.",
          `O valor de *${formatMoney(credit.order.totalCents)}* foi adicionado ao seu saldo.`,
          `Saldo disponível: *${formatMoney(credit.balanceCents)}*`,
          "",
          "Escolha outro produto na loja ou aguarde a reposição.",
        ].join("\n"),
      }).catch((sendError) => {
        console.error(
          "[bot-store] Falha ao avisar crédito por estoque esgotado",
          sendError,
        );
      });
    }
  }
  return true;
};

const sendRootMenu = async (
  store: BotStore,
  client: WuzapiClient,
  to: string,
  customerName?: string | null,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.root,
    DEFAULT_STORE_MENU_CONFIG.root,
  );
  const [
    categories,
    products,
    wwPanelIntegration,
    wwPanelOffers,
    customerWwPanelClients,
    smmIntegration,
  ] =
    await Promise.all([
      listBotStoreCategories(store.id, false),
      listBotStoreProducts(store.id, { includeDisabled: false }),
      getWwPanelIntegration(store.id),
      listWwPanelOffers(store.id, false),
      listCustomerWwPanelClients(store.id, to),
      getSmmIntegration(store.id),
    ]);
  const smmServices =
    smmIntegration?.enabled && smmIntegration.apiKey
      ? await listSmmServices(store.id, smmIntegration, {
          enabledOnly: true,
        })
      : [];
  const availableProducts = products.filter(
    (product) => product.stock == null || product.stock > 0,
  );
  const digitalCategoryRows = categories.reduce<ListMessageRow[]>(
    (rows, category) => {
      const count = availableProducts.filter(
        (product) => product.categoryId === category.id,
      ).length;
      if (!count) return rows;
      rows.push({
        title: category.name.slice(0, 60),
        description: renderStoreTemplate(menu.categoryRow, {
          count,
          countLabel: count === 1 ? "produto" : "produtos",
          description:
            cleanText(category.description, 110) || "Entrega digital",
        }).slice(0, 110),
        rowId: `${STORE_ACTION_PREFIX}category:${category.id}`,
      });
      return rows;
    },
    [],
  );

  const uncategorizedProducts = availableProducts.filter(
    (entry) => !entry.categoryId,
  );
  if (uncategorizedProducts.length) {
    digitalCategoryRows.push({
      title: "Outros produtos",
      description: renderStoreTemplate(menu.categoryRow, {
        count: uncategorizedProducts.length,
        countLabel:
          uncategorizedProducts.length === 1 ? "produto" : "produtos",
        description: "Entrega digital",
      }).slice(0, 110),
      rowId: `${STORE_ACTION_PREFIX}uncategorized`,
    });
  }

  let centralCatalog: CentralCartCatalog | null = null;
  if (store.centralCart.connected) {
    centralCatalog = await loadCentralCartCatalog(store).catch(() => null);
    for (const category of (centralCatalog?.categories || [])
      .filter((category) => !category.hide_category && normalizeId(category.id))
      .slice(0, Math.max(0, 80 - digitalCategoryRows.length))) {
      const categoryId = normalizeId(category.id);
      const count = (centralCatalog?.packages || [])
        .filter(
          (product) =>
            normalizeId(product.category_id) === categoryId &&
            product.enabled !== false &&
            !product.parent_id &&
            (product.inventory_amount == null || product.inventory_amount > 0),
        )
        .length;
      if (!count) continue;
      const categoryName = cleanText(category.name, 60) || "Categoria";
      digitalCategoryRows.push({
        title: categoryName,
        description: renderStoreTemplate(menu.categoryRow, {
          count,
          countLabel: count === 1 ? "produto" : "produtos",
          description: "Catálogo digital",
        }).slice(0, 110),
        rowId: `${STORE_ACTION_PREFIX}cc-category:${categoryId}`,
      });
    }
  }

  const enabledWwPanelOffers =
    wwPanelIntegration?.enabled && wwPanelIntegration.apiKey
      ? wwPanelOffers
      : [];
  if (
    !digitalCategoryRows.length &&
    !enabledWwPanelOffers.length &&
    !smmServices.length
  ) {
    await sendTextMessage(client, {
      to,
      body: "A loja está ativa, mas ainda não possui produtos disponíveis.",
    });
    return;
  }
  const customerValues = await getStoreCustomerTemplateValues(
    store.id,
    to,
    customerName,
  );
  const values = {
    ...customerValues,
    store: store.name,
    description:
      store.description || "Escolha uma categoria para ver os produtos.",
  };
  const rootTitle = renderStoreTemplate(menu.title, values) || store.name;
  const rootDescription =
    renderStoreTemplate(menu.body, values) ||
    "Escolha uma categoria para ver os produtos.";
  const digitalMediaUrl =
    templateMediaUrl(menu) ||
    store.imageUrl ||
    categories.find((category) => category.imageUrl)?.imageUrl ||
    cleanNullable(
      centralCatalog?.categories.find((category) => category.image)?.image,
      2_000,
    );
  const cards: ListMessageCard[] = [];
  if (digitalCategoryRows.length) {
    cards.push({
      title: "Produtos digitais",
      description: rootDescription,
      footerText: renderStoreTemplate(menu.footer, values),
      buttonText: menu.listButton || "Ver categorias",
      sections: [
        {
          title: "Categorias de produtos digitais",
          rows: digitalCategoryRows.slice(0, 80),
        },
      ],
      media: digitalMediaUrl
        ? {
            type: "image",
            media: digitalMediaUrl,
            sourceUrl: digitalMediaUrl,
          }
        : null,
    });
  }
  if (enabledWwPanelOffers.length) {
    const iptvMenu = normalizeMenuTemplate(
      store.menuConfig.iptv,
      DEFAULT_STORE_MENU_CONFIG.iptv,
    );
    const firstOfferImage = enabledWwPanelOffers.find(
      (offer) => offer.imageUrl,
    )?.imageUrl;
    const offerRows = enabledWwPanelOffers.slice(0, 60).map((offer) => {
      const validity =
        offer.months && offer.months > 0
          ? `${offer.months} ${offer.months === 1 ? "mês" : "meses"}`
          : `${offer.days || 1} ${offer.days === 1 ? "dia" : "dias"}`;
      return {
        title: offer.name.slice(0, 60),
        description: renderStoreTemplate(iptvMenu.productRow, {
          price: offer.isTrial ? "Teste grátis" : formatMoney(offer.priceCents),
          validity,
          screens: `${offer.accessIptv} ${
            offer.accessIptv === 1 ? "tela" : "telas"
          }`,
          product: offer.name,
          description: offer.description || "",
        }).slice(0, 110),
        rowId: `${STORE_ACTION_PREFIX}iptv-offer:${offer.id}`,
      };
    });
    const accessRows = customerWwPanelClients.slice(0, 20).map((entry) => {
      const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;
      const validity =
        expiresAt && Number.isFinite(expiresAt.getTime())
          ? new Intl.DateTimeFormat("pt-BR", {
              dateStyle: "short",
              timeZone: "America/Sao_Paulo",
            }).format(expiresAt)
          : "validade indisponível";
      return {
        title: entry.username.slice(0, 60),
        description: `${
          entry.isTrial ? "Teste" : "Acesso"
        } · válido até ${validity}`.slice(0, 110),
        rowId: `${STORE_ACTION_PREFIX}iptv-client:${entry.id}`,
      };
    });
    const iptvValues = {
      ...values,
      plan_count: enabledWwPanelOffers.length,
      access_count: customerWwPanelClients.length,
    };
    const iptvMedia =
      templateMediaUrl(iptvMenu) || firstOfferImage || store.imageUrl;
    cards.push({
      title:
        renderStoreTemplate(iptvMenu.title, iptvValues) || "Planos IPTV",
      description:
        renderStoreTemplate(iptvMenu.body, iptvValues) ||
        "Escolha um plano, crie seu teste ou gerencie seus acessos.",
      footerText: renderStoreTemplate(iptvMenu.footer, iptvValues),
      buttonText: iptvMenu.listButton || "Abrir IPTV 📺",
      sections: [
        {
          title: "Planos e testes",
          rows: offerRows,
        },
        ...(accessRows.length
          ? [{ title: "Meus acessos", rows: accessRows }]
          : []),
      ],
      media: iptvMedia
        ? {
            type: "image",
            media: iptvMedia,
            sourceUrl: iptvMedia,
          }
        : null,
    });
  }
  if (smmServices.length) {
    const smmMenu = normalizeMenuTemplate(
      store.menuConfig.smm,
      DEFAULT_STORE_MENU_CONFIG.smm,
    );
    const categoryCounts = new Map<string, number>();
    for (const service of smmServices) {
      categoryCounts.set(
        service.category,
        (categoryCounts.get(service.category) || 0) + 1,
      );
    }
    const smmRows = [...categoryCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "pt-BR"))
      .slice(0, 80)
      .map(([category, count]) => ({
        title: category.slice(0, 60),
        description: `${count} ${count === 1 ? "serviço" : "serviços"}`.slice(
          0,
          110,
        ),
        rowId: `${STORE_ACTION_PREFIX}smm-category:${encodeStoreActionPart(
          category,
        )}`,
      }));
    const smmValues = {
      ...values,
      service_count: smmServices.length,
      category_count: categoryCounts.size,
    };
    const smmMedia = templateMediaUrl(smmMenu) || store.imageUrl;
    cards.push({
      title: renderStoreTemplate(smmMenu.title, smmValues) || "Painel SMM",
      description:
        renderStoreTemplate(smmMenu.body, smmValues) ||
        "Curtidas, seguidores, visualizações e outros serviços.",
      footerText: renderStoreTemplate(smmMenu.footer, smmValues),
      buttonText: smmMenu.listButton || "Abrir painel SMM 🚀",
      sections: [{ title: "Categorias SMM", rows: smmRows }],
      media: smmMedia
        ? {
            type: "image",
            media: smmMedia,
            sourceUrl: smmMedia,
          }
        : null,
    });
  }
  const firstCard = cards[0]!;
  await sendStoreListMessage(client, {
    to,
    title: firstCard.title || rootTitle,
    description: firstCard.description || rootDescription,
    buttonText: firstCard.buttonText || menu.listButton || "Ver categorias",
    footerText: renderStoreTemplate(menu.footer, values),
    sections: firstCard.sections,
    media: firstCard.media,
    cards,
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const sendUncategorizedProducts = async (
  store: BotStore,
  client: WuzapiClient,
  to: string,
  customerName?: string | null,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.category,
    DEFAULT_STORE_MENU_CONFIG.category,
  );
  const products = (
    await listBotStoreProducts(store.id, { includeDisabled: false })
  )
    .filter(
      (product) =>
        !product.categoryId && (product.stock == null || product.stock > 0),
    )
    .slice(0, 80);
  const rows: ListMessageRow[] = products.map((product) => ({
    title: product.name.slice(0, 60),
    description: renderStoreTemplate(
      menu.productRow,
      productTemplateValues(product),
    ).slice(0, 110),
    rowId: `${STORE_ACTION_PREFIX}product:${product.id}`,
  }));
  if (!rows.length) {
    await sendTextMessage(client, {
      to,
      body: "Não há produtos disponíveis nesta categoria.",
    });
    return;
  }
  const values = {
    ...(await getStoreCustomerTemplateValues(store.id, to, customerName)),
    store: store.name,
    category: "Outros produtos",
    description: "Escolha um produto.",
  };
  const mediaUrl =
    products.find((product) => product.imageUrl)?.imageUrl ||
    templateMediaUrl(menu);
  await sendStoreListMessage(client, {
    to,
    title: renderStoreTemplate(menu.title, values) || "Outros produtos",
    description:
      renderStoreTemplate(menu.body, values) || "Escolha um produto.",
    buttonText: menu.listButton || "Ver produtos",
    footerText: renderStoreTemplate(menu.footer, values),
    sections: [{ title: "Outros produtos", rows }],
    media: mediaUrl
      ? { type: "image", media: mediaUrl, sourceUrl: mediaUrl }
      : null,
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const sendLocalCategory = async (
  store: BotStore,
  client: WuzapiClient,
  to: string,
  categoryId: number,
  customerName?: string | null,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.category,
    DEFAULT_STORE_MENU_CONFIG.category,
  );
  const [categories, products] = await Promise.all([
    listBotStoreCategories(store.id, false),
    listBotStoreProducts(store.id, { categoryId, includeDisabled: false }),
  ]);
  const category = categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error("Categoria não encontrada.");
  const rows = products
    .filter((product) => product.stock == null || product.stock > 0)
    .slice(0, 80)
    .map((product) => ({
      title: product.name.slice(0, 60),
      description: renderStoreTemplate(
        menu.productRow,
        productTemplateValues(product),
      ).slice(0, 110),
      rowId: `${STORE_ACTION_PREFIX}product:${product.id}`,
    }));
  if (!rows.length) {
    await sendTextMessage(client, {
      to,
      body: "Não há produtos disponíveis nesta categoria.",
    });
    return;
  }
  const values = {
    ...(await getStoreCustomerTemplateValues(store.id, to, customerName)),
    store: store.name,
    category: category.name,
    description: category.description || "Escolha um produto.",
  };
  const mediaUrl = category.imageUrl || templateMediaUrl(menu);
  await sendStoreListMessage(client, {
    to,
    title: renderStoreTemplate(menu.title, values) || category.name,
    description:
      renderStoreTemplate(menu.body, values) || "Escolha um produto.",
    buttonText: menu.listButton || "Ver produtos",
    footerText: renderStoreTemplate(menu.footer, values),
    sections: [{ title: category.name, rows }],
    media: mediaUrl
      ? {
          type: "image",
          media: mediaUrl,
          sourceUrl: mediaUrl,
        }
      : null,
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const sendLocalProduct = async (
  store: BotStore,
  client: WuzapiClient,
  to: string,
  productId: number,
  customerName?: string | null,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.product,
    DEFAULT_STORE_MENU_CONFIG.product,
  );
  const product = await getLocalProduct(store.id, productId);
  if (!product || !product.enabled) throw new Error("Produto indisponível.");
  const stockText =
    product.stock == null
      ? "⚡ Entrega digital"
      : `📦 Estoque: ${product.stock}`;
  const values = {
    ...(await getStoreCustomerTemplateValues(store.id, to, customerName)),
    store: store.name,
    product: product.name,
    description: product.description,
    price: formatMoney(product.priceCents),
    stock: stockText,
  };
  const body =
    renderStoreTemplate(menu.body, values) ||
    `💰 ${formatMoney(product.priceCents)}\n${stockText}${
      product.description ? `\n\n${product.description}` : ""
    }`;
  const mediaUrl = product.imageUrl || templateMediaUrl(menu);
  await sendStoreButtonMessage(client, {
    to,
    title: renderStoreTemplate(menu.title, values) || product.name,
    body,
    footer: renderStoreTemplate(menu.footer, values) || store.name,
    headerMedia: mediaUrl
      ? {
          type: "image",
          media: mediaUrl,
          sourceUrl: mediaUrl,
        }
      : undefined,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}buy:${product.id}`,
        text:
          product.priceCents > 0
            ? menu.buyButton || "Comprar agora 🛒"
            : "Receber agora 🎁",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}root`,
        text: menu.backButton || "Voltar à loja ↩️",
        type: "quick_reply",
      },
    ],
  });
};

const sendCentralCategory = async (
  store: BotStore,
  client: WuzapiClient,
  to: string,
  categoryId: string,
  customerName?: string | null,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.category,
    DEFAULT_STORE_MENU_CONFIG.category,
  );
  const catalog = await loadCentralCartCatalog(store);
  const category = catalog.allCategories.find(
    (entry) => normalizeId(entry.id) === categoryId,
  );
  if (!category) throw new Error("Categoria da Central Cart não encontrada.");
  const childCategories = (category.sub_categories || []).filter(
    (entry) => !entry.hide_subcategory && normalizeId(entry.id),
  );
  const packages = catalog.packages.filter(
    (entry) =>
      normalizeId(entry.category_id) === categoryId &&
      entry.enabled !== false &&
      !entry.parent_id,
  );
  const rows: ListMessageRow[] = [
    ...childCategories.map((entry) => ({
      title: cleanText(entry.name, 60) || "Categoria",
      description: "Ver produtos",
      rowId: `${STORE_ACTION_PREFIX}cc-category:${normalizeId(entry.id)}`,
    })),
    ...packages.map((entry) => ({
      title: cleanText(entry.name, 60) || "Produto",
      description: renderStoreTemplate(menu.productRow, {
        product: cleanText(entry.name, 60),
        price: formatMoney(Math.round(Number(entry.price || 0) * 100)),
        stock: formatAvailableStock(entry.inventory_amount),
        description: stripHtml(entry.description),
      }).slice(0, 110),
      rowId: `${STORE_ACTION_PREFIX}cc-product:${normalizeId(entry.id)}`,
    })),
  ].slice(0, 80);
  if (!rows.length) {
    await sendTextMessage(client, {
      to,
      body: "Não há produtos disponíveis nesta categoria.",
    });
    return;
  }
  const categoryName = cleanText(category.name, 80) || store.name;
  const categoryDescription =
    stripHtml(category.description) || "Escolha um produto.";
  const values = {
    ...(await getStoreCustomerTemplateValues(store.id, to, customerName)),
    store: store.name,
    category: categoryName,
    description: categoryDescription,
  };
  const mediaUrl =
    cleanNullable(category.image, 2_000) || templateMediaUrl(menu);
  await sendStoreListMessage(client, {
    to,
    title: renderStoreTemplate(menu.title, values) || categoryName,
    description:
      renderStoreTemplate(menu.body, values) || categoryDescription,
    buttonText: menu.listButton || "Ver opções",
    footerText: renderStoreTemplate(menu.footer, values),
    sections: [{ title: "Catálogo", rows }],
    media: mediaUrl
      ? { type: "image", media: mediaUrl, sourceUrl: mediaUrl }
      : null,
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const getCentralPackage = async (store: BotStore, packageId: string) => {
  const catalog = await loadCentralCartCatalog(store);
  return {
    catalog,
    product:
      catalog.packages.find((entry) => normalizeId(entry.id) === packageId) ||
      null,
  };
};

const sendCentralProduct = async (
  store: BotStore,
  client: WuzapiClient,
  to: string,
  packageId: string,
  customerName?: string | null,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.product,
    DEFAULT_STORE_MENU_CONFIG.product,
  );
  const { product } = await getCentralPackage(store, packageId);
  if (!product || product.enabled === false)
    throw new Error("Produto indisponível.");
  const productName = cleanText(product.name, 180) || "Produto";
  const price = formatMoney(Math.round(Number(product.price || 0) * 100));
  const stock =
    product.inventory_amount == null
      ? "⚡ Entrega digital"
      : `📦 Estoque: ${product.inventory_amount}`;
  const values = {
    ...(await getStoreCustomerTemplateValues(store.id, to, customerName)),
    store: store.name,
    product: productName,
    description: stripHtml(product.description),
    price,
    stock,
  };
  const body =
    renderStoreTemplate(menu.body, values) ||
    `💰 ${price}\n${stock}${
      stripHtml(product.description)
        ? `\n\n${stripHtml(product.description)}`
        : ""
    }`;
  const mediaUrl =
    cleanNullable(product.image, 2_000) || templateMediaUrl(menu);
  await sendStoreButtonMessage(client, {
    to,
    title: renderStoreTemplate(menu.title, values) || productName,
    body,
    footer: renderStoreTemplate(menu.footer, values) || store.name,
    headerMedia: mediaUrl
      ? { type: "image", media: mediaUrl, sourceUrl: mediaUrl }
      : undefined,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}cc-buy:${packageId}`,
        text: menu.buyButton || "Comprar agora 🛒",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}root`,
        text: menu.backButton || "Voltar à loja ↩️",
        type: "quick_reply",
      },
    ],
  });
};

export const sendBotStoreMenuToCustomer = async (
  userId: number,
  instanceId: number,
  customerJid: string,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const to = cleanText(customerJid, 160);
  if (!to) throw new Error("Cliente não informado.");
  await sendRootMenu(store, await getStoreClient(store), to);
};

export const sendBotStoreProductToCustomer = async (
  userId: number,
  instanceId: number,
  customerJid: string,
  productId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const to = cleanText(customerJid, 160);
  if (!to) throw new Error("Cliente não informado.");
  await sendLocalProduct(
    store,
    await getStoreClient(store),
    to,
    Math.max(0, toInt(productId)),
  );
};

export const deliverBotStoreProductManually = async (
  userId: number,
  instanceId: number,
  customerJid: string,
  productId: number,
  customerName?: string | null,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const to = cleanText(customerJid, 160);
  const product = await getLocalProduct(
    store.id,
    Math.max(0, toInt(productId)),
  );
  if (!to) throw new Error("Cliente não informado.");
  if (!product) throw new Error("Produto não encontrado.");
  const order = await createOrder({
    storeId: store.id,
    productId: product.id,
    provider: "manual",
    customerJid: to,
    customerName: cleanNullable(customerName, 180),
    quantity: 1,
    totalCents: 0,
    status: "paid",
    metadata: { manualDelivery: true, createdByUserId: userId },
  });
  try {
    await reserveInventoryForOrder(store.id, product.id, order.id, 1);
    await deliverLocalOrder(store, order);
  } catch (error) {
    await releaseOrderInventory(store.id, order.id);
    const db = getDb();
    await db.query(
      `UPDATE bot_store_orders
       SET status = 'failed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [order.id, store.id],
    );
    throw error;
  }
};

export const reissueBotStoreOrder = async (
  userId: number,
  instanceId: number,
  orderId: number,
) => {
  const store = await getBotStoreForUser(userId, instanceId);
  if (!store) throw new Error("Loja não encontrada.");
  const db = getDb();
  const [rows] = await db.query<BotStoreOrderRow[]>(
    "SELECT * FROM bot_store_orders WHERE id = ? AND store_id = ? LIMIT 1",
    [Math.max(0, toInt(orderId)), store.id],
  );
  if (!rows.length) throw new Error("Venda não encontrada.");
  const order = mapOrder(rows[0]);
  const product = order.productId
    ? await getLocalProduct(store.id, order.productId, {
        includeDeleted: true,
      })
    : null;
  if (!product) throw new Error("Produto da venda não foi encontrado.");
  const inventory = await listOrderInventory(store.id, order.id);
  if (!inventory.length) {
    throw new Error("Esta venda não possui uma entrega registrada.");
  }
  const client = await getStoreClient(store);
  const deliveryData = inventoryDeliveryData(product.name, inventory);
  if (!deliveryData) throw new Error("A entrega registrada está vazia.");
  const onlyItem = inventory.length === 1 ? inventory[0] : null;
  await sendStoreDelivery({
    store,
    client,
    to: order.customerJid,
    customerName: order.customerName,
    productName: product.name,
    totalCents:
      order.totalCents > 0
        ? order.totalCents
        : product.priceCents * Math.max(1, order.quantity),
    purchaseDate: order.createdAt,
    orderId: order.publicId.slice(0, 8).toUpperCase(),
    data: deliveryData,
    attachment:
      onlyItem?.itemType === "file" &&
      onlyItem.deliveryFileUrl &&
      !onlyItem.deliveryValue
        ? {
            url: onlyItem.deliveryFileUrl,
            fileName:
              onlyItem.deliveryFileName ||
              path.basename(onlyItem.deliveryFileUrl),
            mimeType: onlyItem.deliveryMimeType,
          }
        : null,
  });
};

const buyLocalProduct = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  productId: number;
  customerName: string | null;
}) => {
  const product = await getLocalProduct(params.store.id, params.productId);
  if (
    !product ||
    !product.enabled ||
    (product.stock != null && product.stock <= 0)
  ) {
    throw new Error("Produto indisponível.");
  }
  if (product.priceCents <= 0) {
    const order = await createOrder({
      storeId: params.store.id,
      productId: product.id,
      provider: "free",
      customerJid: params.to,
      customerName: params.customerName,
      totalCents: 0,
      status: "paid",
    });
    await deliverLocalOrder(params.store, order);
    return;
  }

  const availableBalance = await getStoreCustomerBalanceCents(
    params.store.id,
    params.to,
  );
  if (availableBalance >= product.priceCents) {
    const balanceOrder = await createOrder({
      storeId: params.store.id,
      productId: product.id,
      provider: "balance",
      customerJid: params.to,
      customerName: params.customerName,
      totalCents: product.priceCents,
      status: "processing",
      metadata: { paidWithStoreBalance: true },
    });
    let debited = false;
    try {
      await reserveInventoryForOrder(
        params.store.id,
        product.id,
        balanceOrder.id,
        balanceOrder.quantity,
      );
      const debitedSuccessfully = await debitStoreCustomerBalanceForOrder(
        params.store.id,
        balanceOrder.id,
        params.to,
        product.priceCents,
      );
      debited = debitedSuccessfully;
      if (debitedSuccessfully) {
        await deliverLocalOrder(params.store, {
          ...balanceOrder,
          provider: "balance",
          status: "paid",
        });
        return;
      }
      await failPendingOrder(params.store.id, balanceOrder.id);
    } catch (error) {
      if (!debited) {
        await failPendingOrder(params.store.id, balanceOrder.id);
      }
      throw error;
    }
  }

  const provider = params.store.paymentProvider || "mercadopago_pix";
  const order = await createOrder({
    storeId: params.store.id,
    productId: product.id,
    provider,
    customerJid: params.to,
    customerName: params.customerName,
    totalCents: product.priceCents,
  });
  const context = {
    type: "bot_store_purchase",
    storeId: params.store.id,
    instanceId: params.store.instanceId,
    productId: product.id,
    productName: product.name,
    orderPublicId: order.publicId,
  };
  const phone = normalizePhone(params.to);
  let charge: PaymentCharge;
  try {
    charge =
      provider === "polopag_pix"
        ? await createPoloPagPixCharge({
            userId: params.store.userId,
            amount: product.price,
            customerWhatsapp: phone,
            customerName: params.customerName,
            config: await getPoloPagPixConfigForUser(params.store.userId),
            metadata: { skipBalanceCredit: true, context },
          })
        : await createMercadoPagoPixCharge({
            userId: params.store.userId,
            amount: product.price,
            customerWhatsapp: phone,
            customerName: params.customerName,
            config: await getMercadoPagoPixConfigForUser(params.store.userId),
            metadata: { skipBalanceCredit: true, context },
          });
    await attachChargeToOrder(order.id, charge);
  } catch (error) {
    await failPendingOrder(params.store.id, order.id);
    throw error;
  }
  const buttons = [
    ...(charge.qrCode
      ? [
          {
            id: `${STORE_ACTION_PREFIX}pix:${charge.publicId}`,
            text: "Copiar Pix",
            type: "cta_copy" as const,
            copyCode: charge.qrCode,
          },
        ]
      : []),
    ...(charge.ticketUrl
      ? [
          {
            id: `${STORE_ACTION_PREFIX}pay:${charge.publicId}`,
            text: "Abrir pagamento",
            type: "cta_url" as const,
            url: charge.ticketUrl,
          },
        ]
      : []),
  ];
  await sendInteractiveButtons(params.client, {
    to: params.to,
    title: "Pagamento do pedido",
    body: [
      `🛍️ *${product.name}*`,
      `💰 ${formatMoney(product.priceCents)}`,
      "",
      "Pague pelo Pix. A entrega será enviada automaticamente após a confirmação.",
    ].join("\n"),
    footer: params.store.name,
    buttonType: "native",
    buttons:
      buttons.length > 0
        ? buttons
        : [
            {
              id: `${STORE_ACTION_PREFIX}root`,
              text: "Voltar à loja ↩️",
              type: "quick_reply",
            },
          ],
  });
};

const buyCentralProduct = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  packageId: string;
  customerName: string | null;
}) => {
  const { product } = await getCentralPackage(params.store, params.packageId);
  if (!product) throw new Error("Produto indisponível.");
  const phone = normalizePhone(params.to);
  const checkout = await centralFetch<{
    checkout_url?: string;
    order_id?: string | number;
    status?: string;
    price?: number;
    formatted_price?: string;
  }>(params.store, "/app/checkout", {
    method: "POST",
    body: JSON.stringify({
      gateway: params.store.centralCart.checkoutGateway || "OTHER",
      client_email: `cliente-${phone || Date.now()}@botadmin.shop`,
      client_name: params.customerName || "Cliente WhatsApp",
      client_phone: phone ? `+${phone}` : params.to,
      terms: true,
      fields: { client_identifier: phone, botadmin_whatsapp: params.to },
      cart: [
        {
          package_id: Number(params.packageId),
          quantity: 1,
          options: {},
          fields: {},
        },
      ],
    }),
  });
  const checkoutUrl =
    cleanText(checkout.checkout_url, 2_000) ||
    (params.store.centralCart.app?.url && product.slug
      ? `${params.store.centralCart.app.url.replace(/\/+$/, "")}/package/${product.slug}`
      : "");
  await createOrder({
    storeId: params.store.id,
    provider: "central_cart",
    externalOrderId: normalizeId(checkout.order_id),
    customerJid: params.to,
    customerName: params.customerName,
    totalCents: Math.round(Number(checkout.price ?? product.price ?? 0) * 100),
    checkoutUrl: checkoutUrl || null,
    metadata: {
      centralCartPackageId: params.packageId,
      productName: product.name,
    },
  });
  if (!checkoutUrl)
    throw new Error("A Central Cart não retornou o link de checkout.");
  await sendInteractiveButtons(params.client, {
    to: params.to,
    title: "Finalizar compra",
    body: [
      `🛍️ *${cleanText(product.name, 180) || "Produto"}*`,
      `💰 ${checkout.formatted_price || formatMoney(Math.round(Number(product.price || 0) * 100))}`,
      "",
      "Toque abaixo para pagar. Após a aprovação, a entrega será enviada aqui.",
    ].join("\n"),
    footer: params.store.name,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}checkout:${params.packageId}`,
        text: "Ir para pagamento",
        type: "cta_url",
        url: checkoutUrl,
      },
    ],
  });
};

const sendWwPanelOffer = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  offerId: number;
  customerName: string | null;
}) => {
  const integration = await getWwPanelIntegration(params.store.id);
  const offer = await getWwPanelOffer(params.store.id, params.offerId);
  if (!integration?.enabled || !integration.apiKey || !offer?.enabled) {
    throw new Error("Plano IPTV indisponível.");
  }
  const validity =
    offer.months && offer.months > 0
      ? `${offer.months} ${offer.months === 1 ? "mês" : "meses"}`
      : `${offer.days || 1} ${offer.days === 1 ? "dia" : "dias"}`;
  const body = [
    `💰 ${formatMoney(offer.priceCents)}`,
    `📅 Validade: ${validity}`,
    `📺 ${offer.accessIptv} ${offer.accessIptv === 1 ? "tela" : "telas"}`,
    offer.description ? `\n${offer.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.iptv,
    DEFAULT_STORE_MENU_CONFIG.iptv,
  );
  await sendStoreButtonMessage(params.client, {
    to: params.to,
    title: offer.name,
    body,
    footer: params.store.name,
    headerMedia: offer.imageUrl
      ? {
          type: "image",
          media: offer.imageUrl,
          sourceUrl: offer.imageUrl,
        }
      : undefined,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}iptv-buy:${offer.id}`,
        text: offer.isTrial
          ? "Criar teste grátis 🧪"
          : menu.buyButton || "Comprar agora 🛒",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}root`,
        text: menu.backButton || "Voltar à loja ↩️",
        type: "quick_reply",
      },
    ],
  });
};

const buyWwPanelOffer = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  offerId: number;
  customerName: string | null;
  renewClientId?: number | null;
}) => {
  const integration = await getWwPanelIntegration(params.store.id);
  const offer = await getWwPanelOffer(params.store.id, params.offerId);
  if (!integration?.enabled || !integration.apiKey || !offer?.enabled) {
    throw new Error("Plano IPTV indisponível.");
  }
  if (params.renewClientId && offer.isTrial) {
    throw new Error("Uma oferta de teste não pode renovar um acesso.");
  }
  if (
    offer.isTrial &&
    (await customerAlreadyUsedWwPanelTrial(params.store.id, params.to))
  ) {
    throw new Error("Este número já utilizou o teste gratuito.");
  }
  const orderMetadata = {
    integration: params.renewClientId ? "wwpanel_renewal" : "wwpanel",
    wwPanelOfferId: offer.id,
    ...(params.renewClientId
      ? { wwPanelClientId: params.renewClientId }
      : {}),
    productName: offer.name,
  };
  if (offer.priceCents <= 0) {
    const freeOrder = await createOrder({
      storeId: params.store.id,
      provider: "free",
      customerJid: params.to,
      customerName: params.customerName,
      totalCents: 0,
      status: "paid",
      metadata: orderMetadata,
    });
    if (params.renewClientId) {
      await deliverWwPanelRenewalOrder(params.store, freeOrder);
    } else {
      await deliverWwPanelOrder(params.store, freeOrder);
    }
    return;
  }

  const availableBalance = await getStoreCustomerBalanceCents(
    params.store.id,
    params.to,
  );
  if (availableBalance >= offer.priceCents) {
    const balanceOrder = await createOrder({
      storeId: params.store.id,
      provider: "balance",
      customerJid: params.to,
      customerName: params.customerName,
      totalCents: offer.priceCents,
      status: "processing",
      metadata: {
        ...orderMetadata,
        paidWithStoreBalance: true,
      },
    });
    const debited = await debitStoreCustomerBalanceForOrder(
      params.store.id,
      balanceOrder.id,
      params.to,
      offer.priceCents,
    );
    if (debited) {
      try {
        if (params.renewClientId) {
          await deliverWwPanelRenewalOrder(params.store, {
            ...balanceOrder,
            status: "paid",
          });
        } else {
          await deliverWwPanelOrder(params.store, {
            ...balanceOrder,
            status: "paid",
          });
        }
      } catch (error) {
        if (!params.renewClientId) {
          const provisioned = await findWwPanelClientByOrder(
            params.store.id,
            balanceOrder.id,
          );
          if (provisioned) throw error;
        }

        const credit = await creditPaidOrderToCustomerBalance(
          params.store,
          balanceOrder.id,
        );
        if (credit.credited) {
          await sendTextMessage(params.client, {
            to: params.to,
            body: [
              "O acesso IPTV não pôde ser ativado neste momento.",
              `O valor de *${formatMoney(offer.priceCents)}* voltou integralmente para o seu saldo.`,
              `Saldo disponível: *${formatMoney(credit.balanceCents)}*`,
              "",
              "Tente novamente em instantes.",
            ].join("\n"),
          }).catch(() => {});
          return;
        }
        throw error;
      }
      return;
    }
    await failPendingOrder(params.store.id, balanceOrder.id);
  }

  const provider = params.store.paymentProvider || "mercadopago_pix";
  const order = await createOrder({
    storeId: params.store.id,
    provider,
    customerJid: params.to,
    customerName: params.customerName,
    totalCents: offer.priceCents,
    metadata: orderMetadata,
  });
  const context = {
    type: "bot_store_purchase",
    storeId: params.store.id,
    instanceId: params.store.instanceId,
    integration: "wwpanel",
    ...(params.renewClientId
      ? {
          integration: "wwpanel_renewal",
          wwPanelClientId: params.renewClientId,
        }
      : {}),
    wwPanelOfferId: offer.id,
    productName: offer.name,
    orderPublicId: order.publicId,
  };
  const phone = normalizePhone(params.to);
  let charge: PaymentCharge;
  try {
    charge =
      provider === "polopag_pix"
        ? await createPoloPagPixCharge({
            userId: params.store.userId,
            amount: offer.price,
            customerWhatsapp: phone,
            customerName: params.customerName,
            config: await getPoloPagPixConfigForUser(params.store.userId),
            metadata: { skipBalanceCredit: true, context },
          })
        : await createMercadoPagoPixCharge({
            userId: params.store.userId,
            amount: offer.price,
            customerWhatsapp: phone,
            customerName: params.customerName,
            config: await getMercadoPagoPixConfigForUser(params.store.userId),
            metadata: { skipBalanceCredit: true, context },
          });
    await attachChargeToOrder(order.id, charge);
  } catch (error) {
    await failPendingOrder(params.store.id, order.id);
    throw error;
  }
  const buttons = [
    ...(charge.qrCode
      ? [
          {
            id: `${STORE_ACTION_PREFIX}pix:${charge.publicId}`,
            text: "Copiar Pix 📋",
            type: "cta_copy" as const,
            copyCode: charge.qrCode,
          },
        ]
      : []),
    ...(charge.ticketUrl
      ? [
          {
            id: `${STORE_ACTION_PREFIX}pay:${charge.publicId}`,
            text: "Abrir pagamento ↗️",
            type: "cta_url" as const,
            url: charge.ticketUrl,
          },
        ]
      : []),
  ];
  await sendInteractiveButtons(params.client, {
    to: params.to,
    title: params.renewClientId
      ? "Pagamento da renovação IPTV"
      : "Pagamento do plano IPTV",
    body: [
      `📺 *${offer.name}*`,
      `💰 ${formatMoney(offer.priceCents)}`,
      "",
      params.renewClientId
        ? "Pague pelo Pix. O acesso será renovado automaticamente após a confirmação."
        : "Pague pelo Pix. Seu acesso será criado e enviado aqui após a confirmação.",
    ].join("\n"),
    footer: params.store.name,
    buttonType: "native",
    buttons:
      buttons.length > 0
        ? buttons
        : [
            {
              id: `${STORE_ACTION_PREFIX}root`,
              text: "Voltar à loja ↩️",
              type: "quick_reply",
            },
          ],
  });
};

const getCustomerWwPanelClient = async (
  storeId: number,
  customerJid: string,
  clientId: number,
) => {
  const clients = await listCustomerWwPanelClients(storeId, customerJid);
  return clients.find((entry) => entry.id === clientId) || null;
};

const encodeStoreActionPart = (value: string) => encodeURIComponent(value);

const decodeStoreActionPart = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeDetectedMac = (value: string) => {
  const text = cleanText(value, 100);
  const separated = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(text);
  const compact = /^[0-9a-f]{12}$/i.test(text);
  return separated || compact ? text.toUpperCase() : null;
};

const renderWwPanelMessage = (
  store: BotStore,
  key:
    | "trialUsedBody"
    | "macPromptBody"
    | "macAccessBody"
    | "macAppBody"
    | "appActivatedBody",
  values: Record<string, string | number | null | undefined>,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.iptv,
    DEFAULT_STORE_MENU_CONFIG.iptv,
  );
  return renderStoreTemplate(menu[key], {
    store: store.name,
    ...values,
  });
};

const sendWwPanelClientMenu = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  clientId: number;
}) => {
  const access = await getCustomerWwPanelClient(
    params.store.id,
    params.to,
    params.clientId,
  );
  if (!access) throw new Error("Acesso IPTV não encontrado.");
  const offers = (await listWwPanelOffers(params.store.id, false)).filter(
    (offer) => !offer.isTrial && offer.priceCents > 0,
  );
  const apps = wwPanelPublicCatalog().apps;
  const sections = [
    ...(offers.length
      ? [
          {
            title: access.isTrial
              ? "Ativar e continuar assistindo"
              : "Renovar acesso",
            rows: offers.slice(0, 40).map((offer) => ({
              title: offer.name.slice(0, 60),
              description: `${formatMoney(offer.priceCents)} · ${
                offer.months && offer.months > 0
                  ? `${offer.months} ${
                      offer.months === 1 ? "mês" : "meses"
                    }`
                  : `${offer.days || 1} ${
                      offer.days === 1 ? "dia" : "dias"
                    }`
              }`.slice(0, 110),
              rowId: `${STORE_ACTION_PREFIX}iptv-renew-offer:${access.id}:${offer.id}`,
            })),
          },
        ]
      : []),
    {
      title: "Ativar aplicativo por MAC",
      rows: apps.map((app) => ({
        title: app,
        description: "Ativação automática neste acesso".slice(0, 110),
        rowId: `${STORE_ACTION_PREFIX}iptv-app:${access.id}:${encodeStoreActionPart(app)}`,
      })),
    },
  ];
  await sendStoreListMessage(params.client, {
    to: params.to,
    title: access.username,
    description: access.isTrial
      ? "Gerencie seu teste, ative um plano ou libere um aplicativo."
      : "Renove seu acesso ou ative um aplicativo pelo MAC.",
    buttonText: "Gerenciar acesso 📺",
    footerText: params.store.name,
    sections,
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const sendWwPanelRenewalOffer = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  clientId: number;
  offerId: number;
}) => {
  const access = await getCustomerWwPanelClient(
    params.store.id,
    params.to,
    params.clientId,
  );
  const offer = await getWwPanelOffer(params.store.id, params.offerId);
  if (!access || !offer?.enabled || offer.isTrial) {
    throw new Error("Renovação IPTV indisponível.");
  }
  const validity =
    offer.months && offer.months > 0
      ? `${offer.months} ${offer.months === 1 ? "mês" : "meses"}`
      : `${offer.days || 1} ${offer.days === 1 ? "dia" : "dias"}`;
  await sendStoreButtonMessage(params.client, {
    to: params.to,
    title: access.isTrial ? "Ativar acesso IPTV" : "Renovar acesso IPTV",
    body: [
      `👤 ${access.username}`,
      `📺 ${offer.name}`,
      `💰 ${formatMoney(offer.priceCents)}`,
      `📅 ${validity}`,
    ].join("\n"),
    footer: params.store.name,
    headerMedia: offer.imageUrl
      ? {
          type: "image",
          media: offer.imageUrl,
          sourceUrl: offer.imageUrl,
        }
      : undefined,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}iptv-renew-buy:${access.id}:${offer.id}`,
        text: access.isTrial ? "Ativar agora ✅" : "Renovar agora ♻️",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}iptv-client:${access.id}`,
        text: "Voltar ↩️",
        type: "quick_reply",
      },
    ],
  });
};

const beginWwPanelAppActivation = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  clientId: number;
  appName: string;
}) => {
  const access = await getCustomerWwPanelClient(
    params.store.id,
    params.to,
    params.clientId,
  );
  const app = cleanText(params.appName, 40);
  if (!access || !isWwPanelAppName(app)) {
    throw new Error("Aplicativo IPTV indisponível.");
  }
  await setStoreCustomerState(params.store.id, params.to, "wwpanel_app_mac", {
    clientId: access.id,
    app,
  });
  const body =
    renderWwPanelMessage(params.store, "macPromptBody", {
      app,
      usuario: access.username,
    }) ||
    `📺 *Ativar ${app}*\n\nEnvie agora o *MAC* ou identificador exibido no aplicativo.\nPara sair, envie *cancelar*.`;
  await sendTextMessage(params.client, {
    to: params.to,
    body,
  });
};

const completeWwPanelAppActivation = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  access: Awaited<ReturnType<typeof getCustomerWwPanelClient>>;
  app: string;
  mac: string;
}) => {
  if (!params.access || !isWwPanelAppName(params.app)) {
    throw new Error("Acesso ou aplicativo IPTV indisponível.");
  }
  const apiKey = await wwPanelApiKeyForStore(params.store.id);
  await activateWwPanelApp(apiKey, {
    clientId: params.access.externalId,
    nameApp: params.app,
    mac: params.mac,
    namePlaylist: params.store.name,
  });
  await clearStoreCustomerState(params.store.id, params.to);
  const body =
    renderWwPanelMessage(params.store, "appActivatedBody", {
      app: params.app,
      usuario: params.access.username,
      mac: params.mac,
    }) ||
    [
      "✅ *Aplicativo ativado*",
      `📺 ${params.app}`,
      `👤 ${params.access.username}`,
      `🔗 ${params.mac}`,
    ].join("\n");
  await sendTextMessage(params.client, {
    to: params.to,
    body,
  });
};

const sendWwPanelMacAccessSelection = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  mac: string;
}) => {
  const accesses = await listCustomerWwPanelClients(params.store.id, params.to);
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.iptv,
    DEFAULT_STORE_MENU_CONFIG.iptv,
  );
  if (!accesses.length) {
    await sendStoreButtonMessage(params.client, {
      to: params.to,
      title: "Nenhum acesso IPTV",
      body: "Você ainda não possui um acesso para ativar neste aplicativo.",
      footer: params.store.name,
      buttonType: "native",
      buttons: [
        {
          id: `${STORE_ACTION_PREFIX}root`,
          text: menu.backButton || "Voltar à loja ↩️",
          type: "quick_reply",
        },
      ],
    });
    return;
  }
  await setStoreCustomerState(
    params.store.id,
    params.to,
    "wwpanel_mac_access",
    { mac: params.mac },
  );
  const description =
    renderWwPanelMessage(params.store, "macAccessBody", {
      mac: params.mac,
      access_count: accesses.length,
    }) ||
    `Encontrei o MAC *${params.mac}*.\nEscolha o acesso IPTV que deseja ativar.`;
  await sendStoreListMessage(params.client, {
    to: params.to,
    title: "Escolher acesso IPTV",
    description,
    buttonText: menu.macAccessButton || "Escolher acesso 👤",
    footerText: params.store.name,
    sections: [
      {
        title: "Seus acessos",
        rows: accesses.map((access) => ({
          title: access.username.slice(0, 60),
          description: `${
            access.isTrial ? "Teste" : "Acesso"
          } · ${access.status}`.slice(0, 110),
          rowId: `${STORE_ACTION_PREFIX}iptv-mac-client:${access.id}`,
        })),
      },
    ],
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const sendWwPanelMacAppSelection = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  clientId: number;
}) => {
  const state = await getStoreCustomerState(params.store.id, params.to);
  const mac = cleanText(state?.payload.mac, 100);
  const access = await getCustomerWwPanelClient(
    params.store.id,
    params.to,
    params.clientId,
  );
  const validState =
    state?.key === "wwpanel_mac_access" ||
    (state?.key === "wwpanel_mac_app" &&
      toInt(state.payload.clientId) === params.clientId);
  if (!validState || !mac || !access) {
    throw new Error("Envie o endereço MAC novamente para continuar.");
  }
  await setStoreCustomerState(params.store.id, params.to, "wwpanel_mac_app", {
    mac,
    clientId: access.id,
  });
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.iptv,
    DEFAULT_STORE_MENU_CONFIG.iptv,
  );
  const description =
    renderWwPanelMessage(params.store, "macAppBody", {
      mac,
      usuario: access.username,
    }) ||
    `Acesso *${access.username}* selecionado.\nAgora escolha o aplicativo que deseja ativar.`;
  await sendStoreListMessage(params.client, {
    to: params.to,
    title: "Escolher aplicativo",
    description,
    buttonText: menu.macAppButton || "Escolher aplicativo 📺",
    footerText: params.store.name,
    sections: [
      {
        title: "Aplicativos disponíveis",
        rows: wwPanelPublicCatalog().apps.map((app) => ({
          title: app,
          description: `Ativar no MAC ${mac}`.slice(0, 110),
          rowId: `${STORE_ACTION_PREFIX}iptv-mac-app:${access.id}:${encodeStoreActionPart(app)}`,
        })),
      },
    ],
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const completeWwPanelMacSelection = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  clientId: number;
  appName: string;
}) => {
  const state = await getStoreCustomerState(params.store.id, params.to);
  const mac = cleanText(state?.payload.mac, 100);
  const stateClientId = toInt(state?.payload.clientId);
  const access = await getCustomerWwPanelClient(
    params.store.id,
    params.to,
    params.clientId,
  );
  const app = cleanText(params.appName, 40);
  if (
    state?.key !== "wwpanel_mac_app" ||
    !mac ||
    stateClientId !== params.clientId
  ) {
    throw new Error("Envie o endereço MAC novamente para continuar.");
  }
  await completeWwPanelAppActivation({
    store: params.store,
    client: params.client,
    to: params.to,
    access,
    app,
    mac,
  });
};

const renderSmmMessage = (
  store: BotStore,
  key:
    | "linkPromptBody"
    | "quantityPromptBody"
    | "detailsPromptBody"
    | "orderSummaryBody"
    | "statusBody",
  values: Record<string, string | number | null | undefined>,
) => {
  const menu = normalizeMenuTemplate(
    store.menuConfig.smm,
    DEFAULT_STORE_MENU_CONFIG.smm,
  );
  return renderStoreTemplate(menu[key], {
    store: store.name,
    ...values,
  });
};

const smmPriceFor = async (
  storeId: number,
  service: Awaited<ReturnType<typeof getSmmService>>,
  request: SmmAddOrderInput,
) => {
  if (!service) throw new Error("Serviço SMM não encontrado.");
  const integration = await requireSmmIntegration(storeId);
  const usdBrlRate = await refreshSmmFxRate(integration);
  const quantity = smmServiceQuantityFromInput(
    { type: service.serviceType, min: service.min },
    request,
  );
  const price = calculateSmmPrice({
    providerRate: service.providerRate,
    serviceType: service.serviceType,
    quantity,
    usdBrlRate,
    markupPercent: integration.markupPercent,
    fixedMarkupCents: integration.fixedMarkupCents,
    minimumProfitCents: integration.minimumProfitCents,
    customSaleRateCents: service.customSaleRateCents,
  });
  return { ...price, quantity, integration };
};

const sendSmmCategory = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  category: string;
  customerName?: string | null;
}) => {
  const integration = await requireSmmIntegration(params.store.id);
  const services = (
    await listSmmServices(params.store.id, integration, {
      enabledOnly: true,
    })
  )
    .filter((service) => service.category === params.category)
    .slice(0, 80);
  if (!services.length) throw new Error("Categoria SMM indisponível.");
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.smm,
    DEFAULT_STORE_MENU_CONFIG.smm,
  );
  const rows = services.map((service) => ({
    title: service.name.slice(0, 60),
    description: renderStoreTemplate(menu.productRow, {
      service: service.name,
      category: service.category,
      price: formatMoney(service.estimatedSaleCents || 0),
      min: service.min,
      max: service.max,
      type: service.serviceType,
    }).slice(0, 110),
    rowId: `${STORE_ACTION_PREFIX}smm-service:${service.id}`,
  }));
  await sendStoreListMessage(params.client, {
    to: params.to,
    title: params.category.slice(0, 80),
    description: `${services.length} ${
      services.length === 1 ? "serviço disponível" : "serviços disponíveis"
    }.`,
    buttonText: menu.listButton || "Ver serviços 🚀",
    footerText: renderStoreTemplate(menu.footer, {
      store: params.store.name,
      category: params.category,
    }),
    sections: [{ title: "Serviços SMM", rows }],
    media: templateMediaUrl(menu)
      ? {
          type: "image",
          media: templateMediaUrl(menu)!,
          sourceUrl: templateMediaUrl(menu)!,
        }
      : null,
    transport: DEFAULT_LIST_MESSAGE_TRANSPORT,
  });
};

const sendSmmService = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  serviceId: number;
}) => {
  const service = await getSmmService(
    params.store.id,
    params.serviceId,
    true,
  );
  if (!service) throw new Error("Serviço SMM indisponível.");
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.smm,
    DEFAULT_STORE_MENU_CONFIG.smm,
  );
  const fixed = smmServiceUsesFixedPrice(service.serviceType);
  await sendStoreButtonMessage(params.client, {
    to: params.to,
    title: service.name,
    body: [
      `📂 ${service.category}`,
      `💰 ${
        fixed ? "Total" : "A partir de"
      }: ${formatMoney(service.estimatedSaleCents || 0)}${
        fixed ? "" : " por 1.000"
      }`,
      fixed ? "📦 Pacote fechado" : `📦 Mínimo ${service.min} · máximo ${service.max}`,
      service.refill ? "♻️ Reposição disponível" : "",
      service.description ? `\n${service.description}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    footer: params.store.name,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}smm-start:${service.id}`,
        text: menu.buyButton || "Continuar pedido 🛒",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}smm-category:${encodeStoreActionPart(
          service.category,
        )}`,
        text: "Voltar à categoria ↩️",
        type: "quick_reply",
      },
    ],
  });
};

const beginSmmOrder = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  serviceId: number;
}) => {
  const service = await getSmmService(
    params.store.id,
    params.serviceId,
    true,
  );
  if (!service) throw new Error("Serviço SMM indisponível.");
  await setStoreCustomerState(params.store.id, params.to, "smm_target", {
    serviceId: service.id,
  });
  const body =
    renderSmmMessage(params.store, "linkPromptBody", {
      service: service.name,
      category: service.category,
      min: service.min,
      max: service.max,
    }) ||
    `Envie o link que receberá o serviço *${service.name}*.`;
  await sendTextMessage(params.client, { to: params.to, body });
};

const smmDetailInstructions = (type: string) => {
  switch (type.toLowerCase()) {
    case "custom comments":
    case "custom comments package":
      return "Envie um comentário por linha.";
    case "mentions custom list":
      return "Envie um usuário por linha, com ou sem @.";
    case "seo":
      return "Envie as palavras-chave separadas por vírgula.";
    case "mentions hashtag":
      return "Envie a hashtag, com ou sem #.";
    case "mentions user followers":
    case "comment likes":
      return "Envie o nome do usuário, com ou sem @.";
    case "poll":
      return "Envie o número da alternativa da enquete.";
    case "invites from groups":
      return "Envie os links ou IDs dos grupos, um por linha.";
    case "web traffic":
      return "Opcional: país|dispositivo|tipo|palavra-chave|URL de referência. Envie *pular* para usar o padrão.";
    case "subscriptions":
      return "Envie no formato mínimo:máximo:posts:posts antigos:atraso. Exemplo: 10:20:5:0:0.";
    default:
      return "";
  }
};

const smmNeedsDetails = (type: string) =>
  [
    "custom comments",
    "custom comments package",
    "mentions custom list",
    "seo",
    "mentions hashtag",
    "mentions user followers",
    "comment likes",
    "poll",
    "invites from groups",
    "web traffic",
    "subscriptions",
  ].includes(type.toLowerCase());

const sendSmmQuantityPrompt = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  service: NonNullable<Awaited<ReturnType<typeof getSmmService>>>;
  target: string;
}) => {
  await setStoreCustomerState(params.store.id, params.to, "smm_quantity", {
    serviceId: params.service.id,
    target: params.target,
  });
  const body =
    renderSmmMessage(params.store, "quantityPromptBody", {
      service: params.service.name,
      target: params.target,
      min: params.service.min,
      max: params.service.max,
    }) ||
    `Envie uma quantidade entre ${params.service.min} e ${params.service.max}.`;
  await sendTextMessage(params.client, { to: params.to, body });
};

const sendSmmDetailsPrompt = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  service: NonNullable<Awaited<ReturnType<typeof getSmmService>>>;
  target: string;
  quantity?: number;
}) => {
  const instructions = smmDetailInstructions(params.service.serviceType);
  await setStoreCustomerState(params.store.id, params.to, "smm_details", {
    serviceId: params.service.id,
    target: params.target,
    quantity: params.quantity,
  });
  const body =
    renderSmmMessage(params.store, "detailsPromptBody", {
      service: params.service.name,
      target: params.target,
      quantity: params.quantity,
      min: params.service.min,
      max: params.service.max,
      instructions,
    }) || instructions;
  await sendTextMessage(params.client, { to: params.to, body });
};

const buildSmmRequest = (
  service: NonNullable<Awaited<ReturnType<typeof getSmmService>>>,
  target: string,
  quantity?: number,
  details?: string,
): SmmAddOrderInput => {
  const type = service.serviceType.toLowerCase();
  const request: SmmAddOrderInput = {
    service: service.providerServiceId,
    link: target,
  };
  if (!smmServiceUsesFixedPrice(type) && quantity) request.quantity = quantity;
  const value = cleanText(details, 20_000);
  if (type === "custom comments" || type === "custom comments package") {
    request.comments = value;
    request.quantity = value.split(/\r?\n/).filter((line) => line.trim()).length;
  } else if (type === "mentions custom list") {
    request.usernames = value;
    request.quantity = value.split(/\r?\n/).filter((line) => line.trim()).length;
  } else if (type === "seo") {
    request.keywords = value;
  } else if (type === "mentions hashtag") {
    request.hashtag = value.replace(/^#/, "");
  } else if (type === "mentions user followers" || type === "comment likes") {
    request.username = value.replace(/^@/, "");
  } else if (type === "poll") {
    request.answerNumber = Math.max(1, toInt(value, 1));
  } else if (type === "invites from groups") {
    request.groups = value;
  } else if (type === "subscriptions") {
    const [min, max, posts, oldPosts, delay] = value
      .split(":")
      .map((part) => Math.max(0, toInt(part)));
    request.min = Math.max(1, min || service.min);
    request.max = Math.max(request.min, max || request.min);
    request.posts = Math.max(1, posts || 1);
    request.oldPosts = oldPosts || 0;
    request.delay = delay || 0;
    request.username = target.replace(/^@/, "");
    delete request.quantity;
  } else if (type === "web traffic" && value.toLowerCase() !== "pular") {
    const [country, device, trafficType, googleKeyword, referringUrl] =
      value.split("|").map((part) => part.trim());
    request.country = country || undefined;
    request.device = device || undefined;
    request.trafficType = trafficType ? Math.max(1, toInt(trafficType)) : undefined;
    request.googleKeyword = googleKeyword || undefined;
    request.referringUrl = referringUrl || undefined;
  }
  return request;
};

const sendSmmQuote = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  service: NonNullable<Awaited<ReturnType<typeof getSmmService>>>;
  request: SmmAddOrderInput;
}) => {
  const quote = await smmPriceFor(params.store.id, params.service, params.request);
  if (
    !smmServiceUsesFixedPrice(params.service.serviceType) &&
    (quote.quantity < params.service.min || quote.quantity > params.service.max)
  ) {
    throw new Error(
      `A quantidade deve ficar entre ${params.service.min} e ${params.service.max}.`,
    );
  }
  await setStoreCustomerState(params.store.id, params.to, "smm_ready", {
    serviceId: params.service.id,
    request: params.request,
    quantity: quote.quantity,
    providerCostUsd: quote.providerCostUsd,
    totalCents: quote.totalCents,
  });
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.smm,
    DEFAULT_STORE_MENU_CONFIG.smm,
  );
  const body =
    renderSmmMessage(params.store, "orderSummaryBody", {
      service: params.service.name,
      category: params.service.category,
      target: params.request.link,
      quantity: quote.quantity,
      price: formatMoney(quote.totalCents),
    }) ||
    `${params.service.name}\n${quote.quantity}\n${formatMoney(quote.totalCents)}`;
  await sendStoreButtonMessage(params.client, {
    to: params.to,
    title: "Confirmar pedido SMM",
    body,
    footer: params.store.name,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}smm-buy:${params.service.id}`,
        text: menu.buyButton || "Gerar pagamento 🛒",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}smm-service:${params.service.id}`,
        text: "Alterar pedido ↩️",
        type: "quick_reply",
      },
    ],
  });
};

const buySmmService = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  serviceId: number;
  customerName?: string | null;
}) => {
  const state = await getStoreCustomerState(params.store.id, params.to);
  if (
    state?.key !== "smm_ready" ||
    toInt(state.payload.serviceId) !== params.serviceId
  ) {
    throw new Error("Monte o pedido SMM novamente para atualizar o preço.");
  }
  const service = await getSmmService(
    params.store.id,
    params.serviceId,
    true,
  );
  if (!service) throw new Error("Serviço SMM indisponível.");
  const request = state.payload.request as SmmAddOrderInput;
  const quote = await smmPriceFor(params.store.id, service, request);
  const expectedTotal = Math.max(1, toInt(state.payload.totalCents));
  if (Math.abs(quote.totalCents - expectedTotal) > 1) {
    await sendSmmQuote({
      store: params.store,
      client: params.client,
      to: params.to,
      service,
      request,
    });
    return;
  }
  const provider = params.store.paymentProvider || "mercadopago_pix";
  const orderMetadata = {
    integration: "smm",
    smmServiceId: service.id,
    productName: service.name,
    quantity: quote.quantity,
    target: request.link,
  };
  const availableBalance = await getStoreCustomerBalanceCents(
    params.store.id,
    params.to,
  );
  const usesBalance = availableBalance >= quote.totalCents;
  const order = await createOrder({
    storeId: params.store.id,
    provider: usesBalance ? "balance" : provider,
    customerJid: params.to,
    customerName: params.customerName,
    quantity: quote.quantity,
    totalCents: quote.totalCents,
    status: usesBalance ? "processing" : "pending",
    metadata: {
      ...orderMetadata,
      ...(usesBalance ? { paidWithStoreBalance: true } : {}),
    },
  });
  const db = getDb();
  try {
    await db.query(
      `INSERT INTO bot_store_smm_orders (
         store_id, order_id, service_id, customer_jid, target, quantity,
         request_payload, provider_cost, provider_currency,
         sale_total_cents, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'pending_payment')`,
      [
        params.store.id,
        order.id,
        service.id,
        params.to,
        request.link,
        quote.quantity,
        JSON.stringify(request),
        quote.providerCostUsd,
        quote.totalCents,
      ],
    );
  } catch (error) {
    await failPendingOrder(params.store.id, order.id);
    throw error;
  }
  await clearStoreCustomerState(params.store.id, params.to);
  if (usesBalance) {
    const debited = await debitStoreCustomerBalanceForOrder(
      params.store.id,
      order.id,
      params.to,
      quote.totalCents,
    );
    if (!debited) {
      await failPendingOrder(params.store.id, order.id);
      throw new Error("O saldo mudou. Monte o pedido novamente.");
    }
    try {
      await deliverSmmOrder(params.store, { ...order, status: "paid" });
    } catch (error) {
      const credit = await creditPaidOrderToCustomerBalance(
        params.store,
        order.id,
      );
      if (!credit.credited) throw error;
      await sendTextMessage(params.client, {
        to: params.to,
        body: "Não consegui criar o pedido agora. O valor voltou integralmente para o seu saldo.",
      }).catch(() => {});
    }
    return;
  }
  const context = {
    type: "bot_store_purchase",
    storeId: params.store.id,
    instanceId: params.store.instanceId,
    integration: "smm",
    smmServiceId: service.id,
    productName: service.name,
    orderPublicId: order.publicId,
  };
  const phone = normalizePhone(params.to);
  let charge: PaymentCharge;
  try {
    charge =
      provider === "polopag_pix"
        ? await createPoloPagPixCharge({
            userId: params.store.userId,
            amount: quote.totalCents / 100,
            customerWhatsapp: phone,
            customerName: params.customerName,
            config: await getPoloPagPixConfigForUser(params.store.userId),
            metadata: { skipBalanceCredit: true, context },
          })
        : await createMercadoPagoPixCharge({
            userId: params.store.userId,
            amount: quote.totalCents / 100,
            customerWhatsapp: phone,
            customerName: params.customerName,
            config: await getMercadoPagoPixConfigForUser(params.store.userId),
            metadata: { skipBalanceCredit: true, context },
          });
    await attachChargeToOrder(order.id, charge);
  } catch (error) {
    await failPendingOrder(params.store.id, order.id);
    throw error;
  }
  const buttons = [
    ...(charge.qrCode
      ? [
          {
            id: `${STORE_ACTION_PREFIX}pix:${charge.publicId}`,
            text: "Copiar Pix 📋",
            type: "cta_copy" as const,
            copyCode: charge.qrCode,
          },
        ]
      : []),
    ...(charge.ticketUrl
      ? [
          {
            id: `${STORE_ACTION_PREFIX}pay:${charge.publicId}`,
            text: "Abrir pagamento ↗️",
            type: "cta_url" as const,
            url: charge.ticketUrl,
          },
        ]
      : []),
  ];
  await sendInteractiveButtons(params.client, {
    to: params.to,
    title: "Pagamento do pedido SMM",
    body: [
      `🚀 *${service.name}*`,
      `📦 ${quote.quantity}`,
      `💰 ${formatMoney(quote.totalCents)}`,
      "",
      "O pedido será criado automaticamente após a confirmação.",
    ].join("\n"),
    footer: params.store.name,
    buttonType: "native",
    buttons:
      buttons.length > 0
        ? buttons
        : [
            {
              id: `${STORE_ACTION_PREFIX}root`,
              text: "Voltar à loja ↩️",
              type: "quick_reply",
            },
          ],
  });
};

const sendSmmOrderStatus = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  smmOrderId: number;
}) => {
  const order = await getSmmOrderById(params.store.id, params.smmOrderId);
  if (!order || order.customerJid !== params.to) {
    throw new Error("Pedido SMM não encontrado.");
  }
  let current = order;
  if (order.providerOrderId) {
    const integration = await requireSmmIntegration(params.store.id);
    await syncSmmOrderStatus(integration, order.id).catch(() => null);
    current = (await getSmmOrderById(params.store.id, order.id)) || order;
  }
  const menu = normalizeMenuTemplate(
    params.store.menuConfig.smm,
    DEFAULT_STORE_MENU_CONFIG.smm,
  );
  const body =
    renderSmmMessage(params.store, "statusBody", {
      service: current.serviceName,
      category: current.serviceCategory,
      target: current.target,
      quantity: current.quantity,
      price: formatMoney(current.saleTotalCents),
      order: current.providerOrderId || current.id,
      pedido: current.providerOrderId || current.id,
      status: current.status,
      remains: current.remains || "-",
    }) || `Status: ${current.status}`;
  await sendStoreButtonMessage(params.client, {
    to: params.to,
    title: "Acompanhar pedido SMM",
    body,
    footer: params.store.name,
    buttonType: "native",
    buttons: [
      {
        id: `${STORE_ACTION_PREFIX}smm-order:${current.id}`,
        text: "Atualizar status 🔄",
        type: "quick_reply",
      },
      {
        id: `${STORE_ACTION_PREFIX}root`,
        text: menu.backButton || "Voltar à loja ↩️",
        type: "quick_reply",
      },
    ],
  });
};

const handleStoreCustomerState = async (params: {
  store: BotStore;
  client: WuzapiClient;
  to: string;
  text: string;
}) => {
  const state = await getStoreCustomerState(params.store.id, params.to);
  if (!state) return false;
  const text = cleanText(params.text, 100);
  if (text.toLowerCase() === "cancelar") {
    await clearStoreCustomerState(params.store.id, params.to);
    await sendTextMessage(params.client, {
      to: params.to,
      body: "Ativação cancelada.",
    });
    return true;
  }
  if (state.key.startsWith("smm_")) {
    const service = await getSmmService(
      params.store.id,
      toInt(state.payload.serviceId),
      true,
    );
    if (!service) {
      await clearStoreCustomerState(params.store.id, params.to);
      throw new Error("Serviço SMM indisponível.");
    }
    const target = cleanText(state.payload.target, 2_000);
    if (state.key === "smm_target") {
      const submittedTarget = cleanText(params.text, 2_000);
      if (submittedTarget.length < 3) {
        await sendTextMessage(params.client, {
          to: params.to,
          body: "Envie um link, usuário ou destino válido.",
        });
        return true;
      }
      if (
        smmServiceUsesFixedPrice(service.serviceType) &&
        !smmNeedsDetails(service.serviceType)
      ) {
        await sendSmmQuote({
          store: params.store,
          client: params.client,
          to: params.to,
          service,
          request: buildSmmRequest(service, submittedTarget),
        });
      } else if (
        ["custom comments package", "subscriptions"].includes(
          service.serviceType.toLowerCase(),
        )
      ) {
        await sendSmmDetailsPrompt({
          store: params.store,
          client: params.client,
          to: params.to,
          service,
          target: submittedTarget,
        });
      } else {
        await sendSmmQuantityPrompt({
          store: params.store,
          client: params.client,
          to: params.to,
          service,
          target: submittedTarget,
        });
      }
      return true;
    }
    if (state.key === "smm_quantity") {
      const quantity = toInt(params.text);
      if (quantity < service.min || quantity > service.max) {
        await sendTextMessage(params.client, {
          to: params.to,
          body: `Envie uma quantidade entre *${service.min}* e *${service.max}*.`,
        });
        return true;
      }
      if (smmNeedsDetails(service.serviceType)) {
        await sendSmmDetailsPrompt({
          store: params.store,
          client: params.client,
          to: params.to,
          service,
          target,
          quantity,
        });
      } else {
        await sendSmmQuote({
          store: params.store,
          client: params.client,
          to: params.to,
          service,
          request: buildSmmRequest(service, target, quantity),
        });
      }
      return true;
    }
    if (state.key === "smm_details") {
      const details = cleanText(params.text, 20_000);
      if (!details) {
        await sendTextMessage(params.client, {
          to: params.to,
          body: "Envie os dados solicitados para continuar.",
        });
        return true;
      }
      await sendSmmQuote({
        store: params.store,
        client: params.client,
        to: params.to,
        service,
        request: buildSmmRequest(
          service,
          target,
          toInt(state.payload.quantity),
          details,
        ),
      });
      return true;
    }
    return true;
  }
  if (state.key !== "wwpanel_app_mac") {
    if (state.key === "wwpanel_mac_access") {
      await sendWwPanelMacAccessSelection({
        store: params.store,
        client: params.client,
        to: params.to,
        mac: cleanText(state.payload.mac, 100),
      });
      return true;
    }
    if (state.key === "wwpanel_mac_app") {
      await sendWwPanelMacAppSelection({
        store: params.store,
        client: params.client,
        to: params.to,
        clientId: toInt(state.payload.clientId),
      });
      return true;
    }
    await clearStoreCustomerState(params.store.id, params.to);
    return false;
  }
  const compactMac = text.replace(/[^a-zA-Z0-9]/g, "");
  if (compactMac.length < 6) {
    await sendTextMessage(params.client, {
      to: params.to,
      body: "Envie o MAC ou identificador completo exibido no aplicativo.",
    });
    return true;
  }
  const access = await getCustomerWwPanelClient(
    params.store.id,
    params.to,
    toInt(state.payload.clientId),
  );
  const app = cleanText(state.payload.app, 40);
  if (!access || !isWwPanelAppName(app)) {
    await clearStoreCustomerState(params.store.id, params.to);
    throw new Error("Acesso ou aplicativo IPTV indisponível.");
  }
  await completeWwPanelAppActivation({
    store: params.store,
    client: params.client,
    to: params.to,
    access,
    app,
    mac: text,
  });
  return true;
};

const actionFromMessage = (text: string, buttonId?: string | null) => {
  const id = cleanText(buttonId, 500);
  if (id.startsWith(STORE_ACTION_PREFIX)) return id;
  const normalized = cleanText(text, 500).toLowerCase();
  return normalized;
};

export const handleBotStorePrivateMessage = async (params: {
  instanceId: number;
  client: WuzapiClient;
  chatId: string;
  text: string;
  buttonId?: string | null;
  customerName?: string | null;
}): Promise<boolean> => {
  const store = await getBotStoreByInstance(params.instanceId);
  if (!store?.enabled) return false;
  if (
    !cleanText(params.buttonId, 500) &&
    (await handleStoreCustomerState({
      store,
      client: params.client,
      to: params.chatId,
      text: params.text,
    }))
  ) {
    return true;
  }
  if (!cleanText(params.buttonId, 500)) {
    const detectedMac = normalizeDetectedMac(params.text);
    if (detectedMac) {
      try {
        await sendWwPanelMacAccessSelection({
          store,
          client: params.client,
          to: params.chatId,
          mac: detectedMac,
        });
      } catch (error) {
        console.error("[bot-store] Falha ao iniciar ativação pelo MAC", {
          instanceId: params.instanceId,
          chatId: params.chatId,
          error,
        });
        await sendTextMessage(params.client, {
          to: params.chatId,
          body: "Não consegui consultar seus acessos agora. Tente novamente em instantes.",
        }).catch(() => {});
      }
      return true;
    }
  }
  const action = actionFromMessage(params.text, params.buttonId);
  const isRootCommand = store.commands.some(
    (command) =>
      action === command ||
      action === `/${command}` ||
      action === `!${command}` ||
      action === `.${command}`,
  );
  const isStoreAction = action.startsWith(STORE_ACTION_PREFIX);
  const autoOpenRoot =
    store.autoOpenPrivate && !isStoreAction && !cleanText(params.buttonId, 500);
  if (!isRootCommand && !isStoreAction && !autoOpenRoot) return false;
  try {
    if (
      isRootCommand ||
      autoOpenRoot ||
      action === `${STORE_ACTION_PREFIX}root`
    ) {
      await sendRootMenu(
        store,
        params.client,
        params.chatId,
        params.customerName,
      );
      return true;
    }
    const [, kind, ...rest] = action.split(":");
    const id = rest.join(":");
    if (kind === "category") {
      await sendLocalCategory(
        store,
        params.client,
        params.chatId,
        toInt(id),
        params.customerName,
      );
    } else if (kind === "uncategorized") {
      await sendUncategorizedProducts(
        store,
        params.client,
        params.chatId,
        params.customerName,
      );
    } else if (kind === "product") {
      await sendLocalProduct(
        store,
        params.client,
        params.chatId,
        toInt(id),
        params.customerName,
      );
    } else if (kind === "buy") {
      await ensureBotStoreCustomerCanBuy(store.id, params.chatId);
      await buyLocalProduct({
        store,
        client: params.client,
        to: params.chatId,
        productId: toInt(id),
        customerName: params.customerName || null,
      });
    } else if (kind === "cc-category") {
      await sendCentralCategory(
        store,
        params.client,
        params.chatId,
        id,
        params.customerName,
      );
    } else if (kind === "cc-product") {
      await sendCentralProduct(
        store,
        params.client,
        params.chatId,
        id,
        params.customerName,
      );
    } else if (kind === "cc-buy") {
      await ensureBotStoreCustomerCanBuy(store.id, params.chatId);
      await buyCentralProduct({
        store,
        client: params.client,
        to: params.chatId,
        packageId: id,
        customerName: params.customerName || null,
      });
    } else if (kind === "iptv-offer") {
      await sendWwPanelOffer({
        store,
        client: params.client,
        to: params.chatId,
        offerId: toInt(id),
        customerName: params.customerName || null,
      });
    } else if (kind === "iptv-buy") {
      await ensureBotStoreCustomerCanBuy(store.id, params.chatId);
      await buyWwPanelOffer({
        store,
        client: params.client,
        to: params.chatId,
        offerId: toInt(id),
        customerName: params.customerName || null,
      });
    } else if (kind === "iptv-client") {
      await sendWwPanelClientMenu({
        store,
        client: params.client,
        to: params.chatId,
        clientId: toInt(id),
      });
    } else if (kind === "iptv-renew-offer") {
      const [clientId, offerId] = id.split(":").map((value) => toInt(value));
      await sendWwPanelRenewalOffer({
        store,
        client: params.client,
        to: params.chatId,
        clientId,
        offerId,
      });
    } else if (kind === "iptv-renew-buy") {
      const [clientId, offerId] = id.split(":").map((value) => toInt(value));
      await ensureBotStoreCustomerCanBuy(store.id, params.chatId);
      await buyWwPanelOffer({
        store,
        client: params.client,
        to: params.chatId,
        offerId,
        customerName: params.customerName || null,
        renewClientId: clientId,
      });
    } else if (kind === "iptv-app") {
      const [clientIdRaw, ...appParts] = id.split(":");
      await beginWwPanelAppActivation({
        store,
        client: params.client,
        to: params.chatId,
        clientId: toInt(clientIdRaw),
        appName: decodeStoreActionPart(appParts.join(":")),
      });
    } else if (kind === "iptv-mac-client") {
      await sendWwPanelMacAppSelection({
        store,
        client: params.client,
        to: params.chatId,
        clientId: toInt(id),
      });
    } else if (kind === "iptv-mac-app") {
      const [clientIdRaw, ...appParts] = id.split(":");
      await completeWwPanelMacSelection({
        store,
        client: params.client,
        to: params.chatId,
        clientId: toInt(clientIdRaw),
        appName: decodeStoreActionPart(appParts.join(":")),
      });
    } else if (kind === "smm-category") {
      await sendSmmCategory({
        store,
        client: params.client,
        to: params.chatId,
        category: decodeStoreActionPart(id),
        customerName: params.customerName,
      });
    } else if (kind === "smm-service") {
      await sendSmmService({
        store,
        client: params.client,
        to: params.chatId,
        serviceId: toInt(id),
      });
    } else if (kind === "smm-start") {
      await beginSmmOrder({
        store,
        client: params.client,
        to: params.chatId,
        serviceId: toInt(id),
      });
    } else if (kind === "smm-buy") {
      await ensureBotStoreCustomerCanBuy(store.id, params.chatId);
      await buySmmService({
        store,
        client: params.client,
        to: params.chatId,
        serviceId: toInt(id),
        customerName: params.customerName,
      });
    } else if (kind === "smm-order") {
      await sendSmmOrderStatus({
        store,
        client: params.client,
        to: params.chatId,
        smmOrderId: toInt(id),
      });
    } else {
      return false;
    }
  } catch (error) {
    console.error("[bot-store] Falha no atendimento da loja", {
      instanceId: params.instanceId,
      chatId: params.chatId,
      action,
      error,
    });
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("já utilizou o teste gratuito")) {
      const menu = normalizeMenuTemplate(
        store.menuConfig.iptv,
        DEFAULT_STORE_MENU_CONFIG.iptv,
      );
      const values = await getStoreCustomerTemplateValues(
        store.id,
        params.chatId,
        params.customerName,
      );
      await sendStoreButtonMessage(params.client, {
        to: params.chatId,
        title: "Teste já utilizado",
        body:
          renderWwPanelMessage(store, "trialUsedBody", values) ||
          "Este número já utilizou o teste gratuito. Escolha um plano para continuar assistindo.",
        footer: store.name,
        buttonType: "native",
        buttons: [
          {
            id: `${STORE_ACTION_PREFIX}root`,
            text: menu.trialUsedButton || "Voltar aos planos ↩️",
            type: "quick_reply",
          },
        ],
      }).catch(() => {});
      return true;
    }
    const message = isStoreInventoryUnavailableError(error)
      ? "Este produto acabou de esgotar. Escolha outra opção ou tente novamente após a reposição."
      : action.includes(":buy") ||
          action.includes(":cc-buy") ||
          action.includes(":iptv-buy") ||
          action.includes(":smm-buy")
        ? "Não consegui iniciar o pagamento agora. Tente novamente em instantes ou escolha outra opção."
        : "Não consegui abrir esta opção agora. Envie *loja* para continuar.";
    await sendTextMessage(params.client, {
      to: params.chatId,
      body: message,
    }).catch(() => {});
  }
  return true;
};

const getEventHeader = (request: Request, names: string[]) => {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value?.trim()) return value.trim();
  }
  return "";
};

export const verifyCentralCartWebhook = (
  request: Request,
  rawBody: string,
  payload: unknown,
  store: BotStore,
) => {
  const secret = cleanText(store.centralCart.webhook?.secret, 2_000);
  if (!secret) return true;
  const signature = getEventHeader(request, [
    "x-centralcart-signature",
    "x-webhook-signature",
    "x-signature",
  ]).replace(/^sha256=/i, "");
  const timestamp = getEventHeader(request, [
    "x-centralcart-timestamp",
    "x-webhook-timestamp",
    "x-timestamp",
  ]);
  if (!signature) return false;
  const candidates = [
    rawBody,
    timestamp ? `${timestamp}.${rawBody}` : rawBody,
  ].map((value) => createHmac("sha256", secret).update(value).digest("hex"));
  return candidates.some((expected) => {
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  });
};

const centralOrderId = (order: JsonRecord) =>
  normalizeId(order.internal_id || order.id || order.external_id);

const centralOrderRecipient = (order: JsonRecord) =>
  normalizePhone(
    cleanText(order.client_phone, 100) ||
      cleanText(order.client_identifier, 100) ||
      cleanText((order.fields as JsonRecord | null)?.botadmin_whatsapp, 100),
  );

const centralDeliveries = (order: JsonRecord) =>
  Array.isArray(order.deliveries)
    ? order.deliveries.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];

export const processCentralCartWebhook = async (params: {
  store: BotStore;
  eventId: string;
  event: string;
  data: JsonRecord;
}) => {
  const event = params.event.toUpperCase();
  const rawOrder =
    params.data.order && typeof params.data.order === "object"
      ? (params.data.order as JsonRecord)
      : params.data;
  let order = rawOrder;
  const orderId = centralOrderId(order);
  if (
    orderId &&
    (event === "ORDER_APPROVED" || !centralDeliveries(order).length)
  ) {
    order = await centralFetch<JsonRecord>(
      params.store,
      `/app/order/${orderId}`,
    ).catch(() => order);
  }
  const resolvedOrderId = centralOrderId(order) || orderId;
  const eventKey = `${params.store.id}:${params.eventId || event}:${event}:${resolvedOrderId}`;
  const db = getDb();
  try {
    await db.query(
      "INSERT INTO bot_store_events (store_id, event_key, event_type, payload) VALUES (?, ?, ?, ?)",
      [params.store.id, eventKey, event, JSON.stringify(params.data)],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("duplicate") || message.includes("unique"))
      return { duplicate: true };
    throw error;
  }
  await db.query(
    `
      UPDATE bot_store_orders
      SET status = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ? AND external_order_id = ?
    `,
    [
      event === "ORDER_APPROVED"
        ? "paid"
        : event === "ORDER_REFUNDED"
          ? "refunded"
          : event === "ORDER_CHARGEDBACK"
            ? "chargedback"
            : event === "ORDER_REJECTED"
              ? "rejected"
              : "pending",
      JSON.stringify({ centralCartEvent: params.data }),
      params.store.id,
      resolvedOrderId,
    ],
  );
  if (event !== "ORDER_APPROVED") return { duplicate: false, delivered: false };

  const recipient = centralOrderRecipient(order);
  if (!recipient) throw new Error("Pedido aprovado sem WhatsApp do cliente.");
  const to = `${recipient}@s.whatsapp.net`;
  const client = await getStoreClient(params.store);
  const packages = Array.isArray(order.packages) ? order.packages : [];
  const firstPackage =
    packages[0] && typeof packages[0] === "object"
      ? (packages[0] as JsonRecord)
      : {};
  const productName =
    cleanText(firstPackage.name, 180) ||
    cleanText((firstPackage.meta as JsonRecord | null)?.name, 180) ||
    "Produto digital";
  const chatDelivery = cleanText(
    (firstPackage.meta as JsonRecord | null)?.chat_delivery &&
      typeof (firstPackage.meta as JsonRecord).chat_delivery === "object"
      ? ((firstPackage.meta as JsonRecord).chat_delivery as JsonRecord)
          .initial_message
      : null,
    20_000,
  );
  const deliveries = centralDeliveries(order)
    .map((delivery) => ({
      type: cleanText(delivery.type, 40).toUpperCase(),
      value: cleanText(delivery.value, 20_000),
    }))
    .filter((delivery) => delivery.value);
  const deliveryParts = deliveries.map((delivery) => delivery.value);
  if (chatDelivery && !deliveryParts.includes(chatDelivery)) {
    deliveryParts.push(chatDelivery);
  }
  const deliveryData = deliveryParts.join("\n\n");
  const onlyDelivery = deliveries.length === 1 ? deliveries[0] : null;
  const isAttachment =
    onlyDelivery &&
    !["CHAT", "TEXT", "URL", "LINK"].includes(onlyDelivery.type) &&
    /^https?:\/\//i.test(onlyDelivery.value);
  let attachment: {
    url: string;
    fileName: string;
    mimeType?: string | null;
  } | null = null;
  if (isAttachment && onlyDelivery) {
    const fileName =
      path.basename(new URL(onlyDelivery.value).pathname) ||
      `entrega-${Date.now()}`;
    attachment = { url: onlyDelivery.value, fileName };
  }
  const totalValue = Number(
    order.total ??
      order.amount ??
      order.price ??
      firstPackage.price ??
      firstPackage.amount ??
      0,
  );
  await sendStoreDelivery({
    store: params.store,
    client,
    to,
    customerName:
      cleanNullable(order.client_name, 180) ||
      cleanNullable(order.customer_name, 180),
    productName,
    totalCents: Number.isFinite(totalValue)
      ? Math.max(0, Math.round(totalValue * 100))
      : 0,
    purchaseDate:
      cleanNullable(order.approved_at, 100) ||
      cleanNullable(order.created_at, 100) ||
      new Date(),
    orderId: resolvedOrderId,
    data: deliveryData || "Entrega digital liberada.",
    attachment,
  });
  await db.query(
    `
      UPDATE bot_store_orders
      SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ? AND external_order_id = ?
    `,
    [params.store.id, resolvedOrderId],
  );
  return { duplicate: false, delivered: true };
};
