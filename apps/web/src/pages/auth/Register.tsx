import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Badge, Button, Field, InlineNotice, Input, Skeleton } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

interface InvitationPreview {
  email: string;
  role: string;
  organizationName: string;
  expiresAt: string;
}

/**
 * Creation de compte : uniquement sur invitation.
 * Le jeton est verifie par l'API avant l'affichage du formulaire, puis
 * revalide au moment de la creation.
 */
export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError("Cette page requiert un lien d'invitation valide.");
      setLoading(false);
      return;
    }
    api
      .get<{ invitation: InvitationPreview }>(`/auth/invitation?token=${encodeURIComponent(token)}`)
      .then((response) => setInvitation(response.invitation))
      .catch((err) => setTokenError(err instanceof ApiError ? err.message : 'Invitation invalide.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (user) return <Navigate to="/" replace />;

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
      await register({ token, name, password });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else {
        setError('Creation du compte impossible.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthLayout title="Verification de l'invitation">
        <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      </AuthLayout>
    );
  }

  if (tokenError || !invitation) {
    return (
      <AuthLayout
        title="Invitation invalide"
        subtitle="Ce lien ne permet pas de creer un compte."
        footer={<Link to="/connexion" className="text-[var(--accent-text)] hover:underline">Retour a la connexion</Link>}
      >
        <InlineNotice tone="danger" title="Lien inutilisable">
          {tokenError || "L'invitation a expire ou a deja ete utilisee. Demandez-en une nouvelle a votre administrateur."}
        </InlineNotice>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Creer votre compte"
      subtitle={`Vous rejoignez ${invitation.organizationName}.`}
      footer={<Link to="/connexion" className="text-[var(--accent-text)] hover:underline">J'ai deja un compte</Link>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <InlineNotice tone="danger" title="Inscription refusee">{error}</InlineNotice> : null}

        <div className="flex items-center justify-between rounded-[10px] bg-[var(--surface-base)] px-3 py-2.5">
          <span className="truncate text-[13px]">{invitation.email}</span>
          <Badge tone="accent">{invitation.role === 'admin' ? 'Administrateur' : 'Collaborateur'}</Badge>
        </div>

        <Field label="Nom complet" htmlFor="name" error={fields.name}>
          <Input
            id="name" required autoComplete="name" value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Prenom Nom" invalid={Boolean(fields.name)}
          />
        </Field>

        <Field
          label="Mot de passe"
          htmlFor="password"
          error={fields.password}
          hint="Au moins 10 caracteres, dont une lettre et un chiffre."
        >
          <Input
            id="password" type="password" required autoComplete="new-password" value={password}
            onChange={(event) => setPassword(event.target.value)} invalid={Boolean(fields.password)}
          />
        </Field>

        <Field label="Confirmer le mot de passe" htmlFor="confirm" error={fields.confirm}>
          <Input
            id="confirm" type="password" required autoComplete="new-password" value={confirm}
            onChange={(event) => setConfirm(event.target.value)} invalid={Boolean(fields.confirm)}
          />
        </Field>

        <Button type="submit" full size="lg" loading={submitting}>Creer mon compte</Button>
      </form>
    </AuthLayout>
  );
}
