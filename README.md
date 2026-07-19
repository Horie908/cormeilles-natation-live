# Cormeilles Natation Live

Site de résultats pour ACS Cormeilles Natation (club FFN id 733), avec recherche de nageur, résultats de la saison en cours (les compétitions les plus récentes, pas l'historique complet des années précédentes), et compétitions à venir avec adversaires/horaires quand la liste de départ est publiée. Données sourcées depuis ffn.extranat.fr et liveffn.com (Fédération Française de Natation).

## Lancer en local

```
npm install
npm run scrape   # remplit data/club_data.json avec les vraies données FFN
npm start        # démarre le site sur http://localhost:3000
```

## Mettre le site en ligne gratuitement (Render.com)

1. Crée un compte gratuit sur https://render.com (tu peux te connecter avec GitHub).
2. Crée un dépôt GitHub avec ce code (ou demande-moi de préparer le `git push` si tu me donnes l'URL du dépôt vide que tu as créé).
3. Sur Render : **New +** → **Blueprint** → sélectionne ton dépôt GitHub. Render lit le fichier `render.yaml` fourni et configure tout automatiquement (nom, build, variables d'environnement).
4. Clique **Apply** puis attends la fin du déploiement (2-3 minutes). Ton lien public sera de la forme `https://cormeilles-natation-live.onrender.com`.
5. C'est ce lien que tu envoies à tes coéquipiers.

### Garder les données à jour automatiquement

Deux actualisations tournent en parallèle, tant que le serveur est éveillé :

- **Complète** (`REFRESH_CRON`, 2x/jour par défaut à 7h et 19h) : re-scrape toute la saison, trouve les nouveaux nageurs/compétitions.
- **Live** (`LIVE_REFRESH_CRON`, toutes les 15 min par défaut) : ne re-scrape que la compétition du jour (si le club en a une), pour suivre les temps qui tombent en direct pendant une réunion — beaucoup plus léger, donc peut tourner souvent sans solliciter excessivement le site de la FFN.

Sur le plan gratuit de Render, le site s'endort après 15 minutes sans visite (les actualisations internes sont alors en pause). Si quelqu'un garde la page ouverte pendant une compétition, le site reste éveillé et se met à jour tout seul toutes les 15 min. Pour une actualisation continue même sans visiteurs :
1. Va dans le dashboard Render → ton service → **Environment**, note la valeur générée pour `REFRESH_TOKEN`.
2. Crée un compte gratuit sur https://cron-job.org.
3. Ajoute une tâche qui appelle toutes les 15 minutes (utile surtout les jours de compétition) :
   `https://TON-SITE.onrender.com/api/refresh-live?token=LE_TOKEN` (méthode POST).

Cela réveille le site et relance l'actualisation légère à intervalle régulier.

## Structure du projet

- `src/scraper/` — récupération et parsing des pages ffn.extranat.fr (aucune donnée n'est inventée : un champ manquant reste vide).
- `src/server.js` — API Express (`/api/club`, `/api/swimmers`, `/api/swimmers/:id`, `/api/refresh`, `/api/refresh-live`) + sert le frontend.
- `public/` — frontend (recherche, fiche nageur, historique, compétitions à venir).
- `data/club_data.json` — dernière donnée scrapée (régénérée automatiquement).

## Respect du site source

Le scraper attend entre chaque requête et ne scrape que les pages nécessaires (résultats du club, pas l'intégralité de la base FFN) pour rester correct vis-à-vis du serveur de la fédération.
