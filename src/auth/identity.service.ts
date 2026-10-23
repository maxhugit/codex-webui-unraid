import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq, and, isNull, lte } from 'drizzle-orm';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { currentAccess } from './access-context';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import {
  people,
  projects,
  projectWorkspaces,
  projectResources,
  settings,
  projectParticipants,
  projectAgentThreads,
  simpleChatThreads,
  conversationOwners,
  conversationBranchEdges,
  documentAccessSessions,
} from '../database/schema';

export interface PlatformIdentity {
  kind: 'person' | 'service' | 'unlinked';
  personId: string | null;
  name: string | null;
  role: 'standard' | 'administrator' | null;
  active: boolean;
  subject?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  theme?: string;
  language?: string;
}
export type IdentityHeaders = Record<string, string | string[] | undefined>;

@Injectable()
export class IdentityService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  /** Call only after bearer authentication. The ingress overwrites every identity header. */
  resolve(headers: IdentityHeaders): PlatformIdentity {
    if (headers['x-webui-auth-source'] !== 'authentik') {
      if (
        (headers['x-webui-auth-source'] !== undefined &&
          headers['x-webui-auth-source'] !== 'service') ||
        (process.env.WEBUI_REQUIRE_IDENTITY === 'true' &&
          headers['x-webui-auth-source'] !== 'service')
      )
        return {
          kind: 'unlinked',
          personId: null,
          name: null,
          role: null,
          active: false,
        };
      return {
        kind: 'service',
        personId: null,
        name: 'Deployment service',
        role: 'administrator',
        active: true,
      };
    }
    const subject = headers['x-webui-auth-subject'];
    const rawEmail = headers['x-webui-auth-email'];
    const email =
      typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 512)
      return {
        kind: 'unlinked',
        personId: null,
        name: null,
        role: null,
        active: false,
      };
    return this.resolveTrustedSubject(subject, email, true);
  }

  /** Resolve verified OIDC claims without trusting browser-provided headers. */
  resolveOidc(
    subject: string,
    email: string,
    emailVerified: boolean,
  ): PlatformIdentity {
    return this.resolveTrustedSubject(
      subject,
      email.trim().toLowerCase(),
      emailVerified,
    );
  }

  private resolveTrustedSubject(
    subject: string,
    email: string,
    emailVerified: boolean,
  ): PlatformIdentity {
    return this.db.transaction(() => {
      let person = this.db
        .select()
        .from(people)
        .where(eq(people.identitySubject, subject))
        .get();
      if (!person && email && emailVerified) {
        // No account creation or administrator promotion on first login. Only a
        // pre-provisioned active record can bind, once, by the verified email.
        const candidate = this.db
          .select()
          .from(people)
          .where(and(eq(people.email, email), isNull(people.identitySubject)))
          .get();
        // An administrator must be explicitly bound by a deployment operator:
        // an email assertion alone must never be enough to claim admin access.
        if (candidate?.active && candidate.role === 'standard') {
          this.db
            .update(people)
            .set({ identitySubject: subject, updatedAt: Date.now() })
            .where(eq(people.id, candidate.id))
            .run();
          person = { ...candidate, identitySubject: subject };
        }
      }
      if (!person)
        return {
          kind: 'unlinked' as const,
          personId: null,
          name: null,
          role: null,
          active: false,
          subject,
          email,
        };
      return {
        kind: 'person' as const,
        personId: person.id,
        name: person.name,
        role: person.role,
        active: person.active,
        subject,
        email,
        firstName: person.firstName,
        lastName: person.lastName,
        theme: person.theme,
        language: person.language,
      };
    });
  }

  /** Resolves a server-authenticated local session to its person profile. */
  resolvePerson(personId: string): PlatformIdentity {
    const person = this.db
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .get();
    if (!person)
      return {
        kind: 'unlinked',
        personId: null,
        name: null,
        role: null,
        active: false,
      };
    return {
      kind: 'person',
      personId: person.id,
      name: person.name,
      role: person.role,
      active: person.active,
      email: person.email ?? undefined,
      firstName: person.firstName,
      lastName: person.lastName,
      theme: person.theme,
      language: person.language,
    };
  }

  updatePreferences(
    identity: PlatformIdentity,
    input: { theme?: unknown; language?: unknown },
  ) {
    this.requireActive(identity);
    if (!identity.personId)
      throw new ForbiddenException('A person profile is required');
    const themes = new Set([
      'light',
      'dark',
      'sepia',
      'nord',
      'solarized',
      'dracula',
      'high-contrast',
    ]);
    if (
      input.theme !== undefined &&
      (typeof input.theme !== 'string' || !themes.has(input.theme))
    )
      throw new BadRequestException('Unsupported theme');
    if (
      input.language !== undefined &&
      (typeof input.language !== 'string' ||
        !/^[a-z]{2,3}$/.test(input.language))
    )
      throw new BadRequestException('Unsupported language');
    const updates = {
      ...(typeof input.theme === 'string' ? { theme: input.theme } : {}),
      ...(typeof input.language === 'string'
        ? { language: input.language }
        : {}),
      updatedAt: Date.now(),
    };
    this.db
      .update(people)
      .set(updates)
      .where(eq(people.id, identity.personId))
      .run();
    const person = this.db
      .select()
      .from(people)
      .where(eq(people.id, identity.personId))
      .get();
    return { theme: person!.theme, language: person!.language };
  }

  requireActive(identity: PlatformIdentity) {
    if (!identity.active || !identity.role)
      throw new ForbiddenException(
        'Your login is not linked to an active person. Contact an administrator.',
      );
  }
  requireAdministrator(identity: PlatformIdentity) {
    identity = this.current(identity);
    this.requireActive(identity);
    if (identity.role !== 'administrator')
      throw new ForbiddenException('Administrator access required');
  }

  /** Shared policy used by REST, sockets, file capabilities and domain services. */
  current(identity: PlatformIdentity): PlatformIdentity {
    if (identity.kind === 'service') return identity;
    const person = identity.personId
      ? this.db
          .select()
          .from(people)
          .where(eq(people.id, identity.personId))
          .get()
      : undefined;
    return person
      ? { ...identity, active: person.active, role: person.role }
      : { ...identity, active: false, role: null };
  }

  canReadProject(identity: PlatformIdentity, projectId: string): boolean {
    identity = this.current(identity);
    if (!identity.active || !identity.role) return false;
    if (identity.role === 'administrator') return true;
    return (
      !!identity.personId &&
      !!this.db
        .select()
        .from(projectParticipants)
        .where(
          and(
            eq(projectParticipants.projectId, projectId),
            eq(projectParticipants.personId, identity.personId),
          ),
        )
        .get()
    );
  }

  requireProject(identity: PlatformIdentity, projectId: string) {
    if (!this.canReadProject(identity, projectId))
      throw new ForbiddenException('Project participant access required');
  }

  threadProject(id: string, kind: 'agent' | 'simple' = 'agent'): string | null {
    return kind === 'simple'
      ? (this.db
          .select()
          .from(simpleChatThreads)
          .where(eq(simpleChatThreads.id, id))
          .get()?.projectId ?? null)
      : (this.db
          .select()
          .from(projectAgentThreads)
          .where(eq(projectAgentThreads.threadId, id))
          .get()?.projectId ?? null);
  }

  canReadThread(
    identity: PlatformIdentity,
    id: string,
    kind: 'agent' | 'simple' = 'agent',
  ): boolean {
    identity = this.current(identity);
    if (!identity.active || !identity.role) return false;
    if (identity.role === 'administrator') return true;
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      const projectId = this.threadProject(current, kind);
      const edge: typeof conversationBranchEdges.$inferSelect | undefined =
        kind === 'agent'
          ? this.db
              .select()
              .from(conversationBranchEdges)
              .where(eq(conversationBranchEdges.childThreadId, current))
              .get()
          : undefined;
      const owner = this.db
        .select()
        .from(conversationOwners)
        .where(
          and(
            eq(conversationOwners.kind, kind),
            eq(conversationOwners.conversationId, current),
          ),
        )
        .get();
      if (
        projectId
          ? !this.canReadProject(identity, projectId)
          : owner
            ? owner.personId !== identity.personId
            : !edge
      )
        return false;
      // A fork can contain inherited messages: access to its parent is required too.
      current = edge?.parentThreadId;
    }
    return true;
  }

  requireThread(
    identity: PlatformIdentity,
    id: string,
    kind: 'agent' | 'simple' = 'agent',
  ) {
    if (!this.canReadThread(identity, id, kind))
      throw new ForbiddenException('Conversation access denied');
  }

  readableAgentIds(identity: PlatformIdentity): string[] {
    return [
      ...new Set([
        ...this.db
          .select()
          .from(projectAgentThreads)
          .all()
          .map((t) => t.threadId),
        ...this.db
          .select()
          .from(conversationOwners)
          .all()
          .filter((o) => o.kind === 'agent')
          .map((o) => o.conversationId),
        ...this.db
          .select()
          .from(conversationBranchEdges)
          .all()
          .map((e) => e.childThreadId),
      ]),
    ].filter((id) => this.canReadThread(identity, id));
  }

  recordConversationOwner(
    identity: PlatformIdentity,
    id: string,
    kind: 'agent' | 'simple',
  ) {
    if (identity.personId)
      this.db
        .insert(conversationOwners)
        .values({ kind, conversationId: id, personId: identity.personId })
        .onConflictDoNothing()
        .run();
  }

  workspaceRoots(identity?: PlatformIdentity) {
    return [
      ...new Set([
        ...this.db
          .select()
          .from(projects)
          .all()
          .filter((p) => !identity || this.canReadProject(identity, p.id))
          .map((p) => p.workspacePath),
        ...this.db
          .select()
          .from(projectWorkspaces)
          .all()
          .filter(
            (p) => !identity || this.canReadProject(identity, p.projectId),
          )
          .map((p) => p.path),
      ]),
    ];
  }

  /** Resolve symlinks and the nearest existing parent, including creation paths. */
  requireWorkspacePath(
    value: unknown,
    allowProjectCreation = false,
    identity: PlatformIdentity | undefined = currentAccess()?.identity,
  ) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0'))
      throw new ForbiddenException('Access is limited to project workspaces');
    const canonical = (path: string): string => {
      let current = resolve(path);
      const tail: string[] = [];
      for (;;) {
        try {
          return resolve(realpathSync(current), ...tail.reverse());
        } catch (error) {
          if (
            !['ENOENT', 'ENOTDIR'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            )
          )
            throw new ForbiddenException('Workspace path cannot be verified');
          const parent = dirname(current);
          if (parent === current)
            throw new ForbiddenException('Workspace path cannot be verified');
          tail.push(current.slice(parent.length).replace(/^\//, ''));
          current = parent;
        }
      }
    };
    const target = canonical(value);
    const contains = (root: string, candidate: string) => {
      const rel = relative(root, candidate);
      return (
        rel === '' ||
        (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
      );
    };
    // Even a broadly linked project must not expose the deployment credentials
    // or its database through the appdata bind-mount alias.
    const protectedPaths = (
      process.env.WEBUI_PROTECTED_PATHS ??
      '/home/codex,/run/secrets,/app,/proc,/sys,/dev,/etc,/root,/appdata/codex-web'
    )
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (
      protectedPaths.some(
        (root) =>
          contains(canonical(root), target) ||
          contains(target, canonical(root)),
      )
    )
      throw new ForbiddenException(
        'Server private paths require administrator access',
      );
    const roots = this.workspaceRoots(identity);
    if (allowProjectCreation) roots.push('/workspaces');
    const allowed = roots.some((root) => {
      return contains(canonical(root), target);
    });
    if (!allowed)
      throw new ForbiddenException('Access is limited to project workspaces');
    if (identity) {
      const owner = this.projectForPath(target);
      if (owner) this.requireProject(identity, owner);
      else if (!allowProjectCreation)
        throw new ForbiddenException('Path has no project owner');
    }
  }

  projectForPath(value: string): string | null {
    const canonical = (p: string) => {
      let current = resolve(p);
      const tail: string[] = [];
      for (;;) {
        try {
          return resolve(realpathSync(current), ...tail.reverse());
        } catch {
          const parent = dirname(current);
          if (parent === current)
            throw new ForbiddenException('Cannot verify document path');
          tail.push(current.slice(parent.length).replace(/^\//, ''));
          current = parent;
        }
      }
    };
    const target = canonical(value);
    const matches: Array<{ projectId: string; canonical: string }> = this.db
      .select()
      .from(projectWorkspaces)
      .all()
      .map((w) => ({ projectId: w.projectId, canonical: canonical(w.path) }))
      .filter((w) => {
        const rel = relative(w.canonical, target);
        const reverse = relative(target, w.canonical);
        return (
          rel === '' ||
          (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) ||
          (reverse !== '..' &&
            !reverse.startsWith('../') &&
            !isAbsolute(reverse))
        );
      });
    for (const p of this.db.select().from(projects).all()) {
      const root = canonical(p.workspacePath);
      const rel = relative(root, target);
      const reverse = relative(target, root);
      if (
        rel === '' ||
        (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) ||
        (reverse !== '..' && !reverse.startsWith('../') && !isAbsolute(reverse))
      )
        matches.push({
          projectId: p.id,
          canonical: root,
        });
    }
    const owners = new Set(matches.map((w) => w.projectId));
    if (owners.size > 1)
      throw new ForbiddenException('Workspace ownership is ambiguous');
    return matches[0]?.projectId ?? null;
  }

  createDocumentSession(
    identity: PlatformIdentity,
    path: string,
    writable: boolean,
  ): string {
    identity = this.current(identity);
    this.requireActive(identity);
    if (identity.role !== 'administrator')
      this.requireWorkspacePath(path, false, identity);
    let projectId: string | null = null;
    try {
      projectId = this.projectForPath(path);
    } catch (error) {
      if (identity.role !== 'administrator') throw error;
    }
    const id = randomUUID();
    this.db
      .delete(documentAccessSessions)
      .where(lte(documentAccessSessions.expiresAt, Date.now()))
      .run();
    this.db
      .insert(documentAccessSessions)
      .values({
        id,
        path,
        projectId,
        personId: identity.personId,
        administrator: identity.role === 'administrator',
        writable,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      })
      .run();
    return id;
  }

  verifyDocumentSession(id: unknown, path: string, writable = false): boolean {
    if (typeof id !== 'string') return false;
    const session = this.db
      .select()
      .from(documentAccessSessions)
      .where(eq(documentAccessSessions.id, id))
      .get();
    if (
      !session ||
      session.path !== path ||
      session.expiresAt <= Date.now() ||
      (writable && !session.writable)
    )
      return false;
    // Service sessions are internal and can only be minted behind authenticated ingress.
    if (!session.personId) return session.administrator;
    const person = this.db
      .select()
      .from(people)
      .where(eq(people.id, session.personId))
      .get();
    if (!person?.active) return false;
    if (session.administrator) return person.role === 'administrator';
    try {
      const identity: PlatformIdentity = {
        kind: 'person',
        personId: person.id,
        name: person.name,
        role: person.role,
        active: person.active,
      };
      if (!session.projectId || this.projectForPath(path) !== session.projectId)
        return false;
      this.requireProject(identity, session.projectId);
      this.requireWorkspacePath(path, false, identity);
      return true;
    } catch {
      return false;
    }
  }

  getDocumentSession(id: unknown, path: string, writable = false) {
    if (!this.verifyDocumentSession(id, path, writable)) return null;
    return this.db
      .select()
      .from(documentAccessSessions)
      .where(eq(documentAccessSessions.id, id as string))
      .get();
  }

  clientConfig() {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, 'general.maxIdleSubscriptions'))
      .get();
    const parsed = Number(row?.value ?? row?.defaultValue ?? 30);
    return { maxIdleSubscriptions: Number.isFinite(parsed) ? parsed : 30 };
  }

  isAutomationResource(id: string) {
    return (
      this.db
        .select()
        .from(projectResources)
        .where(eq(projectResources.id, id))
        .get()?.type === 'automation_board'
    );
  }

  requireWorkspaceDeletions(projectId: string, ids: unknown) {
    if (!Array.isArray(ids)) return;
    const selected = new Set(ids);
    for (const workspace of this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, projectId))
      .all()) {
      if (selected.has(workspace.id)) this.requireWorkspacePath(workspace.path);
    }
  }
}
