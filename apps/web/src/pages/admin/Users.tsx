import { useState } from 'react';
import {
  CheckCircle2, Coins, Copy, Mail, MoreHorizontal, Search, Trash2, UserPlus, Users,
} from 'lucide-react';
import type { Invitation, Role } from '@nova/shared';
import { ApiError, api, query } from '../../lib/api';
import { useQuery, useQueryClient } from '../../lib/queries';
import { useAuth } from '../../context/AuthContext';
import {
  Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field,
  InlineNotice, Input, Modal, PageHeader, SegmentedControl, Select, Skeleton, Switch, useToast,
} from '../../components/ui';
import { formatNumber, formatRelative } from '../../lib/format';

interface AdminUserRow {
  id: string; name: string; email: string; role: Role; status: string; avatarColor: string;
  balance: number; totalSpent: number; totalGranted: number; allowOverdraft: boolean;
  generations: number; lastGenerationAt: string | null; createdAt: string; lastLoginAt: string | null;
}

interface Footprint {
  generations: number; galleryItems: number; workflows: number; files: number;
  creditsSpent: number; balance: number;
}

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('created');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [creditTarget, setCreditTarget] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [detail, setDetail] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const users = useQuery({
    queryKey: ['admin-users', search, role, status, sort],
    queryFn: () =>
      api.get<{ items: AdminUserRow[]; total: number }>(
        `/admin/users${query({ search, role, status, sort, pageSize: 100 })}`,
      ),
  });

  const invitations = useQuery({
    queryKey: ['admin-invitations'],
    queryFn: () => api.get<{ invitations: Invitation[] }>('/admin/invitations').then((r) => r.invitations),
  });

  const footprint = useQuery({
    queryKey: ['admin-user-footprint', deleteTarget?.id],
    enabled: Boolean(deleteTarget),
    queryFn: () =>
      api.get<{ footprint: Footprint }>(`/admin/users/${deleteTarget!.id}`).then((r) => r.footprint),
  });

  function refreshAll() {
    void client.invalidateQueries({ queryKey: ['admin-users'] });
    void client.invalidateQueries({ queryKey: ['admin-invitations'] });
    void client.invalidateQueries({ queryKey: ['admin-overview'] });
  }

  async function toggleStatus(row: AdminUserRow) {
    const next = row.status === 'active' ? 'disabled' : 'active';
    try {
      await api.patch(`/admin/users/${row.id}/status`, { status: next });
      toast.success(next === 'active' ? 'Compte reactive' : 'Compte desactive',
        next === 'disabled' ? 'Les sessions en cours ont ete revoquees.' : undefined);
      refreshAll();
    } catch (err) {
      toast.error('Action impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function changeRole(row: AdminUserRow, nextRole: Role) {
    try {
      await api.patch(`/admin/users/${row.id}/role`, { role: nextRole });
      toast.success('Role mis a jour');
      refreshAll();
    } catch (err) {
      toast.error('Action impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function toggleOverdraft(row: AdminUserRow) {
    try {
      await api.patch(`/admin/users/${row.id}/overdraft`, { allow: !row.allowOverdraft });
      toast.success(row.allowOverdraft ? 'Decouvert desactive' : 'Decouvert autorise');
      refreshAll();
    } catch (err) {
      toast.error('Action impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function deleteUser() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/admin/users/${deleteTarget.id}`, { confirmEmail: deleteTarget.email });
      toast.success('Compte supprime', 'Toutes les donnees associees ont ete effacees.');
      setDeleteTarget(null);
      refreshAll();
    } catch (err) {
      toast.error('Suppression impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Collaborateurs"
        description="Comptes, statuts, activite et consommation de credits."
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
            Inviter
          </Button>
        }
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un nom ou un e-mail..."
              className="pl-9"
              aria-label="Rechercher un collaborateur"
            />
          </div>
          <SegmentedControl
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Tous' },
              { value: 'active', label: 'Actifs' },
              { value: 'disabled', label: 'Desactives' },
            ]}
          />
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-auto min-w-[150px]" aria-label="Filtrer par role">
            <option value="">Tous les roles</option>
            <option value="admin">Administrateurs</option>
            <option value="collaborator">Collaborateurs</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto min-w-[150px]" aria-label="Trier">
            <option value="created">Plus recents</option>
            <option value="name">Nom (A-Z)</option>
            <option value="credits">Credits consommes</option>
            <option value="activity">Derniere activite</option>
          </Select>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Comptes" description={users.data ? `${users.data.total} compte(s)` : undefined} icon={<Users className="size-4" />} />
        {users.error ? (
          <ErrorState onRetry={() => void users.refetch()} />
        ) : users.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : users.data && users.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-fg">
                  <th className="px-4 py-2.5 font-semibold">Collaborateur</th>
                  <th className="px-4 py-2.5 font-semibold">Statut</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Generations</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Consomme</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Solde</th>
                  <th className="px-4 py-2.5 font-semibold">Activite</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.name} color={row.avatarColor} size={30} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {row.name}
                            {row.id === me?.id ? <span className="ml-1.5 text-[11px] text-muted-fg">(vous)</span> : null}
                          </p>
                          <p className="truncate text-[11px] text-muted-fg">{row.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={row.status === 'active' ? 'success' : 'danger'}>
                          {row.status === 'active' ? 'Actif' : 'Desactive'}
                        </Badge>
                        {row.role === 'admin' ? <Badge tone="accent">Admin</Badge> : null}
                        {row.allowOverdraft ? <Badge tone="info">Decouvert</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.generations)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.totalSpent)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatNumber(row.balance)}</td>
                    <td className="px-4 py-3 text-secondary-fg">{formatRelative(row.lastGenerationAt ?? row.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" aria-label="Attribuer des credits" onClick={() => setCreditTarget(row)}>
                          <Coins className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label="Options" onClick={() => setDetail(row)}>
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Users className="size-5" />}
            title="Aucun collaborateur"
            description="Invitez un membre de votre equipe pour commencer."
            action={<Button icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>Inviter</Button>}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Invitations" description="Les comptes ne peuvent etre crees que sur invitation." icon={<Mail className="size-4" />} />
        {invitations.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-12" /></div>
        ) : invitations.data && invitations.data.length > 0 ? (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{invitation.email}</p>
                  <p className="text-[11px] text-muted-fg">
                    {invitation.role === 'admin' ? 'Administrateur' : 'Collaborateur'} —{' '}
                    {invitation.initialCredits} credits — creee {formatRelative(invitation.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    tone={
                      invitation.status === 'pending' ? 'info'
                        : invitation.status === 'accepted' ? 'success' : 'neutral'
                    }
                  >
                    {{ pending: 'En attente', accepted: 'Acceptee', revoked: 'Revoquee', expired: 'Expiree' }[invitation.status]}
                  </Badge>
                  {invitation.status === 'pending' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.delete(`/admin/invitations/${invitation.id}`);
                          toast.success('Invitation revoquee');
                          refreshAll();
                        } catch {
                          toast.error('Revocation impossible');
                        }
                      }}
                    >
                      Revoquer
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Aucune invitation" description="Les invitations envoyees apparaitront ici." />
        )}
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onCreated={refreshAll} />

      <CreditModal
        user={creditTarget}
        onClose={() => setCreditTarget(null)}
        onDone={() => { setCreditTarget(null); refreshAll(); }}
      />

      {/* Actions sur un compte */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ''}
        description={detail?.email}
        size="sm"
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Fermer</Button>}
      >
        {detail ? (
          <div className="space-y-4">
            <Switch
              checked={detail.status === 'active'}
              label="Compte actif"
              description="Un compte desactive ne peut plus se connecter ; ses donnees sont conservees."
              disabled={detail.id === me?.id}
              onChange={() => { void toggleStatus(detail); setDetail(null); }}
            />
            <Switch
              checked={detail.allowOverdraft}
              label="Autoriser le decouvert de credits"
              description="Regle d'exception : permet de lancer une generation malgre un solde insuffisant."
              onChange={() => { void toggleOverdraft(detail); setDetail(null); }}
            />
            <Field label="Role" hint="Un administrateur accede a la supervision et aux parametres.">
              <Select
                value={detail.role}
                disabled={detail.id === me?.id}
                onChange={(event) => { void changeRole(detail, event.target.value as Role); setDetail(null); }}
              >
                <option value="collaborator">Collaborateur</option>
                <option value="admin">Administrateur</option>
              </Select>
            </Field>
            <div className="border-t border-[var(--border-subtle)] pt-4">
              <Button
                variant="danger"
                full
                icon={<Trash2 className="size-4" />}
                disabled={detail.id === me?.id}
                onClick={() => { setDeleteTarget(detail); setDetail(null); }}
              >
                Supprimer definitivement le compte
              </Button>
              {detail.id === me?.id ? (
                <p className="mt-2 text-center text-[12px] text-muted-fg">
                  Vous ne pouvez pas supprimer votre propre compte.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteUser}
        loading={busy}
        title="Supprimer definitivement le compte"
        description={deleteTarget ? `${deleteTarget.name} — ${deleteTarget.email}` : undefined}
        confirmLabel="Supprimer definitivement"
        confirmWord={deleteTarget?.email}
        consequences={
          footprint.data
            ? [
                `${footprint.data.generations} generation(s) et leurs resultats seront effaces.`,
                `${footprint.data.galleryItems} element(s) de galerie seront supprimes.`,
                `${footprint.data.workflows} workflow(s) seront supprimes.`,
                `${footprint.data.files} fichier(s) televerse(s) seront effaces du stockage.`,
                `Le solde restant de ${footprint.data.balance} credits sera perdu.`,
                "L'historique des actions du compte est conserve dans le journal.",
              ]
            : ['Chargement du detail des donnees associees...']
        }
      />
    </>
  );
}

/**
 * Deux facons d'ouvrir un acces :
 *  - « Inviter » : le collaborateur choisit lui-meme son mot de passe (par defaut) ;
 *  - « Creer le compte » : l'administrateur definit un mot de passe provisoire,
 *    utile lorsque le lien d'invitation ne peut pas etre transmis.
 */
function InviteModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'invite' | 'direct'>('invite');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('collaborator');
  const [credits, setCredits] = useState(500);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  /** Resultat de l'envoi automatique, pour adapter le message affiche. */
  const [delivery, setDelivery] = useState<{ delivered: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setFields({});
    try {
      if (mode === 'direct') {
        const response = await api.post<{ delivery: { delivered: boolean } }>('/admin/users', {
          email, name, password, role, initialCredits: credits,
        });
        toast.success(
          'Compte cree',
          response.delivery?.delivered
            ? `${name} a recu un e-mail de bienvenue. Communiquez-lui son mot de passe provisoire par un autre canal.`
            : `${name} peut se connecter. Communiquez-lui son mot de passe provisoire.`,
        );
        onCreated();
        close();
        return;
      }
      const response = await api.post<{
        invitation: Invitation;
        delivery: { delivered: boolean; reason: string | null };
      }>('/admin/invitations', { email, role, initialCredits: credits });
      setInviteUrl(response.invitation.inviteUrl ?? null);
      setDelivery(response.delivery ?? null);
      toast.success(
        response.delivery?.delivered ? 'Invitation envoyee' : 'Invitation creee',
        response.delivery?.delivered ? `Un e-mail est parti vers ${email}.` : undefined,
      );
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        toast.error(err.title, err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setEmail(''); setName(''); setPassword(''); setInviteUrl(null); setDelivery(null);
    setFields({}); setCredits(500); setMode('invite');
    onClose();
  }

  const canSubmit =
    email.trim().length > 0 &&
    (mode === 'invite' || (name.trim().length > 1 && password.length >= 10));

  return (
    <Modal
      open={open}
      onClose={close}
      title="Ajouter un collaborateur"
      description={
        mode === 'invite'
          ? "Le compte ne pourra etre cree qu'avec ce lien d'invitation."
          : 'Le compte est cree immediatement avec un mot de passe provisoire.'
      }
      footer={
        inviteUrl ? (
          <Button onClick={close}>Termine</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Annuler</Button>
            <Button loading={busy} disabled={!canSubmit} onClick={submit}>
              {mode === 'invite' ? "Creer l'invitation" : 'Creer le compte'}
            </Button>
          </>
        )
      }
    >
      {inviteUrl ? (
        <div className="space-y-4">
          {delivery?.delivered ? (
            <InlineNotice
              tone="success"
              title="Invitation envoyee par e-mail"
              icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />}
            >
              Le collaborateur a recu le lien de creation de compte. Il est valable
              14 jours et ne pourra etre utilise qu une seule fois. Le lien ci-dessous
              reste disponible si l e-mail n arrive pas.
            </InlineNotice>
          ) : (
            <InlineNotice tone="warning" title="A transmettre manuellement">
              {delivery?.reason ?? "L'envoi d'e-mails n'est pas configure."} Transmettez
              ce lien au collaborateur : il est valable 14 jours et ne pourra etre
              utilise qu une seule fois.
            </InlineNotice>
          )}
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              icon={<Copy className="size-4" />}
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl);
                toast.success('Lien copie');
              }}
            >
              Copier
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <SegmentedControl
            value={mode}
            onChange={(value) => { setMode(value as 'invite' | 'direct'); setFields({}); }}
            options={[
              { value: 'invite', label: 'Inviter par lien' },
              { value: 'direct', label: 'Creer le compte' },
            ]}
          />

          <Field label="Adresse e-mail" required error={fields.email} htmlFor="invite-email">
            <Input
              id="invite-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="collaborateur@entreprise.com"
            />
          </Field>
          {mode === 'direct' ? (
            <>
              <Field label="Nom complet" required error={fields.name} htmlFor="invite-name">
                <Input
                  id="invite-name" value={name}
                  onChange={(e) => setName(e.target.value)} placeholder="Prenom Nom"
                />
              </Field>
              <Field
                label="Mot de passe provisoire"
                required
                error={fields.password}
                hint="Au moins 10 caracteres dont une lettre et un chiffre. Le collaborateur pourra le changer depuis son profil."
                htmlFor="invite-password"
              >
                <Input
                  id="invite-password" type="text" value={password} autoComplete="off"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          <Field label="Role" hint="Un administrateur peut superviser toute l'organisation.">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="collaborator">Collaborateur</option>
              <option value="admin">Administrateur</option>
            </Select>
          </Field>
          <Field label="Credits initiaux" error={fields.initialCredits} htmlFor="invite-credits">
            <Input
              id="invite-credits" type="number" min={0} value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function CreditModal({
  user, onClose, onDone,
}: { user: AdminUserRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(500);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!user) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${user.id}/credits`, { amount, type: 'grant', reason });
      toast.success(`${amount} credits attribues`, `Nouveau solde pour ${user.name}.`);
      setAmount(500); setReason('');
      onDone();
    } catch (err) {
      toast.error('Attribution impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title="Attribuer des credits"
      description={user ? `${user.name} — solde actuel : ${formatNumber(user.balance)}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={busy} disabled={amount < 1} onClick={submit}>Attribuer</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Montant" htmlFor="credit-amount">
          <Input id="credit-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Field label="Motif" hint="Visible dans l'historique des credits du collaborateur." htmlFor="credit-reason">
          <Input
            id="credit-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Dotation mensuelle"
          />
        </Field>
      </div>
    </Modal>
  );
}
