import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Field, InlineNotice, Input } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setFields({});
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else {
        setError('Connexion impossible. Verifiez votre reseau.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Connexion"
      subtitle="Accedez a votre espace de travail."
      footer={<>Un probleme d acces ? Contactez l administrateur de votre organisation.</>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <InlineNotice tone="danger" title="Connexion refusee">{error}</InlineNotice> : null}

        <Field label="Adresse e-mail" htmlFor="email" error={fields.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="vous@entreprise.com"
            invalid={Boolean(fields.email)}
          />
        </Field>

        <Field label="Mot de passe" htmlFor="password" error={fields.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(fields.password)}
          />
        </Field>

        <div className="flex justify-end">
          <Link to="/mot-de-passe-oublie" className="text-[13px] text-[var(--accent-text)] hover:underline">
            Mot de passe oublie ?
          </Link>
        </div>

        <Button type="submit" full size="lg" loading={submitting}>Se connecter</Button>
      </form>
    </AuthLayout>
  );
}
