export const AISLES = [
    { key: 'fruits', label: 'Fruits & légumes', emoji: '🥕' },
    { key: 'boulangerie', label: 'Boulangerie', emoji: '🥖' },
    { key: 'frais', label: 'Frais', emoji: '🧀' },
    { key: 'viande', label: 'Viande & poisson', emoji: '🍗' },
    { key: 'epicerie', label: 'Épicerie', emoji: '🥫' },
    { key: 'boissons', label: 'Boissons', emoji: '🧃' },
    { key: 'surgeles', label: 'Surgelés', emoji: '🧊' },
    { key: 'hygiene', label: 'Hygiène & beauté', emoji: '🧴' },
    { key: 'maison', label: 'Maison', emoji: '🧽' },
    { key: 'autre', label: 'Autre', emoji: '🛒' },
];

const KEYWORDS = {
    fruits: 'pomme, pommes, poire, poires, banane, bananes, orange, oranges, clementine, clementines, mandarine, citron, citrons, fraise, fraises, framboise, framboises, myrtille, myrtilles, raisin, kiwi, kiwis, ananas, mangue, melon, pasteque, abricot, abricots, peche, peches, prune, cerise, cerises, tomate, tomates, salade, laitue, roquette, mache, carotte, carottes, courgette, courgettes, aubergine, poivron, poivrons, oignon, oignons, ail, echalote, pomme de terre, pommes de terre, patate, patates, brocoli, chou, chou-fleur, epinard, epinards, haricot, haricots, champignon, champignons, concombre, radis, poireau, poireaux, avocat, avocats, persil, basilic, menthe, coriandre, ciboulette, gingembre, legume, legumes, fruit, fruits, betterave, navet, celeri, fenouil, potiron, courge, butternut',
    boulangerie: 'pain, baguette, baguettes, brioche, croissant, croissants, pain de mie, viennoiserie, viennoiseries, biscotte, biscottes',
    frais: 'lait, beurre, creme, creme fraiche, yaourt, yaourts, fromage, fromages, emmental, comte, gruyere, mozzarella, feta, chevre, camembert, raclette, oeuf, oeufs, skyr, fromage blanc, jambon, lardons, compote, compotes, margarine, ricotta, mascarpone, pate feuilletee, pate brisee, houmous, tofu',
    viande: 'poulet, boeuf, porc, veau, dinde, steak, steaks, steak hache, steaks haches, saucisse, saucisses, merguez, viande, poisson, saumon, cabillaud, thon, crevette, crevettes, escalope, escalopes, roti',
    epicerie: 'pates, riz, farine, sucre, sel, poivre, huile, vinaigre, moutarde, ketchup, mayonnaise, sauce, sauce tomate, conserve, conserves, cereales, chocolat, cafe, the, miel, confiture, biscuits, gateau, gateaux, chips, lentilles, pois chiches, semoule, quinoa, epices, levure, cacao, bonbons, soupe, bouillon, olives, noix, amandes, noisettes, puree, tisane, pate a tartiner',
    boissons: 'eau, eau gazeuse, jus, jus d orange, jus de pomme, soda, coca, biere, bieres, vin, limonade, sirop',
    surgeles: 'surgele, surgeles, glace, glaces, pizza, pizzas, frites, poelee',
    hygiene: 'dentifrice, shampoing, shampooing, apres-shampoing, savon, gel douche, deodorant, coton, cotons, papier toilette, mouchoirs, rasoir, rasoirs, creme solaire, protections, serviettes hygieniques, tampons, brosse a dents, maquillage, demaquillant',
    maison: 'lessive, adoucissant, liquide vaisselle, tablettes lave-vaisselle, eponge, eponges, sac poubelle, sacs poubelle, essuie-tout, javel, nettoyant, ampoule, ampoules, piles, papier aluminium, film alimentaire',
};

export const normalize = s => s.toLowerCase().replace(/œ/g, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').trim();

const PHRASES = Object.entries(KEYWORDS).flatMap(([aisle, list]) => list.split(',').map(p => ({ aisle, phrase: p.trim() })));

export function guessAisle(text) {
    const words = ` ${normalize(text).replace(/[^a-z0-9-]+/g, ' ')} `;
    let best = null;
    for (const { aisle, phrase } of PHRASES) {
        if (words.includes(` ${phrase} `) && (!best || phrase.length > best.phrase.length)) {
            best = { aisle, phrase };
        }
    }
    return best ? best.aisle : 'autre';
}
