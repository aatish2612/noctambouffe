'use strict';
/**
 * Transforme un nom de lieu ("Sevran", "Méry sur Oise") en coordonnées GPS grâce à Nominatim,
 * le service de géocodage gratuit d'OpenStreetMap (sans clé, sans compte).
 *
 * Respect de la politique d'usage de Nominatim : User-Agent explicite, au plus 1 requête par
 * seconde, résultats mis en cache. Seul le nom du lieu tapé par l'utilisateur est envoyé
 * (jamais sa position GPS, jamais le reste du message).
 *
 * Lieu inconnu : renvoie null (le Veilleur le dit, avec mépris). Service indisponible ou délai
 * dépassé : renvoie undefined, et le Veilleur continue sans position, sans erreur visible.
 *
 * Données © contributeurs OpenStreetMap, licence ODbL — https://www.openstreetmap.org/copyright
 */

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = Number(process.env.NOMINATIM_DELAY_MS ?? 1100);
const TIMEOUT_MS = 4000;
const CACHE_MAX = 500;

// Deux zones, interrogées dans l'ordre. Paris et la petite couronne d'abord : « Châtelet » doit désigner le quartier
// parisien et non « Le Châtelet-en-Brie » à 50 km. Si rien n'y est trouvé, on élargit à toute l'Île-de-France.
const ZONES = [
  { nom: 'Paris et petite couronne', west: 2.10, north: 48.99, east: 2.60, south: 48.72 },
  { nom: 'Île-de-France', west: 1.45, north: 49.24, east: 3.56, south: 48.12 },
];

const cache = new Map(); // nom normalisé -> résultat | null
let nextSlot = 0;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Une requête Nominatim bornée à une zone. Renvoie le résultat, ou null si la zone n'a rien ; lève en cas de panne. */
async function search(place, zone) {
  // File d'attente simple : on réserve un créneau, au plus 1 appel réseau par intervalle.
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Date.now() + wait + MIN_INTERVAL_MS;
  if (wait) await sleep(wait);

  const params = new URLSearchParams({
    q: place,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
    countrycodes: 'fr',
    viewbox: `${zone.west},${zone.north},${zone.east},${zone.south}`,
    bounded: '1',
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': 'Noctambouffe-projet-scolaire/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const results = await res.json();
  const first = Array.isArray(results) ? results[0] : null;
  const lat = first ? Number(first.lat) : NaN;
  const lon = first ? Number(first.lon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // Libellé lisible, pour que l'utilisateur voie quel lieu a été compris : « Châtelet, Paris ».
  const address = first.address || {};
  const nom = String(first.name || String(first.display_name || place).split(',')[0]).slice(0, 80);
  const ville = String(address.city || address.town || address.village || address.municipality || '').slice(0, 60);
  const libelle = ville && ville.toLowerCase() !== nom.toLowerCase() ? `${nom}, ${ville}` : nom;
  return { nom, libelle, lat, lon, categorie: String(first.category || ''), type: String(first.type || ''), zone: zone.nom };
}

/**
 * @param {string} place  nom de lieu tel que tapé par l'utilisateur
 * @returns {Promise<{nom: string, libelle: string, lat: number, lon: number, categorie: string, type: string, zone: string} | null | undefined>}
 *          null = lieu inconnu ; undefined = service indisponible
 */
async function lookup(place) {
  const key = String(place).toLowerCase().trim();
  if (!key) return undefined;
  if (cache.has(key)) return cache.get(key);

  let found = null;
  try {
    for (const zone of ZONES) {
      found = await search(place, zone);
      if (found) break;
    }
  } catch {
    // Panne réseau, délai dépassé, réponse invalide : on ne met PAS en cache (réessai possible plus tard).
    return undefined;
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, found); // un lieu réellement introuvable est mis en cache aussi
  return found;
}

module.exports = { lookup };
