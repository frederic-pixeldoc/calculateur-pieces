# Calculateur de pièces — PixelDoc

Outil interne : prix de revente de pièces détachées avec marge, octroi de mer et main d'œuvre (La Réunion). Application statique (HTML + JS, PWA), données conservées dans le navigateur uniquement.

## Formules

Les calculs sont dans [`calc.js`](calc.js) (fonctions pures, sans DOM), testés par `npm test` (Node ≥ 18, aucune dépendance). Montants en centimes entiers, arrondi au centime (demi vers le haut) **ligne par ligne**, pour que l'écran, les totaux et le PDF concordent.

| Grandeur | Formule |
|---|---|
| Base d'octroi | achat + transport/frais (approximation de la valeur en douane) |
| Octroi | base × (taux OM + taux OMR) ÷ 100 |
| Coût réel | achat + transport + octroi |
| Revente HT | coût réel × (1 + marge ÷ 100) |
| Total HT | revente HT + main d'œuvre |
| TVA | total HT du document × 8,5 % (un seul arrondi) — seulement si « Assujetti » |

- La **marge est un taux de majoration sur le coût**. Le taux de marque (marge ÷ prix de vente) est plus faible : 30 % de majoration ≈ 23,1 %.
- Sans TVA (franchise en base, art. 293 B du CGI), le PDF porte la mention « TVA non applicable ».

## Sources

- Octroi de mer — assiette à l'importation : valeur en douane ; l'octroi de mer régional a la même assiette ; taux fixés par délibération du conseil régional : [Douane, fiscalité douanière dans les DOM](https://www.douane.gouv.fr/fiche/fiscalite-douaniere-dans-les-departements-doutre-mer) ; loi n° 2004-639 du 2 juillet 2004.
- TVA 8,5 % (taux normal) et 2,1 % (réduit) à La Réunion : art. 296 CGI, [BOI-TVA-GEO-20-10](https://bofip.impots.gouv.fr/bofip/343-PGP.html/identifiant=BOI-TVA-GEO-20-10-20190605).
- Franchise en base : art. 293 B CGI.

## Limites connues

- Le taux d'octroi dépend de la nomenclature douanière du produit et des délibérations régionales en vigueur : il est saisi par l'utilisateur (global, modifiable par ligne), jamais deviné.
- Le transport pris dans la base est une approximation : la valeur en douane retient le fret/assurance jusqu'à l'entrée sur le territoire douanier.
- Pas de calcul de la TVA à l'importation payée en amont ; ce n'est pas un avis fiscal.

## Historique

Les 10 derniers calculs sont gardés localement (`localStorage`), archivés à l'export PDF, avant « Vider » / restauration, ou via « Enregistrer ce calcul ».

## Données existantes

Les lignes enregistrées avant cette version (clé `pixeldoc_calc_pieces_v1`, colonne « Port / Octroi ») sont migrées vers « Transport / frais » avec un octroi à 0 %, de sorte que leurs totaux ne changent pas.
