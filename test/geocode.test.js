'use strict';
// Géocodage de lieux (faux serveur Nominatim local, aucun accès à Internet) : `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let hits = [];
let mode = 'ok';
const inBox = (viewbox, lon, lat) => {
  const [west, north, east, south] = viewbox.split(',').map(Number);
  return lon >= west && lon <= east && lat >= south && lat <= north;
};
// Base de lieux fictifs. « Châtelet » existe à Paris ET à 50 km (Le Châtelet-en-Brie) : Paris doit gagner.
const PLACES = {
  Châtelet: [
    { lat: '48.8584', lon: '2.3470', name: 'Châtelet', category: 'railway', type: 'station', address: { city: 'Paris' } },
    { lat: '48.5210', lon: '2.8000', name: 'Le Châtelet-en-Brie', category: 'boundary', type: 'administrative', address: { village: 'Le Châtelet-en-Brie' } },
  ],
  Sevran: [{ lat: '48.9385', lon: '2.5276', name: 'Sevran', category: 'boundary', type: 'administrative', address: { city: 'Sevran' } }],
  'Méry-sur-Oise': [{ lat: '49.0590', lon: '2.1860', name: 'Méry-sur-Oise', category: 'boundary', type: 'administrative', address: { town: 'Méry-sur-Oise' } }],
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  hits.push({ url, ua: req.headers['user-agent'] });
  if (mode === 'down') { res.statusCode = 503; return res.end('indisponible'); }
  res.setHeader('Content-Type', 'application/json');
  const candidates = PLACES[url.searchParams.get('q')] || [];
  const inside = candidates.filter((p) => inBox(url.searchParams.get('viewbox'), Number(p.lon), Number(p.lat)));
  return res.end(JSON.stringify(inside.slice(0, 1)));
});

let geocode;
test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  process.env.NOMINATIM_URL = `http://127.0.0.1:${server.address().port}/search`;
  process.env.NOMINATIM_DELAY_MS = '0';
  geocode = require('../geocode'); // chargé après les variables d'environnement
});
test.after(() => { server.close(); });

test('lieu connu : coordonnées, libellé avec la ville, requête conforme', async () => {
  const r = await geocode.lookup('Sevran');
  assert.equal(r.lat, 48.9385);
  assert.equal(r.libelle, 'Sevran'); // nom identique à la ville : pas de répétition
  assert.match(hits[0].ua, /Noctambouffe/);
  assert.equal(hits[0].url.searchParams.get('bounded'), '1');
  assert.equal(hits[0].url.searchParams.get('limit'), '1');
  assert.equal(hits[0].url.searchParams.get('q'), 'Sevran'); // seul le nom du lieu est envoyé
});

test('ambiguïté : « Châtelet » désigne le quartier de Paris, pas la commune à 50 km', async () => {
  const r = await geocode.lookup('Châtelet');
  assert.equal(r.libelle, 'Châtelet, Paris');
  assert.equal(r.categorie, 'railway');
  assert.ok(Math.abs(r.lat - 48.8584) < 0.001);
  assert.equal(r.zone, 'Paris et petite couronne');
});

test('hors petite couronne : on élargit à toute l\'Île-de-France (deuxième requête)', async () => {
  const before = hits.length;
  const r = await geocode.lookup('Méry-sur-Oise');
  assert.equal(r.zone, 'Île-de-France');
  assert.equal(hits.length - before, 2); // Paris d'abord, puis la région
  assert.ok(r.lat > 49);
});

test('cache : la même recherche ne refait pas d\'appel réseau', async () => {
  const before = hits.length;
  await geocode.lookup('sevran');
  assert.equal(hits.length, before);
});

test('lieu inconnu : null après les deux zones, et mis en cache', async () => {
  const before = hits.length;
  assert.equal(await geocode.lookup('Zzzzville'), null);
  assert.equal(hits.length - before, 2);
  assert.equal(await geocode.lookup('Zzzzville'), null);
  assert.equal(hits.length - before, 2);
});

test('service en panne : undefined, sans exception, et pas de mise en cache', async () => {
  mode = 'down';
  assert.equal(await geocode.lookup('Pantin'), undefined);
  mode = 'ok';
  const before = hits.length;
  await geocode.lookup('Pantin'); // réessaie vraiment (la panne n'a pas été mémorisée)
  assert.ok(hits.length > before);
});
