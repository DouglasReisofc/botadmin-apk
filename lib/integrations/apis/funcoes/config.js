const LocalStrategy = require('passport-local').Strategy;
const { usuario } = require('../db/model'); // O modelo de usuário

module.exports = function (passport) {
    // Configurando a estratégia local do passport
    passport.use(new LocalStrategy(
        async (login, _senha, done) => {
            try {
                const numero = (login || '').replace(/\D/g, '');
                const candidatos = new Set();
                if (numero) {
                    candidatos.add(numero);
                    if (numero.startsWith('55')) {
                        const semDDI = numero.slice(2);
                        candidatos.add(semDDI);
                        if (semDDI.length >= 10) {
                            const sem9 = semDDI.replace(/^(\d{2})9/, '$1');
                            const com9 = semDDI.replace(/^(\d{2})(\d)/, '$19$2');
                            candidatos.add(`55${sem9}`);
                            candidatos.add(`55${com9}`);
                            candidatos.add(sem9);
                            candidatos.add(com9);
                        }
                    } else if (numero.length <= 11) {
                        const sem9 = numero.replace(/^(\d{2})9/, '$1');
                        const com9 = numero.replace(/^(\d{2})(\d)/, '$19$2');
                        candidatos.add(`55${numero}`);
                        candidatos.add(`55${sem9}`);
                        candidatos.add(`55${com9}`);
                        candidatos.add(sem9);
                        candidatos.add(com9);
                    }
                }
                const lista = Array.from(candidatos);
                console.log('Login: buscando usuários com números', lista);
                let user = null;
                if (lista.length) {
                    user = await usuario.findOneIn('whatsapp', lista);
                }
                // Não faz fallback por adminCode aqui; login por adminCode é tratado em /admin/login
                console.log('Login: resultado', user ? `id ${user.id}` : 'nenhum encontrado');
                if (!user) {
                    return done(null, false, { message: 'Usuário não encontrado' });
                }
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        })
    );

    // Serializando o usuário para armazenar o ID na sessão
    passport.serializeUser(function (user, done) {
        done(null, user.id);
    });

    // Desserializando o usuário a partir da sessão
    passport.deserializeUser(async function (id, done) {
        try {
            const user = await usuario.findById(id);
            done(null, user);
        } catch (err) {
            done(err);
        }
    });
}
