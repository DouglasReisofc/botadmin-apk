export type NotificationVoiceOption = {
  value: string;
  label: string;
};

export const DEFAULT_NOTIFICATION_BOT_NAME = "StoreBot";

export const DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE =
  "{{customer_name}} comprou {{category_name}} no {{bot_name}}.";

export const DEFAULT_NOTIFICATION_BALANCE_TEMPLATE =
  "{{customer_name}} adicionou {{amount}} no {{bot_name}}. {{balance_text}}";

export const DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE =
  "{{customer_name}} garantiu {{ticket_quantity}} número(s) na rifa {{raffle_name}}{{ticket_numbers_phrase}}.";

export const DEFAULT_NOTIFICATION_PLAN_TEMPLATE =
  "{{buyer_name}} confirmou o plano {{plan_name}} por {{amount}}.";

export const DEFAULT_NOTIFICATION_VOICE = "br_005";

export const NOTIFICATION_VOICE_OPTIONS: NotificationVoiceOption[] = [
  { value: "ludmilla", label: "Compat - Ludmilla (usa br_004)" },
  { value: "laizza", label: "Compat - Laizza (usa br_004)" },
  { value: "lhays", label: "Compat - Lhays (usa br_003)" },
  { value: "bueno", label: "Compat - Bueno (usa br_005)" },
  { value: "ivete", label: "Compat - Ivete (usa br_004)" },
  { value: "br001", label: "Compat - BR-001 (usa br_003)" },
  { value: "br002", label: "Compat - BR-002 (usa br_004)" },
  { value: "br003", label: "Compat - BR-003 (usa br_003)" },
  { value: "br004", label: "Compat - BR-004 (usa br_004)" },
  { value: "br005", label: "Compat - BR-005 (usa br_005)" },
  { value: "br_003", label: "Portuguese BR - Female 2 (br_003)" },
  { value: "br_004", label: "Portuguese BR - Female 3 (br_004)" },
  { value: "br_005", label: "Portuguese BR - Male (br_005)" },
  { value: "en_us_001", label: "English US - Female (en_us_001)" },
  { value: "en_us_006", label: "English US - Male 1 (en_us_006)" },
  { value: "en_us_007", label: "English US - Male 2 (en_us_007)" },
  { value: "en_us_009", label: "English US - Male 3 (en_us_009)" },
  { value: "en_us_010", label: "English US - Male 4 (en_us_010)" },
  { value: "en_uk_001", label: "English UK - Male 1 (en_uk_001)" },
  { value: "en_uk_003", label: "English UK - Male 2 (en_uk_003)" },
  { value: "en_au_001", label: "English AU - Female (en_au_001)" },
  { value: "en_au_002", label: "English AU - Male (en_au_002)" },
  { value: "fr_001", label: "French - Male 1 (fr_001)" },
  { value: "fr_002", label: "French - Male 2 (fr_002)" },
  { value: "de_001", label: "German - Female (de_001)" },
  { value: "de_002", label: "German - Male (de_002)" },
  { value: "es_002", label: "Spanish - Male (es_002)" },
  { value: "es_mx_002", label: "Spanish MX - Male 1 (es_mx_002)" },
  { value: "es_male_m3", label: "Spanish MX - Male 2 (es_male_m3)" },
  { value: "es_female_f6", label: "Spanish MX - Female 1 (es_female_f6)" },
  { value: "es_female_fp1", label: "Spanish MX - Female 2 (es_female_fp1)" },
  { value: "es_mx_female_supermom", label: "Spanish MX - Female 3 (es_mx_female_supermom)" },
  { value: "id_001", label: "Indonesian - Female (id_001)" },
  { value: "jp_001", label: "Japanese - Female 1 (jp_001)" },
  { value: "jp_003", label: "Japanese - Female 2 (jp_003)" },
  { value: "jp_005", label: "Japanese - Female 3 (jp_005)" },
  { value: "jp_006", label: "Japanese - Male (jp_006)" },
  { value: "kr_002", label: "Korean - Male 1 (kr_002)" },
  { value: "kr_004", label: "Korean - Male 2 (kr_004)" },
  { value: "kr_003", label: "Korean - Female (kr_003)" },
  { value: "en_us_ghostface", label: "Characters - Ghostface (en_us_ghostface)" },
  { value: "en_us_chewbacca", label: "Characters - Chewbacca (en_us_chewbacca)" },
  { value: "en_us_c3po", label: "Characters - C3PO (en_us_c3po)" },
  { value: "en_us_stitch", label: "Characters - Stitch (en_us_stitch)" },
  { value: "en_us_stormtrooper", label: "Characters - Stormtrooper (en_us_stormtrooper)" },
  { value: "en_us_rocket", label: "Characters - Rocket (en_us_rocket)" },
  { value: "en_female_f08_salut_damour", label: "Singing - Alto (en_female_f08_salut_damour)" },
  { value: "en_male_m03_lobby", label: "Singing - Tenor (en_male_m03_lobby)" },
  { value: "en_male_m03_sunshine_soon", label: "Singing - Sunshine Soon (en_male_m03_sunshine_soon)" },
  { value: "en_female_f08_warmy_breeze", label: "Singing - Warmy Breeze (en_female_f08_warmy_breeze)" },
  { value: "en_female_ht_f08_glorious", label: "Singing - Glorious (en_female_ht_f08_glorious)" },
  { value: "en_male_sing_funny_it_goes_up", label: "Singing - It Goes Up (en_male_sing_funny_it_goes_up)" },
  { value: "en_male_m2_xhxs_m03_silly", label: "Singing - Chipmunk (en_male_m2_xhxs_m03_silly)" },
  { value: "en_female_ht_f08_wonderful_world", label: "Singing - Dramatic (en_female_ht_f08_wonderful_world)" },
];

export const NOTIFICATION_VOICE_ID_SET = new Set(
  NOTIFICATION_VOICE_OPTIONS.map((option) => option.value),
);
