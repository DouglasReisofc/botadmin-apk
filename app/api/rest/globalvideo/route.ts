import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { spawn } from "node:child_process";

import { withUserApiAuth } from "lib/api-rest-auth";
import { getAffiliateProviderRuntimeConfig } from "lib/admin-affiliate-providers";
import {
  generateShopeeShortLink,
  searchShopeeAffiliate,
} from "lib/apis/shopee-affiliate";
import { resolveAffiliateShopeeLinkForUserByItemId } from "lib/affiliate-shopee-links";
import {
  extractShopeeVideo,
  isShopeeUrl,
  type ShopeeExtractorLinkedProduct,
} from "lib/shopee-extractor";
import type { UserApiKey } from "lib/user-api-keys";

export const runtime = "nodejs";
export const maxDuration = 300;

type ShopeeRouteProduct = {
  itemId: string | null;
  shopId: string | null;
  title: string | null;
  description: string | null;
  productUrl: string | null;
  affiliateUrl: string | null;
  imageUrl: string | null;
  priceFormatted: string | null;
  shopName: string | null;
  ratingStar: string | null;
};

const getBaseUrl = () => {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, "");
  if (process.env.BASE_SITE_URL?.trim()) return process.env.BASE_SITE_URL.trim().replace(/\/$/, "");
  try {
    const cfg = (eval("require") as NodeRequire)("config/app-settings.js");
    if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, "");
  } catch {}
  return "http://localhost:4478";
};

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
};

const toProductUrl = (product: ShopeeExtractorLinkedProduct | null, fallbackUrl: string): string | null => {
  if (!product) {
    return fallbackUrl || null;
  }
  if (product.productUrl) {
    return product.productUrl;
  }
  return product.shopId && product.itemId
    ? `https://shopee.com.br/product/${product.shopId}/${product.itemId}`
    : fallbackUrl || null;
};

const buildAffiliateBody = (product: ShopeeRouteProduct | null): string | null => {
  if (!product) {
    return null;
  }
  const lines = [
    product.title ? `🛍️ ${product.title}` : "🛍️ Produto vinculado",
    product.description,
    product.priceFormatted ? `💸 ${product.priceFormatted}` : null,
    product.shopName ? `🏪 ${product.shopName}` : null,
    product.ratingStar ? `⭐ ${product.ratingStar}` : null,
  ].filter(Boolean) as string[];
  return lines.length > 0 ? lines.join("\n") : null;
};

const formatCount = (value: unknown): string | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return new Intl.NumberFormat("pt-BR").format(Math.trunc(parsed));
};

const formatDuration = (value: unknown): string | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const totalSeconds = Math.max(1, Math.round(parsed));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
};

const buildShopeeMessageBody = (
  extractorResult: Awaited<ReturnType<typeof extractShopeeVideo>>,
  primaryProduct: ShopeeRouteProduct | null,
  products: ShopeeRouteProduct[],
): string => {
  const metadata = extractorResult.metadata ?? {};
  const author =
    readString(metadata.creator_username) ??
    extractorResult.author ??
    null;
  const rawCaption =
    readString(metadata.caption) ??
    extractorResult.caption ??
    null;
  const hashtags = Array.isArray(metadata.hashtags)
    ? metadata.hashtags
        .map((entry) => (typeof entry === "string" ? entry.trim().replace(/^#/, "") : ""))
        .filter(Boolean)
    : [];
  const stats = [
    formatCount(metadata.view_count) ? `👀 ${formatCount(metadata.view_count)}` : null,
    formatCount(metadata.like_count) ? `❤️ ${formatCount(metadata.like_count)}` : null,
    formatCount(metadata.comment_count) ? `💬 ${formatCount(metadata.comment_count)}` : null,
  ].filter(Boolean) as string[];
  const duration = formatDuration(metadata.duration_sec);

  const lines: string[] = [];
  lines.push("🛍️ *Shopee Video*");
  if (rawCaption) {
    lines.push("", rawCaption);
  }

  const infoLine = [
    author ? `👤 @${author}` : null,
    duration ? `⏱️ ${duration}` : null,
  ].filter(Boolean) as string[];
  if (infoLine.length > 0) {
    lines.push("", infoLine.join("   "));
  }
  if (stats.length > 0) {
    lines.push(stats.join("   "));
  }
  if (hashtags.length > 0) {
    lines.push(`🏷️ ${hashtags.slice(0, 10).map((entry) => `#${entry}`).join(" ")}`);
  }
  if (products.length > 1) {
    lines.push(`📦 Produtos vinculados: ${products.length}`);
  }

  if (primaryProduct) {
    lines.push("", "🛒 *Produto em destaque*");
    if (primaryProduct.title) {
      lines.push(`📝 ${primaryProduct.title}`);
    }
    if (primaryProduct.description) {
      lines.push(primaryProduct.description);
    }
    if (primaryProduct.priceFormatted) {
      lines.push(`💸 ${primaryProduct.priceFormatted}`);
    }
    if (primaryProduct.shopName) {
      lines.push(`🏪 ${primaryProduct.shopName}`);
    }
    if (primaryProduct.ratingStar) {
      lines.push(`⭐ ${primaryProduct.ratingStar}`);
    }
  }

  return lines.join("\n").trim();
};

const resolveShopeeAffiliateProducts = async (
  linkedProducts: ShopeeExtractorLinkedProduct[],
  userId: number,
  fallbackUrl: string,
): Promise<{ primary: ShopeeRouteProduct | null; products: ShopeeRouteProduct[] }> => {
  const products: ShopeeRouteProduct[] = [];

  for (const linkedProduct of linkedProducts) {
    const itemId = readString(linkedProduct.itemId);
    const shopId = readString(linkedProduct.shopId);
    const defaultProductUrl = toProductUrl(linkedProduct, fallbackUrl);
    let searchProduct: Record<string, any> | null = null;

    if (itemId) {
      try {
        const result = await searchShopeeAffiliate(itemId, {
          userId,
          limit: 1,
          itemId,
          ...(shopId ? { shopId } : {}),
        });
        const first = Array.isArray(result?.produtos) ? result.produtos[0] : null;
        if (first && typeof first === "object") {
          searchProduct = first as Record<string, any>;
        }
      } catch {
        searchProduct = null;
      }
    }

    const resolvedItemId = readString(searchProduct?.id) ?? itemId;
    let affiliateUrl =
      resolvedItemId && userId
        ? (await resolveAffiliateShopeeLinkForUserByItemId(userId, resolvedItemId))?.affiliateUrl ?? null
        : null;

    const productUrl =
      readString(searchProduct?.shopee?.productLink) ??
      readString(searchProduct?.url) ??
      defaultProductUrl;

    if (!affiliateUrl && productUrl) {
      try {
        affiliateUrl = await generateShopeeShortLink(productUrl, [], { userId });
      } catch {
        affiliateUrl = null;
      }
    }

    if (!affiliateUrl) {
      affiliateUrl = readString(searchProduct?.shopee?.offerLink);
    }

    products.push({
      itemId: resolvedItemId ?? null,
      shopId: readString(searchProduct?.shopee?.shopId) ?? shopId ?? null,
      title: readString(searchProduct?.titulo) ?? linkedProduct.name ?? null,
      description: readString(searchProduct?.descricaoCurta),
      productUrl,
      affiliateUrl,
      imageUrl: readString(searchProduct?.imagem),
      priceFormatted: readString(searchProduct?.precoFormatado),
      shopName:
        readString(searchProduct?.shopee?.shopName) ??
        readString(searchProduct?.vendedor?.nickname),
      ratingStar: readString(searchProduct?.shopee?.ratingStar),
    });
  }

  const primary =
    products.find((entry) => Boolean(entry.affiliateUrl)) ??
    products.find((entry) => Boolean(entry.productUrl)) ??
    null;

  return { primary, products };
};

export const GET = withUserApiAuth(async (req: NextRequest, _context: unknown, auth: UserApiKey) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get("url") || searchParams.get("q") || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ status: false, mensagem: "Forneça url válida" }, { status: 400 });
    }

    if (isShopeeUrl(url)) {
      try {
        const runtimeConfig = await getAffiliateProviderRuntimeConfig("shopee").catch(() => null);
        const extractorResult = await extractShopeeVideo(url, {
          cookieText: runtimeConfig?.extractorCookieText ?? null,
        });
        const affiliate = await resolveShopeeAffiliateProducts(
          extractorResult.linkedProducts,
          auth.userId,
          extractorResult.sourceUrl,
        );
        const messageBody = buildShopeeMessageBody(
          extractorResult,
          affiliate.primary,
          affiliate.products,
        );
        const captionWithAffiliate = [
          messageBody,
          affiliate.primary?.affiliateUrl ? `🔗 ${affiliate.primary.affiliateUrl}` : null,
        ].filter(Boolean).join("\n\n");

        const payload = {
          id: "shopee",
          title: extractorResult.title || "",
          author: extractorResult.author || "",
          url: extractorResult.url,
          durationSeconds:
            typeof extractorResult.metadata.duration_sec === "number"
              ? Number(extractorResult.metadata.duration_sec)
              : 0,
          thumbnail:
            affiliate.primary?.imageUrl ||
            extractorResult.cover ||
            "",
          format: "video/mp4",
          source: url,
          caption: extractorResult.caption || "",
          watermarkUrl: extractorResult.watermarkUrl || "",
          seoUrl: extractorResult.seoUrl || "",
          linkedProducts: extractorResult.linkedProducts,
          products: affiliate.products,
          affiliateUrl: affiliate.primary?.affiliateUrl || "",
          affiliateProductUrl: affiliate.primary?.productUrl || "",
          affiliateTitle: affiliate.primary?.title || "",
          affiliateImageUrl: affiliate.primary?.imageUrl || "",
          affiliateBody: buildAffiliateBody(affiliate.primary) || "",
          affiliateButtonText: affiliate.primary?.affiliateUrl ? "Ver produto" : "",
          messageBody,
          captionWithAffiliate,
          useVideoHeaderCta: Boolean(affiliate.primary?.affiliateUrl),
          metadata: extractorResult.metadata,
        };

        return NextResponse.json({ status: true, código: 200, resultado: payload });
      } catch (error) {
        console.warn("[globalvideo] Shopee extractor interno falhou; fallback para python.", { error });
      }
    }

    const baseDir = path.join(process.cwd(), "lib", "python");
    const pyScript = path.join(baseDir, "video_downloader.py");
    const infoScript = path.join(baseDir, "video_info.py");
    const baseUrl = getBaseUrl();

    const id: string = await new Promise((resolve, reject) => {
      const child = spawn("python3", [pyScript, url, baseUrl], { cwd: baseDir });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => (out += String(chunk)));
      child.stderr.on("data", (chunk) => (err += String(chunk)));
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `python exited ${code}`));
        const value = out.trim();
        if (!value) return reject(new Error("python did not return id"));
        resolve(value);
      });
    });

    const info: any = await new Promise((resolve, reject) => {
      const child = spawn("python3", [infoScript, id], { cwd: baseDir });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => (out += String(chunk)));
      child.stderr.on("data", (chunk) => (err += String(chunk)));
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `python info exited ${code}`));
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("invalid info json"));
        }
      });
    });

    const bundle = info?.video_info || {};
    const payload = {
      id,
      title: bundle.titulo || bundle.title || "",
      author: bundle.uploader || "",
      url: bundle.video_url || `${baseUrl}/api/play/${id}`,
      durationSeconds: Number(bundle.duration || 0),
      thumbnail: bundle.thumbnail || "",
      format: "video/mp4",
      source: bundle.url || url,
    };
    return NextResponse.json({ status: true, código: 200, resultado: payload });
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || "Erro" }, { status: 500 });
  }
});
