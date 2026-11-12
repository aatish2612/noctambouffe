'use strict';
/**
 * Import de vrais restaurants ouverts la nuit depuis OpenStreetMap (API Overpass).
 * Gratuit, sans compte, sans clé d'API.
 *
 *   npm run import            Paris + petite couronne (rapide, quelques centaines à milliers de spots)
 *   npm run import -- idf     toute l'Île-de-France (plus long, plus de spots)
 *
 * Relancer l'import est sans danger : les spots déjà présents sont ignorés.
 * Données © contributeurs OpenStreetMap, licence ODbL — https://www.openstreetmap.org/copyright
 */
require('dotenv').config({ quiet: true });
const db = require('./database');
const { convert } = require('./osm');

// OVERPASS_URL permet d'imposer un serveur précis (ou de tester avec un faux serveur).
const ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const TIMEOUT_MS = 240000;

const ZONES = {
  paris: { label: 'Paris et petite couronne', prefix: '', filter: '(48.72,2.10,48.99,2.60)' },
  // Rectangle englobant l'Île-de-France : rapide pour le serveur Overpass. Il déborde sur les départements voisins,
  // mais osm.js écarte alors par code postal tout lieu hors Île-de-France (75, 77, 78, 91, 92, 93, 94, 95).
  idf: { label: 'toute l\'Île-de-France', prefix: '', filter: '(48.12,1.45,49.24,3.56)' },
};

/**
 * Requête Overpass : restaurants et fast-foods nommés, dont les horaires mentionnent
 * 24/7 ou une fermeture entre 23h et 6h. Le tri fin (Décret de 23h) est refait dans osm.js.
 */
function buildQuery(zone) {
  return `[out:json][timeout:200];
${zone.prefix}
nwr["amenity"~"^(restaurant|fast_food)$"]["name"]["opening_hours"~"24/7|-(2[3-9]|0[0-6]):"]${zone.filter};
out center tags;`;
}

async function fetchOverpass(query) {
  const errors = [];
  for (const url of ENDPOINTS) {
    const host = new URL(url).host;
    console.log(`→ Interrogation de ${host} (compte 1 à 4 minutes, ne ferme pas le terminal)…`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Noctambouffe-projet-scolaire/1.0' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(res.status === 429 || res.status === 504 ? `serveur surchargé (HTTP ${res.status})` : `HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.elements)) throw new Error('réponse inattendue');
      if (json.remark && /error|timed out/i.test(json.remark)) console.warn(`⚠ ${host} signale : ${json.remark} (résultat peut-être partiel)`);
      return json.elements;
    } catch (err) {
      errors.push(`${host} : ${err.name === 'TimeoutError' ? 'délai dépassé' : err.message}`);
      console.warn(`✗ ${errors[errors.length - 1]}`);
    }
  }
  throw new Error(`Aucun serveur Overpass n'a répondu.\n  - ${errors.join('\n  - ')}`);
}

async function main() {
  const zoneName = (process.argv[2] || 'paris').toLowerCase();
  const zone = ZONES[zoneName];
  if (!zone) {
    console.error(`Zone inconnue « ${zoneName} ». Utilise : npm run import   ou   npm run import -- idf`);
    process.exit(1);
  }

  console.log(`🌙 Import OpenStreetMap — ${zone.label}`);
  let elements;
  try {
    elements = await fetchOverpass(buildQuery(zone));
  } catch (err) {
    console.error(`\n${err.message}`);
    console.error('\nVérifie ta connexion internet (VPN, pare-feu, réseau de l\'école) puis réessaie dans quelques minutes.');
    console.error('Les serveurs Overpass gratuits sont parfois saturés : réessayer plus tard règle souvent le problème.');
    process.exit(1);
  }

  const { spots, ecartes } = convert(elements);
  const avant = db.countSpots();
  const ajoutes = db.importSpots(spots);

  console.log('\n✔ Terminé');
  console.log(`  Éléments reçus d'OpenStreetMap : ${elements.length}`);
  console.log(`  Écartés (sans nom, sans position, hors Île-de-France ou jamais ouverts la nuit) : ${ecartes}`);
  console.log(`  Spots valides                  : ${spots.length}`);
  console.log(`  Nouveaux spots ajoutés         : ${ajoutes} (${spots.length - ajoutes} déjà présents)`);
  console.log(`  Total dans l'annuaire          : ${avant + ajoutes}`);
  console.log('\nDonnées © contributeurs OpenStreetMap (licence ODbL) — https://www.openstreetmap.org/copyright');
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
