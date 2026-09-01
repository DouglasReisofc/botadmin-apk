const mysql = require('mysql2/promise');

const cfg = {
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 3306),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  charset: 'utf8mb4',
};

const REPLACEMENTS = [
  ['Ol?', 'Olá'], ['ol?', 'olá'], ['Voc?', 'Você'], ['voc?', 'você'], ['d?', 'dê'], ['j?', 'já'],
  ['n?o', 'não'], ['s?o', 'são'], ['?rea', 'área'], ['vis?o', 'visão'], ['Vis?o', 'Visão'],
  ['servi?o', 'serviço'], ['solu??o', 'solução'], ['automa??o', 'automação'], ['automa??es', 'automações'],
  ['modera??o', 'moderação'], ['integra??o', 'integração'], ['avan?ados', 'avançados'],
  ['usu?rios', 'usuários'], ['mant?m', 'mantêm'], ['contrata??es', 'contratações'], ['ap?s', 'após'],
  ['migra??es', 'migrações'], ['necess?rio', 'necessário'], ['op??es', 'opções'], ['respons?vel', 'responsável'],
  ['n?mero', 'número'], ['viola??o', 'violação'], ['ocorr?ncias', 'ocorrências'], ['comunica??es', 'comunicações'],
  ['atrav?s', 'através'], ['eleg?veis', 'elegíveis'], ['restaura??o', 'restauração'], ['pr?prio', 'próprio'],
  ['rob?', 'robô'], ['fun??es', 'funções'], ['confirma??o', 'confirmação'], ['experi?ncia', 'experiência'],
  ['experi?ncias', 'experiências'], ['estar?', 'estará'], ['padr?o', 'padrão'], ['inst?ncia', 'instância'],
  ['inst?ncias', 'instâncias'], ['d?vida', 'dúvida'], ['gest?o', 'gestão'], ['boas?vindas', 'boas-vindas'],
  ['autom?tico', 'automático'], ['autom?tica', 'automática'], ['autom?ticas', 'automáticas'], ['a??es', 'ações'],
  ['pol?ticas', 'políticas'], ['come?ar', 'começar'], ['Come?ar', 'Começar'], ['atualiza??es', 'atualizações'],
  ['? um prazer', 'É um prazer'], ['pr?ximo', 'próximo'], ['espec?ficos', 'específicos'], ['benef?cios', 'benefícios'],
  ['m?dia', 'mídia'], ['ir?', 'irá'], ['usu?rio', 'usuário'],
  ['incr?veis', 'incríveis'],
  ['p?blico', 'público'],
  ['come?ou', 'começou'],
  ['est?', 'está'],
  ['Pr?ximo', 'Próximo'],
  ['Inst?ncia', 'Instância'],
  ['J? sou cliente', 'Já sou cliente'],
  ['R$?', 'R$ '],
  ['Usu?rio', 'Usuário'],
  ['usu?rio', 'usuário'],
  ['Usu?rios', 'Usuários'],
  ['Lan?amento', 'Lançamento'],
  ['lan?amento', 'lançamento'],
  ['Promo??o', 'Promoção'],
  ['promo??o', 'promoção'],
  ['Promo??es', 'Promoções'],
  ['Administra??o', 'Administração'],
  ['administra??o', 'administração'],
  ['fam?lia', 'família'],
  ['circunst?ncias', 'circunstâncias'],
  ['seguran?a', 'segurança'],
  ['portugu?s', 'português'],
  ['c?digo', 'código'],
  ['Inscri??es', 'Inscrições'],
  ['divulga??o', 'divulgação'],
  ['lan?ar', 'lançar'],
  ['N?o', 'Não'],
  ['n?o', 'não'],
  ['t?', 'tá'],
  ['J?', 'Já'],
  ['verifica??o', 'verificação'],
  ['m?s', 'mês'],
  ['conte?do', 'conteúdo'],
  ['integra??es', 'integrações'],
  ['s?mbolo', 'símbolo'],
  ['v?deo', 'vídeo'],
  ['m?todo', 'método'],
  ['sugest?o', 'sugestão'],
  ['vers?o', 'versão'],
  ['M?dia', 'Mídia'],
  ['hor?rio', 'horário'],
  ['Hor?rio', 'Horário'],
  ['N?mero', 'Número'],
  ['ser?', 'será'],
  ['ficar?', 'ficará'],
  ['entrar?', 'entrará'],
  ['An?ncio', 'Anúncio'],
  ['an?ncio', 'anúncio'],
  ['manh?', 'manhã'],
  ['Inscrio', 'Inscrição'],
  ['Premiao', 'Premiação'],
  ['obrigat?rio', 'obrigatório'],
  ['apresentao', 'apresentação'],
  ['Divulgao', 'Divulgação'],
  ['PROVIS?RIO', 'PROVISÓRIO'],
  ['Garc?a', 'García'],
  ['Cau?', 'Cauã'],
  [' ? um ', ' é um '],
  [' ? essencial', ' é essencial'],
  [' ? obrigatário', ' é obrigatório'],
  [' ? obrigatario', ' é obrigatório'],
  [' ? Acesse', ' ✅ Acesse'],
  ['painel. ?', 'painel. ✨'],
  ['aqui! ', 'aqui! 🚀'],
  ['passos juntos ', 'passos juntos ⬇️'],
  ['*Seu teste gratuito começou agora!*', '🎉 *Seu teste gratuito começou agora!*']
];

const cleanup = (text) => {
  let out = text;
  for (const [bad, good] of REPLACEMENTS) out = out.split(bad).join(good);
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
};

const fixAny = (value) => {
  if (typeof value === 'string') return cleanup(value);
  if (Array.isArray(value)) return value.map((item) => fixAny(item));
  if (value && typeof value === 'object') {
    const next = {};
    for (const [k, v] of Object.entries(value)) next[k] = fixAny(v);
    return next;
  }
  return value;
};

const safe = async (label, fn) => {
  try {
    await fn();
  } catch (error) {
    console.warn(`skip ${label}: ${error.message}`);
  }
};

(async () => {
  const conn = await mysql.createConnection(cfg);
  const updates = [];

  const updatePlain = async (table, keyCol, cols) => {
    const [rows] = await conn.query(`SELECT ${[keyCol, ...cols].map((c) => `\`${c}\``).join(', ')} FROM \`${table}\``);
    for (const row of rows) {
      const changedCols = [];
      const values = [];
      for (const col of cols) {
        const current = row[col];
        if (typeof current !== 'string' || !current) continue;
        const next = cleanup(current);
        if (next !== current) {
          changedCols.push(col);
          values.push(next);
        }
      }
      if (!changedCols.length) continue;
      const setSql = changedCols.map((c) => `\`${c}\` = ?`).join(', ');
      await conn.query(`UPDATE \`${table}\` SET ${setSql} WHERE \`${keyCol}\` = ?`, [...values, row[keyCol]]);
      updates.push(`${table}: ${row[keyCol]} (${changedCols.join(', ')})`);
    }
  };

  const updateJson = async (table, keyCol, col) => {
    const [rows] = await conn.query(`SELECT \`${keyCol}\`, \`${col}\` FROM \`${table}\``);
    for (const row of rows) {
      const raw = row[col];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const fixed = fixAny(parsed);
      const nextRaw = JSON.stringify(fixed);
      if (nextRaw === raw) continue;
      await conn.query(`UPDATE \`${table}\` SET \`${col}\` = ? WHERE \`${keyCol}\` = ?`, [nextRaw, row[keyCol]]);
      updates.push(`${table}: ${row[keyCol]} (${col})`);
    }
  };

  await safe('admin_site_settings', () => updatePlain('admin_site_settings', 'id', [
    'hero_badge','hero_title','hero_subtitle','features_title','features_subtitle','workflow_title',
    'workflow_description','cta_title','cta_description','cta_button_label','seo_title','seo_description','footer_text','terms_content',
    'hero_secondary_button_label'
  ]));
  await safe('admin_site_settings.test_groups_json', () => updateJson('admin_site_settings', 'id', 'test_groups_json'));

  await safe('admin_bot_config', () => updatePlain('admin_bot_config', 'id', [
    'instance_connected_body_text',
    'group_actions_body_text',
    'group_delete_prompt_body_text'
  ]));

  await safe('admin_email_templates', () => updatePlain('admin_email_templates', 'id', ['name', 'subject','heading','body_html','cta_label','footer_text']));
  await safe('subscription_plans', () => updatePlain('subscription_plans', 'id', ['name','description']));
  await safe('useful_links', () => updatePlain('useful_links', 'id', ['title','description','button_label']));
  await safe('useful_link_banners', () => updatePlain('useful_link_banners', 'id', ['title','subtitle']));
  await safe('field_tutorials', () => updatePlain('field_tutorials', 'id', ['title','description']));
  await safe('api_request_plans', () => updatePlain('api_request_plans', 'id', ['description']));
  await safe('admin_campaigns', () => updatePlain('admin_campaigns', 'id', ['name']));
  await safe('admin_mobile_build_jobs', () => updatePlain('admin_mobile_build_jobs', 'id', ['message']));
  await safe('user_notifications', () => updatePlain('user_notifications', 'id', ['title', 'message', 'metadata']));
  await safe('user_support_threads', () => updatePlain('user_support_threads', 'id', ['last_message_preview']));
  await safe('user_support_messages', () => updatePlain('user_support_messages', 'id', ['text', 'payload']));
  await safe('user_notification_audio_settings', () => updatePlain('user_notification_audio_settings', 'user_id', ['raffle_template', 'purchase_template', 'balance_template', 'plan_template']));

  await safe('bot_groups', () => updatePlain('bot_groups', 'id', ['name', 'description', 'metadata']));
  await safe('bot_group_settings', () => updatePlain('bot_group_settings', 'group_id', [
    'menu_texts',
    'welcome_config',
    'auto_responses',
    'command_aliases',
    'ai_prompt',
    'antifake_message',
    'ads_config',
    'last_mark_message',
    'rules_message',
    'last_broadcast_template'
  ]));
  await safe('bot_ad_campaigns', () => updatePlain('bot_ad_campaigns', 'id', ['name', 'description', 'content_json', 'next_target_hint_json']));
  await safe('bot_group_divulgacao_templates', () => updatePlain('bot_group_divulgacao_templates', 'id', ['description', 'contents_json']));
  await safe('bot_instance_settings', () => updatePlain('bot_instance_settings', 'instance_id', ['auto_responses']));
  await safe('user_raffles', () => updatePlain('user_raffles', 'id', ['description', 'group_targets', 'metadata']));
  await safe('user_payment_methods', () => updatePlain('user_payment_methods', 'id', ['display_name', 'settings']));

  await safe('admin_mobile_settings.onboarding_slides', () => updateJson('admin_mobile_settings', 'id', 'onboarding_slides'));
  await safe('plan_trial_settings.settings_json', () => updateJson('plan_trial_settings', 'id', 'settings_json'));
  await safe('plan_guard_settings.settings_json', () => updateJson('plan_guard_settings', 'id', 'settings_json'));
  await safe('admin_billing_notifications.settings', () => updateJson('admin_billing_notifications', 'id', 'settings'));
  await safe('admin_meta_templates.components', () => updateJson('admin_meta_templates', 'id', 'components'));
  await safe('user_notifications.metadata', () => updateJson('user_notifications', 'id', 'metadata'));
  await safe('user_payment_charges.metadata', () => updateJson('user_payment_charges', 'id', 'metadata'));
  await safe('user_plan_payments.metadata', () => updateJson('user_plan_payments', 'id', 'metadata'));
  await safe('user_balance_payments.metadata', () => updateJson('user_balance_payments', 'id', 'metadata'));
  await safe('user_api_request_topups.metadata', () => updateJson('user_api_request_topups', 'id', 'metadata'));
  await safe('bot_groups.metadata', () => updateJson('bot_groups', 'id', 'metadata'));
  await safe('bot_groups.participants', () => updateJson('bot_groups', 'id', 'participants'));
  await safe('bot_group_settings.menu_texts', () => updateJson('bot_group_settings', 'group_id', 'menu_texts'));
  await safe('bot_group_settings.welcome_config', () => updateJson('bot_group_settings', 'group_id', 'welcome_config'));
  await safe('bot_group_settings.auto_responses', () => updateJson('bot_group_settings', 'group_id', 'auto_responses'));
  await safe('bot_group_settings.command_aliases', () => updateJson('bot_group_settings', 'group_id', 'command_aliases'));
  await safe('bot_group_settings.ads_config', () => updateJson('bot_group_settings', 'group_id', 'ads_config'));
  await safe('bot_group_settings.last_broadcast_template', () => updateJson('bot_group_settings', 'group_id', 'last_broadcast_template'));
  await safe('bot_group_settings.horapg_config', () => updateJson('bot_group_settings', 'group_id', 'horapg_config'));
  await safe('bot_group_settings.schedule_config', () => updateJson('bot_group_settings', 'group_id', 'schedule_config'));
  await safe('bot_ad_campaigns.schedule_config', () => updateJson('bot_ad_campaigns', 'id', 'schedule_config'));
  await safe('bot_ad_campaigns.content_json', () => updateJson('bot_ad_campaigns', 'id', 'content_json'));
  await safe('bot_ad_campaigns.options_json', () => updateJson('bot_ad_campaigns', 'id', 'options_json'));
  await safe('bot_ad_campaigns.next_target_hint_json', () => updateJson('bot_ad_campaigns', 'id', 'next_target_hint_json'));
  await safe('bot_group_divulgacao_templates.contents_json', () => updateJson('bot_group_divulgacao_templates', 'id', 'contents_json'));
  await safe('bot_instance_settings.auto_responses', () => updateJson('bot_instance_settings', 'instance_id', 'auto_responses'));
  await safe('user_raffles.group_targets', () => updateJson('user_raffles', 'id', 'group_targets'));
  await safe('user_raffles.metadata', () => updateJson('user_raffles', 'id', 'metadata'));
  await safe('user_payment_methods.settings', () => updateJson('user_payment_methods', 'id', 'settings'));

  await conn.end();

  console.log(`updated_rows=${updates.length}`);
  for (const line of updates.slice(0, 200)) console.log(line);
  if (updates.length > 200) console.log(`...and ${updates.length - 200} more`);
})();
