import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import {
  people,
  projects,
  projectWorkspaces,
  projectResources,
  settings,
} from '../database/schema';

export interface PlatformIdentity {
  kind: 'person' | 'service' | 'unlinked';
  personId: string | null;
  name: string | null;
  role: 'standard' | 'administrator' | null;
  active: boolean;
  subject?: string;
  email?: string;
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
    return this.db.transaction(() => {
      let person = this.db
        .select()
        .from(people)
        .where(eq(people.identitySubject, subject))
        .get();
      if (!person && email) {
        // No account creation or administrator promotion on first login. Only a
        // pre-provisioned active record can bind, once, by the verified email.
        const candidate = this.db
          .select()
          .from(people)
          .where(and(eq(people.email, email), isNull(people.identitySubject)))
          .get();
        if (candidate?.active) {
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
      };
    });
  }

  requireActive(identity: PlatformIdentity) {
    if (!identity.active || !identity.role)
      throw new ForbiddenException(
        'Your login is not linked to an active person. Contact an administrator.',
      );
  }
  requireAdministrator(identity: PlatformIdentity) {
    this.requireActive(identity);
    if (identity.role !== 'administrator')
      throw new ForbiddenException('Administrator access required');
  }

  workspaceRoots() {
    return [
      ...new Set([
        ...this.db
          .select()
          .from(projects)
          .all()
          .map((p) => p.workspacePath),
        ...this.db
          .select()
          .from(projectWorkspaces)
          .all()
          .map((p) => p.path),
      ]),
    ];
  }

  /** Resolve symlinks and the nearest existing parent, including creation paths. */
  requireWorkspacePath(value: unknown, allowProjectCreation = false) {
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
    const roots = this.workspaceRoots();
    if (allowProjectCreation) roots.push('/workspaces');
    const allowed = roots.some((root) => {
      return contains(canonical(root), target);
    });
    if (!allowed)
      throw new ForbiddenException('Access is limited to project workspaces');
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
}
