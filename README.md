# Notes & Tâches

App perso (PWA) : planning avec rappels, listes de courses, coffre chiffré par code PIN.
Aucun serveur : toutes les données restent dans le navigateur du téléphone.

## Tester sur le PC

```bash
cd ~/notes-app
python3 -m http.server 8000
```

Puis ouvrir http://localhost:8000 (mode mobile des DevTools : Ctrl+Maj+M).

## Mettre sur le téléphone (GitHub Pages, gratuit)

1. Créer un dépôt GitHub (par exemple `notes-taches`) et y pousser le contenu de ce dossier.
2. Sur GitHub : *Settings → Pages → Source : Deploy from a branch → main / (root)*.
3. Sur le téléphone, ouvrir `https://<ton-compte>.github.io/notes-taches/` dans **Chrome**.
4. Menu ⋮ → **Ajouter à l'écran d'accueil** → **Installer**.

L'app fonctionne ensuite hors ligne. Le dépôt ne contient que le code, jamais tes données.

## Mettre à jour l'app

Modifier les fichiers, puis incrémenter `CACHE` dans `sw.js` (`notes-taches-v4`, …) et `APP_VERSION` dans `js/app.js` avant de pousser.
Le téléphone récupère la nouvelle version à l'ouverture suivante.

## Sauvegarde

Paramètres (⚙) → **Exporter** : télécharge un fichier JSON. Le coffre y reste chiffré, mais les rappels et
les courses sont en clair. Pour restaurer : **Importer** sur le nouveau téléphone, puis entrer le même code.
Sans le code, le coffre est irrécupérable.

## Importer un agenda

Paramètres (⚙) → **Importer un agenda (.ics)**. Google Agenda : sur ordinateur, *Paramètres → Importer et
exporter → Exporter* donne un zip contenant un `.ics` par agenda. Les événements passés sont ignorés ; ré-importer
le même fichier met à jour les événements déjà importés sans les dupliquer.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Squelette des 3 écrans + icônes SVG |
| `css/app.css` | Styles, animations, 3 thèmes |
| `js/app.js` | Interface et interactions |
| `js/store.js` | Lecture / écriture `localStorage` |
| `js/vault.js` | Chiffrement AES-GCM, clé dérivée du PIN (PBKDF2) |
| `js/dates.js` | Calculs de dates et répétitions |
| `sw.js` | Cache hors ligne |
