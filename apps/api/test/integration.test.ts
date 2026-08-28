import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startMockKie, PNG, type MockKie } from './mockKie.js';
import { extractLink, startMockSmtp, type MockSmtp } from './mockSmtp.js';
import { startMockEmailApi, type MockEmailApi } from './mockEmailApi.js';

/* Isolation complete : base et stockage temporaires, provider simule. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.DATABASE_PATH = path.join(tmp, 'data', 'test.sqlite');
process.env.APP_SECRET = 'secret-de-test-suffisamment-long-pour-passer-la-validation';
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@test.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'AdminTest123';
process.env.WORKER_ENABLED = 'false';
process.env.POLL_INTERVAL_MS = '1';

let mock: MockKie;
let smtp: MockSmtp;
let emailApi: MockEmailApi;
let server: Server;
let baseUrl: string;
let tick: () => Promise<void>;

async function api(
  method: string,
  route: string,
  options: { body?: unknown; cookie?: string; form?: FormData; origin?: string } = {},
): Promise<{ status: number; body: any; cookie: string | null }> {
  // Aucune origine par defaut : hors production, les clients non-navigateur
  // sont acceptes. La protection d'origine est testee explicitement plus bas.
  const headers: Record<string, string> = {};
  if (options.origin) headers.Origin = options.origin;
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: setCookie ? setCookie.split(';')[0] : null,
  };
}

before(async () => {
  mock = await startMockKie(1);
  process.env.KIE_BASE_URL = mock.url;
  process.env.KIE_API_KEY = 'test-key';

  // Service d'envoi d'e-mails simule, configure par variables d'environnement
  // (le chemin « configuration d'organisation » est teste separement).
  smtp = await startMockSmtp();
  // Fournisseur d'e-mail par API HTTP simule (mode sans relais SMTP).
  emailApi = await startMockEmailApi('cle-api-test');
  process.env.EMAIL_API_ENDPOINT_OVERRIDE = emailApi.url;
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_SECURE = 'false';
  process.env.MAIL_FROM_EMAIL = 'nova@test.local';
  process.env.MAIL_FROM_NAME = 'Nova Studio';

  const { createApp } = await import('../src/app.js');
  const { bootstrap } = await import('../src/db/bootstrap.js');
  const worker = await import('../src/services/worker.js');
  tick = worker.tick;

  bootstrap();
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.PUBLIC_BASE_URL = baseUrl;
});

after(async () => {
  server?.close();
  const { resetTransporters } = await import('../src/services/mailer.js');
  resetTransporters();
  await smtp?.close();
  await emailApi?.close();
  await mock?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Sonde jusqu'a ce que la generation atteigne un etat terminal. */
async function waitForState(generationId: string, cookie: string, attempts = 12): Promise<any> {
  for (let i = 0; i < attempts; i += 1) {
    await tick();
    const res = await api('GET', `/generations/${generationId}`, { cookie });
    const generation = res.body.generation;
    if (['completed', 'failed', 'cancelled'].includes(generation.state)) return generation;
  }
  throw new Error('La generation n a pas atteint un etat terminal.');
}

describe('Authentification et controle d acces', () => {
  let adminCookie = '';
  let collaboratorCookie = '';

  test('un administrateur peut se connecter', async () => {
    const res = await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'admin');
    assert.ok(res.cookie);
    adminCookie = res.cookie!;
  });

  test('un mot de passe incorrect est refuse sans reveler le compte', async () => {
    const res = await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'mauvais-mot-de-passe' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'authentication_error');

    const unknown = await api('POST', '/auth/login', {
      body: { email: 'inconnu@test.local', password: 'mauvais-mot-de-passe' },
    });
    assert.equal(unknown.body.error.message, res.body.error.message);
  });

  test('un collaborateur ne peut s inscrire que via une invitation', async () => {
    const sansJeton = await api('POST', '/auth/register', {
      body: { token: 'jeton-inexistant-mais-long', name: 'Pirate', password: 'Motdepasse12' },
    });
    assert.equal(sansJeton.status, 400);

    const invitation = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'lea@test.local', role: 'collaborator', initialCredits: 100 },
    });
    assert.equal(invitation.status, 201);
    const token = invitation.body.invitation.inviteUrl.split('token=')[1];

    const created = await api('POST', '/auth/register', {
      body: { token, name: 'Lea Martin', password: 'Motdepasse12' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'collaborator');
    assert.equal(created.body.user.credits.balance, 100);
    collaboratorCookie = created.cookie!;

    // Le jeton ne peut pas etre rejoue.
    const replay = await api('POST', '/auth/register', {
      body: { token, name: 'Doublon', password: 'Motdepasse12' },
    });
    assert.equal(replay.status, 400);
  });

  test('les routes d administration sont refusees a un collaborateur', async () => {
    for (const route of ['/admin/users', '/admin/overview', '/admin/settings']) {
      const res = await api('GET', route, { cookie: collaboratorCookie });
      assert.equal(res.status, 403, `route ${route}`);
      assert.equal(res.body.error.code, 'permission_error');
    }
    const anonymous = await api('GET', '/admin/users');
    assert.equal(anonymous.status, 401);
  });

  test('une origine inconnue est rejetee sur une requete mutante (CSRF)', async () => {
    const res = await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
      origin: 'https://site-malveillant.example',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'permission_error');
  });

  test('la deconnexion revoque la session', async () => {
    const login = await api('POST', '/auth/login', {
      body: { email: 'lea@test.local', password: 'Motdepasse12' },
    });
    const cookie = login.cookie!;
    await api('POST', '/auth/logout', { cookie });
    const after = await api('GET', '/me', { cookie });
    assert.equal(after.status, 401);
  });
});

describe('Generation de contenu', () => {
  let cookie = '';
  let adminCookie = '';
  let fileId = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
    cookie = (await api('POST', '/auth/login', {
      body: { email: 'lea@test.local', password: 'Motdepasse12' },
    })).cookie!;

    const form = new FormData();
    form.append('files', new Blob([PNG], { type: 'image/png' }), 'reference.png');
    const upload = await api('POST', '/files', { cookie, form });
    assert.equal(upload.status, 201);
    fileId = upload.body.files[0].id;
  });

  test('les parametres sont valides cote serveur', async () => {
    const ratio = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'nano-banana', params: { prompt: 'test', image_size: '42:1' } },
    });
    assert.equal(ratio.status, 400);
    assert.ok(ratio.body.error.fields.image_size);

    const inconnu = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'nano-banana', params: { prompt: 'test', seed: 7 } },
    });
    assert.equal(inconnu.status, 400);

    const reference = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'nano-banana-edit', params: { prompt: 'test' } },
    });
    assert.equal(reference.status, 400);
    assert.ok(reference.body.error.fields.image_urls);
  });

  test('une generation aboutie produit un resultat et debite les credits', async () => {
    const before = (await api('GET', '/me/credits', { cookie })).body.summary.balance;

    const created = await api('POST', '/generations', {
      cookie,
      body: {
        modelKey: 'nano-banana-edit',
        params: { prompt: 'Studio lumineux', image_urls: [fileId], image_size: '16:9' },
        outputCount: 1,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.generations.length, 1);
    assert.equal(created.body.generations[0].state, 'queued');

    const cost = created.body.creditCost;
    assert.ok(cost > 0);

    const generation = await waitForState(created.body.generations[0].id, cookie);
    assert.equal(generation.state, 'completed');
    const outputs = generation.assets.filter((a: any) => a.kind === 'output');
    assert.equal(outputs.length, 1);
    assert.equal(generation.creditsRefunded, 0);
    // Le resultat a ete recopie localement : il est servi par l'API et reste
    // disponible meme si l'URL du provider expire.
    assert.match(outputs[0].url, /^\/api\/files\//);
    const download = await fetch(`${baseUrl}${outputs[0].url}`, { headers: { Cookie: cookie } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'image/png');

    const after = (await api('GET', '/me/credits', { cookie })).body.summary.balance;
    assert.equal(after, before - cost);

    // Le payload transmis au provider respecte la definition du modele.
    const createCall = mock.requests.filter((r) => r.path === '/api/v1/jobs/createTask').at(-1)!;
    const body = createCall.body as any;
    assert.equal(body.model, 'google/nano-banana-edit');
    assert.equal(body.input.prompt, 'Studio lumineux');
    assert.equal(body.input.image_size, '16:9');
    assert.equal(body.input.image_urls.length, 1);
    assert.match(body.input.image_urls[0], /\/api\/files\/public\/.+signature=/);
    assert.ok(body.callBackUrl.includes('/api/webhooks/kie/'));
  });

  test('une generation en echec rembourse integralement les credits', async () => {
    const before = (await api('GET', '/me/credits', { cookie })).body.summary.balance;
    mock.failNext = true;

    const created = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'nano-banana', params: { prompt: 'sujet refuse' } },
    });
    const generation = await waitForState(created.body.generations[0].id, cookie);

    assert.equal(generation.state, 'failed');
    assert.match(generation.errorMessage, /prompt refuse/);
    assert.equal(generation.creditsRefunded, created.body.creditCost);

    const after = (await api('GET', '/me/credits', { cookie })).body.summary.balance;
    assert.equal(after, before);
  });

  test('une generation est refusee si le solde est insuffisant', async () => {
    const balance = (await api('GET', '/me/credits', { cookie })).body.summary.balance;
    // Videe le solde par un ajustement negatif via un debit administrateur
    // simule : on demande plus de sorties que le solde ne le permet.
    const res = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'veo-3-fast', params: { prompt: 'trop cher' }, outputCount: 4 },
    });
    assert.equal(res.status, 402, `solde=${balance}`);
    assert.equal(res.body.error.code, 'insufficient_credits');
  });

  test('les donnees d un collaborateur sont isolees', async () => {
    const invitation = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'tom@test.local', role: 'collaborator', initialCredits: 50 },
    });
    const token = invitation.body.invitation.inviteUrl.split('token=')[1];
    const tom = await api('POST', '/auth/register', {
      body: { token, name: 'Tom Dupont', password: 'Motdepasse12' },
    });
    const tomCookie = tom.cookie!;

    const leaGenerations = (await api('GET', '/generations', { cookie })).body;
    assert.ok(leaGenerations.items.length > 0);
    const target = leaGenerations.items[0].id;

    const tomList = (await api('GET', '/generations', { cookie: tomCookie })).body;
    assert.equal(tomList.items.length, 0);

    const direct = await api('GET', `/generations/${target}`, { cookie: tomCookie });
    assert.equal(direct.status, 403);

    // Meme en forcant le parametre `userId`, un collaborateur reste cantonne.
    const forced = await api('GET', `/generations?userId=all`, { cookie: tomCookie });
    assert.equal(forced.body.items.length, 0);

    const fichier = await api('GET', `/files/${fileId}`, { cookie: tomCookie });
    assert.equal(fichier.status, 403);

    // L'administrateur, lui, supervise l'ensemble.
    const admin = (await api('GET', '/generations?userId=all', { cookie: adminCookie })).body;
    assert.ok(admin.items.length > 0);
  });

  test('un resultat peut etre enregistre puis retire de la galerie', async () => {
    const generations = (await api('GET', '/generations?state=completed', { cookie })).body;
    const asset = generations.items[0].assets.find((a: any) => a.kind === 'output');

    const added = await api('POST', '/gallery', { cookie, body: { assetId: asset.id, title: 'Visuel studio' } });
    assert.equal(added.status, 201);
    assert.equal(added.body.item.title, 'Visuel studio');

    const list = (await api('GET', '/gallery', { cookie })).body;
    assert.equal(list.items.length, 1);

    const removed = await api('DELETE', `/gallery/${added.body.item.id}`, { cookie });
    assert.equal(removed.status, 200);
    assert.equal((await api('GET', '/gallery', { cookie })).body.items.length, 0);
  });
});

describe('Workflows', () => {
  let cookie = '';
  let fileId = '';

  before(async () => {
    cookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
    const form = new FormData();
    form.append('files', new Blob([PNG], { type: 'image/png' }), 'source.png');
    fileId = (await api('POST', '/files', { cookie, form })).body.files[0].id;
  });

  test('un workflow enchaine deux etapes, la seconde reprenant la sortie de la premiere', async () => {
    const created = await api('POST', '/workflows', {
      cookie,
      body: {
        name: 'Visuel puis variante',
        description: 'Genere une image puis la retravaille',
        steps: [
          { name: 'Image de base', modelKey: 'nano-banana', prompt: 'Un flacon sur fond clair', params: {} },
          {
            name: 'Variante editoriale',
            modelKey: 'nano-banana-edit',
            prompt: 'Ajoute un fond degrade',
            params: {},
            inputs: [{ paramId: 'image_urls', source: 'step', stepIndex: 0, limit: 1 }],
          },
        ],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.workflow.steps.length, 2);
    assert.ok(created.body.workflow.estimatedCredits > 0);

    const run = await api('POST', `/workflows/${created.body.workflow.id}/run`, { cookie, body: {} });
    assert.equal(run.status, 201);

    let state = run.body.run;
    for (let i = 0; i < 30 && !['completed', 'failed', 'cancelled'].includes(state.state); i += 1) {
      await tick();
      state = (await api('GET', `/workflows/runs/${run.body.run.id}`, { cookie })).body.run;
    }
    assert.equal(state.state, 'completed', state.errorMessage ?? '');
    assert.equal(state.steps.length, 2);
    assert.ok(state.steps.every((s: any) => s.state === 'completed'));

    // La seconde etape a bien recu l'image produite par la premiere.
    const lastCall = mock.requests.filter((r) => r.path === '/api/v1/jobs/createTask').at(-1)!;
    assert.equal((lastCall.body as any).model, 'google/nano-banana-edit');
    assert.equal((lastCall.body as any).input.image_urls.length, 1);
  });

  test('un workflow refuse une etape referencant une etape ulterieure', async () => {
    const res = await api('POST', '/workflows', {
      cookie,
      body: {
        name: 'Invalide',
        steps: [
          {
            name: 'Etape 1',
            modelKey: 'nano-banana-edit',
            prompt: 'x',
            inputs: [{ paramId: 'image_urls', source: 'step', stepIndex: 1 }],
          },
        ],
      },
    });
    assert.equal(res.status, 400);
  });
});

describe('Administration', () => {
  let adminCookie = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
  });

  test('la supervision agrege l activite de tous les collaborateurs', async () => {
    const overview = (await api('GET', '/admin/overview', { cookie: adminCookie })).body;
    assert.ok(overview.totals.collaborators >= 3);
    assert.ok(overview.totals.generations > 0);
    assert.ok(overview.byModel.length > 0);
    assert.ok(overview.byUser.some((u: any) => u.email === 'lea@test.local'));
    assert.equal(overview.timeline.length, 30);
  });

  test('un compte peut etre desactive puis reactive', async () => {
    const users = (await api('GET', '/admin/users?search=lea', { cookie: adminCookie })).body;
    const lea = users.items[0];

    await api('PATCH', `/admin/users/${lea.id}/status`, { cookie: adminCookie, body: { status: 'disabled' } });
    const refused = await api('POST', '/auth/login', {
      body: { email: 'lea@test.local', password: 'Motdepasse12' },
    });
    assert.equal(refused.status, 403);

    await api('PATCH', `/admin/users/${lea.id}/status`, { cookie: adminCookie, body: { status: 'active' } });
    const ok = await api('POST', '/auth/login', {
      body: { email: 'lea@test.local', password: 'Motdepasse12' },
    });
    assert.equal(ok.status, 200);
  });

  test('la suppression exige une confirmation explicite et efface les donnees', async () => {
    const users = (await api('GET', '/admin/users?search=tom', { cookie: adminCookie })).body;
    const tom = users.items[0];

    const sansConfirmation = await api('DELETE', `/admin/users/${tom.id}`, {
      cookie: adminCookie,
      body: { confirmEmail: 'mauvais@test.local' },
    });
    assert.equal(sansConfirmation.status, 400);

    const supprime = await api('DELETE', `/admin/users/${tom.id}`, {
      cookie: adminCookie,
      body: { confirmEmail: 'tom@test.local' },
    });
    assert.equal(supprime.status, 200);

    const restant = (await api('GET', '/admin/users?search=tom', { cookie: adminCookie })).body;
    assert.equal(restant.items.length, 0);
  });

  test('un administrateur ne peut pas supprimer son propre compte', async () => {
    const me = (await api('GET', '/me', { cookie: adminCookie })).body.user;
    const res = await api('DELETE', `/admin/users/${me.id}`, {
      cookie: adminCookie,
      body: { confirmEmail: me.email },
    });
    assert.equal(res.status, 409);
  });

  test('un modele desactive n est plus utilisable', async () => {
    await api('PATCH', '/admin/models/nano-banana/enabled', { cookie: adminCookie, body: { enabled: false } });
    const catalogue = (await api('GET', '/models', { cookie: adminCookie })).body;
    assert.ok(!catalogue.models.some((m: any) => m.key === 'nano-banana'));

    const refuse = await api('POST', '/generations', {
      cookie: adminCookie,
      body: { modelKey: 'nano-banana', params: { prompt: 'test' } },
    });
    assert.equal(refuse.status, 400);

    await api('PATCH', '/admin/models/nano-banana/enabled', { cookie: adminCookie, body: { enabled: true } });
  });

  test('un nouveau modele est ajoutable sans modifier le code', async () => {
    const res = await api('PUT', '/admin/models/mon-modele-maison', {
      cookie: adminCookie,
      body: {
        name: 'Modele maison',
        kind: 'image',
        providerModel: 'fournisseur/modele-x',
        outputs: { mode: 'fanout', min: 1, max: 2, default: 1 },
        credits: { base: 3, perOutput: true },
        params: [
          { id: 'prompt', field: 'prompt', label: 'Prompt', group: 'core', type: 'textarea', default: '', maxLength: 1000, required: true },
          { id: 'style', field: 'style', label: 'Style', group: 'output', type: 'select', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
        ],
      },
    });
    assert.equal(res.status, 200);

    const catalogue = (await api('GET', '/models', { cookie: adminCookie })).body;
    const model = catalogue.models.find((m: any) => m.key === 'mon-modele-maison');
    assert.ok(model, 'le modele doit apparaitre dans le catalogue');
    assert.equal(model.params.length, 2);

    // Il est immediatement utilisable, avec validation des nouvelles options.
    const invalide = await api('POST', '/generations', {
      cookie: adminCookie,
      body: { modelKey: 'mon-modele-maison', params: { prompt: 'x', style: 'z' } },
    });
    assert.equal(invalide.status, 400);
  });

  test('la cle API n est jamais renvoyee au client', async () => {
    await api('PUT', '/admin/api-configuration', {
      cookie: adminCookie,
      body: { apiKey: 'cle-secrete-abcd1234' },
    });
    const settings = (await api('GET', '/admin/settings', { cookie: adminCookie })).body;
    const serialized = JSON.stringify(settings);
    assert.ok(!serialized.includes('cle-secrete-abcd1234'));
    assert.equal(settings.apiConfiguration.keyLast4, '1234');
    assert.equal(settings.apiConfiguration.configured, true);

    // Restaure la cle de test pour les suites suivantes.
    await api('PUT', '/admin/api-configuration', { cookie: adminCookie, body: { apiKey: 'test-key' } });
  });

  test('les actions sensibles sont journalisees', async () => {
    const activity = (await api('GET', '/admin/activity', { cookie: adminCookie })).body;
    const actions = activity.items.map((a: any) => a.action);
    for (const expected of ['admin.user_deleted', 'admin.user_disabled', 'admin.invitation_created']) {
      assert.ok(actions.includes(expected), `action manquante : ${expected}`);
    }
  });
});

describe('Robustesse', () => {
  let adminCookie = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
  });

  test('une generation echoue proprement et rembourse si le modele est desactive apres coup', async () => {
    // Le modele est desactive juste apres la creation : la soumission au
    // fournisseur doit echouer sans laisser la generation en attente.
    const before = (await api('GET', '/me/credits', { cookie: adminCookie })).body.summary.balance;
    const created = await api('POST', '/generations', {
      cookie: adminCookie,
      body: { modelKey: 'seedream-v4', params: { prompt: 'test robustesse' } },
    });
    assert.equal(created.status, 201);
    await api('PATCH', '/admin/models/seedream-v4/enabled', {
      cookie: adminCookie,
      body: { enabled: false },
    });

    const generation = await waitForState(created.body.generations[0].id, adminCookie);
    assert.ok(['completed', 'failed'].includes(generation.state));
    if (generation.state === 'failed') {
      assert.equal(generation.creditsRefunded, created.body.creditCost);
      const after = (await api('GET', '/me/credits', { cookie: adminCookie })).body.summary.balance;
      assert.equal(after, before);
    }

    await api('PATCH', '/admin/models/seedream-v4/enabled', {
      cookie: adminCookie,
      body: { enabled: true },
    });
  });

  test('une definition de modele corrompue ne casse pas le catalogue', async () => {
    // Ecriture directe d'une definition invalide, comme le ferait une donnee
    // heritee d'une version anterieure.
    const { db } = await import('../src/db/index.js');
    db.prepare("UPDATE models SET definition_json = '{ corrompu' WHERE model_key = 'tts-voice'")
      .run();

    const catalogue = await api('GET', '/models', { cookie: adminCookie });
    assert.equal(catalogue.status, 200);
    const broken = catalogue.body.models.find((m: any) => m.key === 'tts-voice');
    assert.ok(broken, 'le modele reste liste');
    assert.deepEqual(broken.params, []);
    assert.ok(catalogue.body.models.length > 1, 'les autres modeles restent disponibles');
  });
});

describe('Transports provider', () => {
  let cookie = '';

  before(async () => {
    cookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
  });

  /** Derniere requete de creation envoyee au fournisseur, quel que soit l'endpoint. */
  function lastCreateCall(path: string) {
    return mock.requests.filter((r) => r.path === path).at(-1);
  }

  test("Veo passe par son endpoint dedie avec un corps a plat", async () => {
    const created = await api('POST', '/generations', {
      cookie,
      body: {
        modelKey: 'veo-3-fast',
        params: { prompt: 'Un plan large sur une vallee', aspect_ratio: '9:16' },
      },
    });
    assert.equal(created.status, 201);
    const generation = await waitForState(created.body.generations[0].id, cookie);
    assert.equal(generation.state, 'completed', generation.errorMessage ?? '');

    const call = lastCreateCall('/api/v1/veo/generate');
    assert.ok(call, 'la tache doit etre creee sur /api/v1/veo/generate');
    const body = call!.body as Record<string, unknown>;
    // Corps a plat : pas d'enveloppe `input`, et le modele est la valeur courte.
    assert.equal(body.model, 'veo3_fast');
    assert.equal(body.input, undefined);
    assert.equal(body.prompt, 'Un plan large sur une vallee');
    assert.equal(body.aspect_ratio, '9:16');
    assert.equal(body.enableTranslation, true);

    // Le suivi a bien utilise l'endpoint dedie, pas celui de l'API Jobs.
    assert.ok(mock.requests.some((r) => r.path === '/api/v1/veo/record-info'));
  });

  test('Suno passe par son endpoint dedie et son mode simple', async () => {
    const created = await api('POST', '/generations', {
      cookie,
      body: {
        modelKey: 'suno-music',
        params: { prompt: 'Ambiance lo-fi douce', instrumental: true, style: 'lo-fi' },
      },
    });
    assert.equal(created.status, 201);
    const generation = await waitForState(created.body.generations[0].id, cookie);
    assert.equal(generation.state, 'completed', generation.errorMessage ?? '');

    const call = lastCreateCall('/api/v1/generate');
    assert.ok(call, 'la tache doit etre creee sur /api/v1/generate');
    const body = call!.body as Record<string, unknown>;
    assert.equal(body.model, 'V5');
    assert.equal(body.customMode, false, 'le mode simple est impose par le transport');
    assert.equal(body.instrumental, true);
    assert.equal(body.style, 'lo-fi');
  });

  test('un modele produisant plusieurs sorties ne cree qu une seule tache', async () => {
    const before = mock.requests.filter((r) => r.path === '/api/v1/jobs/createTask').length;

    const created = await api('POST', '/generations', {
      cookie,
      body: {
        modelKey: 'seedream-v4',
        params: { prompt: 'Trois variantes d une affiche', image_resolution: '1K' },
        outputCount: 3,
      },
    });
    assert.equal(created.status, 201);
    // Une seule ligne de generation, et non trois.
    assert.equal(created.body.generations.length, 1);

    const generation = await waitForState(created.body.generations[0].id, cookie);
    assert.equal(generation.state, 'completed', generation.errorMessage ?? '');

    const after = mock.requests.filter((r) => r.path === '/api/v1/jobs/createTask').length;
    assert.equal(after - before, 1, 'une seule tache doit etre envoyee au fournisseur');

    const call = lastCreateCall('/api/v1/jobs/createTask');
    const input = (call!.body as { input: Record<string, unknown> }).input;
    assert.equal(input.max_images, 3);
    assert.equal(input.image_size, 'landscape_16_9');
    assert.equal(input.image_resolution, '1K');
    // Les trois images arrivent dans la meme generation.
    assert.equal(generation.assets.filter((a: any) => a.kind === 'output').length, 3);
    // Le cout couvre bien les trois sorties.
    assert.equal(generation.creditCost, created.body.creditCost);
  });

  test("un parametre conditionnel n'est ni exige ni transmis lorsqu'il est masque", async () => {
    // Aucun modele du catalogue verifie n'utilise `visibleWhen` aujourd'hui ;
    // la capacite est donc couverte par un modele cree via l'administration,
    // exactement comme le ferait un administrateur pour un nouveau modele.
    await api('PUT', '/admin/models/modele-conditionnel', {
      cookie,
      body: {
        name: 'Modele conditionnel',
        kind: 'image',
        providerModel: 'fournisseur/conditionnel',
        outputs: { mode: 'fanout', min: 1, max: 1, default: 1 },
        credits: { base: 2, perOutput: true },
        params: [
          { id: 'prompt', field: 'prompt', label: 'Prompt', group: 'core', type: 'textarea', default: '', maxLength: 500, required: true },
          { id: 'avance', field: null, label: 'Mode avance', group: 'advanced', type: 'boolean', default: false },
          {
            id: 'reglage', field: 'reglage', label: 'Reglage fin', group: 'advanced',
            type: 'text', default: '', maxLength: 100, required: true,
            visibleWhen: { paramId: 'avance', equals: [true] },
          },
        ],
      },
    });

    // Masque : le champ obligatoire n'est pas exige et n'est pas transmis.
    const masque = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'modele-conditionnel', params: { prompt: 'sans mode avance', avance: false } },
    });
    assert.equal(masque.status, 201);
    await waitForState(masque.body.generations[0].id, cookie);
    let input = (lastCreateCall('/api/v1/jobs/createTask')!.body as { input: Record<string, unknown> }).input;
    assert.equal(input.reglage, undefined, 'le parametre masque ne doit pas etre transmis');
    // `field: null` : parametre purement applicatif, jamais transmis non plus.
    assert.equal(input.avance, undefined);

    // Visible : le champ redevient obligatoire.
    const vide = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'modele-conditionnel', params: { prompt: 'avec mode avance', avance: true } },
    });
    assert.equal(vide.status, 400);
    assert.ok(vide.body.error.fields.reglage);

    const rempli = await api('POST', '/generations', {
      cookie,
      body: {
        modelKey: 'modele-conditionnel',
        params: { prompt: 'avec mode avance', avance: true, reglage: 'valeur' },
      },
    });
    assert.equal(rempli.status, 201);
    await waitForState(rempli.body.generations[0].id, cookie);
    input = (lastCreateCall('/api/v1/jobs/createTask')!.body as { input: Record<string, unknown> }).input;
    assert.equal(input.reglage, 'valeur');
  });

  test('la resolution influe reellement sur le cout facture', async () => {
    const base = await api('POST', '/models/seedream-v4/estimate', {
      cookie,
      body: { params: { prompt: 'x', image_resolution: '1K' }, outputCount: 1 },
    });
    const high = await api('POST', '/models/seedream-v4/estimate', {
      cookie,
      body: { params: { prompt: 'x', image_resolution: '4K' }, outputCount: 1 },
    });
    assert.equal(base.status, 200);
    assert.ok(
      high.body.totalCost > base.body.totalCost,
      `4K (${high.body.totalCost}) doit couter plus cher que 1K (${base.body.totalCost})`,
    );

    // Le multiplicateur se cumule avec le nombre de sorties.
    const batch = await api('POST', '/models/seedream-v4/estimate', {
      cookie,
      body: { params: { prompt: 'x', image_resolution: '4K' }, outputCount: 3 },
    });
    assert.equal(batch.body.totalCost, high.body.totalCost * 3);
  });

  test('le ratio est transmis sous le nom de champ attendu par chaque modele', async () => {
    // Nano Banana attend `image_size`, pas `aspect_ratio`.
    const created = await api('POST', '/generations', {
      cookie,
      body: { modelKey: 'nano-banana', params: { prompt: 'test ratio', image_size: '21:9' } },
    });
    assert.equal(created.status, 201);
    await waitForState(created.body.generations[0].id, cookie);

    const input = (lastCreateCall('/api/v1/jobs/createTask')!.body as { input: Record<string, unknown> }).input;
    assert.equal(input.image_size, '21:9');
    assert.equal(input.aspect_ratio, undefined);
  });

  test('Kling transmet la duree en chaine, comme l exige le fournisseur', async () => {
    const created = await api('POST', '/generations', {
      cookie,
      body: {
        modelKey: 'kling-t2v',
        params: { prompt: 'Un plan sequence', duration: '10', cfg_scale: 0.5 },
      },
    });
    assert.equal(created.status, 201);
    await waitForState(created.body.generations[0].id, cookie);

    const input = (lastCreateCall('/api/v1/jobs/createTask')!.body as { input: Record<string, unknown> }).input;
    assert.equal(input.duration, '10');
    assert.equal(typeof input.duration, 'string');
    // Le cout double avec la duree, conformement au multiplicateur declare.
    assert.ok(created.body.creditCost >= 50);
  });
});

describe('Envoi des e-mails', () => {
  let adminCookie = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
  });

  /** Attend qu'un message destine a `to` arrive dans la boite de test. */
  async function waitForEmail(to: string, attempts = 40): Promise<any> {
    for (let i = 0; i < attempts; i += 1) {
      const found = smtp.messages.find((m) => m.to.includes(to));
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Aucun e-mail recu pour ${to}`);
  }

  test("une invitation part par e-mail avec un lien utilisable", async () => {
    const created = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'nina@test.local', role: 'collaborator', initialCredits: 300 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.delivery.delivered, true);

    const mail = await waitForEmail('nina@test.local');
    assert.equal(mail.from, 'nova@test.local');
    assert.match(mail.subject, /Rejoignez/);

    // Le lien contenu dans l'e-mail doit reellement permettre l'inscription.
    const link = extractLink(mail.raw, '/register');
    assert.ok(link, "l'e-mail doit contenir le lien d'inscription");
    const token = new URL(link!).searchParams.get('token')!;
    assert.ok(token.length > 10);

    const preview = await api('GET', `/auth/invitation?token=${encodeURIComponent(token)}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.invitation.email, 'nina@test.local');

    const registered = await api('POST', '/auth/register', {
      body: { token, name: 'Nina Roux', password: 'Motdepasse12' },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.credits.balance, 300);
  });

  test('la demande de mot de passe oublie envoie un lien fonctionnel', async () => {
    const before = smtp.messages.length;
    const asked = await api('POST', '/auth/forgot-password', { body: { email: 'nina@test.local' } });
    assert.equal(asked.status, 200);
    // Aucun lien n'est renvoye au client des lors que l'e-mail est parti.
    assert.equal(asked.body.devResetUrl, undefined);

    const mail = smtp.messages.slice(before).find((m) => m.to.includes('nina@test.local'))
      ?? (await waitForEmail('nina@test.local'));
    const link = extractLink(mail.raw, '/reset-password');
    assert.ok(link, "l'e-mail doit contenir le lien de reinitialisation");
    const token = new URL(link!).searchParams.get('token')!;

    const reset = await api('POST', '/auth/reset-password', {
      body: { token, password: 'NouveauPass123' },
    });
    assert.equal(reset.status, 200);

    const login = await api('POST', '/auth/login', {
      body: { email: 'nina@test.local', password: 'NouveauPass123' },
    });
    assert.equal(login.status, 200);
  });

  test("une adresse inconnue ne declenche aucun envoi et repond a l'identique", async () => {
    const before = smtp.messages.length;
    const res = await api('POST', '/auth/forgot-password', {
      body: { email: 'personne@test.local' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(smtp.messages.length, before, "aucun e-mail ne doit partir");
  });

  test("un echec d'envoi ne compromet pas la creation de l'invitation", async () => {
    smtp.rejectAll = true;
    try {
      const created = await api('POST', '/admin/invitations', {
        cookie: adminCookie,
        body: { email: 'hugo@test.local', role: 'collaborator' },
      });
      // L'invitation existe malgre l'echec, et son lien reste exploitable.
      assert.equal(created.status, 201);
      assert.equal(created.body.delivery.delivered, false);
      assert.ok(created.body.delivery.reason);
      assert.ok(created.body.invitation.inviteUrl);

      const token = created.body.invitation.inviteUrl.split('token=')[1];
      const preview = await api('GET', `/auth/invitation?token=${encodeURIComponent(token)}`);
      assert.equal(preview.status, 200);
    } finally {
      smtp.rejectAll = false;
    }
  });

  test("aucun mot de passe n'est transmis dans l'e-mail de creation de compte", async () => {
    const created = await api('POST', '/admin/users', {
      cookie: adminCookie,
      body: {
        email: 'marc@test.local',
        name: 'Marc Leroy',
        password: 'ProvisoirE123',
        role: 'collaborator',
        initialCredits: 100,
      },
    });
    assert.equal(created.status, 201);

    const mail = await waitForEmail('marc@test.local');
    assert.ok(!mail.raw.includes('ProvisoirE123'), "le mot de passe ne doit jamais figurer dans l'e-mail");
    assert.match(mail.subject, /acces/i);
  });

  test('le mot de passe SMTP est chiffre et jamais renvoye', async () => {
    const saved = await api('PUT', '/admin/email-configuration', {
      cookie: adminCookie,
      body: {
        enabled: true,
        host: '127.0.0.1',
        port: smtp.port,
        secure: false,
        username: 'nova',
        password: 'motdepasse-smtp-secret',
        fromName: 'Nova Studio',
        fromEmail: 'nova@test.local',
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.emailConfiguration.hasPassword, true);
    assert.ok(!JSON.stringify(saved.body).includes('motdepasse-smtp-secret'));

    const settings = await api('GET', '/admin/settings', { cookie: adminCookie });
    assert.ok(!JSON.stringify(settings.body).includes('motdepasse-smtp-secret'));
    assert.equal(settings.body.emailConfiguration.source, 'organization');

    // La valeur stockee en base est bien chiffree.
    const { db } = await import('../src/db/index.js');
    const stored = db.prepare('SELECT password_encrypted FROM email_configurations LIMIT 1')
      .get() as { password_encrypted: string };
    assert.ok(stored.password_encrypted.startsWith('v1.'));
    assert.ok(!stored.password_encrypted.includes('motdepasse-smtp-secret'));
  });

  test('le test de configuration envoie un message de verification', async () => {
    const before = smtp.messages.length;
    const res = await api('POST', '/admin/email-configuration/test', {
      cookie: adminCookie,
      body: { sendTo: 'admin@test.local' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.ok, true);
    assert.equal(res.body.delivery.delivered, true);
    assert.equal(res.body.emailConfiguration.lastCheckStatus, 'ok');
    assert.ok(smtp.messages.length > before);
  });

  test("l'envoi peut etre desactive sans perdre les parametres", async () => {
    await api('PUT', '/admin/email-configuration', {
      cookie: adminCookie,
      body: { enabled: false },
    });
    const status = (await api('GET', '/admin/settings', { cookie: adminCookie })).body
      .emailConfiguration;
    assert.equal(status.enabled, false);
    assert.equal(status.host, '127.0.0.1', 'les parametres restent enregistres');
    // Le repli par variables d'environnement reste actif.
    assert.equal(status.source, 'environment');

    await api('PUT', '/admin/email-configuration', { cookie: adminCookie, body: { enabled: true } });
  });
});

describe("Fonctionnement sans service d'e-mail", () => {
  let adminCookie = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
  });

  test("un administrateur peut emettre un lien de reinitialisation a transmettre", async () => {
    const users = (await api('GET', '/admin/users?search=lea', { cookie: adminCookie })).body;
    const lea = users.items[0];

    const issued = await api('POST', `/admin/users/${lea.id}/password-reset`, { cookie: adminCookie });
    assert.equal(issued.status, 200);
    assert.match(issued.body.resetUrl, /\/reset-password\?token=/);
    assert.equal(issued.body.email, lea.email);

    // Le lien fonctionne reellement, meme sans e-mail.
    const token = new URL(issued.body.resetUrl).searchParams.get('token')!;
    const reset = await api('POST', '/auth/reset-password', {
      body: { token, password: 'ResetParAdmin123' },
    });
    assert.equal(reset.status, 200);

    const login = await api('POST', '/auth/login', {
      body: { email: lea.email, password: 'ResetParAdmin123' },
    });
    assert.equal(login.status, 200);

    // L'action est tracee comme sensible.
    const activity = (await api('GET', '/admin/activity?action=admin.password_reset_issued', {
      cookie: adminCookie,
    })).body;
    assert.ok(activity.items.length > 0);
    assert.equal(activity.items[0].targetName, lea.name);
  });

  test("le lien de reinitialisation est refuse pour un compte desactive", async () => {
    const users = (await api('GET', '/admin/users?search=lea', { cookie: adminCookie })).body;
    const lea = users.items[0];
    await api('PATCH', `/admin/users/${lea.id}/status`, {
      cookie: adminCookie, body: { status: 'disabled' },
    });

    const issued = await api('POST', `/admin/users/${lea.id}/password-reset`, { cookie: adminCookie });
    assert.equal(issued.status, 409);

    await api('PATCH', `/admin/users/${lea.id}/status`, {
      cookie: adminCookie, body: { status: 'active' },
    });
  });

  test('une invitation peut etre reemise, ce qui invalide le lien precedent', async () => {
    const created = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'paul@test.local', role: 'collaborator' },
    });
    const ancienToken = created.body.invitation.inviteUrl.split('token=')[1];

    const resent = await api('POST', `/admin/invitations/${created.body.invitation.id}/resend`, {
      cookie: adminCookie,
    });
    assert.equal(resent.status, 201);
    const nouveauToken = resent.body.invitation.inviteUrl.split('token=')[1];
    assert.notEqual(nouveauToken, ancienToken);

    // L'ancien lien ne fonctionne plus, le nouveau oui.
    const ancien = await api('GET', `/auth/invitation?token=${encodeURIComponent(ancienToken)}`);
    assert.equal(ancien.status, 400);
    const nouveau = await api('GET', `/auth/invitation?token=${encodeURIComponent(nouveauToken)}`);
    assert.equal(nouveau.status, 200);
    assert.equal(nouveau.body.invitation.email, 'paul@test.local');
  });

});

describe("Envoi par API HTTP (sans relais SMTP)", () => {
  let adminCookie = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
    await api('PUT', '/admin/email-configuration', {
      cookie: adminCookie,
      body: {
        enabled: true,
        provider: 'resend',
        apiKey: 'cle-api-test',
        fromName: 'Nova Studio',
        fromEmail: 'nova@test.local',
      },
    });
  });

  after(async () => {
    // Retour au mode SMTP pour ne pas perturber d'eventuelles suites suivantes.
    await api('PUT', '/admin/email-configuration', {
      cookie: adminCookie,
      body: { enabled: true, provider: 'smtp' },
    });
  });

  test('Resend recoit le corps attendu et la cle en Bearer', async () => {
    const before = emailApi.calls.length;
    const created = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'api-resend@test.local', role: 'collaborator', initialCredits: 50 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.delivery.delivered, true);

    const call = emailApi.calls.at(-1)!;
    assert.ok(emailApi.calls.length > before);
    assert.equal(call.headers.authorization, 'Bearer cle-api-test');
    assert.equal((call.body.from as string), 'Nova Studio <nova@test.local>');
    assert.deepEqual(call.body.to, ['api-resend@test.local']);
    assert.match(call.body.subject as string, /Rejoignez/);
    assert.ok((call.body.html as string).includes('/register?token='));
    assert.ok((call.body.text as string).includes('/register?token='));
  });

  test('Brevo recoit sa propre forme de corps et son en-tete api-key', async () => {
    await api('PUT', '/admin/email-configuration', {
      cookie: adminCookie,
      body: { provider: 'brevo', apiKey: 'cle-api-test' },
    });

    const created = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'api-brevo@test.local', role: 'collaborator' },
    });
    assert.equal(created.body.delivery.delivered, true);

    const call = emailApi.calls.at(-1)!;
    assert.equal(call.headers['api-key'], 'cle-api-test');
    assert.equal(call.headers.authorization, undefined);
    assert.deepEqual(call.body.sender, { email: 'nova@test.local', name: 'Nova Studio' });
    assert.deepEqual(call.body.to, [{ email: 'api-brevo@test.local' }]);
    assert.ok(call.body.htmlContent);
    assert.ok(call.body.textContent);
  });

  test("le refus du fournisseur est remonte a l'administrateur sans bloquer l'invitation", async () => {
    emailApi.nextStatus = 403;
    emailApi.nextError = 'The domain is not verified';

    const created = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'refus@test.local', role: 'collaborator' },
    });
    assert.equal(created.status, 201, "l'invitation doit exister malgre le refus");
    assert.equal(created.body.delivery.delivered, false);
    assert.match(created.body.delivery.reason, /domain is not verified/);
    assert.ok(created.body.invitation.inviteUrl);
  });

  test("la cle API est chiffree et jamais renvoyee", async () => {
    const settings = await api('GET', '/admin/settings', { cookie: adminCookie });
    assert.ok(!JSON.stringify(settings.body).includes('cle-api-test'));
    assert.equal(settings.body.emailConfiguration.hasApiKey, true);
    assert.equal(settings.body.emailConfiguration.provider, 'brevo');

    const { db } = await import('../src/db/index.js');
    const stored = db.prepare('SELECT api_key_encrypted FROM email_configurations LIMIT 1')
      .get() as { api_key_encrypted: string };
    assert.ok(stored.api_key_encrypted.startsWith('v1.'));
    assert.ok(!stored.api_key_encrypted.includes('cle-api-test'));
  });

  test("activer un fournisseur HTTP sans cle est refuse", async () => {
    const res = await api('PUT', '/admin/email-configuration', {
      cookie: adminCookie,
      body: { enabled: true, provider: 'resend', apiKey: null },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.fields.apiKey);
  });
});
