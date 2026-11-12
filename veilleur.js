'use strict';
/**
 * Le Veilleur de Nuit : règles horaires + moteur de réponse.
 *
 * Aucun appel réseau, aucune clé d'API : le Veilleur est un moteur à règles
 * (détection de l'heure, de la faim, du type de cuisine, du quartier) qui
 * pioche ses répliques dans des banques de phrases. Il est donc gratuit,
 * instantané et testable de façon déterministe (le hasard est injectable).
 */

const TYPES = ['Kebab', 'Burger', 'Pizza', 'Asiatique', 'Bistrot', 'Libanais', 'Tacos', 'Indien', 'Snack', 'Autre'];

const TZ = 'Europe/Paris';
const NIGHT_START = 23 * 60; // 23h00
const NIGHT_LENGTH = 7 * 60; // jusqu'à 6h00 le lendemain
const NIGHT_END = 6 * 60;

/* ------------------------------------------------------------------ */
/* Heures                                                              */
/* ------------------------------------------------------------------ */

/** "HH:MM" -> minutes depuis minuit, ou null si le format est invalide. */
function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Le lieu est-il ouvert à `minute` ? Gère le passage de minuit
 * (ex : 18:00 -> 02:00). Ouverture == fermeture signifie 24h/24.
 */
function isOpenAt(ouverture, fermeture, minute) {
  const o = toMinutes(ouverture);
  const f = toMinutes(fermeture);
  if (o === null || f === null) return false;
  if (o === f) return true;
  return o < f ? minute >= o && minute < f : minute >= o || minute < f;
}

/** Décret de 23h : le lieu doit être ouvert à un moment du créneau 23h -> 6h. */
function coversNight(ouverture, fermeture) {
  for (let i = 0; i < NIGHT_LENGTH; i += 1) {
    if (isOpenAt(ouverture, fermeture, (NIGHT_START + i) % 1440)) return true;
  }
  return false;
}

/** Minutes écoulées depuis minuit, à Paris. */
function parisMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') * 60 + get('minute');
}

function fmtTime(minute) {
  if (minute === 0) return 'minuit';
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function isNight(minute) {
  return minute >= NIGHT_START || minute < NIGHT_END;
}

/** Minuscules, sans accents, apostrophes normalisées. */
function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[’`]/g, "'");
}

/** Extrait une heure d'un message libre ("3h", "02:15", "minuit et demi"...). */
function parseTime(message) {
  const t = normalize(message);
  if (/\bminuit\b/.test(t)) {
    if (/minuit et demi/.test(t)) return 30;
    if (/minuit (?:et )?quart/.test(t)) return 15;
    return 0;
  }
  const m = /\b(\d{1,2})\s*(?:h|:|heures?)\s*(\d{2})?(?!\d)/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 30);
  const evening = /du soir|ce soir|apres.?midi|\bpm\b/.test(rest);
  const morning = /du matin|du mat\b|\bam\b/.test(rest);
  if (evening && !morning && h < 12) h += 12;
  if (h === 24) h = 0;
  return h * 60 + min;
}

/* ------------------------------------------------------------------ */
/* Analyse du message                                                  */
/* ------------------------------------------------------------------ */

const BIG_HUNGER = ['grosse dalle', 'gros dalle', 'grosse faim', 'enorme', 'affame', 'creve la dalle', 'creve de faim',
  'faim de loup', 'tres faim', 'trop faim', 'mort de faim', 'xxl', 'copieux', 'double', 'a fond', 'gouffre', 'un max'];
const SMALL_HUNGER = ['petite faim', 'petit creux', 'petite dalle', 'un petit truc', 'grignot', 'leger', 'snack',
  'de quoi tenir', 'un peu faim', 'pas grand chose', 'en-cas', 'en cas'];

function detectHunger(t) {
  if (BIG_HUNGER.some((k) => t.includes(k))) return 'grosse';
  if (SMALL_HUNGER.some((k) => t.includes(k))) return 'petite';
  return 'normale';
}

const CUISINES = [
  ['Kebab', ['kebab', 'grec', 'doner', 'shawarma']],
  ['Burger', ['burger', 'smash']],
  ['Pizza', ['pizza', 'calzone']],
  ['Asiatique', ['sushi', 'ramen', 'pho', 'thai', 'chinois', 'nem', 'wok', 'asiatique', 'japonais', 'coreen', 'nouilles']],
  ['Bistrot', ['bistrot', 'brasserie', 'steak', 'frites', 'croque', 'oignon', 'entrecote', 'bouillon', 'omelette']],
  ['Libanais', ['libanais', 'falafel', 'houmous', 'mezze']],
  ['Tacos', ['tacos', 'mexicain', 'burrito', 'quesadilla']],
  ['Indien', ['indien', 'curry', 'naan', 'tikka', 'biryani', 'samosa']],
  ['Snack', ['sandwich', 'snack', 'panini', 'hot dog', 'hotdog', 'crepe', 'gaufre', 'croissant', 'pain', 'boulangerie', 'dessert']],
];

function detectCuisines(t) {
  const words = new Set(t.split(/[^a-z0-9]+/));
  return CUISINES.filter(([, keys]) => keys.some((k) => (k.includes(' ') ? t.includes(k) : words.has(k)))).map(([type]) => type);
}

const STOP_WORDS = new Set(['avec', 'pour', 'dans', 'faim', 'manger', 'dalle', 'grosse', 'petite', 'minuit', 'heure', 'heures',
  'matin', 'soir', 'quelque', 'chose', 'cherche', 'veux', 'voudrais', 'besoin', 'autour', 'pres', 'proche', 'paris', 'france',
  'nuit', 'truc', 'envie', 'vers', 'quartier', 'mais', 'tout', 'tres', 'trop', 'bien', 'quelque', 'sans', 'plus', 'moins', 'suis']);

/** Mots utiles pour le quartier / le nom : mots de 4+ lettres, codes postaux, "11e" -> 75011. */
function locationTokens(t) {
  const tokens = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w) && !/^\d{1,4}$/.test(w)));
  const arr = /\b(\d{1,2})\s?(?:e|eme|er)\b/.exec(t);
  if (arr && Number(arr[1]) >= 1 && Number(arr[1]) <= 20) tokens.add(`750${String(arr[1]).padStart(2, '0')}`);
  return [...tokens].filter((w) => !detectCuisinesWord(w));
}

// Un mot déjà reconnu comme cuisine ne doit pas compter deux fois comme "quartier".
function detectCuisinesWord(w) {
  return CUISINES.some(([, keys]) => keys.includes(w));
}

/** Mots qui coupent un nom de lieu ("à Sevran j'ai faim" -> "Sevran"). */
const PLACE_STOPPERS = new Set(['pour', 'avec', 'et', 'ou', 'mais', 'car', "j'ai", 'jai', 'je', 'tu', 'il', 'on', 'grosse', 'gros', 'petite',
  'petit', 'faim', 'dalle', 'minuit', 'heure', 'heures', 'matin', 'soir', 'mat', 'nuit', 'un', 'une', 'ce', 'cette', 'parce', 'que', 'si', 'stp']);
const ARTICLES = new Set(['le', 'la', 'les', "l'"]);

/**
 * Cherche un nom de lieu dans le message ("un kebab à Sevran", "vers Méry sur Oise") ; null s'il n'y en a pas.
 * Le lieu est ensuite géolocalisé par le serveur (voir geocode.js).
 */
function extractPlace(message) {
  const re = /(?:^|[\s,.;!?])(?:à|a|au|aux|vers|pres de|près de|autour de|dans|sur|proche de|du côté de|du cote de)\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,3})/giu;
  let m = re.exec(String(message));
  while (m) {
    const words = [];
    for (const w of m[1].split(/\s+/)) {
      const n = normalize(w);
      if (PLACE_STOPPERS.has(n) || /\d/.test(n)) break;
      words.push(w);
    }
    // On ignore les articles de tête pour juger le mot qui compte ("Le Raincy" -> "raincy").
    const core = words.filter((w, i) => !(i < words.length - 1 && words.slice(0, i + 1).every((x) => ARTICLES.has(normalize(x)))));
    const first = core.length ? normalize(core[0]) : '';
    const ordinary = ['maison', 'moi', 'ici', 'chez', 'toi'].includes(first);
    if (first.length >= 3 && !ARTICLES.has(first) && !ordinary && !detectCuisinesWord(first) && !STOP_WORDS.has(first)) return words.join(' ');
    m = re.exec(String(message));
  }
  return null;
}

// Mots courants qui ne sont jamais un lieu (utilisé quand le message ne contient pas « à Paris », « vers Sevran »…).
const LOOSE_IGNORED = new Set(['salut', 'bonjour', 'coucou', 'veux', 'voudrais', 'cherche', 'manger', 'bouffer', 'bouffe', 'resto', 'restos',
  'restaurant', 'restaurants', 'ouvert', 'ouverts', 'proche', 'pres', 'autour', 'chez', 'moi', 'mon', 'des', 'les', 'pour', 'avec', 'dans',
  'quelque', 'chose', 'truc', 'trouve', 'trouver', 'donne', 'donnez', 'svp', 'stp', 'merci', 'aujourd', 'hui', 'tard', 'heure', 'heures',
  'creux', 'enorme', 'affame', 'gouffre', 'copieux', 'double', 'leger', 'petit', 'petite', 'grosse', 'gros', 'dalle', 'faim', 'minuit', 'est',
  'suis', 'ici', 'maison', 'quoi', 'quel', 'quelle', 'adresse', 'adresses', 'endroit', 'spot', 'spots', 'idee', 'idees']);

/**
 * Lieu « nu » : « Châtelet », « kebab Châtelet », « 2h pizza Châtelet les Halles ».
 * On retire l'heure, la cuisine, la faim et les mots courants ; s'il reste 1 à 3 mots, c'est le lieu probable.
 * Plus risqué que extractPlace : le serveur ne garde le résultat que si le géocodeur renvoie un vrai lieu
 * (quartier, commune, station), et reste silencieux sinon.
 */
function extractPlaceLoose(message) {
  const text = String(message).replace(/\b\d{1,2}\s*(?:h|:|heures?)\s*\d{0,2}\b/gi, ' ');
  const words = [];
  for (const m of text.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
    const raw = m[0];
    const n = normalize(raw);
    if (n.length < 3 || STOP_WORDS.has(n) || PLACE_STOPPERS.has(n) || LOOSE_IGNORED.has(n) || detectCuisinesWord(n) || ARTICLES.has(n)) continue;
    words.push(raw);
  }
  return words.length >= 1 && words.length <= 3 ? words.join(' ') : null;
}

/* ------------------------------------------------------------------ */
/* Répliques                                                           */
/* ------------------------------------------------------------------ */

const TIME_ROASTS = {
  soiree: [
    '{h}. L\'heure où les gens bien élevés dorment et où toi, tu négocies avec un frigo vide.',
    'Il est {h} et tu cherches à bouffer. Ta mère serait fière. Enfin non, mais passons.',
    '{h}, déjà ? T\'as même pas la décence d\'attendre le fond de la nuit pour faire n\'importe quoi.',
    'Ah, un client de {h}. Le dernier métro est parti sans toi, comme tout le reste.',
  ],
  coeur: [
    '{h} du mat\'. Tes horaires, c\'est un cri d\'alarme que personne n\'écoute.',
    'À {h}, y\'a que les rats, les livreurs et toi. Et franchement, t\'es pas le mieux classé.',
    '{h}. Qui vit comme ça ? Ton rythme de sommeil a démissionné sans préavis.',
    'Tu me tires du lit à {h} pour un sandwich. Même ton réveil a honte de te connaître.',
    '{h}. À cette heure-là, ce n\'est plus de la fringale, c\'est de la négligence de soi.',
  ],
  aube: [
    '{h}. Soit t\'as pas dormi, soit t\'es un boulanger raté. Dans les deux cas, c\'est triste.',
    'Le jour se lève et toi tu cherches encore à bouffer. Le soleil te regarde de travers.',
    '{h}. À cette heure, t\'es plus un noctambule, t\'es un fantôme avec un ticket resto.',
  ],
  jour: [
    '{h} ? Décret de 23h : avant la nuit, je ne sers personne. Va déjeuner comme un citoyen.',
    'À {h}, tu viens me voir ? Le soleil est encore là, imbécile. Décret de 23h : reviens quand il aura eu la décence de partir.',
    '{h}. Le jour, c\'est pour les gens normaux. Moi je ne parle qu\'aux dégénérés du soir. Décret de 23h.',
  ],
};

const HUNGER_ROASTS = {
  petite: [
    'Une petite faim ? C\'est même pas un appétit, c\'est une excuse.',
    'Tout ça pour un en-cas ? Mon estomac de gardien de nuit a plus d\'ambition que le tien.',
    'Tu déranges un professionnel pour un petit creux. Mange une chaussette, ça ira aussi vite.',
    'Petite faim... même ton estomac a honte de se pointer à cette heure-là.',
  ],
  normale: [
    'Une faim normale, comme ta vie : sans relief, sans surprise, sans intérêt.',
    'Ni petite ni grosse : la faim du mec qui n\'assume rien. Classique.',
    'T\'as faim, comme tout le monde, sauf que toi tu l\'annonces en pleine nuit comme si c\'était une info.',
  ],
  grosse: [
    'Grosse dalle ? Ton estomac n\'est pas un organe, c\'est une déclaration de guerre au quartier.',
    'Une faim de loup et la conscience tranquille d\'un cambrioleur. Quel tocard magnifique.',
    'Ton estomac gronde, et c\'est lui qui prend les décisions dans ta vie, hein ? Ça explique tout.',
    'Un gouffre, voilà ce que t\'as là-dedans. On devrait te facturer un loyer.',
  ],
};

const BADGES = {
  soiree: { petite: 'Grignoteur de crépuscule', normale: 'Veilleur amateur', grosse: 'Estomac de première soirée' },
  coeur: { petite: 'Moineau insomniaque', normale: 'Zombie homologué', grosse: 'Gouffre de 3h du mat\'' },
  aube: { petite: 'Fantôme à ticket resto', normale: 'Noctambule périmé', grosse: 'Ogre de l\'aube' },
  jour: { petite: 'Citoyen du jour égaré', normale: 'Citoyen du jour égaré', grosse: 'Citoyen du jour égaré' },
};

const MISSING_CUISINE = [
  'Tu voulais du {cuisine} ? Y\'a rien de ça d\'ouvert. C\'est la nuit, pas Deliveroo : tu manges ce qu\'on te donne.',
  'Du {cuisine} à cette heure-là ? Rêve. Voilà ce qui reste debout, comme toi, mais en mieux.',
];

const CLOSED_ROASTS = [
  'Fermé à {h}, comme ton cerveau. Ce spot ne t\'ouvrira pas.',
  'À {h}, le rideau est baissé. Ton planning, lui, est tout aussi en ruine.',
  'Tu tombes sur un spot qui dort à {h}. Tu veux une médaille pour ton timing ?',
];

const VAGUE_LINES = [
  'T\'as rien dit d\'exploitable : ni heure, ni envie. J\'ai pris l\'heure qu\'il est et j\'ai improvisé, comme toi dans la vie.',
  'Pas d\'heure, pas d\'envie, pas de personnalité. Je me fie à l\'horloge, puisque toi tu ne sers à rien.',
];

const LIEU_FOUND = [
  'Direction {lieu}. Évidemment, il fallait que tu habites au bout du monde.',
  '{lieu} ? Je regarde ce qui reste debout là-bas. Pas grand-chose, comme d\'habitude.',
  'Tu veux bouffer à {lieu} à cette heure-là. J\'admire le courage, pas le jugement.',
];

const LIEU_UNKNOWN = [
  'Je ne connais pas « {lieu} », ou alors tu l\'as mal écrit. Je te cherche ça dans toute l\'Île-de-France.',
  '« {lieu} » ? Introuvable. Même mes cartes ont des limites, mais pas autant que ton orthographe.',
];

const CLOSINGS = {
  valide: ['Voilà ton adresse, ne me remercie pas :', 'Fonce, et que ça te serve de leçon :', 'Voilà. Va t\'y goinfrer :'],
  valide_many: ['Voilà tes adresses, choisis vite, je n\'ai pas toute la nuit :', 'Trois options, parce que tu es incapable de te décider seul :', 'Sers-toi, et ne me remercie pas :'],
  closed: ['Voilà l\'adresse quand même, pour aller pleurer devant le rideau :', 'Je te la donne, mais elle est fermée. Bonne chance :'],
  decree: ['Aucune adresse avant 23h. C\'est la loi, la mienne :'],
  empty: ['Rien à te donner pour l\'instant. Va remplir l\'annuaire, feignasse :'],
};

const PUBLIC_VALIDATION_ROASTS = [
  'Fermer à {f} ? Décret de 23h, tocard : un resto qui ferme avant la nuit n\'a rien à faire dans mon annuaire.',
  'Ton spot dort ({o} → {f}) avant même que la nuit commence. Ici on parle de gens qui veillent, pas de retraités du ravioli. Dégage.',
  'Rejeté. Décret de 23h. Reviens quand ton restaurant aura appris à veiller.',
];

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : vars[k]));

function bandOf(minute) {
  if (minute >= NIGHT_START || minute < 120) return 'soiree';
  if (minute < 300) return 'coeur';
  if (minute < 360) return 'aube';
  return 'jour';
}

function hoursLabel(spot) {
  return spot.ouverture === spot.fermeture ? 'non-stop' : `de ${spot.ouverture} à ${spot.fermeture}`;
}

/** Message du Veilleur quand un spot est refusé par le Décret de 23h (erreur 422). */
function validationRoast(ouverture, fermeture, rng = Math.random) {
  return fill(pick(PUBLIC_VALIDATION_ROASTS, rng), { o: ouverture, f: fermeture });
}

/* ------------------------------------------------------------------ */
/* Décision                                                            */
/* ------------------------------------------------------------------ */

const MAX_PROPOSALS = 3;
// Rayons de recherche autour du point demandé, en km : on prend le plus petit qui contient assez de spots.
const RADII = [1, 2, 4, 8, 15, 30, 60, 120, 400];
const CUISINE_MAX_RADIUS = 8; // au-delà, on préfère des spots proches d'une autre cuisine à un spot lointain de la bonne cuisine

/** Distance à vol d'oiseau (formule de haversine), en kilomètres. */
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Répond à un message d'utilisateur.
 * @param {string} message  texte libre
 * @param {Array}  spots    spots enregistrés ({nom, type, adresse, ouverture, fermeture, roast, lat, lon})
 * @param {{now?: Date, rng?: Function, position?: {lat:number, lon:number}|null, lieu?: {nom:string, trouve:boolean}|null}} opts
 *        injection de l'heure et du hasard (tests) ; position GPS (ou centre du lieu cité) facultative ;
 *        lieu = nom de lieu cité dans le message, trouvé ou non par le géocodage
 * @returns {{reponse: string, recommandation: object, recommandations: object[], contexte: object}}
 *          `recommandation` : la 1re proposition, au format imposé ; `recommandations` : jusqu'à 3 propositions.
 */
function decide(message, spots, { now = new Date(), rng = Math.random, position = null, lieu = null } = {}) {
  const text = normalize(message);
  const parsed = parseTime(message);
  const minute = parsed === null ? parisMinutes(now) : parsed;
  const heure = fmtTime(minute);
  const band = bandOf(minute);
  const hunger = detectHunger(text);
  const cuisines = detectCuisines(text);
  const tokens = locationTokens(text);
  const vars = { h: heure, cuisine: cuisines[0] ? cuisines[0].toLowerCase() : '' };

  const badge = BADGES[band][hunger];
  const roastTime = fill(pick(TIME_ROASTS[band], rng), vars);
  const roastHunger = pick(HUNGER_ROASTS[hunger], rng);
  const vague = parsed === null && cuisines.length === 0 && tokens.length === 0 && hunger === 'normale';
  const vagueLine = vague ? pick(VAGUE_LINES, rng) : '';
  const contexte = { heure, source: parsed === null ? 'horloge' : 'message', faim: hunger, position: Boolean(position), lieu: lieu ? lieu.nom : null,
    // Centre de la recherche (GPS ou commune citée) : sert à placer « toi » sur la carte.
    centre: position ? { lat: position.lat, lon: position.lon } : null };
  const lieuLine = lieu ? [fill(pick(lieu.trouve ? LIEU_FOUND : LIEU_UNKNOWN, rng), { lieu: lieu.nom })] : [];

  /** Assemble la réponse : texte commun + proposition(s). */
  const finish = (statut, nom, adresse, shared, closingKey, list, firstRoast) => {
    const sharedText = [vagueLine, roastTime, roastHunger, ...shared].filter(Boolean).join(' ');
    const recommandation = {
      nom,
      adresse,
      statut,
      punchline_roast: [roastTime, roastHunger, ...shared, firstRoast].filter(Boolean).join(' '),
      badge_attribue: badge,
    };
    return {
      reponse: `${sharedText} ${pick(CLOSINGS[closingKey], rng)}`,
      recommandation,
      recommandations: list || [recommandation],
      contexte,
    };
  };

  // Décret de 23h : hors de la nuit (6h -> 23h), le Veilleur ne sert personne.
  if (!isNight(minute)) {
    return finish('REJETÉ', 'Aucun — Décret de 23h', 'Reviens après 23h, quand le jour aura démissionné.', [], 'decree');
  }

  if (!spots.length) {
    return finish('REJETÉ', 'Aucun spot enregistré', 'Importe des spots (npm run import) ou ajoute-en dans l\'onglet « Ajouter un spot ».', [], 'empty');
  }

  // Classement : cuisine demandée (+3), mots du message retrouvés dans le nom/l'adresse (+2 chacun),
  // puis distance si la position est connue, puis hasard.
  const ranked = spots.map((spot) => {
    let score = cuisines.includes(spot.type) ? 3 : 0;
    if (tokens.length) {
      const haystack = normalize(`${spot.nom} ${spot.adresse}`);
      score += tokens.filter((tok) => haystack.includes(tok)).length * 2;
    }
    const hasGps = position && spot.lat !== null && spot.lat !== undefined && spot.lon !== null && spot.lon !== undefined;
    return {
      spot,
      score,
      open: isOpenAt(spot.ouverture, spot.fermeture, minute),
      dist: hasGps ? distanceKm(position, { lat: spot.lat, lon: spot.lon }) : null,
      r: rng(),
    };
  });
  const byRank = (a, b) => b.score - a.score || (a.dist === null ? 1e9 : a.dist) - (b.dist === null ? 1e9 : b.dist) || a.r - b.r;

  const card = (x, statut, roast) => ({
    nom: x.spot.nom,
    adresse: x.spot.adresse,
    statut,
    punchline_roast: roast,
    badge_attribue: badge,
    type: x.spot.type,
    ouverture: x.spot.ouverture,
    fermeture: x.spot.fermeture,
    lat: x.spot.lat ?? null,
    lon: x.spot.lon ?? null,
    distance_km: x.dist === null ? null : Math.round(x.dist * 10) / 10,
    spot_id: x.spot.id,
  });

  const radiusFor = (list, count) => RADII.find((r) => list.filter((x) => x.dist <= r).length >= count) || Infinity;

  /**
   * Avec un point de départ (GPS ou lieu cité), on ne garde que les spots proches :
   * le plus petit rayon contenant 3 spots, élargi si la cuisine demandée n'existe que un peu plus loin.
   * Un spot lointain de la bonne cuisine ne passe donc jamais devant des spots à côté.
   */
  const nearbyPool = (sorted) => {
    if (!position) return sorted;
    const located = sorted.filter((x) => x.dist !== null);
    if (!located.length) return sorted;
    let radius = radiusFor(located, MAX_PROPOSALS);
    if (cuisines.length) {
      const wanted = radiusFor(located.filter((x) => cuisines.includes(x.spot.type)), 1);
      if (wanted <= CUISINE_MAX_RADIUS) radius = Math.max(radius, wanted);
    }
    // Les spots sans GPS (ajoutés à la main) ne servent qu'à compléter s'il n'y a pas assez de spots proches.
    return [...located.filter((x) => x.dist <= radius), ...sorted.filter((x) => x.dist === null)];
  };

  const open = ranked.filter((x) => x.open).sort(byRank);
  if (open.length) {
    const picks = nearbyPool(open).slice(0, MAX_PROPOSALS);
    const shared = [...lieuLine, ...(cuisines.length && !picks.some((x) => cuisines.includes(x.spot.type)) ? [fill(pick(MISSING_CUISINE, rng), vars)] : [])];
    const result = finish('VALIDÉ', picks[0].spot.nom, picks[0].spot.adresse, shared,
      picks.length > 1 ? 'valide_many' : 'valide', picks.map((x) => card(x, 'VALIDÉ', x.spot.roast)), picks[0].spot.roast);
    result.spot_id = picks[0].spot.id;
    result.contexte.score = picks[0].score;
    return result;
  }

  // Rien d'ouvert à cette heure : on donne quand même l'adresse du meilleur candidat, en REJETÉ.
  const best = ranked.sort(byRank)[0];
  const closedRoast = [fill(pick(CLOSED_ROASTS, rng), vars), `(Ouvert ${hoursLabel(best.spot)}.)`].join(' ');
  const result = finish('REJETÉ', best.spot.nom, best.spot.adresse, [...lieuLine, closedRoast], 'closed', [card(best, 'REJETÉ', closedRoast)], '');
  result.spot_id = best.spot.id;
  return result;
}

module.exports = {
  TYPES, toMinutes, isOpenAt, coversNight, isNight, parisMinutes, fmtTime, parseTime, normalize,
  detectHunger, detectCuisines, extractPlace, extractPlaceLoose, validationRoast, distanceKm, decide,
};
