import { useState, type FormEvent } from 'react';
import { KeyRound, Monitor, ShieldCheck, User } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../lib/queries';
import {
  Avatar, Badge, Button, Card, CardHeader, Field, InlineNotice, Input, PageHeader,
  Skeleton, useToast,
} from '../components/ui';
import { formatDateTime, formatRelative } from '../lib/format';

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#0ea5e9', '#22c55e', '#eab308'];

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [color, setColor] = useState(user?.avatarColor ?? AVATAR_COLORS[0]);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordFields, setPasswordFields] = useState<Record<string, string>>({});
  const [savingPassword, setSavingPassword] = useState(false);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ sessions: any[] }>('/me/sessions').then((r) => r.sessions),
  });

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch('/me', { name, avatarColor: color });
      await refresh();
      toast.success('Profil mis a jour');
    } catch (err) {
      toast.error('Mise a jour impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setPasswordFields({ confirm: 'Les mots de passe ne correspondent pas.' });
      return;
    }
    setSavingPassword(true);
    setPasswordFields({});
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Mot de passe modifie', 'Vos autres sessions ont ete deconnectees.');
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
      void sessions.refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordFields(err.fields);
        toast.error(err.title, err.message);
      }
    } finally {
      setSavingPassword(false);
    }
  }

  async function revoke(sessionId: string) {
    try {
      await api.delete(`/me/sessions/${sessionId}`);
      toast.success('Session revoquee');
      void sessions.refetch();
    } catch {
      toast.error('Revocation impossible');
    }
  }

  if (!user) return null;

  return (
    <>
      <PageHeader title="Profil et parametres" description="Vos informations personnelles et la securite de votre compte." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Informations" icon={<User className="size-4" />} />
          <form onSubmit={saveProfile} className="space-y-4 p-5">
            <div className="flex items-center gap-4">
              <Avatar name={name || user.name} color={color} size={56} />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">{user.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone="accent">{user.role === 'admin' ? 'Administrateur' : 'Collaborateur'}</Badge>
                  <Badge>{user.organizationName}</Badge>
                </div>
              </div>
            </div>

            <Field label="Nom complet" htmlFor="profile-name">
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>

            <Field label="Couleur d'avatar">
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Couleur ${value}`}
                    onClick={() => setColor(value)}
                    className="size-8 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: value,
                      outline: color === value ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </Field>

            <Button type="submit" loading={savingProfile}>Enregistrer</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Mot de passe" icon={<KeyRound className="size-4" />} />
          <form onSubmit={savePassword} className="space-y-4 p-5">
            <InlineNotice tone="info">
              Changer votre mot de passe deconnecte toutes vos autres sessions.
            </InlineNotice>
            <Field label="Mot de passe actuel" htmlFor="current" error={passwordFields.currentPassword}>
              <Input
                id="current" type="password" autoComplete="current-password" required
                value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field
              label="Nouveau mot de passe"
              htmlFor="new"
              error={passwordFields.newPassword}
              hint="Au moins 10 caracteres, dont une lettre et un chiffre."
            >
              <Input
                id="new" type="password" autoComplete="new-password" required
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field label="Confirmer" htmlFor="confirm-pwd" error={passwordFields.confirm}>
              <Input
                id="confirm-pwd" type="password" autoComplete="new-password" required
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={savingPassword}>Modifier le mot de passe</Button>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Sessions actives"
            description="Appareils actuellement connectes a votre compte."
            icon={<ShieldCheck className="size-4" />}
          />
          {sessions.isLoading ? (
            <div className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {(sessions.data ?? []).map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Monitor className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-[13px]">
                        {session.userAgent?.slice(0, 60) || 'Appareil inconnu'}
                        {session.current ? <Badge tone="success" className="ml-2">Session actuelle</Badge> : null}
                      </p>
                      <p className="text-[11px] text-muted-fg">
                        {session.ip || 'IP inconnue'} — vue {formatRelative(session.lastSeenAt)} — expire le{' '}
                        {formatDateTime(session.expiresAt)}
                      </p>
                    </div>
                  </div>
                  {!session.current ? (
                    <Button size="sm" variant="ghost" onClick={() => revoke(session.id)}>Revoquer</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
