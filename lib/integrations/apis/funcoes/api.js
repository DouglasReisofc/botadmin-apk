const axios = require("axios");
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require("cheerio");
const request = require('request');
const ytdl = require("ytdl-core");
// Compat: wrappers usados no código legado
const ytdlgetInfo = (...args) => ytdl.getInfo(...args);
const ytdlgetVideoID = (url) => {
  try { return ytdl.getVideoID(url); } catch { return url; }
};
const yts = require('yt-search');
//const ytdlexec = require('youtube-dl-exec');
const { fetch } = require("undici");
const { lookup } = require("mime-types");
const { SocksProxyAgent } = require('socks-proxy-agent');
const { createGunzip, createBrotliDecompress } = require('zlib');
const https = require('https');
const search = require('yt-search');
const BodyForm = require('form-data');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { fetchInflactProfile } = require('../../../../helper/inflact-viewer');

const fluxCookieJar = new CookieJar();
const axiosFlux = wrapper(axios.create({ jar: fluxCookieJar, withCredentials: true }));
const { spotifyDl } = require('./spotify-downloader');

function resetFluxCookies() {
  return new Promise(resolve => fluxCookieJar.removeAllCookies(() => resolve()));
}





//FONTES MODIFICADAS
function styletext(texto) {
  return new Promise((resolve, reject) => {
    axios.get('http://qaz.wtf/u/convert.cgi?text=' + texto)
      .then(({ data }) => {
        let $ = cheerio.load(data)
        let hasil = []
        $('table > tbody > tr').each(function (a, b) {
          hasil.push({ nome: $(b).find('td:nth-child(1) > span').text(), fonte: $(b).find('td:nth-child(2)').text().trim() })
        })
        resolve(hasil)
      })
  })
}

//upload no telegra
function TelegraPh(Path) {
  return new Promise(async (resolve, reject) => {
    if (!fs.existsSync(Path)) return reject(new Error("File not Found"))
    try {
      const form = new BodyForm();
      form.append("file", fs.createReadStream(Path))
      const data = await axios({
        url: "https://telegra.ph/upload",
        method: "POST",
        headers: {
          ...form.getHeaders()
        },
        data: form
      })
      return resolve("https://telegra.ph" + data.data[0].src)
    } catch (err) {
      return reject(new Error(String(err)))
    }
  })
}

//playstore
function playstore(name) {
  return new Promise((resolve, reject) => {
    axios.get('https://play.google.com/store/search?q=' + name + '&c=apps')
      .then(({ data }) => {
        const $ = cheerio.load(data)
        let ln = [];
        let nm = [];
        let dv = [];
        let lm = [];
        const result = [];
        $('div.wXUyZd > a').each(function (a, b) {
          const link = 'https://play.google.com' + $(b).attr('href')
          ln.push(link);
        })
        $('div.b8cIId.ReQCgd.Q9MA7b > a > div').each(function (d, e) {
          const name = $(e).text().trim()
          nm.push(name);
        })
        $('div.b8cIId.ReQCgd.KoLSrc > a > div').each(function (f, g) {
          const dev = $(g).text().trim();
          dv.push(dev)
        })
        $('div.b8cIId.ReQCgd.KoLSrc > a').each(function (h, i) {
          const limk = 'https://play.google.com' + $(i).attr('href');
          lm.push(limk);
        })
        for (let i = 0; i < ln.length; i++) {
          result.push({
            name: nm[i],
            link: ln[i],
            developer: dv[i],
            link_dev: lm[i]
          })
        }
        resolve(result)
      })
      .catch(reject)
  })
}

//wallpaper.mob.org
function wallmob() {
  return new Promise((resolve, reject) => {
    axios.get(`https://wallpaper.mob.org/gallery/tag=anime/`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.image-gallery-image ").each((_, say) => {
        var img = $(say).find("img").attr('src');
        var resultado = {
          img: img
        }
        postagem.push(resultado)
      })
      //  console.log(tod.data)
      resolve(postagem)
    }).catch(reject)
  });
}

// Flux Text2Image
const fluxQueue = [];
let fluxProcessing = false;

function generateFluxSessionHash(length = 11) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let hash = '';
  for (let i = 0; i < length; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
}

function generateFluxImage(prompt, retry = 2) {
  const session_hash = generateFluxSessionHash();

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    Accept: '/',
    'Content-Type': 'application/json'
  };

  const payload = {
    data: [prompt, 0, true, 1024, 1024, 4],
    event_data: null,
    fn_index: 2,
    trigger_id: 5,
    session_hash
  };

  const requestUrl = 'https://black-forest-labs-flux-1-schnell.hf.space/queue/join?__theme=system';
  const streamUrl = `https://black-forest-labs-flux-1-schnell.hf.space/queue/data?session_hash=${session_hash}`;

  return axiosFlux.post(requestUrl, payload, { headers })
    .then(() => new Promise((resolve, reject) => {
      fluxCookieJar.getCookieString(streamUrl, (err, cookie) => {
        const reqHeaders = { ...headers };
        if (!err && cookie) reqHeaders.Cookie = cookie;

        https.get(streamUrl, { headers: reqHeaders }, res => {
          let buffer = '';
          let finished = false;
          res.on('data', chunk => {
            buffer += chunk.toString();
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (const part of parts) {
              if (part.startsWith('data:')) {
                const json = part.replace('data: ', '').trim();
                try {
                  const parsed = JSON.parse(json);
                  if (parsed.msg === 'process_completed') {
                    const url = parsed.output.data[0]?.url;
                    finished = true;
                    return resolve(url);
                  }
                } catch (e) {
                  /* ignore parse errors */
                }
              }
            }
          });
          res.on('error', err => {
            if (!finished && retry > 0) {
              generateFluxImage(prompt, retry - 1).then(resolve).catch(reject);
            } else {
              resetFluxCookies().finally(() => reject(err));
            }
          });
          res.on('end', () => {
            if (!finished && retry > 0) {
              generateFluxImage(prompt, retry - 1).then(resolve).catch(reject);
            } else if (!finished) {
              resetFluxCookies().finally(() => reject(new Error('Stream ended without result')));
            }
          });
        }).on('error', err => {
          resetFluxCookies().finally(() => reject(err));
        });
      });
    }));
}

function processFluxQueue() {
  if (fluxProcessing || !fluxQueue.length) return;
  fluxProcessing = true;
  const { prompt, resolve, reject } = fluxQueue.shift();
  generateFluxImage(prompt)
    .then(resolve)
    .catch(reject)
    .finally(() => {
      fluxProcessing = false;
      processFluxQueue();
    });
}

function fluxAI(prompt) {
  return new Promise((resolve, reject) => {
    fluxQueue.push({ prompt, resolve, reject });
    processFluxQueue();
  });
}

//Assistirhentai Pesquisa
function assistitht(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://www.assistirhentai.com/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.videos").each((_, say) => {
        var nome = $(say).find("h2").text().trim();
        var img = $(say).find("img").attr('src');
        var link = $(say).find("a").attr('href');
        var data_up = $(say).find("span.video-data").text().trim();
        var tipo = $(say).find("span.selo-tipo").text().trim();
        var eps = $(say).find("span.selo-tempo").text().trim();
        var resultado = {
          nome: nome,
          img: img,
          link: link,
          data_up: data_up,
          tipo: tipo,
          total_ep: eps
        }
        postagem.push(resultado)
      })
      //  console.log(tod.data)
      resolve(postagem)
    }).catch(reject)
  });
}

//Assistirhentai dl
function assistithtdl(link) {
  return new Promise((resolve, reject) => {
    axios.get(`${link}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.meio").each((_, say) => {
        var nome = $(say).find("h1.post-titulo").text().trim();
        var img = $(say).find("img").attr('src');
        var descrição = $(say).find("p").text().trim();
        var link = $(say).find("source").attr('src');
        var resultado = {
          nome: nome,
          capa: img,
          descrição: descrição,
          link_dl: link
        }
        postagem.push(resultado)
      })
      //  console.log(tod.data)
      resolve(postagem)
    }).catch(reject)
  });
}

//Porno gratis
function pornogratis(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://pornogratis.vlog.br/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.videos-row").each((_, say) => {
        var nome = $(say).find("a").attr('title');
        var img = $(say).find("img").attr('src');
        var link = $(say).find("a").attr('href');
        var resultado = {
          nome: nome,
          img: img,
          link: link
        }
        postagem.push(resultado)
      })
      //  console.log(tod.data)
      resolve(postagem)
    }).catch(reject)
  });
}

function xvideoss(nome) {
  var link = `https://www.xvideos.com/?k=${nome}`;
  var data = [];
  var xv = [];
  request(link, (err, req, body) => {
    if (err) return console.log(err);
    const Sayo_Reg = /<\/div><div class=\".+?\"><p class=\".+?\"><a href=\".+?\" .+? <span class=\".+?\"><\/span>/g;
    const datas = body.match(Sayo_Reg);
    data.push(...datas);
    var Sayo_Regk = /\"\/.+?\"/g;
    var Sayo_Regkk = /title=\".+?\">/g;
    //var Sayo_Regkkk = /\"duration\">.+?/g;
    for (let index of data) {
      var Akame_R = index.match(Sayo_Regk);
      var Akame_RR = index.match(Sayo_Regkk);
      var Akame_RRR = Akame_RR[0].split('title=').join('').split('>').join('');
      //var Akame_RRRR = index.match(Sayo_Regkkk);
      var opções = {
        título: JSON.parse(Akame_RRR),
        //duração: JSON.parse(Akame_RRRR),
        link: 'https://www.xvideos.com' + JSON.parse(Akame_R[0]),
      };
      //console.log(opções)
      xv.push(opções);
    }
  });
};

function xvideosdl(link) {
  const ___Xvdlkkk = [];
  request(link, (err, req, body) => {
    var ___Sayo_Reg = /html5player\.setVideoTitle\(\'.+?\'\)/g;
    var ___Título_vD = body.match(___Sayo_Reg)[0].split('html5player.setVideoTitle(\'').join('').split('\')').join('');
    var __Link_dO_Video_rrr = /html5player\.setVideoUrlHigh\(\'.+?\'\)/g;
    var __Link_dO_Video_r = body.match(__Link_dO_Video_rrr)[0].split('html5player.setVideoUrlHigh').join('').split('(').join('').split(')').join('').split('\'').join('');
    var __Duração_do_Vd_sec_dos_ofc011 = /class=\"duration\">.+?<\/span>/g;
    var __Duração_do_Vd_sec_dos_ofc = body.match(__Duração_do_Vd_sec_dos_ofc011)[0].split('class=\"duration\">').join('').split('<').join('').split('span>').join('').split('/').join('');
    var __Duração_do_Vd_sec_dos = __Duração_do_Vd_sec_dos_ofc.endsWith(' min') ? ' minutes' : '' || __Duração_do_Vd_sec_dos_ofc.endsWith(' sec') ? ' seconds' : '';
    var __Duração_do_Vd = __Duração_do_Vd_sec_dos_ofc.split(' ')[0] + __Duração_do_Vd_sec_dos;
    var __Visualizações___k = /class=\"mobile-hide\">.+?<\/strong>/g;
    var __Visualizações_k = body.match(__Visualizações___k)[0].split('class=\"mobile-hide\">').join('').split('</strong>').join('');
    var __Criador = /html5player\.setUploaderName\(\'.+?\'\)/g;
    var __Criador_do_Video_safado = body.match(__Criador)[0].split('html5player.setUploaderName(\'').join('').split('\')').join('');
    var obj = {
      criador_vd: __Criador_do_Video_safado,
      título: ___Título_vD,
      link: __Link_dO_Video_r,
      duração: __Duração_do_Vd,
      visualizações: __Visualizações_k
    };
    ___Xvdlkkk.push(obj);
    //console.log(obj)
  })
}

function htdl(link) {
  return new Promise((resolve, reject) => {
    axios.get(`${link}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.toggle").each((_, say) => {
        var link = $(say).find("video").attr('src');
        var resultado = {
          link: link
        }
        postagem.push(resultado)
      })
      //  console.log(tod.data)
      resolve(postagem)
    }).catch(reject)
  });
}

function papeldeparede(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://wall.alphacoders.com/search.php?search=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.boxgrid").each((_, say) => {
        var titulo = $(say).find("a").attr('title');
        var link1 = $(say).find("a").attr('href');
        var link = `https://wall.alphacoders.com${link1}`
        var img = $(say).find("img").attr('src');
        var resultado = {
          titulo: titulo,
          img: img,
          link: link
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

function xnxxdl(link_video) {
  return new Promise((resolve, reject) => {
    fetch(link_video, { method: 'get' }).then(sexokk => sexokk.text()).then(sexokk => {
      var sayo = cheerio.load(sexokk, { xmlMode: false }); resolve({
        criador: "Dark",
        resultado: { título: sayo('meta[property="og:title"]').attr('content'), duração: sayo('meta[property="og:duration"]').attr('content'), img: sayo('meta[property="og:image"]').attr('content'), tipo_vd: sayo('meta[property="og:video:type"]').attr('content'), vd_altura: sayo('meta[property="og:video:width"]').attr('content'), vd_largura: sayo('meta[property="og:video:height"]').attr('content'), informações: sayo('span.metadata').text(), resultado2: { qualidade_baixa: (sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setVideoUrlLow\\(\'(.*?)\'\\);') || [])[1], qualidade_alta: sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setVideoUrlHigh\\(\'(.*?)\'\\);' || [])[1], qualidade_HLS: sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setVideoHLS\\(\'(.*?)\'\\);' || [])[1], capa: sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setThumbUrl\\(\'(.*?)\'\\);' || [])[1], capa69: sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setThumbUrl169\\(\'(.*?)\'\\);' || [])[1], capa_slide: sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setThumbSlide\\(\'(.*?)\'\\);' || [])[1], capa_slide_grande: sayo('#video-player-bg > script:nth-child(6)').html().match('html5player.setThumbSlideBig\\(\'(.*?)\'\\);' || [])[1] } }
      })
    }).catch(err => reject({ code: 503, status: false, result: err }))
  })
}

//WIKIPEDIA
var wiki = async (query) => {
  var res = await axios.get(`https://pt.m.wikipedia.org/wiki/${query}`)
  var $ = cheerio.load(res.data)
  var postagem = []
  var titulo = $('#mf-section-0').find('p').text()
  var capa = $('#mf-section-0').find('div > div > a > img').attr('src')
  capaofc = capa ? capa : '//pngimg.com/uploads/wikipedia/wikipedia_PNG35.png'
  img = 'https:' + capaofc
  var título = $('h1#section_0').text()
  postagem.push({ titulo, img })
  return postagem
}

//FF
function ff(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://www.ffesportsbr.com.br/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("article.home-post.col-xs-12.col-sm-12.col-md-4.col-lg-4.py-3").each((_, say) => {
        var titulo = $(say).find("h2").text().trim();
        var keywords = $(say).find("ul").text().trim();
        var publicado = $(say).find("span").text().trim();
        var link = $(say).find("a").attr('href');
        var img = $(say).find("img").attr('src');
        var resultado = {
          titulo: titulo,
          keywords: keywords,
          publicado: publicado,
          img: img,
          link: link
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}




//DAFONTE
const dafontSearch = async (query) => {
  const base = `https://www.dafont.com`
  const res = await axios.get(`${base}/search.php?q=${query}`)
  const $ = cheerio.load(res.data)
  const sayo = []
  const total = $('div.dffont2').text().replace(` fonts on DaFont for ${query}`, '')
  $('div').find('div.container > div > div.preview').each(function (a, b) {
    $('div').find('div.container > div > div.lv1left.dfbg').each(function (c, d) {
      $('div').find('div.container > div > div.lv1right.dfbg').each(function (e, f) {
        let link = `${base}/` + $(b).find('a').attr('href')
        let titulo = $(d).text()
        let estilo = $(f).text()
        sayo.push({ titulo, estilo, total, link })
      })
    })
  })
  return sayo
}

const dafontDown = async (link) => {
  const des = await axios.get(link)
  const sup = cheerio.load(des.data)
  const result = []
  let estilo = sup('div').find('div.container > div > div.lv1right.dfbg').text()
  let titulo = sup('div').find('div.container > div > div.lv1left.dfbg').text()
  try {
    isi = sup('div').find('div.container > div > span').text().split('.ttf')
    saida = sup('div').find('div.container > div > span').eq(0).text().replace('ttf', 'zip')
  } catch {
    isi = sup('div').find('div.container > div > span').text().split('.otf')
    saida = sup('div').find('div.container > div > span').eq(0).text().replace('otf', 'zip')
  }
  let download = 'http:' + sup('div').find('div.container > div > div.dlbox > a').attr('href')
  result.push({ estilo, titulo, isi, saida, download })
  return result
}

//GRUPO
function gpsrc(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://zaplinksbrasil.com.br/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.grupo").each((_, say) => {
        var titulo = $(say).find("a").attr('title');
        var link = $(say).find("a").attr('href');
        var img = $(say).find("img").attr('src');
        var conteudo = $(say).find("div.listaCategoria").text().trim();
        var resultado = {
          titulo: titulo,
          img: img,
          conteudo: conteudo,
          link: link
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

//STICKER SEARCH
function st(nome) {
  return new
    Promise((resolve, reject) => {
      axios.get(`https://getstickerpack.com/stickers?query=${query}`)
        .then(({
          data
        }) => {
          const $ = cheerio.load(data)
          const link = [];
          $('#stickerPacks > div > div:nth-child(3) > div > a')
            .each(function (a, b) {
              link.push($(b).attr('href'))
            })
          rand = link[Math.floor(Math.random() * link.length)]
          axios.get(rand)
            .then(({
              data
            }) => {
              const $$ = cheerio.load(data)
              const url = [];
              $$('#stickerPack > div > div.row > div > img')
                .each(function (a, b) {
                  url.push($$(b).attr('src').split('&d=')[0])
                })
              resolve({
                criador: '@Dark',
                titulo: $$('#intro > div > div > h1').text(),
                autor: $$('#intro > div > div > h5 > a').text(),
                autor_link: $$('#intro > div > div > h5 > a').attr('href'),
                figurinhas: url
              })
            })
        })
    })
}

//SOUND CLOUD DOWNLOAD
function soundl(link) {
  return new Promise((resolve, reject) => {
    const opções = {
      method: 'POST',
      url: "https://www.klickaud.co/download.php",
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      formData: {
        'value': link,
        '2311a6d881b099dc3820600739d52e64a1e6dcfe55097b5c7c649088c4e50c37': '710c08f2ba36bd969d1cbc68f59797421fcf90ca7cd398f78d67dfd8c3e554e3'
      }
    };
    request(opções, async function (error, response, body) {
      console.log(body)
      if (error) throw new Error(error);
      const $ = cheerio.load(body)
      resolve({
        titulo: $('#header > div > div > div.col-lg-8 > div > table > tbody > tr > td:nth-child(2)').text(),
        total_downloads: $('#header > div > div > div.col-lg-8 > div > table > tbody > tr > td:nth-child(3)').text(),
        capa: $('#header > div > div > div.col-lg-8 > div > table > tbody > tr > td:nth-child(1) > img').attr('src'),
        link_dl: $('#dlMP3').attr('onclick').split(`downloadFile('`)[1].split(`',`)[0]
      });
    });
  })
}

//PORNHUB
function pornhub(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://pt.pornhub.com/video/search?search=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("li.pcVideoListItem.js-pop.videoblock.videoBox").each((_, say) => {
        var titulo = $(say).find("a").attr('title');
        var link = $(say).find("a").attr('href');
        var img = $(say).find("img").attr('data-thumb_url');
        var duração = $(say).find("var.duration").text().trim();
        var qualidade = $(say).find("span.hd-thumbnail").text().trim();
        var autor = $(say).find("div.usernameWrap").text().trim();
        var visualizações = $(say).find("span.views").text().trim();
        var data_upload = $(say).find("var.added").text().trim();
        var hype = $(say).find("div.value").text().trim();
        var link2 = `https://pt.pornhub.com${link}`
        var resultado = {
          titulo: titulo,
          img: img,
          duração: duração,
          qualidade: qualidade,
          autor: autor,
          visualizações: visualizações,
          data_upload: data_upload,
          hype: hype,
          link: link2
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

//XVIDEOS
function xvideos(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://xvideosporno.blog.br/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.postbox").each((_, say) => {
        var titulo = $(say).find("a").attr('title');
        var link = $(say).find("a").attr('href');
        var img = $(say).find("img").attr('src');
        var duração = $(say).find("time.duration-top").text().trim();
        var qualidade = $(say).find("b.hd-top").text().trim();
        var resultado = {
          titulo: titulo,
          img: img,
          duração: duração,
          qualidade: qualidade,
          link: link
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

//UPTODOWN
function uptodown(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://br.uptodown.com/android/search/${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.item").each((_, say) => {
        var titulo = $(say).find("div.name").text().trim();
        var link = $(say).find("a").attr('href');
        var img = $(say).find("img.app_card_img.lazyload").attr('data-src');
        var descrição = $(say).find("div.description").text().trim();
        var resultado = {
          titulo: titulo,
          link: link,
          icone: img,
          descrição: descrição
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

//GRUPOS WHATSAPP
function gpwhatsapp() {
  return new Promise((resolve, reject) => {
    axios.get(`https://gruposwhats.app/`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.col-12.col-md-6.col-lg-4.mb-4.col-group").each((_, say) => {
        var nome = $(say).find("h5.card-title").text().trim();
        var descrição = $(say).find("p.card-text").text().trim();
        var link = $(say).find("a.btn.btn-success.btn-block.stretched-link.font-weight-bold").attr('href');
        var img = $(say).find("img.card-img-top.lazy").attr('data-src');
        var resultado = {
          nome: nome,
          link: link,
          descrição: descrição,
          img: img
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}


//HENTAIS TUBE
function hentaistube(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://www.hentaistube.com/buscar/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.epiItem").each((_, say) => {
        var titulo = $(say).find("div.epiItemNome").text().trim();
        var link = $(say).find("a").attr('href');
        var img = $(say).find("img").attr('src');
        var resultado = {
          titulo: titulo,
          link: link,
          img: img
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}


//NERDING
function nerding(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://www.nerding.com.br/search?q=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.col-sm-6.col-xs-12.item-boxed-cnt").each((_, say) => {
        var titulo = $(say).find("h3.title").text().trim();
        var descrição = $(say).find("p.summary").text().trim();
        var imagem = $(say).find("img.lazyload.img-responsive").attr('src');
        var link = $(say).find("a.pull-right.read-more").attr('href');
        var review = $(say).find("span.label-post-category").text().trim();
        //    var autor = $(say).find("p.post-meta-inner").text().trim();
        var resultado = {
          titulo: titulo,
          descrição: descrição,
          imagem: imagem,
          review: review,
          link: link
          //      autor: autor
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

//APKMODHACKER
function apkmodhacker(nome) {
  return new Promise((resolve, reject) => {
    axios.get(`https://apkmodhacker.com/?s=${nome}`).then(tod => {
      const $ = cheerio.load(tod.data)
      var postagem = [];
      $("div.post-inner.post-hover").each((_, say) => {
        var nome = $(say).find("h2.post-title.entry-title").text().trim();
        var descrição = $(say).find("div.entry.excerpt.entry-summary").text().trim();
        var imagem = $(say).find("img.attachment-thumb-medium.size-thumb-medium.wp-post-image").attr('src');
        var link = $(say).find("a").attr('href');
        var categoria = $(say).find("p.post-category").text().trim();
        var horario_upload = $(say).find("time.published.updated").attr('datetime');
        var resultado = {
          nome: nome,
          descrição: descrição,
          categoria: categoria,
          imagem: imagem,
          link: link,
          horario_upload: horario_upload
        }
        postagem.push(resultado)
      })
      resolve(postagem)
    }).catch(reject)
  });
}

//YTMP3
async function ytDonlodMp3(url) {
  return new Promise((resolve, reject) => {
    try {
      const id = ytdlgetVideoID(url)
      const yutub = ytdlgetInfo(`https://www.youtube.com/watch?v=${id}`)
        .then((data) => {
          let pormat = data.formats
          let audio = []
          for (let i = 0; i < pormat.length; i++) {
            if (pormat[i].mimeType == 'audio/webm; codecs=\"opus\"') {
              let aud = pormat[i]
              audio.push(aud.url)
            }
          }
          const title = data.player_response.microformat.playerMicroformatRenderer.title.simpleText
          const thumb = data.player_response.microformat.playerMicroformatRenderer.thumbnail.thumbnails[0].url
          const channel = data.player_response.microformat.playerMicroformatRenderer.ownerChannelName
          const views = data.player_response.microformat.playerMicroformatRenderer.viewCount
          const published = data.player_response.microformat.playerMicroformatRenderer.publishDate

          const result = {
            título: title,
            thumb: thumb,
            canal: channel,
            publicado: published,
            visualizações: views,
            link: audio[1]
          }
          return (result)
        })
      resolve(yutub)
    } catch (error) {
      reject(error);
    }
    console.log(error)
  })
}









//PLAY
async function ytPlayMp3(query) {
  return new Promise((resolve, reject) => {
    try {
      const search = yts(query)
        .then((data) => {
          const url = []
          const pormat = data.all
          for (let i = 0; i < pormat.length; i++) {
            if (pormat[i].type == 'video') {
              let dapet = pormat[i]
              url.push(dapet.url)
            }
          }
          const id = ytdlgetVideoID(url[0])
          const yutub = ytdlgetInfo(`https://www.youtube.com/watch?v=${id}`)
            .then((data) => {
              let pormat = data.formats
              let audio = []
              let video = []
              for (let i = 0; i < pormat.length; i++) {
                if (pormat[i].mimeType == 'audio/webm; codecs=\"opus\"') {
                  let aud = pormat[i]
                  audio.push(aud.url)
                }
              }
              const title = data.player_response.microformat.playerMicroformatRenderer.title.simpleText
              const thumb = data.player_response.microformat.playerMicroformatRenderer.thumbnail.thumbnails[0].url
              const channel = data.player_response.microformat.playerMicroformatRenderer.ownerChannelName
              const views = data.player_response.microformat.playerMicroformatRenderer.viewCount
              const published = data.player_response.microformat.playerMicroformatRenderer.publishDate
              const result = {
                título: title,
                thumb: thumb,
                canal: channel,
                publicado: published,
                visualizações: views,
                link: audio[0]
              }
              return (result)
            })
          return (yutub)
        })
      resolve(search)
    } catch (error) {
      reject(error)
    }
    console.log(error)
  })
}

//PLAY VÍDEO
async function ytPlayMp4(query) {
  return new Promise((resolve, reject) => {
    try {
      const search = yts(query)
        .then((data) => {
          const url = []
          const pormat = data.all
          for (let i = 0; i < pormat.length; i++) {
            if (pormat[i].type == 'video') {
              let dapet = pormat[i]
              url.push(dapet.url)
            }
          }
          const id = ytdlgetVideoID(url[0])
          const yutub = ytdlgetInfo(`https://www.youtube.com/watch?v=${id}`)
            .then((data) => {
              let pormat = data.formats
              let video = []
              for (let i = 0; i < pormat.length; i++) {
                if (pormat[i].container == 'mp4' && pormat[i].hasVideo == true && pormat[i].hasAudio == true) {
                  let vid = pormat[i]
                  video.push(vid.url)
                }
              }
              const title = data.player_response.microformat.playerMicroformatRenderer.title.simpleText
              const thumb = data.player_response.microformat.playerMicroformatRenderer.thumbnail.thumbnails[0].url
              const channel = data.player_response.microformat.playerMicroformatRenderer.ownerChannelName
              const views = data.player_response.microformat.playerMicroformatRenderer.viewCount
              const published = data.player_response.microformat.playerMicroformatRenderer.publishDate
              const result = {
                título: title,
                thumb: thumb,
                canal: channel,
                publicado: published,
                visualizações: views,
                url: video[0]
              }
              return (result)
            })
          return (yutub)
        })
      resolve(search)
    } catch (error) {
      reject(error)
    }
    console.log(error)
  })
}

// Caminho para o arquivo de cookies
const cookiesFile = '../ytcookies.txt';

// Função de pesquisa
async function ytSearch(query) {
  return new Promise((resolve, reject) => {
    search(query, function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results.videos); // Retorna os vídeos encontrados
      }
    });
  });
}


async function tiktokDL(url) {
  const domain = 'https://www.tikwm.com/';
  const headers = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'sec-ch-ua': '"Chromium";v="104", " Not A;Brand";v="99", "Google Chrome";v="104"',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36',
  };

  const params = new URLSearchParams({
    'url': url,
    'count': 12,
    'cursor': 0,
    'web': 1,
    'hd': 1,
  });

  const response = await fetch(domain + 'api/', {
    method: 'POST',
    headers: headers,
    body: params,
  });

  const data = await response.json();

  // Retorna o JSON bruto da API
  return data;
}

async function threadsDownloader(url) {
  if (!url || !url.includes('/post/')) {
    throw new Error('URL inválida do Threads');
  }

  const threadId = url.match(/\/post\/([a-zA-Z0-9]+)/)?.[1];
  if (!threadId) throw new Error('Falha ao extrair ID do post');

  const { data: resp } = await axios.get(
    `https://www.dolphinradar.com/api/threads/post_detail/${threadId}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
        Accept: 'application/json'
      }
    }
  );

  const data = resp?.data;
  if (!data || !data.post_detail || !data.user) {
    throw new Error('Dados não encontrados');
  }

  const { post_detail: post, user } = data;
  const media = post.media_list || [];
  const mediaUrls = media.map(m => m.url);

  return {
    user: {
      full_name: user.full_name,
      username: user.username,
      verified: user.verified,
      followers: user.follower_count
    },
    caption: post.caption_text || '',
    like_count: post.like_count,
    media_urls: mediaUrls
  };
}

const mapInflactProfile = (data) => {
  if (!data) return null;
  const profile = data.profile || {};
  return {
    username: profile.username,
    full_name: profile.full_name,
    biography: profile.biography,
    bio_links: profile.bio_links || [],
    followers: profile.edge_followed_by?.count ?? null,
    following: profile.edge_follow?.count ?? null,
    posts: profile.edge_owner_to_timeline_media?.count ?? null,
    profile_pic_url: profile.profile_pic_url,
    profile_pic_url_hd: profile.profile_pic_url_hd,
    external_url: profile.external_url,
    is_private: profile.is_private,
    is_verified: profile.is_verified,
    highlight_reel_count: profile.highlight_reel_count,
    avg_likes: data.avg_likes ?? null,
    avg_comments: data.avg_comments ?? null,
  };
};

const mapInflactPosts = (data) => {
  const edges = data?.profile?.edge_owner_to_timeline_media?.edges;
  if (!Array.isArray(edges)) return [];
  return edges.map((edge) => {
    const node = edge?.node;
    if (!node) return null;
    return {
      id: node.id,
      media_type: node.media_type,
      shortcode: node.shortcode,
      taken_at: node.taken_at,
      is_video: node.is_video,
      like_count: node.edge_liked_by?.count ?? null,
      comment_count: node.edge_media_to_comment?.count ?? null,
      display_url: node.display_url,
      video_url: node.video_url,
      caption:
        node.edge_media_to_caption?.edges?.[0]?.node?.text ?? null,
      permalink: node.shortcode
        ? `https://www.instagram.com/p/${node.shortcode}/`
        : null,
    };
  }).filter(Boolean);
};

async function instaStalk(username, options = {}) {
  if (!username) throw new Error('Username obrigatório');
  const inflact = await fetchInflactProfile(username, options);
  if (!inflact || inflact.status !== 'success') {
    throw new Error('Falha ao obter dados do Instagram (Inflact)');
  }
  const profile = mapInflactProfile(inflact.data);
  const recentPosts = mapInflactPosts(inflact.data);

  return {
    profile,
    recent_posts: recentPosts,
    links: inflact.data?.links || null,
    limits: inflact.data?.limits || null,
    downloader_limits: inflact.data?.downloaderLimits || null,
    preview_limits: inflact.data?.previewLimits || null,
    alert: inflact.data?.alert || null,
  };
}

async function ttstalk(username) {
  if (!username) throw new Error('Username obrigatório');

  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'id-ID,id;q=0.9',
    'content-type': 'application/json',
    origin: 'https://tokviewer.net',
    referer: 'https://tokviewer.net/',
    'user-agent':
      'Mozilla/5.0 (Linux; Android 13; Mobile) Chrome/116.0.0.0 Safari/537.36'
  };

  const profileRes = await axios.post(
    'https://tokviewer.net/api/check-profile',
    { username },
    { headers }
  );
  const videoRes = await axios.post(
    'https://tokviewer.net/api/video',
    { username, offset: Date.now(), limit: 10 },
    { headers }
  );

  const rawProfile = profileRes.data?.data || {};
  const profile = {
    avatar: rawProfile.avatar,
    followers: rawProfile.followers,
    following: rawProfile.following,
    likes: rawProfile.likes
  };

  const rawVideos = videoRes.data?.data || [];
  const videos = rawVideos.map(v => ({
    id: v.aweme_id,
    desc: v.desc,
    cover: v.video?.cover?.url_list?.[0] || null,
    playCount: v.statistics?.play_count || 0,
    likeCount: v.statistics?.digg_count || 0,
    music: v.music?.title || '-',
    musicAuthor: v.music?.author || '-'
  }));

  return { status: true, profile, videos };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function spamngl(link, mensagem) {
  if (!link.startsWith('https://ngl.link/')) {
    throw new Error('Link inválido do NGL');
  }
  if (!mensagem) {
    throw new Error('Mensagem ausente');
  }

  const username = link.split('https://ngl.link/')[1];
  if (!username) throw new Error('Usuário não encontrado');

  try {
    await fetch('https://ngl.link/api/submit', {
      method: 'POST',
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: `username=${username}&question=${encodeURIComponent(mensagem)}&deviceId=1`
    });
    await delay(1000);
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
    throw err;
  }

  return `Mensagem enviada para ${username}`;
}


async function sonuMusicAI(title, lyrics, mood = 'melancholic', genre, gender) {
  if (!title) throw new Error('Título obrigatório');
  if (!lyrics) throw new Error('Letra ausente');
  if (lyrics.length > 1500) throw new Error('Letra longa demais');

  const deviceId = uuidv4();
  const userHeaders = {
    'user-agent': 'NB Android/1.0.0',
    'content-type': 'application/json',
    accept: 'application/json',
    'x-platform': 'android',
    'x-app-version': '1.0.0',
    'x-country': 'ID',
    'accept-language': 'id-ID',
    'x-client-timezone': 'Asia/Jakarta'
  };

  const msgId = uuidv4();
  const time = Date.now().toString();
  const registerHeaders = {
    ...userHeaders,
    'x-device-id': deviceId,
    'x-request-id': msgId,
    'x-message-id': msgId,
    'x-request-time': time
  };

  const fcmToken = 'eqnTqlxMTSKQL5NQz6r5aP:APA91bHa3CvL5Nlcqx2yzqTDAeqxm_L_vIYxXqehkgmTsCXrV29eAak6_jqXv5v1mQrdw4BGMLXl_BFNrJ67Em0vmdr3hQPVAYF8kR7RDtTRHQ08F3jLRRI';

  const reg = await axios.put('https://musicai.apihub.today/api/v1/users', { deviceId, fcmToken }, { headers: registerHeaders });
  const userId = reg.data.id;
  const createHeaders = { ...registerHeaders, 'x-client-id': userId };

  const body = { type: 'lyrics', name: title, lyrics };
  if (mood) body.mood = mood;
  if (genre) body.genre = genre;
  if (gender) body.gender = gender;

  const create = await axios.post('https://musicai.apihub.today/api/v1/song/create', body, { headers: createHeaders });
  const songId = create.data.id;

  const checkHeaders = { ...userHeaders, 'x-client-id': userId };
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data: check } = await axios.get('https://musicai.apihub.today/api/v1/song/user', {
      params: { userId, isFavorite: false, page: 1, searchText: '' },
      headers: checkHeaders
    });
    const found = check.datas.find(song => song.id === songId);
    if (found && found.url) return found;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout ao gerar música');
}



async function mediafire(url) {
  try {
    if (!url.includes('www.mediafire.com')) throw new Error('Invalid url');

    const { data } = await axios.get('https://api.nekorinn.my.id/tools/rynn-stuff-v2', {
      params: {
        method: 'GET',
        url,
        accessKey: '3ebcf782818cfa0b7265086f112ae25c0954afec762aa05a2eac66580c7cb353'
      }
    });

    const $ = cheerio.load(data.result.response);
    const raw = $('div.dl-info');

    const filename = $('.dl-btn-label').attr('title') || raw.find('div.intro div.filename').text().trim() || null;
    const ext = filename.split('.').pop() || null;
    const mimetype = lookup(ext.toLowerCase()) || null;

    const filesize = raw.find('ul.details li:nth-child(1) span').text().trim();
    const uploaded = raw.find('ul.details li:nth-child(2) span').text().trim();
    const dl = $('a#downloadButton').attr('data-scrambled-url');
    if (!dl) throw new Error('File not found');

    return {
      filename,
      filesize,
      mimetype,
      uploaded,
      download_url: Buffer.from(dl, 'base64').toString('utf8'),
      url
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

async function veo3(prompt, { model = 'veo-3-fast', auto_sound = false, auto_speech = false } = {}) {
  try {
    const models = ['veo-3-fast', 'veo-3'];
    if (!prompt) throw new Error('Prompt is required');
    if (!models.includes(model)) throw new Error(`Available models: ${models.join(', ')}`);
    if (typeof auto_sound !== 'boolean') throw new Error('Auto sound must be a boolean');
    if (typeof auto_speech !== 'boolean') throw new Error('Auto speech must be a boolean');

    const { data: cf } = await axios.get('https://api.nekorinn.my.id/tools/rynn-stuff', {
      params: {
        mode: 'turnstile-min',
        siteKey: '0x4AAAAAAANuFg_hYO9YJZqo',
        url: 'https://aivideogenerator.me/features/g-ai-video-generator',
        accessKey: 'e2ddc8d3ce8a8fceb9943e60e722018cb23523499b9ac14a8823242e689eefed'
      }
    });

    const uid = crypto.createHash('md5').update(Date.now().toString()).digest('hex');
    const { data: task } = await axios.post('https://aiarticle.erweima.ai/api/v1/secondary-page/api/create', {
      prompt,
      imgUrls: [],
      quality: '720p',
      duration: 8,
      autoSoundFlag: auto_sound,
      soundPrompt: '',
      autoSpeechFlag: auto_speech,
      speechPrompt: '',
      speakerId: 'Auto',
      aspectRatio: '16:9',
      secondaryPageId: 1811,
      channel: 'VEO3',
      source: 'aivideogenerator.me',
      type: 'features',
      watermarkFlag: true,
      privateFlag: true,
      isTemp: true,
      vipFlag: true,
      model
    }, {
      headers: {
        uniqueid: uid,
        verify: cf.result.token
      }
    });

    while (true) {
      const { data } = await axios.get(`https://aiarticle.erweima.ai/api/v1/secondary-page/api/${task.data.recordId}`, {
        headers: {
          uniqueid: uid,
          verify: cf.result.token
        }
      });

      if (data.data.state === 'success') return JSON.parse(data.data.completeData);
      await new Promise(res => setTimeout(res, 1000));
    }
  } catch (error) {
    throw new Error(error.message);
  }
}



module.exports = { styletext, playstore, gpwhatsapp, hentaistube, nerding, apkmodhacker, xvideos, uptodown, mediafire, pornhub, soundl, st, gpsrc, dafontSearch, dafontDown, ff, papeldeparede, htdl, xvideoss, xvideosdl, assistithtdl, assistitht, pornogratis, wallmob, fluxAI, resetFluxCookies, threadsDownloader, instaStalk, ttstalk, spamngl, sonuMusicAI, veo3, ytDonlodMp3, ytPlayMp3, ytPlayMp4, ytSearch, TelegraPh, tiktokDL, spotifyDl }

//xvideos('porno').then((data) => console.log(data))
