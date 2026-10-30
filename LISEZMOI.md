# Flâneur — ta carte de voyage à toi

Une appli web qui s'installe sur l'écran d'accueil de l'iPhone et qui marche aussi sur ordinateur.
Tout est gratuit : cartes OpenFreeMap, itinéraires OSRM (serveur FOSSGIS), recherche Photon, lieux OpenStreetMap.

## Mettre l'appli en ligne (une fois, environ 10 minutes)

1. Crée un compte gratuit sur **github.com** (si tu n'en as pas).
2. En haut à droite : **+** → **New repository**.
   - Nom : `flaneur`
   - Coche **Public** (obligatoire pour l'hébergement gratuit)
   - Clique **Create repository**.
3. Sur la page qui s'affiche, clique le lien **uploading an existing file**.
4. Dézippe `flaneur-app.zip` sur ton ordinateur, ouvre le dossier, sélectionne **tout son contenu**
   (`index.html`, `style.css`, `sw.js`, `manifest.webmanifest`, les dossiers `js` et `icons`)
   et fais-le glisser dans la page GitHub. Utilise Chrome ou Edge pour pouvoir glisser des dossiers.
   Attention : glisse le contenu du dossier, pas le dossier lui-même ni le fichier zip.
5. En bas, clique **Commit changes**.
6. Va dans **Settings** → **Pages** (menu de gauche).
   - Source : **Deploy from a branch**
   - Branch : **main**, dossier **/ (root)** → **Save**.
7. Attends 1 à 2 minutes et recharge la page : l'adresse de ton appli s'affiche,
   du type `https://ton-pseudo.github.io/flaneur/`.

## L'installer sur l'iPhone

1. Ouvre l'adresse dans **Safari**.
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Lance Flâneur depuis l'icône : elle s'ouvre en plein écran comme une appli.
4. La première fois que tu touches la flèche de position ou « Y aller », autorise la localisation.

## Mettre à jour l'appli plus tard

Dans ton dépôt GitHub : **Add file** → **Upload files**, glisse les fichiers modifiés, **Commit changes**.
Sur l'iPhone, ferme et rouvre l'appli (parfois deux fois) pour voir la nouvelle version.

## Ce qu'il faut savoir

- **Tes voyages restent sur chaque appareil.** Pour passer un voyage de l'ordinateur à l'iPhone :
  Planifier → **Exporter mon voyage**, puis sur l'autre appareil **Importer**.
- **Guidage** : l'écran reste allumé pendant le trajet. Si tu verrouilles l'iPhone, le suivi GPS se met en pause
  (limite d'iOS pour les applis web).
- **Transports en commun** : les temps sont estimés. Le bouton « Itinéraire » ouvre Google Maps avec les horaires exacts.
- **Sur ordinateur**, sans GPS : « Y aller » montre le trajet depuis l'étape précédente, et **Simuler le trajet**
  le fait défiler pour essayer le guidage.
- **Horaires d'ouverture** : repris d'OpenStreetMap quand ils existent, sinon « horaires inconnus ».
  Tu peux les corriger dans la liste de tes lieux.
- Les serveurs gratuits demandent un usage raisonnable : l'appli limite elle-même ses demandes d'itinéraires.
