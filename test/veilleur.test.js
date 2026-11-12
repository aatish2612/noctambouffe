'use strict';
// Cas de vérification du Veilleur et des règles horaires : `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../veilleur');

const rng = () => 0; // hasard figé : tests déterministes
const kebab = { id: 1, nom: 'Le Kebab du Dernier Métro', type: 'Kebab', adresse: '11 rue de la Fringale, 75011 Paris', ouverture: '18:00', fermeture: '05:00', badge: 'b', roast: 'Roast kebab.' };
const pizza = { id: 2, nom: 'Pizza Insomnie', type: 'Pizza', adresse: '27 avenue du Crépuscule, 93100 Montreuil', ouverture: '20:00', fermeture: '02:00', badge: 'b', roast: 'Roast pizza.' };
const boulange = { id: 3, nom: 'La Fournée Zéro', type: 'Snack', adresse: '6 rue du Levain, 75012 Paris', ouverture: '02:00', fermeture: '11:00', badge: 'b', roast: 'Roast pain.' };

test('Décret de 23h : un spot fermé avant 23h ne couvre pas la nuit', () => {
  assert.equal(v.coversNight('11:00', '22:00'), false);
  assert.equal(v.coversNight('07:00', '22:59'), false);
});

test('Décret de 23h : passage de minuit et 24h/24 acceptés', () => {
  assert.equal(v.coversNight('18:00', '02:00'), true);
  assert.equal(v.coversNight('17:00', '00:00'), true);
  assert.equal(v.coversNight('00:00', '00:00'), true);
  assert.equal(v.coversNight('02:00', '11:00'), true);
});

test('isOpenAt gère le passage de minuit', () => {
  assert.equal(v.isOpenAt('18:00', '02:00', 60), true); // 1h
  assert.equal(v.isOpenAt('18:00', '02:00', 180), false); // 3h
  assert.equal(v.isOpenAt('18:00', '02:00', 18 * 60), true);
});

test('parseTime comprend les heures en français', () => {
  assert.equal(v.parseTime('il est 2h30'), 150);
  assert.equal(v.parseTime('3h du mat'), 180);
  assert.equal(v.parseTime('23:45 je meurs'), 23 * 60 + 45);
  assert.equal(v.parseTime('minuit pile'), 0);
  assert.equal(v.parseTime('11h du soir'), 23 * 60);
  assert.equal(v.parseTime('juste un kebab'), null);
});

test('détection de la faim', () => {
  assert.equal(v.detectHunger(v.normalize('Grosse dalle !')), 'grosse');
  assert.equal(v.detectHunger(v.normalize('juste une petite faim')), 'petite');
  assert.equal(v.detectHunger(v.normalize('je veux manger')), 'normale');
});

test('avant 23h : REJETÉ par le Décret, sans adresse de resto', () => {
  const r = v.decide('Il est 20h, une pizza', [pizza], { rng });
  assert.equal(r.recommandation.statut, 'REJETÉ');
  assert.match(r.recommandation.nom, /Décret de 23h/);
});

test('la nuit : VALIDÉ avec le bon type de cuisine, au format imposé', () => {
  const r = v.decide('Il est 1h, grosse dalle, un kebab', [pizza, kebab], { rng });
  assert.equal(r.recommandation.statut, 'VALIDÉ');
  assert.equal(r.recommandation.nom, kebab.nom);
  assert.deepEqual(Object.keys(r.recommandation).sort(), ['adresse', 'badge_attribue', 'nom', 'punchline_roast', 'statut']);
  assert.ok(r.recommandation.punchline_roast.length > 20);
});

test('spot fermé à l\'heure demandée : REJETÉ mais adresse donnée', () => {
  const r = v.decide('3h du mat, une pizza', [pizza], { rng });
  assert.equal(r.recommandation.statut, 'REJETÉ');
  assert.equal(r.recommandation.adresse, pizza.adresse);
});

test('spot ouvert tôt le matin : seul candidat à 3h', () => {
  const r = v.decide('3h, un truc', [pizza, boulange], { rng });
  assert.equal(r.recommandation.nom, boulange.nom);
  assert.equal(r.recommandation.statut, 'VALIDÉ');
});

test('base vide : réponse soignée, pas de plantage', () => {
  const r = v.decide('2h, kebab', [], { rng });
  assert.equal(r.recommandation.statut, 'REJETÉ');
  assert.match(r.recommandation.nom, /Aucun spot/);
});

test('extractPlace : trouve la commune citée, ignore le reste', () => {
  assert.equal(v.extractPlace('un kebab à Sevran'), 'Sevran');
  assert.equal(v.extractPlace('je veux manger vers Méry sur Oise, grosse dalle'), 'Méry sur Oise');
  assert.equal(v.extractPlace('dans le Raincy'), 'le Raincy');
  assert.equal(v.extractPlace('Il est 2h à Aulnay sous Bois'), 'Aulnay sous Bois');
  assert.equal(v.extractPlace('à 3h du mat, petite faim'), null);
  assert.equal(v.extractPlace('vers le 11e'), null);
  assert.equal(v.extractPlace('à la maison j\'ai la dalle'), null);
  assert.equal(v.extractPlace('il a faim'), null);
});

test('lieu cité : le Veilleur le commente, trouvé ou non, et la réponse reste valide', () => {
  const spots = [{ id: 1, nom: 'K1', type: 'Kebab', adresse: '1 rue X', ouverture: '18:00', fermeture: '05:00', roast: 'r', lat: 48.94, lon: 2.53 }];
  const ok = v.decide('2h kebab à Sevran', spots, { rng, position: { lat: 48.9385, lon: 2.5276 }, lieu: { nom: 'Sevran', trouve: true } });
  assert.match(ok.reponse, /Sevran/);
  assert.equal(ok.contexte.lieu, 'Sevran');
  assert.ok(ok.recommandations[0].distance_km < 1);
  const ko = v.decide('2h kebab à Zzzzville', spots, { rng, lieu: { nom: 'Zzzzville', trouve: false } });
  assert.match(ko.reponse, /Zzzzville/);
  assert.equal(ko.recommandations[0].statut, 'VALIDÉ'); // on propose quand même, sur toute l'Île-de-France
});

test('le centre de la recherche (GPS ou commune) est renvoyé pour placer le point sur la carte', () => {
  const spots = [{ id: 1, nom: 'K1', type: 'Kebab', adresse: '1 rue X', ouverture: '18:00', fermeture: '05:00', roast: 'r', lat: 48.94, lon: 2.53 }];
  const avec = v.decide('2h kebab', spots, { rng, position: { lat: 48.9385, lon: 2.5276 } });
  assert.deepEqual(avec.contexte.centre, { lat: 48.9385, lon: 2.5276 });
  assert.equal(avec.recommandations[0].lat, 48.94); // coordonnées nécessaires aux épingles
  assert.equal(v.decide('2h kebab', spots, { rng }).contexte.centre, null);
});

test('extractPlaceLoose : lieu écrit sans préposition (« Châtelet », « kebab châtelet »)', () => {
  assert.equal(v.extractPlaceLoose('Châtelet'), 'Châtelet');
  assert.equal(v.extractPlaceLoose('un kebab châtelet grosse dalle'), 'châtelet');
  assert.equal(v.extractPlaceLoose('2h pizza chatelet les halles'), 'chatelet halles');
  assert.equal(v.extractPlaceLoose('Il est 2h, grosse dalle, un kebab'), null);
  assert.equal(v.extractPlaceLoose('salut je veux manger'), null);
});

test('proximité avant cuisine : un kebab à 100 km ne passe jamais devant des spots à côté', () => {
  const mk = (id, nom, type, adresse, lat, lon) => ({ id, nom, type, adresse, ouverture: '18:00', fermeture: '05:00', roast: 'r', lat, lon });
  const spots = [
    mk(1, 'Kebab de Sens', 'Kebab', '4 rue du Châtelet, 89100 Sens', 48.1975, 3.2835),
    mk(2, 'Kebab Rivoli', 'Kebab', '12 rue de Rivoli, 75001 Paris', 48.8596, 2.3470),
    mk(3, 'Pizza Halles', 'Pizza', '3 rue Saint-Denis, 75001 Paris', 48.8610, 2.3478),
    mk(4, 'Burger Halles', 'Burger', '8 rue Berger, 75001 Paris', 48.8620, 2.3460),
  ];
  const r = v.decide('2h kebab Châtelet', spots, { rng, position: { lat: 48.8584, lon: 2.3470 }, lieu: { nom: 'Châtelet, Paris', trouve: true } });
  const noms = r.recommandations.map((x) => x.nom);
  assert.deepEqual(noms, ['Kebab Rivoli', 'Pizza Halles', 'Burger Halles']); // le kebab de Sens (100 km) est écarté
  assert.ok(r.recommandations.every((x) => x.distance_km < 2));
});

test('cuisine rare un peu plus loin : on l\'inclut tant qu\'elle reste dans un rayon raisonnable', () => {
  const mk = (id, nom, type, lat, lon) => ({ id, nom, type, adresse: `${id} rue X`, ouverture: '18:00', fermeture: '05:00', roast: 'r', lat, lon });
  const spots = [
    mk(1, 'Kebab 1', 'Kebab', 48.8590, 2.3470), mk(2, 'Kebab 2', 'Kebab', 48.8600, 2.3470), mk(3, 'Kebab 3', 'Kebab', 48.8610, 2.3470),
    mk(4, 'Sushi Bastille', 'Asiatique', 48.8530, 2.3690), // ~1,9 km
  ];
  const r = v.decide('2h sushi Châtelet', spots, { rng, position: { lat: 48.8584, lon: 2.3470 } });
  assert.equal(r.recommandations[0].nom, 'Sushi Bastille'); // bonne cuisine d'abord, même un peu plus loin
});

test('cuisine absente dans le rayon : le Veilleur le dit et propose ce qui est à côté', () => {
  const mk = (id, nom, type, lat, lon) => ({ id, nom, type, adresse: `${id} rue X`, ouverture: '18:00', fermeture: '05:00', roast: 'r', lat, lon });
  const spots = [mk(1, 'Pizza A', 'Pizza', 48.8590, 2.3470), mk(2, 'Pizza B', 'Pizza', 48.8600, 2.3470), mk(3, 'Burger C', 'Burger', 48.8610, 2.3470),
    mk(4, 'Sushi lointain', 'Asiatique', 48.40, 2.90)];
  const r = v.decide('2h sushi', spots, { rng, position: { lat: 48.8584, lon: 2.3470 } });
  assert.ok(r.recommandations.every((x) => x.distance_km < 3));
  assert.match(r.reponse, /sushi|asiatique/i);
});
