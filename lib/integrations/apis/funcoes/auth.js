const { usuario } = require('../db/model');
const { BotApi } = require('../db/botApi');
const { BotConfig } = require('../db/botConfig');
const { Compra } = require('../db/compras');
const { Plano } = require('../db/planos');
const { AssinaturaAddons } = require('../db/addons');
const { gerarCodigoVerificacao, enviarCodigoWhatsapp } = require('./function');

// Recupera limites do plano e addons do usuário
async function getUserLimits(userId) {
  const assinatura = await Compra.findActiveSubscriptionByUser(userId);
  if (!assinatura) return { instancias: 0, grupos: 0 };
  const plano = await Plano.findById(assinatura.plano);
  const addons = await AssinaturaAddons.getByUser(userId);
  const instancias =
    (parseInt(plano?.instanciasMax, 10) || 0) +
    (parseInt(addons?.instanciasExtras, 10) || 0);
  const grupos =
    (parseInt(plano?.gruposMax, 10) || 0) +
    (parseInt(addons?.gruposExtras, 10) || 0);
  return { instancias, grupos };
}

// Verifica se o usuário ainda pode criar instâncias dentro do limite contratado
async function hasAvailableInstance(userId) {
  try {
    const { instancias } = await getUserLimits(userId);
    if (instancias <= 0) return false;
    const usadas = await BotApi.countDocuments({ user: userId });
    return usadas < instancias;
  } catch (err) {
    console.error('Erro ao verificar instâncias disponíveis:', err);
    return false;
  }
}

// Verifica se o usuário ainda pode cadastrar grupos dentro do limite
async function hasAvailableGroup(userId) {
  try {
    const { grupos } = await getUserLimits(userId);
    if (grupos <= 0) return false;
    const usadas = await BotConfig.countDocuments({ user: userId });
    return usadas < grupos;
  } catch (err) {
    console.error('Erro ao verificar grupos disponíveis:', err);
    return false;
  }
}

function isTrueAdmin(val) {
  return val === true || val === 1 || val === '1' || val === 'true';
}

module.exports = {
  // Middleware para garantir que o usuário está autenticado
  isAuthenticated: function (req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    req.flash('error_msg', '⚠️ Você precisa estar logado para acessar esta página.');
    return res.redirect('/');
  },

  // Middleware para garantir que o usuário não está autenticado
  notAuthenticated: function (req, res, next) {
    if (!req.isAuthenticated()) {
      return next();
    }
    res.redirect('/painel');
  },

  // Middleware para garantir que o usuário é um admin (consulta o banco e valida estritamente)
  isAdmin: async function (req, res, next) {
    try {
      if (!req.isAuthenticated()) {
        req.flash('error_msg', '⚠️ Faça login para continuar.');
        return res.redirect('/entrar');
      }
      const id = req.user && (req.user._id || req.user.id);
      const fresh = id ? await usuario.findById(id) : null;
      const allowed = fresh && isTrueAdmin(fresh.admin);
      // mantém req.user sincronizado
      if (fresh) req.user = fresh;
      if (allowed) return next();

      // remove vínculo de admin em sessão legado
      if (req.session) {
        delete req.session.adminId;
        delete req.session.impersonating;
      }

      const atAdmin = (req.originalUrl || req.path || '').startsWith('/admin');
      if (atAdmin) {
        req.flash('error_msg', '❌ Acesso restrito a administradores.');
        return res.redirect('/admin/login');
      }
      req.flash('error_msg', '❌ Você não tem permissão para acessar esta página.');
      return res.redirect('/painel');
    } catch (err) {
      console.error('[isAdmin] erro:', err.message);
      req.flash('error_msg', 'Erro de autorização.');
      return res.redirect('/');
    }
  },

  isTrueAdmin,

  // Middleware para garantir que o WhatsApp do usuário está verificado
  isWhatsappVerified: async function (req, res, next) {
    if (req.isAuthenticated() && req.user.whatsappVerificado) {
      return next();
    }

    try {
      const novoCodigo = gerarCodigoVerificacao();
      await usuario.findByIdAndUpdate(req.user.id, { codigoVerificacao: novoCodigo });
      await enviarCodigoWhatsapp(req.user.whatsapp, novoCodigo);
    } catch (err) {
      console.error('Erro ao reenviar código de verificação:', err);
    }

    req.flash('error_msg', '⚠️ Você precisa verificar o WhatsApp antes de acessar o painel. Um novo código foi enviado.');
    res.redirect('/usuario/verificar-whatsapp');
  },

  // Middleware para garantir que o usuário possui ao menos um WhatsApp conectado
  hasInstance: async function (req, res, next) {
    try {
      const userId = req.user._id || req.user.id;
      if (await hasAvailableInstance(userId)) return next();
      req.flash('error_msg', '⚠️ Conecte um WhatsApp antes de acessar o painel.');
      return res.redirect('/conectarwhatsapp');
    } catch (err) {
      console.error('Erro ao verificar instâncias do usuário:', err);
      req.flash('error_msg', 'Erro ao verificar conexões.');
      return res.redirect('/conectarwhatsapp');
    }
  },

  hasAvailableInstance,
  hasAvailableGroup
};
