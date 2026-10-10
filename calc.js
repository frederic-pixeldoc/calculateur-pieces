/* PixelDoc — Calculateur de pièces : logique de calcul pure (sans DOM).
   Chargé par index.html (global PDCalc) et testé sous Node (voir tests/).
   Tous les montants sont manipulés en CENTIMES (entiers) pour éviter les
   erreurs d'arrondi des flottants ; l'arrondi se fait à la ligne, au centime
   (demi vers le haut), de sorte que l'écran, les totaux et le PDF concordent.
   Formules et sources : voir README.md et la section « Formules & sources ». */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PDCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /* TVA normale applicable à La Réunion : 8,5 % (art. 296 CGI, 1° a et b) */
  const TVA_RATE = 8.5;
  const HISTORY_MAX = 10;

  /* Nombre fini borné ; toute valeur invalide / négative devient min (0). */
  function toNum(v, min, max) {
    min = min == null ? 0 : min;
    max = max == null ? Infinity : max;
    const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /* euros -> centimes entiers (toPrecision neutralise 1.005*100 = 100.49999…) */
  function toCents(eur) { return Math.round(+(toNum(eur) * 100).toPrecision(12)); }

  /* applique un pourcentage à un montant en centimes, arrondi au centime */
  function pct(cents, rate) { return Math.round(+(cents * rate / 100).toPrecision(12)); }

  /* Ligne : tous les montants en centimes.
     base d'octroi = prix d'achat + transport/frais   (≈ valeur en douane)
     octroi        = base × taux d'octroi (OM + OMR)
     coût réel     = achat + transport + octroi
     revente HT    = coût réel × (1 + marge/100)       (marge = taux de majoration sur le coût)
     total HT      = revente HT + main d'œuvre HT */
  function calcLine(r) {
    const pa    = toCents(r.pa);
    const port  = toCents(r.port);
    const base  = pa + port;
    const om    = pct(base, toNum(r.om, 0, 100));
    const cout  = base + om;
    const revente = cout + pct(cout, toNum(r.marge, 0, 999));
    const mo    = toCents(r.mo);
    const total = revente + mo;
    return {
      pa, port, base, om, cout, revente, mo, total,
      margeBrute: revente - cout,
      /* taux de marque = marge brute / prix de vente (≠ taux de majoration) */
      tauxMarque: revente ? (revente - cout) / revente * 100 : 0,
    };
  }

  /* Totaux du document. La TVA est calculée sur le total HT du document
     (un seul arrondi), et seulement si le vendeur est assujetti. */
  function calcTotals(rows, opts) {
    const t = { pa: 0, port: 0, om: 0, cout: 0, revente: 0, mo: 0, totalHT: 0, tva: 0, ttc: 0, margeBrute: 0 };
    rows.forEach(r => {
      const l = calcLine(r);
      t.pa += l.pa; t.port += l.port; t.om += l.om; t.cout += l.cout;
      t.revente += l.revente; t.mo += l.mo; t.totalHT += l.total; t.margeBrute += l.margeBrute;
    });
    t.tva = opts && opts.tva ? pct(t.totalHT, TVA_RATE) : 0;
    t.ttc = t.totalHT + t.tva;
    return t;
  }

  /* centimes -> « 1 234,56 € » (format fr, espace normale pour le PDF) */
  function fmtEUR(cents) {
    const n = Math.round(+cents || 0);
    const neg = n < 0 ? '-' : '';
    const a = Math.abs(n);
    const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return neg + ent + ',' + String(a % 100).padStart(2, '0') + ' €';
  }

  /* Ligne propre à partir de données quelconques (localStorage, historique). */
  function normalizeRow(r, id) {
    r = r || {};
    return {
      id: String(r.id || id || ''),
      composant: String(r.composant || ''),
      pa: toNum(r.pa), port: toNum(r.port), om: toNum(r.om, 0, 100),
      marge: toNum(r.marge, 0, 999),
      moLib: String(r.moLib || ''), notes: String(r.notes || ''),
      mo: toNum(r.mo),
    };
  }

  /* Anciennes données (v1) : « port » contenait port ET/OU octroi saisi à la main.
     On le conserve tel quel comme frais, avec octroi 0 %, pour que les totaux
     d'un calcul déjà enregistré ne changent pas. */
  function migrateV1(rows) {
    return rows.map((r, i) => normalizeRow(Object.assign({}, r, { om: 0 }), 'v1-' + i));
  }

  /* ---- Historique local des derniers calculs ---- */
  function sameContent(a, b) {
    return JSON.stringify([a.rows, a.params]) === JSON.stringify([b.rows, b.params]);
  }

  function makeHistoryEntry(rows, params, nowISO, id) {
    const clean = rows.map(r => normalizeRow(r, r.id));
    const totals = calcTotals(clean, params);
    return {
      id, date: nowISO,
      params: { tva: !!(params && params.tva) },
      rows: clean,
      totals: { nb: clean.length, totalHT: totals.totalHT, tva: totals.tva, ttc: totals.ttc },
    };
  }

  /* Ajoute en tête, ignore un doublon exact du plus récent, garde `max` entrées. */
  function addToHistory(list, entry, max) {
    list = Array.isArray(list) ? list : [];
    if (!entry.rows.length) return list;
    if (list[0] && sameContent(list[0], entry)) return list;
    return [entry].concat(list).slice(0, max || HISTORY_MAX);
  }

  /* Relit un historique stocké en ignorant tout ce qui est malformé. */
  function parseHistory(raw) {
    let d;
    try { d = JSON.parse(raw || '[]'); } catch (e) { return []; }
    if (!Array.isArray(d)) return [];
    return d.filter(e => e && Array.isArray(e.rows) && e.date && e.id).map(e => {
      const rows = e.rows.map(r => normalizeRow(r, r && r.id));
      const params = { tva: !!(e.params && e.params.tva) };
      const t = calcTotals(rows, params);
      return { id: String(e.id), date: String(e.date), params, rows,
               totals: { nb: rows.length, totalHT: t.totalHT, tva: t.tva, ttc: t.ttc } };
    }).slice(0, HISTORY_MAX);
  }

  return { TVA_RATE, HISTORY_MAX, toNum, toCents, pct, calcLine, calcTotals, fmtEUR,
           normalizeRow, migrateV1, makeHistoryEntry, addToHistory, parseHistory };
});
