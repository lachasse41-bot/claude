import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Simule l'API HTTP d'un fournisseur d'e-mail (Resend / Brevo).
 * Permet de verifier la forme exacte du corps envoye et l'en-tete
 * d'authentification, sans appeler de service reel.
 */
export interface ApiCall {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export interface MockEmailApi {
  url: string;
  calls: ApiCall[];
  /** Code HTTP renvoye a l'appel suivant (test du chemin d'erreur). */
  nextStatus: number;
  nextError: string;
  close: () => Promise<void>;
}

export async function startMockEmailApi(expectedKey = 'cle-api-test'): Promise<MockEmailApi> {
  const calls: ApiCall[] = [];
  const state = { nextStatus: 0, nextError: '' };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ headers: req.headers, body });

      if (state.nextStatus) {
        const status = state.nextStatus;
        const message = state.nextError;
        state.nextStatus = 0;
        state.nextError = '';
        res.statusCode = status;
        return res.end(JSON.stringify({ message }));
      }

      // Les deux fournisseurs authentifient differemment.
      const bearer = req.headers.authorization === `Bearer ${expectedKey}`;
      const apiKeyHeader = req.headers['api-key'] === expectedKey;
      if (!bearer && !apiKeyHeader) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ message: 'API key is invalid' }));
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ id: `msg_${calls.length}`, messageId: `<${calls.length}@test>` }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/emails`,
    calls,
    get nextStatus() { return state.nextStatus; },
    set nextStatus(value: number) { state.nextStatus = value; },
    get nextError() { return state.nextError; },
    set nextError(value: string) { state.nextError = value; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  } as MockEmailApi;
}
