'use strict';
// Issue 3 : une heure impossible dans le chat ne doit plus être ignorée en silence.
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../veilleur');

const rng = () => 0;
const spots = [{ id: 1, nom: 'Kebab', type: 'Kebab', adresse: '1 rue X', ouverture: '18:00', fermeture: '05:00', roast: 'r', lat: null, lon: null }];

test('invalidTimeMention repère les heures impossibles', () => {
  assert.equal(v.invalidTimeMention('Il est 26h12, un kebab'), '26h12');
  assert.equal(v.invalidTimeMention('rendez-vous à 3h70'), '3h70');
  assert.equal(v.invalidTimeMention('on se voit à 25:00'), '25:00');
});

test('invalidTimeMention laisse passer les heures valides et les messages sans heure', () => {
  for (const msg of ['Il est 2h30', '23h59', '24h', 'minuit pile', 'un kebab', 'au 12 rue de Rivoli']) {
    assert.equal(v.invalidTimeMention(msg), null, msg);
  }
});

test('le Veilleur dit que l\'heure n\'existe pas et utilise l\'horloge', () => {
  const r = v.decide('Il est 26h12, un kebab', spots, { rng, now: new Date('2026-11-13T00:30:00Z') }); // 1h30 à Paris
  assert.match(r.reponse, /26h12/);
  assert.equal(r.contexte.heure_invalide, '26h12');
  assert.equal(r.contexte.source, 'horloge');
  assert.equal(r.contexte.heure, '1h30');
});

test('une heure valide ne déclenche aucun avertissement', () => {
  const r = v.decide('Il est 2h30, un kebab', spots, { rng });
  assert.equal(r.contexte.heure_invalide, null);
  assert.equal(r.contexte.source, 'message');
});
