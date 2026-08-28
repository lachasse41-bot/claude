import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Serveur simulant l'API "Jobs" de KIE.ai pour les tests d'integration.
 * Il reproduit le contrat reel : createTask -> taskId, puis recordInfo qui
 * passe par les etats waiting -> generating -> success|fail.
 */
export interface MockKie {
  url: string;
  close: () => Promise<void>;
  tasks: Map<string, { polls: number; model: string; input: unknown }>;
  /** Force l'echec de la prochaine tache creee. */
  failNext: boolean;
  requests: Array<{ path: string; body: unknown }>;
}

export async function startMockKie(pollsBeforeSuccess = 1): Promise<MockKie> {
  const tasks = new Map<string, { polls: number; model: string; input: unknown }>();
  const state = { failNext: false } as { failNext: boolean };
  const requests: Array<{ path: string; body: unknown }> = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ path: url.pathname, body });
      res.setHeader('Content-Type', 'application/json');

      // Les URL de resultat sont des liens publics (CDN) : pas d'authentification.
      if (url.pathname.startsWith('/output/')) {
        res.setHeader('Content-Type', 'image/png');
        return res.end(PNG);
      }

      if (req.headers.authorization !== 'Bearer test-key') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: 401, msg: 'unauthorized' }));
      }

      if (url.pathname === '/api/v1/jobs/createTask') {
        const taskId = `task_${tasks.size + 1}_${state.failNext ? 'fail' : 'ok'}`;
        tasks.set(taskId, { polls: 0, model: body?.model, input: body?.input });
        state.failNext = false;
        return res.end(JSON.stringify({ code: 200, msg: 'success', data: { taskId } }));
      }

      if (url.pathname === '/api/v1/jobs/recordInfo') {
        const taskId = url.searchParams.get('taskId') ?? '';
        const task = tasks.get(taskId);
        if (!task) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ code: 404, msg: 'task not found' }));
        }
        task.polls += 1;
        if (task.polls <= pollsBeforeSuccess) {
          return res.end(JSON.stringify({ code: 200, data: { taskId, state: 'generating' } }));
        }
        if (taskId.endsWith('fail')) {
          return res.end(JSON.stringify({
            code: 200,
            data: { taskId, state: 'fail', failCode: '422', failMsg: 'prompt refuse par le modele' },
          }));
        }
        return res.end(JSON.stringify({
          code: 200,
          data: {
            taskId,
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${port}/output/${taskId}.png`] }),
          },
        }));
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ code: 404, msg: 'not found' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    tasks,
    requests,
    get failNext() { return state.failNext; },
    set failNext(value: boolean) { state.failNext = value; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  } as MockKie;
}

/** PNG 2x2 valide, utilise comme fichier de reference et comme sortie simulee. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z4AATAxQxjAWAgAeuAEBnFCTgwAAAABJRU5ErkJggg==',
  'base64',
);
