const axios = require('axios');
const crypto = require('crypto');

async function downloadYouTube(link, format = '1080') {
  const apiBase = "https://media.savetube.me/api";
  const apiCDN = "/random-cdn";
  const apiInfo = "/v2/info";
  const apiDownload = "/download";

  const decryptData = async (enc) => {
    try {
      const key = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
      const data = Buffer.from(enc, 'base64');
      const iv = data.slice(0, 16);
      const content = data.slice(16);
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      let decrypted = decipher.update(content);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return JSON.parse(decrypted.toString());
    } catch (error) {
      return null;
    }
  };

  const request = async (endpoint, data = {}, method = 'post') => {
    try {
      const { data: response } = await axios({
        method,
        url: `${endpoint.startsWith('http') ? '' : apiBase}${endpoint}`,
        data: method === 'post' ? data : undefined,
        params: method === 'get' ? data : undefined,
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          origin: 'https://yt.savetube.me',
          referer: 'https://yt.savetube.me/',
          'user-agent': 'Postify/1.0.0'
        }
      });
      return { status: true, data: response };
    } catch (error) {
      return { status: false, error: error.message };
    }
  };

  const youtubeID = link.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  if (!youtubeID) return { status: false, error: 'Gagal mengekstrak ID video dari URL.' };

  const isAudio = format === 'mp3';

  try {
    const cdnRes = await request(apiCDN, {}, 'get');
    if (!cdnRes.status) {
      console.log('CDN response erro:', cdnRes);
      return cdnRes;
    }
    const cdn = cdnRes.data.cdn;

    console.log('CDN:', cdn);

    const infoRes = await request(`https://${cdn}${apiInfo}`, { url: `https://www.youtube.com/watch?v=${youtubeID[1]}` });
    if (!infoRes.status) {
      console.log('Info response erro:', infoRes);
      return infoRes;
    }
    console.log('Info response:', infoRes.data);

    const decrypted = await decryptData(infoRes.data.data);
    if (!decrypted) {
      console.log('Decrypted error');
      return { status: false, error: 'Gagal mendekripsi data video.' };
    }

    console.log('Decrypted:', decrypted);

    let list = isAudio ? decrypted.audio_formats : decrypted.video_formats;
    let quality = isAudio ? (list && list[0] ? list[0].quality : '128') : format;
    let dlFormat = isAudio ? 'mp3' : format;
    let downloadRes = await request(`https://${cdn}${apiDownload}`, {
      id: youtubeID[1],
      downloadType: isAudio ? 'audio' : 'video',
      quality,
      key: decrypted.key
    });

    console.log('Download response:', downloadRes);

    let downloadUrl = downloadRes.status && downloadRes.data?.data?.downloadUrl;

    if (!downloadUrl) {
      const fallback = Array.isArray(list) ? list.find(f => f.url) : null;
      if (fallback) {
        console.log('Trying fallback format:', fallback.quality);
        dlFormat = isAudio ? 'mp3' : fallback.quality;
        downloadRes = await request(`https://${cdn}${apiDownload}`, {
          id: youtubeID[1],
          downloadType: isAudio ? 'audio' : 'video',
          quality: fallback.quality,
          key: decrypted.key
        });
        downloadUrl = downloadRes.status && downloadRes.data?.data?.downloadUrl;
      }
    }

    // Se o link retornado estiver inacessível ou com cabeçalho de anexo, tenta pegar outro
    if (downloadUrl) {
      try {
        const head = await axios.head(downloadUrl);
        const disp = head.headers['content-disposition'] || '';
        if (head.status >= 400 || /attachment/i.test(disp)) {
          throw new Error(`Link retornou ${head.status}`);
        }
      } catch (err) {
        const alt = Array.isArray(list)
          ? list.find(f => f.url && f.url !== downloadUrl)
          : null;
        if (alt) {
          console.log('Download URL falhou, usando alternativa:', alt.quality);
          dlFormat = isAudio ? 'mp3' : alt.quality;
          downloadRes = await request(`https://${cdn}${apiDownload}`, {
            id: youtubeID[1],
            downloadType: isAudio ? 'audio' : 'video',
            quality: alt.quality,
            key: decrypted.key
          });
          downloadUrl = downloadRes.status && downloadRes.data?.data?.downloadUrl;
        }
      }
    }

    if (!downloadUrl) {
      return { status: false, error: 'Não foi possível obter o link de download.' };
    }

    return {
      status: true,
      result: {
        ...decrypted,
        type: isAudio ? 'audio' : 'video',
        format: dlFormat,
        download: downloadUrl
      }
    };
  } catch (error) {
    return { status: false, error: error.message };
  }
}

module.exports = downloadYouTube;
