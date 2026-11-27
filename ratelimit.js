'use strict';
/**
 * Limiteur de débit en mémoire (fenêtre fixe), sans dépendance.
 * Chaque adresse IP a droit à `max` requêtes par fenêtre de `windowMs` millisecondes ;
 * au-delà, l'API répond 429 avec l'en-tête Retry-After. Les compteurs sont perdus au redémarrage.
 */
function createLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map(); // ip -> { count, reset }

  return function limiter(req, res, next) {
    const t = now();
    // Ménage : on oublie les fenêtres terminées pour ne pas laisser grossir la mémoire.
    if (hits.size > 5000) {
      for (const [ip, entry] of hits) if (t >= entry.reset) hits.delete(ip);
    }

    let entry = hits.get(req.ip);
    if (!entry || t >= entry.reset) {
      entry = { count: 0, reset: t + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;

    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retry = Math.ceil((entry.reset - t) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ erreur: `Trop de requêtes. Le Veilleur n'est pas ton esclave : réessaie dans ${retry} s.` });
    }
    return next();
  };
}

module.exports = { createLimiter };
