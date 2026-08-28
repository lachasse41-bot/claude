/**
 * Jeu de donnees de demonstration.
 * ---------------------------------------------------------------------------
 * Cree quelques collaborateurs avec des dotations de credits differentes afin
 * de pouvoir evaluer l'espace d'administration sans attendre des semaines
 * d'usage reel. N'appelle jamais le fournisseur de modeles : aucune generation
 * fictive n'est inventee, seules des donnees de comptes sont creees.
 *
 * Usage : npm run seed
 */
import { db } from './index.js';
import { bootstrap } from './bootstrap.js';
import { logger } from '../lib/logger.js';
import { createInvitation } from '../services/auth.js';
import { createUser, findUserByEmail } from '../services/users.js';

const DEMO_USERS = [
  { email: 'lea.martin@exemple.local', name: 'Lea Martin', credits: 1200 },
  { email: 'tom.dubois@exemple.local', name: 'Tom Dubois', credits: 800 },
  { email: 'nina.roux@exemple.local', name: 'Nina Roux', credits: 400 },
];

const DEMO_PASSWORD = 'Demo12345678';

bootstrap();

const org = db.prepare('SELECT id, name FROM organizations ORDER BY created_at ASC LIMIT 1').get() as {
  id: string;
  name: string;
};
const admin = db.prepare("SELECT id FROM users WHERE organization_id = ? AND role = 'admin' ORDER BY created_at ASC LIMIT 1")
  .get(org.id) as { id: string } | undefined;

let created = 0;
for (const demo of DEMO_USERS) {
  if (findUserByEmail(org.id, demo.email)) continue;
  createUser({
    organizationId: org.id,
    email: demo.email,
    name: demo.name,
    password: DEMO_PASSWORD,
    role: 'collaborator',
    initialCredits: demo.credits,
    actorUserId: admin?.id ?? null,
  });
  created += 1;
}

// Une invitation en attente, pour visualiser le parcours d'inscription.
let inviteUrl: string | undefined;
if (admin) {
  try {
    const invitation = createInvitation({
      organizationId: org.id,
      email: 'nouveau.collaborateur@exemple.local',
      role: 'collaborator',
      createdBy: admin.id,
    });
    inviteUrl = invitation.inviteUrl;
  } catch {
    // Une invitation en attente existe deja pour cette adresse.
  }
}

logger.info('Jeu de donnees de demonstration applique', { organization: org.name, created });

process.stdout.write(
  [
    '',
    '='.repeat(72),
    `  ${created} collaborateur(s) de demonstration cree(s) dans "${org.name}"`,
    ...DEMO_USERS.map((u) => `    ${u.email.padEnd(34)} ${u.credits} credits`),
    `  Mot de passe commun : ${DEMO_PASSWORD}`,
    ...(inviteUrl ? ['', `  Invitation en attente : ${inviteUrl}`] : []),
    '='.repeat(72),
    '',
  ].join('\n'),
);
