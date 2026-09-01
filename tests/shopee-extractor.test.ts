import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectVideoUrlsFromTimelineItem,
  extractNextData,
  extractShareTarget,
  extractShopeeVideo,
  extractTimelineItem,
  extractVideoMetadataFromTimelineItem,
  normalizeCookieTextToHeader,
} from "../lib/shopee-extractor";

const UNIVERSAL_LINK_HTML = `
<html>
  <head>
    <meta property="og:url" content="https://shopee.com.br/universal-link?redir=https%3A%2F%2Fsv.shopee.com.br%2Fshare-video%2Fabc123" />
  </head>
  <body>
    <script>
      var CONFIG={httpUrl:"https:\\/\\/sv.shopee.com.br\\/share-video\\/abc123?c=share_web\\u0026contentType=0"};
    </script>
  </body>
</html>
`;

const SHARE_PAGE_HTML = `
<html>
  <body>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "mediaInfo": {
              "video": {
                "watermarkVideoUrl": "https://cdn.example.com/video/watermark.mp4",
                "watermarkCoverUrl": "https://cdn.example.com/cover/test.jpg",
                "caption": "Legenda de teste"
              },
              "userInfo": {
                "videoUserName": "autor_teste",
                "videoUserAvatar": "avatar123"
              }
            }
          }
        },
        "query": {
          "postId": "abc123",
          "shareUserId": "999"
        }
      }
    </script>
  </body>
</html>
`;

const SEO_PAGE_HTML = `
<html>
  <body>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "timelineVideo": {
              "list": [
                {
                  "meta": {
                    "postId": "abc123",
                    "userId": 999,
                    "userName": "autor_teste",
                    "avatar": "avatar123",
                    "countInfo": {
                      "views": 345,
                      "likes": 12,
                      "comments": 3
                    },
                    "shopId": 55,
                    "shopName": "Loja Teste"
                  },
                  "content": {
                    "caption": "Legenda #tag1 #tag2",
                    "hashtags": [
                      { "start": 8, "length": 5 },
                      { "start": 14, "length": 5 }
                    ],
                    "video": {
                      "url": "https://cdn.example.com/video/original.mp4",
                      "watermarkVideoUrl": "https://cdn.example.com/video/watermark.mp4",
                      "cover": "https://cdn.example.com/cover.jpg",
                      "duration": 30700,
                      "formats": [
                        { "url": "https://cdn.example.com/video/format.mp4" }
                      ],
                      "mmsData": "{\\"formats\\":[{\\"url\\":\\"https://cdn.example.com/video/mms.mp4\\"}]}"
                    },
                    "products": {
                      "count": 1,
                      "items": [{ "shopId": 55, "itemId": 77 }],
                      "enhancedItemList": [{ "shopId": 55, "itemId": 77, "name": "Produto Teste" }]
                    }
                  }
                }
              ]
            }
          }
        }
      }
    </script>
  </body>
</html>
`;

test("normalizeCookieTextToHeader parses Netscape cookies", () => {
  const header = normalizeCookieTextToHeader(`
# Netscape HTTP Cookie File
#HttpOnly_.shopee.com.br\tTRUE\t/\tTRUE\t0\tcsrftoken\tabc
.shopee.com.br\tTRUE\t/\tFALSE\t0\tshopee_token\txyz
`);

  assert.ok(header?.includes("csrftoken=abc"));
  assert.ok(header?.includes("shopee_token=xyz"));
});

test("extractShareTarget prefers CONFIG.httpUrl on universal-link pages", () => {
  const target = extractShareTarget(
    "https://shopee.com.br/universal-link?foo=bar",
    UNIVERSAL_LINK_HTML,
  );

  assert.equal(
    target,
    "https://sv.shopee.com.br/share-video/abc123?c=share_web&contentType=0",
  );
});

test("timeline helpers prioritize original video and linked products", () => {
  const nextData = extractNextData(SEO_PAGE_HTML);
  const item = extractTimelineItem(nextData);
  const metadata = extractVideoMetadataFromTimelineItem(
    item,
    "https://sv.shopee.com.br/web/@autor_teste/video/abc123",
  );
  const videoUrls = collectVideoUrlsFromTimelineItem(
    item,
    "https://sv.shopee.com.br/web/@autor_teste/video/abc123",
  );

  assert.equal(metadata.video_url, "https://cdn.example.com/video/original.mp4");
  assert.deepEqual(metadata.linked_items, [{ shopId: 55, itemId: 77 }]);
  assert.deepEqual(videoUrls, [
    "https://cdn.example.com/video/original.mp4",
    "https://cdn.example.com/video/watermark.mp4",
    "https://cdn.example.com/video/format.mp4",
    "https://cdn.example.com/video/mms.mp4",
  ]);
});

test("extractShopeeVideo resolves share page, cookie header and seo metadata", async () => {
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; cookie: string | null }> = [];

  global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, cookie: headers.get("cookie") });

    if (url === "https://br.shp.ee/short123") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://shopee.com.br/universal-link?foo=bar",
        },
      });
    }
    if (url === "https://shopee.com.br/universal-link?foo=bar") {
      return new Response(UNIVERSAL_LINK_HTML, { status: 200 });
    }
    if (url === "https://sv.shopee.com.br/share-video/abc123?c=share_web&contentType=0") {
      return new Response(SHARE_PAGE_HTML, { status: 200 });
    }
    if (url === "https://sv.shopee.com.br/web/@autor_teste/video/abc123") {
      return new Response(SEO_PAGE_HTML, { status: 200 });
    }

    throw new Error(`Unexpected fetch for ${url}`);
  };

  try {
    const result = await extractShopeeVideo("https://br.shp.ee/short123", {
      cookieText: `
#HttpOnly_.shopee.com.br\tTRUE\t/\tTRUE\t0\tcsrftoken\tabc
.shopee.com.br\tTRUE\t/\tFALSE\t0\tshopee_token\txyz
`,
      timeoutMs: 5_000,
    });

    assert.equal(result.url, "https://cdn.example.com/video/original.mp4");
    assert.equal(result.linkedProduct?.itemId, "77");
    assert.equal(result.linkedProduct?.shopId, "55");
    assert.ok(
      requests.some(
        (entry) =>
          entry.cookie?.includes("csrftoken=abc") &&
          entry.cookie.includes("shopee_token=xyz"),
      ),
    );
  } finally {
    global.fetch = originalFetch;
  }
});
