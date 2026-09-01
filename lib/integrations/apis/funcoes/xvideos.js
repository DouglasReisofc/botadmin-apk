const request = require('request');
const cheerio = require('cheerio');

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const buildRequestOptions = (url) => ({
  url,
  gzip: true,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

const decodeJsString = (value) => {
  if (typeof value !== 'string') return value ?? null;
  return value
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
};

const isoDurationToClock = (isoValue) => {
  if (typeof isoValue !== 'string') return null;
  const match = isoValue.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${formattedMinutes}:${formattedSeconds}`;
  }
  return `${formattedMinutes}:${formattedSeconds}`;
};

const getVideoJsonLd = ($) => {
  const candidates = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const payload = $(element).contents().text().trim();
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach((entry) => {
        if (entry && entry['@type'] === 'VideoObject') {
          candidates.push(entry);
        }
      });
    } catch (error) {
      // Ignore JSON fragments that aren't valid objects we care about.
    }
  });
  return candidates[0] || null;
};

const extractPlayerValue = (html, method) => {
  if (!html) return null;
  const regex = new RegExp(`html5player\\.set${method}\\(\\s*['"]([^'"]+)['"]\\s*\\)`);
  const match = html.match(regex);
  return match ? decodeJsString(match[1]) : null;
};

const firstValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value ?? null;
};

const buildVideoResult = (html, $, sourceUrl) => {
  const ldVideo = getVideoJsonLd($);
  const canonical = $('link[rel="canonical"]').attr('href');

  const titleFromPlayer = extractPlayerValue(html, 'VideoTitle');
  const title =
    titleFromPlayer ||
    ldVideo?.name ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    null;

  const uploader =
    extractPlayerValue(html, 'UploaderName') ||
    $('.video-metadata .main-uploader .name').first().text().trim() ||
    null;

  const mp4High =
    extractPlayerValue(html, 'VideoUrlHigh') ||
    ldVideo?.contentUrl ||
    null;
  const mp4Low = extractPlayerValue(html, 'VideoUrlLow');
  const hls = extractPlayerValue(html, 'VideoHLS');

  const thumb =
    extractPlayerValue(html, 'ThumbUrl169') ||
    $('meta[property="og:image"]').attr('content') ||
    firstValue(ldVideo?.thumbnailUrl) ||
    null;

  const isoDuration = ldVideo?.duration;
  const durationFromIso = isoDurationToClock(isoDuration);
  const durationText =
    durationFromIso ||
    $('.page-title .duration').first().text().trim() ||
    null;

  const quality =
    $('.page-title .video-hd-mark').first().text().trim() || null;

  let views = null;
  const ldViews = ldVideo?.interactionStatistic?.userInteractionCount;
  if (typeof ldViews === 'number') views = ldViews;
  else if (typeof ldViews === 'string' && ldViews) views = Number(ldViews);
  const formattedViews = Number.isFinite(views)
    ? views.toLocaleString('pt-BR')
    : null;

  const primaryLink = mp4High || mp4Low || ldVideo?.contentUrl || null;

  return {
    criador: uploader,
    título: title,
    link: primaryLink,
    duração: durationText,
    visualizações: formattedViews,
    qualidade: quality,
    thumb,
    pagina: canonical || sourceUrl,
    arquivos: {
      mp4_high: mp4High,
      mp4_low: mp4Low,
      hls,
    },
  };
};

function xvideos(req, res, apikey) {
  var text = req.query.nome;
  var option = req.query.op;
  if (!text) return res.send({
    status: false,
    message: 'nome não encontrado'
  });
  if (!option) return res.send({
    status: false,
    message: 'parametro não definido'
  });
  const normalizedOption = String(option).toLowerCase();
  const isSearch = normalizedOption === 'search' || normalizedOption === 'pesquisa';
  const isDownload = normalizedOption === 'download' || normalizedOption === 'dl';
  if (!isSearch && !isDownload) {
    return res.send({
      status: false,
      message: 'opção invalida'
    });
  }

  if (isSearch) {
    const start = (word) => {
      const normalize = word.trim().split(/\s+/).join('+');
      const search = normalize.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const url = `https://www.xvideos.com/?k=${encodeURIComponent(search)}`;

      request(buildRequestOptions(url), (err, reqResp, body) => {
        if (err) {
          console.error(err);
          return res.send({ status: false, message: 'erro ao consultar xvideos' });
        }
        try {
          const $ = cheerio.load(body);
          const results = [];
          $('.thumb-block').each((_, element) => {
            const block = $(element);
            const blockId = block.attr('id') || '';
            if (blockId.startsWith('profile_')) {
              return;
            }
            const anchor = block.find('.thumb a').first();
            const href = anchor.attr('href');
            if (!href || !href.startsWith('/video')) {
              return;
            }
            const titleAnchor = block.find('.thumb-under .title a').first();
            const title = (titleAnchor.attr('title') || titleAnchor.text() || '').trim();
            const duration = (block.find('.thumb-under .duration').first().text() || '').trim();
            const quality = (block.find('.top-right-tags span').first().text() || '').trim() || null;
            const img = anchor.find('img').first();
            const thumbnail = img.attr('data-src') || img.attr('src') || null;
            const channel = (block.find('.thumb-under .name').first().text() || '').trim() || null;
            const metadataText = block.find('.thumb-under .metadata').text().replace(/\s+/g, ' ').trim();
            const viewsMatch = metadataText.match(/([\d.,]+[kM]?)/i);
            const views = viewsMatch ? viewsMatch[1] : null;

            results.push({
              titulo: title || null,
              url: `https://www.xvideos.com${href}`,
              duracao: duration || null,
              qualidade: quality,
              canal: channel,
              visualizacoes: views,
              thumb: thumbnail,
            });
          });

          if (!results.length) {
            return res.send({
              status: false,
              message: 'nenhum resultado encontrado',
            });
          }

          res.send({
            status: true,
            quantidade: results.length,
            resultado: results,
          });
        } catch (parseError) {
          console.error(parseError);
          res.send({ status: false, message: 'falha ao interpretar HTML' });
        }
      });
    };
    start(text);
  } else if (isDownload) {
    const isInvalidUrl = (url) => !/^https?:\/\/(www\.)?xvideos\.com\//i.test(url);
    const start = (url) => {
      if (isInvalidUrl(url)) {
        return res.send({
          status: false,
          invalidUrl: url,
          message: 'somente links do xvideos'
        });
      }

      request(buildRequestOptions(url), (err, response, body) => {
        if (err) {
          console.error(err);
          return res.send({
            status: false,
            message: 'erro ao consultar xvideos'
          });
        }

        if (!body || (response && response.statusCode >= 400)) {
          return res.send({
            status: false,
            message: 'vídeo não encontrado'
          });
        }

        try {
          const $ = cheerio.load(body);
          const parsed = buildVideoResult(body, $, url);

          if (!parsed.link) {
            return res.send({
              status: false,
              message: 'não foi possível extrair o vídeo'
            });
          }

          return res.send({
            status: true,
            resultado: [parsed]
          });
        } catch (parseErr) {
          console.error(parseErr);
          return res.send({
            status: false,
            message: 'falha ao interpretar HTML'
          });
        }
      });
    };
    start(text);
  }
}

module.exports = { xvideos };
