import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import { Button, Field, InlineNotice, Input } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await api.post<{ ok: boolean; devResetUrl?: string }>('/auth/forgot-password', { email });
      setDevLink(response.devResetUrl ?? null);
      setSent(true);
    } catch {
      // Reponse volontairement identique : l'existence d'un compte n'est pas revelee.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Mot de passe oublie"
      subtitle="Nous vous envoyons un lien de reinitialisation."
      footer={<Link to="/connexion" className="text-[var(--accent-text)] hover:underline">Retour a la connexion</Link>}
    >
      {sent ? (
        <div className="space-y-4">
          <InlineNotice
            tone="success"
            title="Demande enregistree"
            icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />}
          >
            Si un compte existe pour cette adresse, un lien de reinitialisation valable une heure lui a ete envoye.
          </InlineNotice>
          {devLink ? (
            <InlineNotice tone="warning" title="Environnement de developpement">
              Aucun service d e-mail n est configure. Lien de reinitialisation :{' '}
              <a href={devLink} className="break-all text-[var(--accent-text)] underline">{devLink}</a>
            </InlineNotice>
          ) : null}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Adresse e-mail" htmlFor="email">
            <Input
              id="email" type="email" required autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)} placeholder="vous@entreprise.com"
            />
          </Field>
          <Button type="submit" full size="lg" loading={submitting}>Envoyer le lien</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setFields({ confirm: 'Les mots de passe ne correspondent pas.' });
      return;
    }
    setSubmitting(true);
    setError('');
    setFields({});
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/connexion'), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else {
        setError('Reinitialisation impossible.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Nouveau mot de passe"
      subtitle="Choisissez un mot de passe pour votre compte."
      footer={<Link to="/connexion" className="text-[var(--accent-text)] hover:underline">Retour a la connexion</Link>}
    >
      {done ? (
        <InlineNotice
          tone="success"
          title="Mot de passe mis a jour"
          icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />}
        >
          Toutes vos sessions ont ete deconnectees. Redirection vers la connexion...
        </InlineNotice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <InlineNotice tone="danger" title="Lien invalide">{error}</InlineNotice> : null}
          <Field
            label="Nouveau mot de passe"
            htmlFor="password"
            error={fields.password}
            hint="Au moins 10 caracteres, dont une lettre et un chiffre."
          >
            <Input
              id="password" type="password" required autoComplete="new-password" value={password}
              onChange={(event) => setPassword(event.target.value)} invalid={Boolean(fields.password)}
            />
          </Field>
          <Field label="Confirmer" htmlFor="confirm" error={fields.confirm}>
            <Input
              id="confirm" type="password" required autoComplete="new-password" value={confirm}
              onChange={(event) => setConfirm(event.target.value)} invalid={Boolean(fields.confirm)}
            />
          </Field>
          <Button type="submit" full size="lg" loading={submitting} disabled={!token}>
            Mettre a jour
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
