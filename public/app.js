'use strict';
/**
 * Noctambouffe — front en JavaScript vanilla.
 * Toutes les données affichées passent par textContent (jamais innerHTML) :
 * rien de ce qui vient de l'utilisateur ou de la base n'est interprété comme du HTML.
 */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  /* ------------------------------------------------------------------ */
  /* Outils                                                              */
  /* ------------------------------------------------------------------ */

  class ApiError extends Error {
    constructor(status, message, payload) {
      super(message);
      this.status = status;
      this.payload = payload || {};
    }
  }

  /** Appel de l'API JSON ; transforme réseau coupé et erreurs HTTP en ApiError. */
  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
    } catch {
      throw new ApiError(0, 'Serveur injoignable. Vérifie que « npm start » tourne toujours, puis réessaie.');
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) throw new ApiError(res.status, (data && data.erreur) || `Erreur inattendue (${res.status}).`, data);
    return data;
  }

  /** Création d'élément DOM : el('div', {class: 'x', text: '...'}, enfants...) */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'class') node.className = val;
      else if (key === 'text') node.textContent = val;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), val);
      else node.setAttribute(key, val === true ? '' : val);
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function toast(message, kind = 'info') {
    const node = el('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
    $('#toasts').append(node);
    setTimeout(() => node.remove(), 4500);
  }

  /* Types de spots (liste fournie par le serveur, source unique de vérité). */
  let typesPromise = null;
  function loadTypes() {
    if (!typesPromise) {
      typesPromise = api('/meta').then((m) => m.types).catch((err) => {
        typesPromise = null; // on réessaiera à la prochaine ouverture d'une vue
        throw err;
      });
    }
    return typesPromise;
  }

  async function fillTypeSelects() {
    const types = await loadTypes();
    const filter = $('#spot-type-filter');
    if (filter.options.length <= 1) types.forEach((t) => filter.append(el('option', { value: t, text: t })));
    const formSelect = $('#f-type');
    if (!formSelect.options.length) {
      formSelect.append(el('option', { value: '', text: 'Choisis un type…' }));
      types.forEach((t) => formSelect.append(el('option', { value: t, text: t })));
    }
  }

  const hoursText = (s) =>
    s.ouverture === s.fermeture ? '24h/24' : `${s.ouverture} → ${s.fermeture}${s.fermeture < s.ouverture ? ' (lendemain)' : ''}`;

  /** Lien vers la carte OpenStreetMap : point GPS si connu, sinon recherche par adresse. */
  const mapUrl = (lat, lon, adresse) =>
    (Number.isFinite(lat) && Number.isFinite(lon)
      ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`
      : `https://www.openstreetmap.org/search?query=${encodeURIComponent(adresse)}`);

  /* ------------------------------------------------------------------ */
  /* Routeur (hash)                                                      */
  /* ------------------------------------------------------------------ */

  const views = {
    chat: $('#view-chat'),
    spots: $('#view-spots'),
    form: $('#view-form'),
    notfound: $('#view-notfound'),
  };
  const titles = {
    chat: 'Le Veilleur de Nuit',
    spots: 'Les spots nocturnes',
    ajouter: 'Ajouter un spot',
    modifier: 'Modifier un spot',
    notfound: 'Page introuvable',
  };

  function show(viewName, routeName) {
    Object.entries(views).forEach(([name, node]) => { node.hidden = name !== viewName; });
    document.querySelectorAll('.main-nav a').forEach((a) => {
      const active = a.dataset.route === (routeName === 'modifier' ? 'spots' : routeName);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = `${titles[routeName]} — Noctambouffe`;
    const heading = $('h1', views[viewName]);
    if (heading) heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function route() {
    const [, name = 'chat', param] = (location.hash || '#/chat').split('/');
    if (name === 'chat') show('chat', 'chat');
    else if (name === 'spots') { show('spots', 'spots'); loadSpots(); }
    else if (name === 'ajouter') { show('form', 'ajouter'); openForm(null); }
    else if (name === 'modifier' && /^\d+$/.test(param || '')) { show('form', 'modifier'); openForm(Number(param)); }
    else show('notfound', 'notfound');
  }

  /* ------------------------------------------------------------------ */
  /* Vue : chat                                                          */
  /* ------------------------------------------------------------------ */

  const chatLog = $('#chat-log');
  const chatEmpty = $('#chat-empty');
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');
  const chatSend = $('#chat-send');
  const chatClear = $('#chat-clear');
  const geoBtn = $('#geo-toggle');
  let position = null; // { lat, lon } si l'utilisateur active « Autour de moi » (jamais stockée)

  function addMessage(role, content, extra) {
    const avatar = role === 'user' ? null : el('div', { class: 'avatar', 'aria-hidden': 'true', text: '🦉' });
    const bubble = el('div', { class: 'bubble' }, typeof content === 'string' ? el('span', { text: content }) : content);
    if (extra) bubble.append(extra);
    const node = el('div', { class: `msg msg-${role}` }, avatar, bubble);
    chatLog.append(node);
    chatLog.scrollTop = chatLog.scrollHeight;
    return node;
  }

  /* ---------- Carte : Leaflet + fonds OpenStreetMap (gratuit, sans clé) ----------
     Si Leaflet n'est pas chargé (fichier manquant), le chat fonctionne normalement, sans carte. */
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
  const hasCoords = (rec) => Number.isFinite(rec.lat) && Number.isFinite(rec.lon);
  const maps = []; // cartes ouvertes dans la conversation, détruites quand on la vide

  /** Épingle numérotée. Le SVG est fixe : seul un chiffre (index + 1) y est inséré, aucune donnée utilisateur. */
  function pinIcon(number, ok) {
    const fill = ok ? '#ffb347' : '#ff6b6b';
    const stroke = ok ? '#ff7a1a' : '#b3261e';
    return L.divIcon({
      className: 'pin',
      html: `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 1C8 1 2 7 2 15c0 10 14 26 14 26s14-16 14-26C30 7 24 1 16 1z" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="16" y="20" text-anchor="middle" font-size="14" font-weight="800" fill="#1a1206">${number}</text></svg>`,
      iconSize: [32, 42],
      iconAnchor: [16, 41],
      popupAnchor: [0, -38],
    });
  }

  /** Contenu de la bulle d'une épingle : éléments DOM et textContent, jamais de HTML construit à la main. */
  function popupContent(rec) {
    return el('div', { class: 'map-popup' },
      el('strong', { text: rec.nom }),
      rec.type ? el('div', { text: rec.type }) : null,
      el('div', { text: `📍 ${rec.adresse}` }),
      el('div', { text: `🕒 ${hoursText(rec)}` }),
      rec.distance_km !== null && rec.distance_km !== undefined ? el('div', { text: `🚶 à ${rec.distance_km} km` }) : null);
  }

  /** Ajoute la carte dans le message et relie chaque bouton « Sur la carte » à son épingle. */
  function mountMap(root, data) {
    const slot = root.querySelector('.map-slot');
    const recs = (data.recommandations || []).map((rec, index) => ({ rec, index })).filter(({ rec }) => hasCoords(rec));
    if (!slot || typeof L === 'undefined' || !recs.length) return;

    const mapEl = el('div', { class: 'map', role: 'region', 'aria-label': 'Carte des adresses proposées' });
    const note = el('p', { class: 'map-note', hidden: true, text: 'Fond de carte indisponible : vérifie ta connexion. Les adresses restent listées ci-dessous.' });
    slot.append(mapEl, note);
    slot.hidden = false;

    const map = L.map(mapEl, { scrollWheelZoom: false }); // la molette fait défiler le chat, pas la carte
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).on('tileerror', () => { note.hidden = false; }).addTo(map);

    const markers = new Map();
    const points = [];
    recs.forEach(({ rec, index }) => {
      const marker = L.marker([rec.lat, rec.lon], { icon: pinIcon(index + 1, rec.statut === 'VALIDÉ'), title: rec.nom })
        .bindPopup(popupContent(rec)).addTo(map);
      markers.set(String(index), marker);
      points.push([rec.lat, rec.lon]);
    });

    // Point de recherche : position GPS de l'utilisateur ou centre de la commune citée.
    const centre = data.contexte && data.contexte.centre;
    if (centre && Number.isFinite(centre.lat) && Number.isFinite(centre.lon)) {
      L.marker([centre.lat, centre.lon], { icon: L.divIcon({ className: 'pin-me', iconSize: [18, 18] }), title: (data.contexte.lieu || 'Ta position'), keyboard: false }).addTo(map);
      points.push([centre.lat, centre.lon]);
    }
    map.fitBounds(points, { padding: [32, 32], maxZoom: 16 });
    maps.push(map);

    root.querySelectorAll('[data-focus]').forEach((btn) => btn.addEventListener('click', () => {
      const marker = markers.get(btn.dataset.focus);
      if (!marker) return;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: false });
      marker.openPopup();
      mapEl.scrollIntoView({ block: 'nearest' });
    }));

    // Une fois la bulle affichée avec sa vraie largeur, on recalcule la taille de la carte.
    requestAnimationFrame(() => {
      map.invalidateSize();
      chatLog.scrollTop = chatLog.scrollHeight;
    });
  }

  function recommendationCard(rec, index) {
    const ok = rec.statut === 'VALIDÉ';
    const hasPlace = rec.ouverture !== undefined; // absent pour « Décret de 23h » et « annuaire vide »
    const canFocus = hasCoords(rec) && typeof L !== 'undefined';
    return el('div', { class: `reco ${ok ? 'ok' : 'ko'}` },
      el('div', { class: 'reco-head' },
        hasPlace ? el('span', { class: 'reco-num', 'aria-hidden': 'true', text: String(index + 1) }) : null,
        el('span', { class: `status ${ok ? 'ok' : 'ko'}`, text: rec.statut })),
      el('h3', { text: rec.nom }),
      rec.type ? el('p', { text: rec.type }) : null,
      el('p', { text: `📍 ${rec.adresse}` }),
      hasPlace ? el('div', { class: 'reco-meta' },
        el('p', { text: `🕒 ${hoursText(rec)}` }),
        rec.distance_km !== null && rec.distance_km !== undefined ? el('p', { text: `🚶 à ${rec.distance_km} km` }) : null) : null,
      hasPlace ? el('div', { class: 'reco-links' },
        canFocus ? el('button', { class: 'btn btn-ghost btn-small', type: 'button', 'data-focus': String(index), text: '📍 Sur la carte' }) : null,
        el('a', { href: mapUrl(rec.lat, rec.lon, rec.adresse), target: '_blank', rel: 'noopener noreferrer', text: 'Ouvrir dans OpenStreetMap ↗' })) : null);
  }

  function recommendationList(data) {
    const recs = data.recommandations || [data.recommandation];
    return el('div', {},
      el('div', { class: 'map-slot', hidden: true }),
      el('div', { class: 'reco-list' }, recs.map(recommendationCard)),
      el('p', { class: 'user-badge', text: `🏅 Badge décerné : ${data.recommandation.badge_attribue}` }));
  }

  async function sendMessage(text) {
    chatEmpty.hidden = true;
    chatClear.hidden = false;
    addMessage('user', text);
    const typing = addMessage('veilleur typing', 'Le Veilleur soupire…');
    chatInput.value = '';
    chatInput.disabled = true;
    chatSend.disabled = true;
    try {
      const data = await api('/chat', { method: 'POST', body: JSON.stringify({ message: text, position }) });
      typing.remove();
      const message = addMessage('veilleur', data.reponse, recommendationList(data));
      mountMap(message, data);
    } catch (err) {
      typing.remove();
      addMessage('veilleur error', err.message);
    } finally {
      chatInput.disabled = false;
      chatSend.disabled = false;
      chatInput.focus();
    }
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) {
      toast('Écris quelque chose. Le silence, ce n\'est pas un menu.', 'error');
      chatInput.focus();
      return;
    }
    sendMessage(text);
  });

  document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => sendMessage(chip.dataset.msg)));

  chatClear.addEventListener('click', () => {
    maps.splice(0).forEach((m) => m.remove());
    chatLog.querySelectorAll('.msg').forEach((m) => m.remove());
    chatEmpty.hidden = false;
    chatClear.hidden = true;
    chatInput.focus();
  });

  function updateGeoButton() {
    geoBtn.setAttribute('aria-pressed', position ? 'true' : 'false');
    geoBtn.textContent = position ? '📍 Autour de moi : activé' : '📍 Autour de moi : désactivé';
  }

  geoBtn.addEventListener('click', () => {
    if (position) {
      position = null;
      updateGeoButton();
      return;
    }
    if (!navigator.geolocation) {
      toast('Ton navigateur ne sait pas te localiser.', 'error');
      return;
    }
    geoBtn.disabled = true;
    geoBtn.textContent = '📍 Localisation…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        geoBtn.disabled = false;
        updateGeoButton();
        toast('Position trouvée : le Veilleur trie par distance.', 'success');
      },
      (err) => {
        geoBtn.disabled = false;
        updateGeoButton();
        toast(err.code === 1 ? 'Localisation refusée : autorise-la dans le navigateur pour trier par distance.' : 'Impossible de te localiser pour l\'instant.', 'error');
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  });

  /* ------------------------------------------------------------------ */
  /* Vue : liste des spots                                               */
  /* ------------------------------------------------------------------ */

  const grid = $('#spots-grid');
  const state = $('#spots-state');
  const count = $('#spots-count');
  const search = $('#spot-search');
  const typeFilter = $('#spot-type-filter');
  const pager = $('#spots-pager');
  let currentPage = 1;
  const moonSvg = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', 'empty-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M40 12a20 20 0 1 0 12 34 17 17 0 0 1-12-34z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  };

  function emptyState(title, text, ...actions) {
    return el('div', { class: 'empty-state' }, moonSvg(), el('h2', { text: title }), el('p', { text }),
      el('div', { class: 'empty-actions' }, ...actions));
  }

  async function loadDemo(button) {
    button.disabled = true;
    try {
      const { ajoutes } = await api('/spots/demo', { method: 'POST' });
      toast(ajoutes ? `${ajoutes} spots de démo chargés.` : 'Les spots de démo sont déjà là.', 'success');
      loadSpots();
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  }

  async function loadSpots() {
    state.replaceChildren();
    pager.hidden = true;
    grid.replaceChildren(el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }));
    count.textContent = '';
    const q = search.value.trim();
    const type = typeFilter.value;
    try {
      await fillTypeSelects();
      const params = new URLSearchParams({ page: currentPage, limit: 24 });
      if (q) params.set('q', q);
      if (type) params.set('type', type);
      const data = await api(`/spots?${params}`);
      currentPage = data.page; // le serveur ramène la page dans les bornes (ex : après une suppression)
      renderSpots(data, Boolean(q || type));
    } catch (err) {
      grid.replaceChildren();
      state.replaceChildren(emptyState('Impossible de charger les spots', err.message,
        el('button', { class: 'btn btn-primary', type: 'button', onclick: loadSpots, text: 'Réessayer' })));
    }
  }

  function renderSpots(data, filtered) {
    const { spots, total, page, pages } = data;
    grid.replaceChildren();
    state.replaceChildren();
    pager.hidden = true;
    count.textContent = `${total.toLocaleString('fr-FR')} spot${total > 1 ? 's' : ''}`;
    if (!total && filtered) {
      state.append(emptyState('Rien ne correspond', 'Même le Veilleur n\'a rien trouvé avec ces critères.',
        el('button', {
          class: 'btn btn-primary', type: 'button', text: 'Réinitialiser les filtres',
          onclick: () => { search.value = ''; typeFilter.value = ''; currentPage = 1; loadSpots(); },
        })));
      return;
    }
    if (!total) {
      count.textContent = '';
      const demoBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Charger des spots de démo' });
      demoBtn.addEventListener('click', () => loadDemo(demoBtn));
      state.append(emptyState('L\'annuaire est vide, comme ton frigo',
        'Aucun spot enregistré. Pour obtenir des centaines de vrais restaurants ouverts la nuit, lance « npm run import » dans le terminal (gratuit, source OpenStreetMap). Sinon, ajoute un spot à la main ou charge quelques spots fictifs.',
        el('a', { class: 'btn btn-primary', href: '#/ajouter', text: 'Ajouter un spot' }), demoBtn));
      return;
    }
    spots.forEach((s) => grid.append(spotCard(s)));
    if (pages > 1) {
      pager.hidden = false;
      $('#pager-info').textContent = `Page ${page} / ${pages}`;
      $('#pager-prev').disabled = page <= 1;
      $('#pager-next').disabled = page >= pages;
    }
  }

  function spotCard(s) {
    return el('article', { class: 'spot-card' },
      el('div', { class: 'spot-top' }, el('h3', { text: s.nom }), el('span', { class: 'pill', text: s.type })),
      el('span', { class: `live ${s.ouvert_maintenant ? 'open' : 'closed'}`, text: s.ouvert_maintenant ? 'Ouvert en ce moment' : 'Fermé en ce moment' }),
      el('p', { class: 'spot-meta', text: `📍 ${s.adresse}` }),
      el('p', { class: 'spot-meta', text: `🕒 ${hoursText(s)}` }),
      el('span', { class: 'badge', text: `🏅 ${s.badge}` }),
      s.source === 'osm' ? el('span', { class: 'src', text: 'Source : OpenStreetMap' }) : null,
      el('a', { class: 'map-link', href: mapUrl(s.lat, s.lon, s.adresse), target: '_blank', rel: 'noopener noreferrer', text: 'Voir sur la carte ↗' }),
      el('p', { class: 'roast', text: s.roast }),
      el('div', { class: 'card-actions' },
        el('a', { class: 'btn btn-ghost btn-small', href: `#/modifier/${s.id}`, 'aria-label': `Modifier ${s.nom}`, text: 'Modifier' }),
        el('button', { class: 'btn btn-danger btn-small', type: 'button', 'aria-label': `Supprimer ${s.nom}`, text: 'Supprimer', onclick: () => deleteSpot(s) })));
  }

  const dialog = $('#confirm-dialog');
  function confirmDelete(spot) {
    return new Promise((resolve) => {
      $('#confirm-name').textContent = spot.nom;
      dialog.returnValue = '';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }

  async function deleteSpot(spot) {
    if (!(await confirmDelete(spot))) return;
    try {
      await api(`/spots/${spot.id}`, { method: 'DELETE' });
      toast(`« ${spot.nom} » a été supprimé.`, 'success');
    } catch (err) {
      toast(err.message, 'error'); // ex : déjà supprimé dans un autre onglet
    }
    loadSpots();
  }

  let searchTimer;
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { currentPage = 1; loadSpots(); }, 250); });
  typeFilter.addEventListener('change', () => { currentPage = 1; loadSpots(); });
  $('#pager-prev').addEventListener('click', () => { currentPage -= 1; loadSpots(); window.scrollTo(0, 0); });
  $('#pager-next').addEventListener('click', () => { currentPage += 1; loadSpots(); window.scrollTo(0, 0); });

  /* ------------------------------------------------------------------ */
  /* Vue : formulaire (ajout / modification)                             */
  /* ------------------------------------------------------------------ */

  const form = $('#spot-form');
  const banner = $('#form-banner');
  const submitBtn = $('#form-submit');
  const FIELDS = ['nom', 'type', 'adresse', 'ouverture', 'fermeture', 'badge', 'roast'];
  let editingId = null;

  function clearErrors() {
    banner.hidden = true;
    banner.replaceChildren();
    FIELDS.forEach((f) => {
      const err = $(`#err-${f}`);
      err.hidden = true;
      err.textContent = '';
      $(`#f-${f}`).removeAttribute('aria-invalid');
    });
  }

  function showErrors(err) {
    const fields = (err.payload && err.payload.champs) || {};
    Object.entries(fields).forEach(([f, msg]) => {
      const node = $(`#err-${f}`);
      if (!node) return;
      node.textContent = msg;
      node.hidden = false;
      $(`#f-${f}`).setAttribute('aria-invalid', 'true');
    });
    banner.replaceChildren();
    if (err.payload && err.payload.veilleur) banner.append(el('span', { class: 'who', text: 'Le Veilleur de Nuit' }));
    banner.append(document.createTextNode(err.message));
    banner.hidden = false;
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    if (firstInvalid) firstInvalid.focus();
  }

  async function openForm(id) {
    editingId = id;
    form.reset();
    clearErrors();
    submitBtn.disabled = false;
    $('#form-title').textContent = id ? 'Modifier un spot' : 'Ajouter un spot';
    submitBtn.textContent = id ? 'Enregistrer les modifications' : 'Enregistrer le spot';
    try {
      await fillTypeSelects();
      if (id) {
        const spot = await api(`/spots/${id}`);
        FIELDS.forEach((f) => { $(`#f-${f}`).value = spot[f]; });
      }
    } catch (err) {
      toast(err.message, 'error');
      if (id && err.status === 404) location.hash = '#/spots';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const body = Object.fromEntries(FIELDS.map((f) => [f, $(`#f-${f}`).value]));
    submitBtn.disabled = true;
    try {
      await api(editingId ? `/spots/${editingId}` : '/spots', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      toast(editingId ? 'Spot modifié.' : 'Spot ajouté. Le Veilleur te juge déjà.', 'success');
      // On repart d'une liste sans filtre : sinon le spot qu'on vient d'enregistrer pourrait être masqué.
      search.value = '';
      typeFilter.value = '';
      currentPage = 1;
      location.hash = '#/spots';
    } catch (err) {
      showErrors(err);
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  window.addEventListener('hashchange', route);
  route();
})();
