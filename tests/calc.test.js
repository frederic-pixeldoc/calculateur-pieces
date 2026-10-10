const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

test('arrondi en centimes : 1,005 € -> 101 c, pas 100', () => {
  assert.equal(C.toCents(1.005), 101);
  assert.equal(C.toCents(0.1 + 0.2), 30);
  assert.equal(C.toCents(-5), 0);
  assert.equal(C.toCents('abc'), 0);
});

test('toNum : virgule décimale, bornes, valeurs invalides', () => {
  assert.equal(C.toNum('12,5'), 12.5);
  assert.equal(C.toNum(-3), 0);
  assert.equal(C.toNum(5000, 0, 999), 999);
  assert.equal(C.toNum(NaN), 0);
  assert.equal(C.toNum(Infinity), 0);
});

test('ligne : exemple de référence (SSD 100 €, port 10 €, octroi 10,5 %, marge 30 %, MO 25 €)', () => {
  // base douane = 110,00 ; octroi = 11,55 ; coût = 121,55 ; revente = 121,55 × 1,30 = 158,015 -> 158,02
  const l = C.calcLine({ pa: 100, port: 10, om: 10.5, marge: 30, mo: 25 });
  assert.equal(l.base, 11000);
  assert.equal(l.om, 1155);
  assert.equal(l.cout, 12155);
  assert.equal(l.revente, 15802);
  assert.equal(l.total, 18302);
  assert.equal(l.margeBrute, 3647);
});

test("l'octroi s'applique sur achat + transport (valeur en douane), pas sur l'achat seul", () => {
  assert.equal(C.calcLine({ pa: 100, port: 20, om: 10 }).om, 1200);
});

test('marge 0 % est respectée (revente = coût réel)', () => {
  const l = C.calcLine({ pa: 50, port: 0, om: 0, marge: 0 });
  assert.equal(l.revente, l.cout);
  assert.equal(l.margeBrute, 0);
});

test('taux de marque = marge brute / prix de vente (30 % de majoration ≈ 23,08 % de marque)', () => {
  const l = C.calcLine({ pa: 100, marge: 30 });
  assert.ok(Math.abs(l.tauxMarque - 23.0769) < 1e-3);
});

test('ligne vide / champs manquants : tout à zéro, pas de NaN', () => {
  const l = C.calcLine({});
  Object.values(l).forEach(v => assert.equal(v, 0));
});

test('entrées négatives ou hors bornes sont ramenées dans les bornes', () => {
  const l = C.calcLine({ pa: -10, om: 500, marge: -5 });
  assert.equal(l.pa, 0);
  assert.equal(l.total, 0);
  assert.equal(C.calcLine({ pa: 100, om: 500 }).om, 10000); // plafonné à 100 %
});

test('totaux sans TVA (franchise en base art. 293 B)', () => {
  const rows = [
    { pa: 100, port: 10, om: 10.5, marge: 30, mo: 25 },
    { pa: 30, port: 0, om: 0, marge: 30, mo: 0 },
  ];
  const t = C.calcTotals(rows, { tva: false });
  assert.equal(t.totalHT, 18302 + 3900);
  assert.equal(t.tva, 0);
  assert.equal(t.ttc, t.totalHT);
});

test('totaux avec TVA 8,5 % : calculée une fois sur le total HT du document', () => {
  const rows = [{ pa: 100, marge: 0 }, { pa: 100, marge: 0 }, { pa: 100, marge: 0 }];
  const t = C.calcTotals(rows, { tva: true });
  assert.equal(t.totalHT, 30000);
  assert.equal(t.tva, 2550);
  assert.equal(t.ttc, 32550);
  // 0,01 € HT -> 0,000850 € de TVA -> 0 c ; 1,00 € HT -> 8,5 c -> 9 c (demi vers le haut)
  assert.equal(C.calcTotals([{ pa: 1 }], { tva: true }).tva, 9);
  assert.equal(C.TVA_RATE, 8.5);
});

test('somme des lignes = totaux (aucune dérive d\'arrondi)', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ pa: 9.99 + i, port: 1.33, om: 7.5, marge: 33, mo: 4.17 }));
  const sum = rows.reduce((s, r) => s + C.calcLine(r).total, 0);
  assert.equal(C.calcTotals(rows).totalHT, sum);
});

test('formatage euros', () => {
  assert.equal(C.fmtEUR(0), '0,00 €');
  assert.equal(C.fmtEUR(5), '0,05 €');
  assert.equal(C.fmtEUR(123456), '1 234,56 €');
  assert.equal(C.fmtEUR(-250), '-2,50 €');
  assert.equal(C.fmtEUR(undefined), '0,00 €');
});

test('migration v1 : les totaux enregistrés ne changent pas', () => {
  const old = [{ id: 'a', composant: 'SSD', pa: 50, port: 7.5, marge: 30, mo: 10, moLib: '', notes: '' }];
  const before = 5750 + Math.round(5750 * 0.3) + 1000; // (50+7,5) × 1,3 + 10 en centimes
  const migrated = C.migrateV1(old);
  assert.equal(migrated[0].om, 0);
  assert.equal(C.calcLine(migrated[0]).total, before);
});

test('normalizeRow nettoie les données corrompues', () => {
  const r = C.normalizeRow({ composant: null, pa: 'x', marge: 99999, notes: 5 }, 'id1');
  assert.equal(r.id, 'id1');
  assert.equal(r.composant, '');
  assert.equal(r.pa, 0);
  assert.equal(r.marge, 999);
  assert.equal(r.notes, '5');
});

test('historique : ajout en tête, doublon ignoré, limite à 10', () => {
  const p = { tva: false };
  const mk = (n, id) => C.makeHistoryEntry([{ pa: n }], p, '2026-01-01T00:00:00Z', id);
  let h = [];
  h = C.addToHistory(h, mk(1, 'a'));
  h = C.addToHistory(h, mk(1, 'b'));
  assert.equal(h.length, 1);
  for (let i = 2; i < 20; i++) h = C.addToHistory(h, mk(i, 'x' + i));
  assert.equal(h.length, C.HISTORY_MAX);
  assert.equal(h[0].id, 'x19');
  assert.equal(h[0].totals.totalHT, C.calcLine({ pa: 19 }).total);
});

test("historique : un tableau vide n'est pas archivé", () => {
  const e = C.makeHistoryEntry([], {}, '2026-01-01T00:00:00Z', 'z');
  assert.deepEqual(C.addToHistory([], e), []);
});

test('historique : lecture tolérante du stockage', () => {
  assert.deepEqual(C.parseHistory('pas du json'), []);
  assert.deepEqual(C.parseHistory('{"a":1}'), []);
  assert.deepEqual(C.parseHistory(null), []);
  const ok = C.makeHistoryEntry([{ pa: 10, marge: 10 }], { tva: true }, '2026-02-02T10:00:00Z', 'k');
  const back = C.parseHistory(JSON.stringify([ok, { bad: true }, null]));
  assert.equal(back.length, 1);
  assert.equal(back[0].totals.ttc, ok.totals.ttc);
});
