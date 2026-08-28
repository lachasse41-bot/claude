/**
 * Verification de la configuration des modeles.
 * ---------------------------------------------------------------------------
 * Affiche, pour chaque modele actif, la requete exacte qui sera envoyee a
 * KIE.ai. C'est le moyen le plus rapide de comparer la definition d'un modele
 * a sa page de documentation avant de laisser l'equipe l'utiliser.
 *
 *   npm run doctor                          apercu de tous les modeles (gratuit)
 *   npm run doctor -- nano-banana           apercu d'un seul modele
 *   npm run doctor -- --live nano-banana    test reel d'un modele
 *   npm run doctor -- --live --all          test reel de tous les modeles
 *
 * ATTENTION : `--live` soumet une vraie tache et consomme des credits chez le
 * fournisseur. Le test de tout le catalogue exige `--all` pour eviter une
 * depense involontaire.
 */
import { db } from '../db/index.js';
import { bootstrap } from '../db/bootstrap.js';
import { getApiConfigurationStatus } from '../services/apiConfig.js';
import { diagnoseModel } from '../services/diagnostics.js';
import { listModels } from '../services/models.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const confirmAll = args.includes('--all');
const wanted = args.filter((a) => !a.startsWith('--'));

const line = (char = '─') => char.repeat(74);
const out = (text = '') => process.stdout.write(`${text}\n`);

bootstrap();

const org = db.prepare('SELECT id, name FROM organizations ORDER BY created_at ASC LIMIT 1')
  .get() as { id: string; name: string } | undefined;
if (!org) {
  out("Aucune organisation initialisee. Demarrez l'API une premiere fois.");
  process.exit(1);
}
const admin = db.prepare("SELECT id FROM users WHERE organization_id = ? AND role = 'admin' LIMIT 1")
  .get(org.id) as { id: string } | undefined;

const config = getApiConfigurationStatus(org.id);
out();
out(line('═'));
out(`  Verification des modeles — ${org.name}`);
out(`  Cle KIE.ai : ${config.configured ? `configuree (••••${config.keyLast4 ?? '????'})` : 'ABSENTE'}`);
out(`  Mode       : ${live ? 'TEST REEL (consomme des credits fournisseur)' : 'apercu (aucun appel)'}`);
out(line('═'));

if (live && !config.configured) {
  out();
  out("  Impossible : aucune cle API n'est configuree.");
  out('  Renseignez KIE_API_KEY ou saisissez la cle dans Administration > Parametres.');
  process.exit(1);
}

const models = listModels(org.id).filter((m) => wanted.length === 0 || wanted.includes(m.key));
if (models.length === 0) {
  out();
  out(wanted.length ? `  Aucun modele actif nomme : ${wanted.join(', ')}` : '  Aucun modele actif.');
  process.exit(1);
}

// Garde-fou : un test reel sur tout le catalogue coute une tache par modele.
if (live && models.length > 1 && !confirmAll) {
  out();
  out(`  Un test reel soumettrait ${models.length} taches facturees par le fournisseur.`);
  out('  Ajoutez --all pour confirmer, ou nommez un modele :');
  out(`      npm run doctor -- --live ${models[0].key}`);
  process.exit(1);
}

let refused = 0;
let flagged = 0;

for (const model of models) {
  const diagnostic = await diagnoseModel({
    organizationId: org.id,
    modelKey: model.key,
    live,
    userId: admin?.id,
  });

  out();
  out(`▸ ${diagnostic.modelName}  (${diagnostic.modelKey})`);
  out(line());
  out(`  transport : ${diagnostic.transport}`);
  out(`  ${diagnostic.request.method} ${diagnostic.request.url}`);
  out('  corps de la requete :');
  for (const l of JSON.stringify(diagnostic.request.body, null, 2).split('\n')) out(`    ${l}`);

  if (diagnostic.unverifiedFields.length) {
    flagged += 1;
    out();
    out(`  ⚠ a confirmer dans la documentation : ${diagnostic.unverifiedFields.join(', ')}`);
    if (model.docsUrl) out(`    ${model.docsUrl}`);
  }

  if (diagnostic.live) {
    out();
    if (diagnostic.live.accepted) {
      out(`  ✓ ${diagnostic.live.message}`);
      if (diagnostic.live.state) out(`    etat initial : ${diagnostic.live.state}`);
    } else {
      refused += 1;
      out(`  ✗ ${diagnostic.live.message}`);
      if (diagnostic.live.hint) out(`    → ${diagnostic.live.hint}`);
    }
  }
}

out();
out(line('═'));
if (live) {
  out(`  ${models.length - refused}/${models.length} modele(s) accepte(s) par le fournisseur.`);
  if (refused) out(`  Corrigez les definitions en echec dans Administration > Modeles IA.`);
} else {
  out(`  ${models.length} modele(s) inspecte(s)${flagged ? `, ${flagged} avec des champs a confirmer` : ''}.`);
  out('  Relancez avec --live pour soumettre une tache reelle par modele.');
}
out(line('═'));
out();
process.exit(refused > 0 ? 1 : 0);
