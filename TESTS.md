# TESTS.md — dix cas de vérification du cœur fonctionnel

Ces cas ont été rédigés après le code, alors que le cours demande de les écrire avant et de les figer.
Ils servent de cas de vérification du cœur et de base pour les évolutions. Résultats mesurés (tests automatisés npm test et appels réels à l'API).

| # | Cas | Résultat attendu | Résultat | Comment le rejouer |
| --- | --- | --- | --- | --- |
| T1 | Créer un spot valide de 18:00 à 02:00 | 201, spot visible dans la liste | Conforme | POST /api/spots |
| T2 | Créer un spot qui ferme à 22:59 | 422 avec message du Veilleur, rien en base | Conforme | POST /api/spots avec 11:00 et 22:59 |
| T3 | Créer deux fois le même nom et la même adresse, casse différente | 409 | Conforme | POST /api/spots deux fois |
| T4 | Créer un spot avec adresse vide | 422 avec le champ en cause | Conforme | POST /api/spots avec adresse vide |
| T5 | Modifier la fermeture d'un spot, puis modifier un id inexistant | 200 puis 404 | Conforme | PUT /api/spots/1 puis /api/spots/99999 |
| T6 | Supprimer un spot deux fois | 200 puis 404 | Conforme | DELETE /api/spots/1 deux fois |
| T7 | Chat à 3h, demande d'un kebab | VALIDÉ, jusqu'à 3 adresses, type demandé en premier | Conforme | npm test |
| T8 | Chat à 20h | REJETÉ, Décret de 23h | Conforme | npm test |
| T9 | Chat avec une base vide | Réponse soignée, aucune erreur | Conforme | npm test |
| T10 | Spot de 18:00 à 02:00 : ouvert à 1h, fermé à 3h | Vrai puis faux | Conforme | npm test |

## Rejouer un cas d'API (exemple T2)

Serveur lancé avec npm start, dans un autre terminal (adapter le port) :

    curl -s -X POST http://localhost:4567/api/spots -H "Content-Type: application/json" -d '{"nom":"Chez Tôt","type":"Bistrot","adresse":"1 rue du Matin, 75001 Paris","ouverture":"11:00","fermeture":"22:59","badge":"Lève-tôt","roast":"Tu dors, toi."}'

Réponse attendue : un message du Veilleur et le code 422.
