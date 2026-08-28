# Nova Studio

Plateforme SaaS interne de generation de contenus IA pour une equipe, adossee a
l'API [KIE.ai](https://kie.ai). Chaque collaborateur dispose de son propre
espace et de ses propres donnees ; l'administrateur supervise l'ensemble de
l'organisation.

---

## Sommaire

- [Demarrage rapide](#demarrage-rapide)
- [Architecture](#architecture)
- [Ajouter un modele IA](#ajouter-un-modele-ia)
- [Integration KIE.ai](#integration-kieai)
- [Systeme de credits](#systeme-de-credits)
- [Securite](#securite)
- [Modele de donnees](#modele-de-donnees)
- [API](#api)
- [Tests](#tests)
- [Deploiement](#deploiement)
- [Points de branchement restants](#points-de-branchement-restants)

---

## Demarrage rapide

Pre-requis : Node.js >= 20.11.

```bash
npm install
cp .env.example .env      # renseigner APP_SECRET et KIE_API_KEY
npm run build:shared
npm run dev               # API sur :4000, interface sur :5173
```

Au premier demarrage, l'organisation, le catalogue de modeles et un compte
administrateur sont crees automatiquement. Si `BOOTSTRAP_ADMIN_PASSWORD` n'est
pas defini, un mot de passe aleatoire est genere et **affiche une seule fois**
dans la console.

Jeu de donnees de demonstration (collaborateurs + invitation en attente) :

```bash
npm run seed
```

### Variables d'environnement essentielles

| Variable | Role |
| --- | --- |
| `APP_SECRET` | Secret maitre : sessions, chiffrement des cles API, URL signees. **Obligatoire en production** (32 caracteres minimum). |
| `PUBLIC_BASE_URL` | URL publique de l'API. **Doit etre joignable depuis Internet** : KIE.ai telecharge les images de reference via des URL signees et appelle le webhook de callback. En local, utiliser un tunnel. |
| `WEB_ORIGIN` | Origine(s) autorisee(s) du frontend (protection CSRF + CORS). |
| `KIE_API_KEY` | Cle API par defaut. Elle peut aussi etre saisie depuis *Administration > Parametres*, auquel cas elle est chiffree en base et prioritaire. |
| `SMTP_HOST`, `MAIL_FROM_EMAIL` | Envoi des e-mails par relais SMTP. **Entierement optionnel** : sans configuration, les liens d'invitation et de reinitialisation s'obtiennent depuis l'espace Administrateur. Un envoi par API (Resend, Brevo) se configure directement dans l'interface, sans relais. |
| `COOKIE_SECURE` | `true` obligatoire derriere HTTPS. |

La liste complete est documentee dans [`.env.example`](.env.example).

---

## Architecture

```
packages/shared   Contrat partage : types + definitions declaratives des modeles
apps/api          Serveur Express + SQLite : auth, credits, KIE.ai, workflows
apps/web          Interface React + Vite
```

Le decoupage du serveur suit les domaines metier :

```
apps/api/src/
├── providers/kie/     Client HTTP KIE.ai (seul endroit qui parle au fournisseur)
├── providers/email/   Fournisseurs d'e-mail par API HTTP (Resend, Brevo)
├── services/
│   ├── auth            sessions, invitations, reinitialisation de mot de passe
│   ├── mailer          envoi SMTP ou API + modeles de messages transactionnels
│   ├── users           comptes, roles, statuts, suppression
│   ├── credits         grand livre (reservation, debit, remboursement)
│   ├── models          catalogue, validation des definitions
│   ├── paramValidation validation serveur + construction du payload provider
│   ├── generations     cycle de vie d'une generation
│   ├── workflows       execution sequentielle multi-etapes
│   ├── gallery         selection personnelle de resultats
│   ├── files           stockage, controle des uploads, URL signees
│   ├── activity        journal des actions sensibles
│   ├── analytics       agregats collaborateur et administrateur
│   ├── diagnostics     inspection de la requete envoyee au fournisseur
│   └── worker          reconciliation periodique des taches
├── middleware/        authentification, roles, origine, erreurs, quotas
└── routes/            surface HTTP (aucune logique metier)
```

**Regle structurante** : les routes valident et delèguent, les services portent
la logique metier, le client KIE.ai est le seul a connaitre le fournisseur.
Aucune cle secrete n'existe cote navigateur.

---

## Ajouter un modele IA

C'est le point central de la conception. Un modele est une **donnee**, pas du
code : sa definition pilote a la fois l'interface, la validation serveur, le
payload envoye au fournisseur et le calcul des credits.

Deux facons de proceder, sans rien reconstruire :

1. **Depuis l'interface** — *Administration > Modeles IA > Ajouter un modele*.
   La definition s'edite au format JSON et le modele est utilisable
   immediatement.
2. **Dans le catalogue par defaut** — ajouter une entree dans
   [`packages/shared/src/models.ts`](packages/shared/src/models.ts). Elle sera
   installee au demarrage suivant (ou via *Restaurer le catalogue*).

```ts
{
  key: 'mon-modele',                    // cle interne stable
  providerModel: 'fournisseur/modele',  // identifiant envoye a KIE.ai
  name: 'Mon modele',
  kind: 'image',                        // image | video | audio
  outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
  credits: { base: 5, perOutput: true },
  params: [
    { id: 'prompt', field: 'prompt', label: 'Prompt',
      type: 'textarea', group: 'core', required: true, default: '', maxLength: 2000 },
    { id: 'resolution', field: 'image_size', label: 'Resolution',
      type: 'select', group: 'output', default: '2K',
      options: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }] },
  ],
}
```

Ce que la plateforme en deduit automatiquement :

| Declaration | Effet |
| --- | --- |
| `params[].type` | Controle affiche (zone de texte, curseur, interrupteur, depot de fichiers, selection segmentee) |
| `params[].field` | Nom du champ transmis dans `input` a KIE.ai |
| `params[].group` | Placement dans l'interface (references / prompt / sortie / audio / avance) |
| `params[].visibleWhen` | Affichage conditionnel — un parametre inapplicable n'est ni affiche ni transmis |
| `credits` | Cout, calcule par la **meme fonction** cote serveur et cote interface |
| `outputs` | Bornes du nombre de generations |

Consequence directe : **un modele sans audio n'affiche aucun controle audio**,
un modele sans duree n'affiche pas de curseur de duree. Aucun composant
d'interface ne connait le nom d'un modele.

Ajouter un nouveau *type* de controle (le seul cas necessitant du code) demande
de completer deux endroits : le `switch` de
[`ParamControl.tsx`](apps/web/src/components/generation/ParamControl.tsx) et
celui de [`paramValidation.ts`](apps/api/src/services/paramValidation.ts).

---

## Integration KIE.ai

KIE.ai n'expose pas un point d'entree unique. Trois **transports** sont
implementes, declares par chaque modele et decrits dans
[`TRANSPORTS`](packages/shared/src/models.ts) :

| Transport | Creation | Suivi | Corps |
| --- | --- | --- | --- |
| `jobs` | `POST /api/v1/jobs/createTask` | `GET /api/v1/jobs/recordInfo` | `{ model, input: { … } }` |
| `veo` | `POST /api/v1/veo/generate` | `GET /api/v1/veo/record-info` | `{ model, …params }` |
| `suno` | `POST /api/v1/generate` | `GET /api/v1/generate/record-info` | `{ model, customMode, …params }` |

Authentification : `Authorization: Bearer <cle>` dans tous les cas.
Etats pris en charge : `waiting`, `queuing`, `generating`, `success`, `fail`,
ainsi que le `successFlag` numerique des endpoints dedies — tous normalises
vers les etats internes. Le resultat est lu depuis `resultJson` (chaine JSON)
ou `response` (objet) selon l'endpoint.

Ajouter un transport = une entree dans `TRANSPORTS` + le referencer depuis un
modele. Validation, credits, suivi et workflows restent inchanges.

### Nombre de sorties

Deux strategies, declarees par `outputs.mode` :

- `provider` — le modele produit plusieurs resultats dans **une seule tache**
  (ex. `max_images` chez Seedream) : une generation, un appel, N resultats ;
- `fanout` — une tache par sortie. Toujours valable, quel que soit le modele.

**Suivi des generations** : le webhook `callBackUrl` accelere la mise a jour,
mais le sondage periodique reste la source de verite. Le corps du callback
n'est jamais cru sur parole : il declenche une verification aupres de
`recordInfo`. L'URL de callback est signee (HMAC) et liee a une generation
precise, ce qui empeche un tiers de forcer un etat.

**Fichiers de reference** : le fournisseur doit pouvoir les telecharger. Ils
sont donc exposes par une URL publique **signee et expirante**
(`/api/files/public/:id?expires=…&signature=…`), seul point d'entree non
authentifie de l'application.

**Resultats** : ils sont recopies vers le stockage local (`MIRROR_OUTPUTS`)
pour que la galerie reste consultable apres expiration des URL du fournisseur.
Si la copie echoue ou disparait, l'interface bascule automatiquement sur l'URL
d'origine.

**Erreurs** : chaque cas est distingue — cle absente ou refusee
(`provider_not_configured`), delai depasse (`provider_timeout`), quota
(`rate_limited`), refus du modele (`provider_error`). Le message affiche a
l'utilisateur ne contient jamais de secret ni de trace technique ; le detail
complet reste dans le journal serveur et dans `generations.error_detail_json`.

---

## Envoi des e-mails

**L'envoi d'e-mails est facultatif.** La plateforme est concue pour fonctionner
entierement sans, ce qui est le cas courant pour un outil interne.

### Sans aucun service d'e-mail

Tout reste faisable depuis l'espace Administrateur, en transmettant un lien
par le canal de l'equipe (messagerie interne, oral, ticket) :

| Besoin | Ou |
| --- | --- |
| Inviter un collaborateur | Le lien s'affiche a la creation de l'invitation |
| Renvoyer une invitation perdue | *Collaborateurs > Invitations > Nouveau lien* (l'ancien devient invalide) |
| Un collaborateur a oublie son mot de passe | Sa fiche > *Emettre un lien de reinitialisation* |

L'administrateur n'apprend jamais le mot de passe : le collaborateur le
choisit lui-meme via le lien, valable une heure et utilisable une seule fois.
Chaque emission est journalisee comme action sensible.

### Avec un service d'e-mail

Trois modes, au choix dans *Administration > Parametres* :

| Mode | Ce qu'il faut |
| --- | --- |
| **Relais SMTP** | Hote, port, identifiants |
| **Resend** (API) | Une cle API — aucun relais a heberger |
| **Brevo** (API) | Une cle API — aucun relais a heberger |

Les modes par API n'exigent ni serveur de messagerie ni port ouvert : ils
conviennent lorsqu'on ne dispose pas d'infrastructure de messagerie. Secrets
(mot de passe SMTP ou cle API) chiffres AES-256-GCM, jamais renvoyes au client.
Un bouton verifie la configuration et envoie un message de test.

Messages envoyes : invitation, reinitialisation de mot de passe, ouverture de
compte, et message de test.

Regles appliquees :

- **L'envoi n'est jamais bloquant.** Une invitation reste creee et valide meme
  si l'e-mail echoue ; l'interface affiche alors le lien a transmettre, avec la
  raison exacte du refus renvoyee par le fournisseur.
- **Aucun mot de passe n'est jamais envoye par e-mail**, y compris lors d'une
  creation de compte par un administrateur.
- La reponse a « mot de passe oublie » est **identique dans tous les cas** :
  elle ne revele ni l'existence du compte, ni le resultat de l'envoi. Le lien
  n'est renvoye au client qu'en developpement, et uniquement si aucun service
  d'e-mail n'est configure.
- Les adresses sont validees avant envoi (protection contre l'injection
  d'en-tetes), et chaque envoi est journalise.

## Systeme de credits

Toute variation de solde passe par une seule fonction transactionnelle
(`applyLedgerEntry`), ce qui garantit que le solde et l'historique ne peuvent
pas diverger.

Cycle de vie d'une generation :

1. **Reservation** — le cout est calcule **cote serveur** a partir de la
   definition du modele, puis debite avant tout appel au fournisseur.
2. **Blocage** — un solde insuffisant empeche le lancement, sauf si
   l'administrateur a active le decouvert pour ce collaborateur.
3. **Remboursement** — si la generation echoue, est annulee ou depasse le delai
   maximum **sans avoir produit de resultat**, le montant est integralement
   restitue. Le remboursement est idempotent : il ne peut pas etre rejoue.

L'estimation affichee dans l'interface utilise la meme fonction pure que le
serveur, mais n'a aucune autorite : le montant reellement debite est toujours
recalcule cote serveur a partir des parametres valides.

Chaque operation enregistre l'utilisateur, le modele, le type de generation,
la date, les parametres, le cout, le statut et l'identifiant de la tache
externe.

---

## Securite

| Mesure | Mise en oeuvre |
| --- | --- |
| Sessions | Jetons opaques aleatoires, stockes **hashes** (SHA-256), revocables, expiration glissante, cookie `httpOnly` + `SameSite=Lax` |
| Mots de passe | bcrypt (cout 12), politique minimale imposee, comparaison a cout constant sur les comptes inexistants |
| Roles | Verifies **cote serveur** sur chaque route ; l'interface se contente de masquer les entrees de menu |
| Isolation | `organization_id` + `user_id` filtres explicitement dans chaque requete ; un collaborateur ne peut pas elargir sa portee via un parametre d'URL |
| Validation | Tout parametre est valide contre la definition du modele ; les parametres inconnus sont **rejetes** |
| Uploads | Liste blanche de types MIME, taille bornee, **verification de la signature binaire** du fichier |
| CSRF | `SameSite=Lax` + controle d'origine sur toute requete mutante |
| Bruteforce | Quotas sur connexion, inscription, reinitialisation et lancement de generation |
| Secrets | Cle API chiffree AES-256-GCM, jamais renvoyee au client (seuls les 4 derniers caracteres) |
| Journalisation | Toute action sensible est tracee (auteur, cible, metadonnees, IP) |
| Suppressions | Confirmation explicite par recopie de l'adresse e-mail du compte |

Les messages d'erreur sont volontairement identiques en cas d'echec de
connexion, quelle qu'en soit la cause, afin de ne pas reveler l'existence d'un
compte.

---

## Modele de donnees

SQLite en mode WAL, avec integrite referentielle activee
(`PRAGMA foreign_keys = ON`) et suppressions en cascade.

```
Organization ─┬─ User ──┬─ CreditBalance
              │         ├─ CreditTransaction
              │         ├─ Generation ──┬─ GenerationAsset ── GalleryItem
              │         │               └─ (File)
              │         ├─ Workflow ── WorkflowStep
              │         │      └─ WorkflowRun ── WorkflowStepRun
              │         └─ File
              ├─ Model            (definition JSON pilotant l'interface)
              ├─ Invitation
              ├─ ActivityLog
              └─ ApiConfiguration (cle chiffree)
```

Le schema complet est dans
[`apps/api/src/db/schema.sql`](apps/api/src/db/schema.sql), commente table par
table. Le schema est multi-organisation, meme si un deploiement n'en heberge
qu'une : aucune migration ne sera necessaire pour evoluer.

---

## API

Toutes les routes sont prefixees par `/api`.

| Domaine | Routes principales |
| --- | --- |
| Authentification | `POST /auth/login`, `/auth/logout`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`, `GET /auth/session`, `/auth/invitation` |
| Espace personnel | `GET /me`, `PATCH /me`, `GET /me/overview`, `/me/credits`, `/me/sessions` |
| Modeles | `GET /models`, `GET /models/:key`, `POST /models/:key/estimate` |
| Fichiers | `POST /files`, `GET /files/:id/content`, `GET /files/public/:id` (signee), `DELETE /files/:id` |
| Generations | `POST /generations`, `GET /generations`, `GET /generations/:id`, `POST /generations/:id/cancel`, `DELETE /generations/:id` |
| Galerie | `GET /gallery`, `POST /gallery`, `PATCH /gallery/:id`, `DELETE /gallery/:id` |
| Workflows | `GET|POST /workflows`, `PUT|DELETE /workflows/:id`, `POST /workflows/:id/run`, `/duplicate`, `GET /workflows/runs` |
| Administration | `/admin/overview`, `/admin/users`, `/admin/credits`, `/admin/activity`, `/admin/invitations`, `/admin/models`, `/admin/settings`, `/admin/api-configuration`, `/admin/email-configuration` |
| Liens hors e-mail | `POST /admin/users/:id/password-reset`, `POST /admin/invitations/:id/resend` |
| Diagnostic | `POST /admin/models/:key/diagnose` (`live` pour un test reel) |
| Webhook | `POST /webhooks/kie/:generationId` (signee) |

Les erreurs suivent une enveloppe unique et typee :

```json
{ "error": { "code": "insufficient_credits", "message": "…", "fields": {}, "requestId": "req_…" } }
```

---

## Tests

```bash
npm test          # 58 tests d'integration (API, fournisseur IA, SMTP et API e-mail simules)
npm run doctor    # inspecte la requete envoyee a KIE.ai pour chaque modele
npm run typecheck # verification TypeScript des trois paquets
```

La suite couvre l'authentification et les messages d'erreur, le controle
d'acces par role, la protection d'origine, l'inscription par invitation (et le
rejeu de jeton), la validation des parametres, le cycle complet d'une
generation reussie, le remboursement en cas d'echec, le blocage sur solde
insuffisant, l'isolation stricte entre collaborateurs, la galerie, les
workflows multi-etapes, la desactivation et la suppression de comptes,
l'ajout d'un modele a chaud, la non-divulgation de la cle API, les trois
transports provider, les sorties multiples en une seule tache, les parametres
conditionnels, l'envoi reel des e-mails (invitation et reinitialisation
jusqu'a la connexion effective, absence de mot de passe dans les messages,
chiffrement des secrets, echec d'envoi non bloquant, formes de corps propres a
Resend et Brevo), le fonctionnement complet **sans aucun service d'e-mail**
(fichier dedie, processus isole), ainsi que deux cas de robustesse :
desactivation d'un modele pendant une generation en vol et definition de modele
corrompue en base. Le diagnostic est couvert lui aussi : forme de requete par
transport, non-divulgation de la cle, absence de generation creee lors d'un
test reel, et identification du parametre refuse.

Le fournisseur de modeles est simule par un serveur HTTP local reproduisant le
contrat KIE.ai (`apps/api/test/mockKie.ts`) et la messagerie par un vrai
serveur SMTP local (`apps/api/test/mockSmtp.ts`) : aucun credit reel n'est
consomme et aucun e-mail ne sort.

---

## Deploiement

```bash
npm run build     # shared, puis API, puis interface
NODE_ENV=production SERVE_WEB=true npm start
```

Avec `SERVE_WEB=true`, l'API sert egalement l'interface compilee : un seul
processus et un seul port a exposer.

En production, verifier imperativement :

- `APP_SECRET` defini et conserve (le changer invalide sessions et cles chiffrees) ;
- `COOKIE_SECURE=true` derriere HTTPS ;
- `PUBLIC_BASE_URL` joignable depuis Internet ;
- sauvegarde de `DATA_DIR` (base) et `STORAGE_DIR` (fichiers).

---

## Verifier les modeles avec votre cle

Avant de laisser l'equipe utiliser un modele, comparez ce que la plateforme
envoie a ce que le fournisseur documente. Deux outils, tous deux sans risque.

**En ligne de commande** — affiche la requete exacte pour chaque modele actif :

```bash
npm run doctor                        # apercu de tous les modeles (aucun appel, gratuit)
npm run doctor -- nano-banana         # un seul modele
npm run doctor -- --live nano-banana  # soumet une vraie tache a ce modele
npm run doctor -- --live --all        # teste tout le catalogue
```

L'apercu ne contacte personne : il imprime l'URL, le transport et le corps
JSON qui partirait. C'est le moyen le plus rapide de reperer un nom de champ
errone en le comparant a la page de documentation du modele.

`--live` soumet une tache minimale et **consomme des credits chez le
fournisseur** (jamais ceux d'un collaborateur). Tester tout le catalogue exige
`--all`, pour eviter une depense involontaire.

**Depuis l'interface** — *Administration > Modeles IA > Diagnostiquer* montre la
meme requete, avec un bouton pour lancer un test reel. Utile sans acces au
serveur.

Lorsque le fournisseur refuse, sa reponse brute est relayee et rapprochee du
parametre concerne :

```
✗ Unsupported parameter 'cfg_scale' for this model
  → Le fournisseur mentionne le champ « cfg_scale » (parametre « Adherence au
    prompt »). Verifiez son nom et ses valeurs sur https://docs.kie.ai/...,
    puis corrigez-le dans Administration > Modeles IA.
```

La cle API n'apparait jamais dans un diagnostic : seuls ses quatre derniers
caracteres sont affiches.

## Verification restant a faire

Un seul point n'a pas pu etre eprouve depuis cet environnement.

**Execution reelle contre KIE.ai** — le catalogue par defaut a ete aligne sur les
   identifiants et noms de champs reels du fournisseur (voir ci-dessous), mais
il n'a pas pu etre execute contre l'API de production depuis cet environnement
(docs et API KIE.ai injoignables ; l'integration est validee contre un
fournisseur simule reproduisant le contrat). Avant la premiere mise en service,
lancer `npm run doctor` puis `npm run doctor -- --live <modele>` avec la cle de
l'organisation, et ajuster si besoin depuis *Administration > Modeles IA* —
**aucun redeploiement n'est necessaire**. Voir
[Verifier les modeles avec votre cle](#verifier-les-modeles-avec-votre-cle).

L'envoi d'e-mails est fonctionnel et valide de bout en bout contre un serveur
SMTP reel. Les deux fournisseurs par API (Resend, Brevo) sont implementes
d'apres leurs API publiques et verifies contre un service simule reproduisant
leur contrat ; le bouton de test permet de les valider avec votre cle, sans
risque. Et si vous ne configurez rien, la plateforme reste complete : voir
[Envoi des e-mails](#envoi-des-e-mails).

### Ecarts corriges lors de l'alignement du catalogue

Ces details ne sont pas devinables et cassent silencieusement une integration ;
ils sont notes ici pour les prochains ajouts de modeles :

| Point | Realite |
| --- | --- |
| Ratio d'image (catalogue market) | champ `image_size`, **pas** `aspect_ratio` |
| Ratio Seedream | valeurs nommees (`square`, `landscape_16_9`…), pas `16:9` |
| Resolution Seedream | champ `image_resolution` (`1K`/`2K`/`4K`) |
| Duree Kling | chaine `"5"` / `"10"` — le fournisseur est strict sur le type |
| Image unique Kling I2V | champ `image_url` (URL seule), pas `image_urls` |
| Veo | endpoint dedie, `model` court (`veo3_fast`), images sous `imageUrls` ; ni duree ni mixage audio parametrables |
| Suno | endpoint dedie, `model` = version du moteur (`V5`), corps a plat |
| ElevenLabs | champ `voice` (obligatoire), identifiants de voix explicites |
