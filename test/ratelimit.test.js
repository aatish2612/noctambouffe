'use strict';
// Issue 5 : limitation de débit de l'API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('../ratelimit');

// Faux objets Express, juste ce qu'il faut pour le limiteur.
function call(limiter, ip) {
  const res = { headers: {}, statusCode: 200, body: null,
    set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  limiter({ ip }, res, () => { passed = true; });
  return { passed, res };
}

test('les requêtes sous la limite passent, l\'excès reçoit 429 avec Retry-After', () => {
  let t = 0;
  const limiter = createLimiter({ windowMs: 60000, max: 3, now: () => t });
  for (let i = 0; i < 3; i += 1) assert.equal(call(limiter, '1.1.1.1').passed, true);
  t = 10000;
  const { passed, res } = call(limiter, '1.1.1.1');
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '50'); // 60 s de fenêtre - 10 s écoulées
  assert.match(res.body.erreur, /Trop de requêtes/);
});

test('chaque adresse IP a son propre compteur', () => {
  const limiter = createLimiter({ windowMs: 60000, max: 1, now: () => 0 });
  assert.equal(call(limiter, '1.1.1.1').passed, true);
  assert.equal(call(limiter, '1.1.1.1').passed, false);
  assert.equal(call(limiter, '2.2.2.2').passed, true);
});

test('la fenêtre se réinitialise une fois écoulée', () => {
  let t = 0;
  const limiter = createLimiter({ windowMs: 1000, max: 1, now: () => t });
  assert.equal(call(limiter, '1.1.1.1').passed, true);
  assert.equal(call(limiter, '1.1.1.1').passed, false);
  t = 1000;
  assert.equal(call(limiter, '1.1.1.1').passed, true);
});

test('les en-têtes RateLimit indiquent la limite et le reste', () => {
  const limiter = createLimiter({ windowMs: 60000, max: 5, now: () => 0 });
  const { res } = call(limiter, '1.1.1.1');
  assert.equal(res.headers['RateLimit-Limit'], '5');
  assert.equal(res.headers['RateLimit-Remaining'], '4');
});
