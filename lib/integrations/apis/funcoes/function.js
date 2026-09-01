const fs = require('fs-extra');
const axios = require('axios');
const crypto = require('crypto');  // Importando crypto para gerar código de verificação
const FormData = require('form-data');

const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'.split('');

// Função para gerar o token de autenticação
const generateAuthToken = () => {
    return crypto.randomBytes(30).toString('hex');
}

// Função para gerar um código de verificação de 6 dígitos
function gerarCodigoVerificacao() {
    return crypto.randomInt(100000, 999999).toString();  // Gera um código aleatório de 6 dígitos
}

// Função para gerar um texto aleatório de determinado comprimento
function randomText(len) {
    const result = [];
    for (let i = 0; i < len; i++) result.push(pool[Math.floor(Math.random() * pool.length)]);
    return result.join('');
}

const { SiteConfig } = require('../db/siteConfig');
const { getPool } = require('../db/connect');
const { sendText } = require('../db/waActions');
const { whatsappNumber: defaultWhatsappNumber } = require('../configuracao');
const { BotApi } = require('../db/botApi');

async function buildConfigFields(config) {
    let api = null;
    if (config.verificationApi) {
        try {
            api = await BotApi.findById(config.verificationApi);
        } catch (_) { /* ignore */ }
    }
    return {
        baseUrl: (api?.baseUrl || 'https://wzap.assinazap.shop').replace(/\/+$/, ''),
        apiKey: api?.apikey || 'A762E6A59827-4C78-8162-3056A928430C',
        instance: api?.instance || '5592991129258',
        numero: config.whatsappNumber || defaultWhatsappNumber
    };
}

async function getActiveBotApi(userId = null) {
    const pool = getPool();

    if (userId) {
        try {
            const [rows] = await pool.query(
                `SELECT a.* FROM bot_configs bc
                 JOIN bot_apis a ON bc.botApi = a.id
                 LEFT JOIN servers s ON a.server = s.id
                 WHERE bc.user = ? AND bc.status = 1 AND a.status = 1 AND (s.status = 1 OR s.status IS NULL)
                 LIMIT 1`,
                [userId]
            );
            if (rows.length) return rows[0];
        } catch (_) { /* ignore */ }
    }

    const [apis] = await pool.query(
        `SELECT a.* FROM bot_apis a
         LEFT JOIN servers s ON a.server = s.id
         WHERE a.status = 1 AND (s.status = 1 OR s.status IS NULL)
         ORDER BY a.id ASC
         LIMIT 1`
    );
    return apis[0] || null;
}

async function getBotApiById(id) {
    const pool = getPool();
    const [apis] = await pool.query(
        `SELECT a.* FROM bot_apis a
         LEFT JOIN servers s ON a.server = s.id
         WHERE a.id = ? AND (s.status = 1 OR s.status IS NULL) LIMIT 1`,
        [id]
    );
    return apis[0] || null;
}

async function getVerificationApi() {
    try {
        const config = (await SiteConfig.findOne()) || {};
        if (config.verificationApi) {
            const api = await getBotApiById(config.verificationApi);
            if (api) return api;
        }
    } catch (_) {
        // ignore errors loading site config
    }
    return await getActiveBotApi();
}

// Função para enviar texto via WhatsApp usando as configurações do site
async function enviarTextoSite(texto, numero = null) {
    const config = (await SiteConfig.findOne()) || {};
    const { baseUrl, apiKey, instance, numero: numPadrao } = await buildConfigFields(config);
    const url = `${baseUrl}/message/sendText/${instance}`;
    const headers = { 'Content-Type': 'application/json', apikey: apiKey };
    const data = { number: numero || numPadrao, text: texto };
    try {
        await axios.post(url, data, { headers });
    } catch (error) {
        console.error('Erro ao enviar texto via WhatsApp:', error.message);
    }
}

// Função para enviar texto via Telegram
async function enviarTelegramSite(texto) {
    const config = (await SiteConfig.findOne()) || {};
    if (!config.telegramNotify) return;
    const token = config.telegramToken || '';
    const chatId = config.telegramChatId || '';
    if (!token || !chatId) return;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, { chat_id: chatId, text: texto });
    } catch (error) {
        console.error('Erro ao enviar texto via Telegram:', error.message);
    }
}

// Função para enviar texto ou mídia para o canal do Telegram com botões opcionais
async function enviarTelegramChannel(texto, buttons = [], media = null) {
    const config = (await SiteConfig.findOne()) || {};
    const token = config.telegramToken || '';
    const channelId = config.telegramChannelId || '';
    if (!token || !channelId) return;

    const baseUrl = `https://api.telegram.org/bot${token}`;
    const hasMedia = media && (media.url || media.buffer) && media.type;

    const methodMap = { photo: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', document: 'sendDocument' };
    if (hasMedia) {
        const method = methodMap[media.type] || 'sendPhoto';
        if (media.buffer) {
            const form = new FormData();
            form.append('chat_id', channelId);
            form.append('caption', texto);
            form.append('parse_mode', 'HTML');
            if (Array.isArray(buttons) && buttons.length) {
                form.append('reply_markup', JSON.stringify({ inline_keyboard: [buttons] }));
            }
            const field = media.type === 'video' ? 'video' : media.type === 'audio' ? 'audio' : media.type === 'document' ? 'document' : 'photo';
            form.append(field, media.buffer, { filename: media.fileName || `${field}.bin` });
            try {
                await axios.post(`${baseUrl}/${method}`, form, { headers: form.getHeaders() });
            } catch (error) {
                console.error('Erro ao enviar texto para canal Telegram:', error.message);
            }
            return;
        }

        const payload = { chat_id: channelId, parse_mode: 'HTML', caption: texto };
        const field = media.type === 'video' ? 'video' : media.type === 'audio' ? 'audio' : media.type === 'document' ? 'document' : 'photo';
        payload[field] = media.url;
        if (Array.isArray(buttons) && buttons.length) {
            payload.reply_markup = { inline_keyboard: [buttons] };
        }
        try {
            await axios.post(`${baseUrl}/${method}`, payload);
        } catch (error) {
            console.error('Erro ao enviar texto para canal Telegram:', error.message);
        }
        return;
    }

    const payload = { chat_id: channelId, parse_mode: 'HTML', text: texto };
    if (Array.isArray(buttons) && buttons.length) {
        payload.reply_markup = { inline_keyboard: [buttons] };
    }
    try {
        await axios.post(`${baseUrl}/sendMessage`, payload);
    } catch (error) {
        console.error('Erro ao enviar texto para canal Telegram:', error.message);
    }
}

// Função para enviar o código de verificação via WhatsApp
async function enviarCodigoWhatsapp(numero, codigo, apiOverride = null) {
    const api = apiOverride || (await getVerificationApi());

    if (!api) {
        console.warn('Nenhuma BotApi ativa encontrada para envio do código.');
        return;
    }

    try {
        await sendText(
            api.baseUrl,
            api.apikey,
            api.instance,
            numero,
            `Seu código de verificação é:\n\n${codigo}\n\npara concluir seu cadastro no site Bot Admin`
        );
    } catch (err) {
        console.error('Erro ao enviar código via BotApi:', err.message);
    }
}

// Função para ler arquivos TXT
function readFileTxt(file) {
    return new Promise((resolve, reject) => {
        const data = fs.readFileSync(file, 'utf8');
        const array = data.toString().split('\n');
        const random = array[Math.floor(Math.random() * array.length)];
        resolve(random.replace('\r', ''));
    })
}

// Função para ler arquivos JSON
function readFileJson(file) {
    return new Promise((resolve, reject) => {
        const jsonData = JSON.parse(fs.readFileSync(file));
        const index = Math.floor(Math.random() * jsonData.length);
        const random = jsonData[index];
        resolve(random);
    })
}

module.exports = {
    readFileTxt,
    readFileJson,
    generateAuthToken,
    randomText,
    gerarCodigoVerificacao,
    enviarCodigoWhatsapp,
    enviarTextoSite,
    enviarTelegramSite,
    enviarTelegramChannel,
    buildConfigFields,
    getActiveBotApi,
    getVerificationApi
};
