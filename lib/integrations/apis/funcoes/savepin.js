const path = require("path");
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

function resolveAbsoluteUrl(value) {
  if (!value) return value;
  let url = value.trim();
  if (url.startsWith("//")) {
    url = `https:${url}`;
  }
  if (!/^https?:\/\//i.test(url)) {
    try {
      url = new URL(url, "https://www.savepin.app/").toString();
    } catch (err) {
      return value;
    }
  }
  return url;
}

function decodeForceSaveLink(raw) {
  if (typeof raw !== "string") {
    return raw;
  }
  if (raw.startsWith("force-save.php?url=")) {
    const encoded = raw.replace(/^force-save\.php\?url=/, "");
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded) return decoded;
    } catch {}
  }
  return raw;
}

async function normalizePinterestLink(value) {
  if (typeof value !== "string" || !/pin\.it\//i.test(value)) {
    return value;
  }
  try {
    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    };

    const first = await axios.get(value, {
      headers: baseHeaders,
      maxRedirects: 0,
      validateStatus: () => true
    });
    let next = first.headers && first.headers.location ? first.headers.location : null;
    if (!next) {
      return value;
    }
    if (!/^https?:\/\//i.test(next)) {
      next = new URL(next, value).toString();
    }

    let cookieHeader;
    const setCookie = first.headers && first.headers["set-cookie"];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
      cookieHeader = setCookie.map(entry => entry.split(";")[0]).join("; ");
    }

    if (/api\.pinterest\.com\/url_shortener/i.test(next)) {
      const second = await axios.get(next, {
        headers: cookieHeader ? { ...baseHeaders, Cookie: cookieHeader } : baseHeaders,
        maxRedirects: 0,
        validateStatus: () => true
      });
      const secondLocation = second.headers && second.headers.location;
      if (secondLocation) {
        next = /^https?:\/\//i.test(secondLocation)
          ? secondLocation
          : new URL(secondLocation, next).toString();
      }
    }

    return next;
  } catch (error) {
    console.warn("[savepin] Failed to resolve pin.it", error && error.message ? error.message : error);
  }
  return value;
}

async function savePin(url) {
    try {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.savepin.app/pinterest/",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        };

        const timeouts = [20000, 35000, 50000];
        const candidates = [url];
        if (/pin\.it\//i.test(url)) {
            const resolved = await normalizePinterestLink(url);
            if (resolved && !candidates.includes(resolved)) {
                candidates.unshift(resolved);
            }
        }

        let fallbackResult = null;
        let lastError = null;

        const attempt = async (target) => {
            const requestUrl = `https://www.savepin.app/download.php?url=${encodeURIComponent(target)}&lang=en&type=redirect`;
            for (const timeout of timeouts) {
                try {
                    const response = await axios.get(requestUrl, {
                        headers,
                        timeout,
                        responseType: "text",
                        maxRedirects: 5
                    });
                    const html = response.data || "";
                    if (!html.trim()) {
                        return null;
                    }

                    const $ = cheerio.load(html);
                    const results = [];
                    $('td.video-quality').each((index, element) => {
                        const type = $(element).text().trim();
                        const format = $(element).next().text().trim();
                        const downloadLinkElement = $(element).closest('tr').find('#submiturl[href], a.button.is-success[href]').attr('href');
                        if (downloadLinkElement) {
                            let downloadLink = decodeForceSaveLink(downloadLinkElement);
                            downloadLink = resolveAbsoluteUrl(downloadLink);
                            results.push({ type, format, downloadLink });
                        }
                    });

                    if (results.length === 0) {
                        const img = $('.image-container img[src]').first().attr('src');
                        if (img) {
                            results.push({
                                type: 'Image',
                                format: 'jpg',
                                downloadLink: resolveAbsoluteUrl(img)
                            });
                        }
                    }

                    const title = $('h1').text().trim();
                    return { title, results };
                } catch (error) {
                    lastError = error;
                    if (!error || error.code !== "ECONNABORTED") {
                        throw error;
                    }
                }
            }
            return null;
        };

        for (const candidate of candidates) {
            const result = await attempt(candidate);
            if (result && result.results.length > 0) {
                return result;
            }
            if (result && !fallbackResult) {
                fallbackResult = result;
            }
        }

        if (fallbackResult) {
            return fallbackResult;
        }
        if (lastError) {
            throw lastError;
        }
        return { title: '', results: [] };
    } catch (error) {
        console.error("Error:", error && error.message ? error.message : error);
        return { success: false, message: error.message };
    }
}

module.exports = savePin;
