import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Scenario complet SANS aucun service d'e-mail.
 * ---------------------------------------------------------------------------
 * Ce fichier tourne dans son propre processus, avec un environnement
 * volontairement depourvu de configuration SMTP : c'est la seule facon de
 * verifier le comportement de repli, la configuration etant lue une fois au
 * chargement des modules.
 *
 * Objectif : prouver qu'une organisation sans messagerie peut tout de meme
 * inviter des collaborateurs et reinitialiser un mot de passe.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-nomail-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.DATABASE_PATH = path.join(tmp, 'data', 'test.sqlite');
process.env.APP_SECRET = 'secret-de-test-suffisamment-long-pour-passer-la-validation';
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@test.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'AdminTest123';
process.env.WORKER_ENABLED = 'false';
// Aucune configuration d'envoi, sous aucune forme.
process.env.SMTP_HOST = '';
process.env.MAIL_FROM_EMAIL = '';

let server: Server;
let baseUrl: string;

async function api(
  method: string,
  route: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: any; cookie: string | null }> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
  const { createApp } = await import('../src/app.js');
  const { bootstrap } = await import('../src/db/bootstrap.js');
  bootstrap();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Organisation sans service d e-mail', () => {
  let adminCookie = '';

  before(async () => {
    adminCookie = (await api('POST', '/auth/login', {
      body: { email: 'admin@test.local', password: 'AdminTest123' },
    })).cookie!;
  });

  test("la configuration signale clairement l'absence de service", async () => {
    const settings = await api('GET', '/admin/settings', { cookie: adminCookie });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.emailConfiguration.configured, false);
    assert.equal(settings.body.emailConfiguration.source, 'none');
  });

  test("une invitation reste creee, avec son lien et la raison de non-envoi", async () => {
    const created = await api('POST', '/admin/invitations', {
      cookie: adminCookie,
      body: { email: 'zoe@test.local', role: 'collaborator', initialCredits: 250 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.delivery.delivered, false);
    assert.match(created.body.delivery.reason, /pas configure/);

    const inviteUrl: string = created.body.invitation.inviteUrl;
    assert.match(inviteUrl, /\/register\?token=/);

    // Le parcours complet fonctionne avec le lien transmis a la main.
    const token = new URL(inviteUrl).searchParams.get('token')!;
    const registered = await api('POST', '/auth/register', {
      body: { token, name: 'Zoe Bernard', password: 'Motdepasse12' },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.credits.balance, 250);
  });

  test("un administrateur peut delivrer un lien de reinitialisation", async () => {
    const users = (await api('GET', '/admin/users?search=zoe', { cookie: adminCookie })).body;
    const zoe = users.items[0];
    assert.ok(zoe, 'le collaborateur doit exister');

    const issued = await api('POST', `/admin/users/${zoe.id}/password-reset`, { cookie: adminCookie });
    assert.equal(issued.status, 200);
    assert.equal(issued.body.delivery.delivered, false);
    assert.match(issued.body.resetUrl, /\/reset-password\?token=/);

    const token = new URL(issued.body.resetUrl).searchParams.get('token')!;
    const reset = await api('POST', '/auth/reset-password', {
      body: { token, password: 'NouveauMotDePasse1' },
    });
    assert.equal(reset.status, 200);

    const login = await api('POST', '/auth/login', {
      body: { email: 'zoe@test.local', password: 'NouveauMotDePasse1' },
    });
    assert.equal(login.status, 200);
  });

  test("le lien d'un collaborateur ne peut etre delivre que par un administrateur", async () => {
    const collaborateur = (await api('POST', '/auth/login', {
      body: { email: 'zoe@test.local', password: 'NouveauMotDePasse1' },
    })).cookie!;
    const users = (await api('GET', '/admin/users?search=zoe', { cookie: adminCookie })).body;

    const refused = await api('POST', `/admin/users/${users.items[0].id}/password-reset`, {
      cookie: collaborateur,
    });
    assert.equal(refused.status, 403);
  });

  test("la demande de mot de passe oublie reste possible via le journal du serveur", async () => {
    const res = await api('POST', '/auth/forgot-password', { body: { email: 'zoe@test.local' } });
    assert.equal(res.status, 200);
    // Hors production et sans service d'e-mail, le lien est renvoye pour
    // permettre de derouler le parcours. En production il n'apparait que dans
    // le journal serveur.
    assert.match(res.body.devResetUrl, /\/reset-password\?token=/);
  });
});
