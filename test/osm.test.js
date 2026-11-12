'use strict';
// Conversion des données OpenStreetMap : `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const osm = require('../osm');
const v = require('../veilleur');

test('horaires OSM : plages extraites, 24/7 et fermeture après minuit', () => {
  assert.deepEqual(osm.extractRanges('24/7'), [['00:00', '00:00']]);
  assert.deepEqual(osm.extractRanges('Mo-Su 18:00-02:00'), [['18:00', '02:00']]);
  assert.deepEqual(osm.extractRanges('Mo-Su 00:00-24:00'), [['00:00', '00:00']]);
  assert.deepEqual(osm.extractRanges('Mo-Fr 12:00-14:30,19:00-26:00'), [['12:00', '14:30'], ['19:00', '02:00']]);
  assert.deepEqual(osm.extractRanges('sur rendez-vous'), []);
});

test('Décret de 23h appliqué à l\'import : fermé avant 23h = écarté', () => {
  assert.equal(osm.bestNightRange('Mo-Su 11:00-22:30'), null);
  assert.equal(osm.bestNightRange('Mo-Fr 12:00-14:00,19:00-23:00'), null);
  assert.deepEqual(osm.bestNightRange('Mo-Fr 12:00-14:00,19:00-02:00'), { ouverture: '19:00', fermeture: '02:00' });
});

test('type de cuisine : tag OSM, sinon devinette par le nom', () => {
  assert.equal(osm.typeFromTags({ cuisine: 'turkish;kebab', name: 'X' }), 'Kebab');
  assert.equal(osm.typeFromTags({ cuisine: 'japanese', name: 'X' }), 'Asiatique');
  assert.equal(osm.typeFromTags({ name: "O'Tacos Nation" }), 'Tacos');
  assert.equal(osm.typeFromTags({ name: 'Chez Jean' }), 'Autre');
});

test('toSpot : spot valide, adresse, GPS (nœud ou centre de bâtiment), badge et roast présents', () => {
  const node = { type: 'node', id: 42, lat: 48.8566, lon: 2.3522, tags: { name: 'Chez Momo', amenity: 'fast_food', cuisine: 'kebab',
    opening_hours: 'Mo-Su 18:00-03:00', 'addr:housenumber': '12', 'addr:street': 'rue de la Soif', 'addr:postcode': '75011', 'addr:city': 'Paris' } };
  const s = osm.toSpot(node);
  assert.equal(s.adresse, '12 rue de la Soif, 75011 Paris');
  assert.equal(s.osm_id, 'node/42');
  assert.ok(s.badge.length >= 2 && s.badge.length <= 40 && s.roast.length >= 5 && s.roast.length <= 280);
  assert.equal(osm.toSpot(node).badge, s.badge); // stable
  const way = { type: 'way', id: 7, center: { lat: 48.9, lon: 2.4 }, tags: { name: 'Sans adresse', opening_hours: '24/7' } };
  assert.match(osm.toSpot(way).adresse, /^GPS 48\.90000, 2\.40000$/);
});

test('toSpot : écarte sans nom, sans position ou fermé trop tôt', () => {
  const base = { type: 'node', id: 1, lat: 48.8, lon: 2.3, tags: { name: 'OK', opening_hours: '24/7' } };
  assert.ok(osm.toSpot(base));
  assert.equal(osm.toSpot({ ...base, tags: { opening_hours: '24/7' } }), null);
  assert.equal(osm.toSpot({ ...base, lat: undefined }), null);
  assert.equal(osm.toSpot({ ...base, tags: { name: 'Tôt', opening_hours: '08:00-20:00' } }), null);
});

test('les spots importés respectent les mêmes règles que la validation du serveur', () => {
  const { spots } = osm.convert([
    { type: 'node', id: 1, lat: 48.8, lon: 2.3, tags: { name: 'A', opening_hours: '24/7' } },
    { type: 'node', id: 2, lat: 48.8, lon: 2.3, tags: { name: 'Bar', opening_hours: 'Mo-Su 20:00-04:00' } },
  ]);
  assert.equal(spots.length, 1); // « A » : nom d'un seul caractère -> écarté
  assert.equal(v.coversNight(spots[0].ouverture, spots[0].fermeture), true);
  assert.ok(v.TYPES.includes(spots[0].type));
});

test('le Veilleur propose jusqu\'à 3 spots ouverts, dans le bon type en premier', () => {
  const mk = (id, type, o, f, extra = {}) => ({ id, nom: `Spot ${id}`, type, adresse: `${id} rue X, 75011 Paris`, ouverture: o, fermeture: f, roast: `Roast ${id}.`, lat: null, lon: null, ...extra });
  const spots = [mk(1, 'Pizza', '20:00', '04:00'), mk(2, 'Kebab', '18:00', '05:00'), mk(3, 'Kebab', '19:00', '03:00'), mk(4, 'Kebab', '10:00', '22:00'), mk(5, 'Burger', '00:00', '00:00')];
  const r = v.decide('Il est 2h, un kebab', spots, { rng: () => 0 });
  assert.equal(r.recommandations.length, 3);
  assert.deepEqual(r.recommandations.slice(0, 2).map((x) => x.type), ['Kebab', 'Kebab']);
  assert.ok(r.recommandations.every((x) => x.statut === 'VALIDÉ' && x.nom !== 'Spot 4')); // 4 est fermé à 2h
  assert.equal(r.recommandation.nom, r.recommandations[0].nom);
});

test('avec la position GPS, le plus proche passe en premier', () => {
  const mk = (id, lat, lon) => ({ id, nom: `Kebab ${id}`, type: 'Kebab', adresse: `${id} rue X`, ouverture: '18:00', fermeture: '05:00', roast: 'Roast.', lat, lon });
  const spots = [mk(1, 48.90, 2.40), mk(2, 48.8570, 2.3530), mk(3, 48.80, 2.20), mk(4, null, null)];
  const r = v.decide('2h kebab', spots, { rng: () => 0, position: { lat: 48.8566, lon: 2.3522 } });
  assert.equal(r.recommandations[0].nom, 'Kebab 2');
  assert.ok(r.recommandations[0].distance_km < 0.2);
  assert.equal(r.recommandations[2].nom, 'Kebab 3');
  assert.ok(Math.abs(v.distanceKm({ lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 }) - 392) < 5); // Paris-Lyon ≈ 392 km
});

test('performance : 20 000 spots, réponse en moins de 300 ms', () => {
  const spots = Array.from({ length: 20000 }, (_, i) => ({ id: i, nom: `Resto ${i}`, type: ['Kebab', 'Pizza', 'Burger'][i % 3], adresse: `${i} rue du Test, 750${String(i % 20 + 1).padStart(2, '0')} Paris`, ouverture: '18:00', fermeture: '03:00', roast: 'r', lat: 48.85 + (i % 100) / 1000, lon: 2.35 + (i % 70) / 1000 }));
  const t0 = Date.now();
  const r = v.decide('Il est 1h, grosse dalle, un kebab vers le 11e', spots, { position: { lat: 48.86, lon: 2.36 } });
  assert.ok(Date.now() - t0 < 300, `trop lent : ${Date.now() - t0} ms`);
  assert.equal(r.recommandations.length, 3);
});

test('hors Île-de-France : un code postal étranger à la région écarte le spot (rectangle de secours)', () => {
  const base = { type: 'node', id: 1, lat: 48.2, lon: 3.28, tags: { name: 'Kebab', opening_hours: '24/7', 'addr:street': 'rue X', 'addr:postcode': '75001' } };
  assert.ok(osm.toSpot(base));
  for (const cp of ['89100', '60200', '28000', '45300', '10400']) assert.equal(osm.toSpot({ ...base, tags: { ...base.tags, 'addr:postcode': cp } }), null, cp);
  for (const cp of ['77000', '78000', '91000', '92000', '93000', '94000', '95540']) assert.ok(osm.toSpot({ ...base, tags: { ...base.tags, 'addr:postcode': cp } }), cp);
  assert.ok(osm.toSpot({ ...base, tags: { name: 'Sans code', opening_hours: '24/7' } })); // pas de code postal : gardé
});
