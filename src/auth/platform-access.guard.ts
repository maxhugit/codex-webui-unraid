import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  IdentityService,
  type IdentityHeaders,
  type PlatformIdentity,
} from './identity.service';
import { AuthService } from './auth.service';

export interface IdentityRequest {
  headers: IdentityHeaders;
  platformIdentity?: PlatformIdentity;
  method: string;
  url: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(
    private readonly identities: IdentityService,
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (context.getType() === 'ws') {
      const socket = context
        .switchToWs()
        .getClient<{ handshake: { headers: IdentityHeaders } }>();
      const identity = this.identities.resolve(socket.handshake.headers);
      this.identities.requireActive(identity);
      if (identity.role === 'administrator') return true;
      const data =
        context.switchToWs().getData<Record<string, unknown>>() ?? {};
      const event = context.switchToWs().getPattern();
      // A cwd is not a sandbox: conversation shells can change directory too.
      // Reserve server execution until per-user OS isolation exists.
      if (event?.startsWith('terminal.') || event === 'codex.serverResponse')
        this.identities.requireAdministrator(identity);
      if (event === 'fs.watch.acquire')
        this.identities.requireWorkspacePath(data.path);
      return true;
    }
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const url = request.url.split('?')[0].replace(/^\/api(?=\/)/, '');
    // Deployment health checks still require the ApiKeyGuard, but not a human.
    if (url === '/status' && request.method === 'GET') return true;
    // Authentik-exempt document transfers must carry a short-lived, path-bound token.
    if (request.headers['x-webui-auth-source'] === 'document') {
      return (
        url === '/files/serve' &&
        this.auth.verifyFileAccess(
          request.query?.access_token,
          request.query?.path,
        )
      );
    }
    const identity = this.identities.resolve(request.headers);
    request.platformIdentity = identity;
    if (url === '/auth/me') return true;
    this.identities.requireActive(identity);
    if (identity.role === 'administrator') return true;
    const admin =
      /^\/(settings|logs|mcp-servers|plugins|apps|codex\/config|codex\/catalog)(\/|$)/.test(
        url,
      ) ||
      (/^\/account(\/|$)/.test(url) &&
        !(request.method === 'GET' && url === '/account/rate-limits')) ||
      (request.method !== 'GET' &&
        /^\/codex\/(approval-policy|sandbox-mode)$/.test(url)) ||
      (request.method !== 'GET' && /^\/skills(\/|$)/.test(url)) ||
      (request.method !== 'GET' && /^\/pending-approvals(\/|$)/.test(url)) ||
      (request.method !== 'GET' &&
        /^\/simple-chat\/(config|settings|models)(\/|$)/.test(url)) ||
      /^\/simple-chat\/api-key(\/|$)/.test(url) ||
      (request.method !== 'GET' && /^\/projects\/people(\/|$)/.test(url));
    if (admin) this.identities.requireAdministrator(identity);
    if (request.method === 'DELETE') {
      const projectId = url.match(/^\/projects\/([^/]+)$/)?.[1];
      if (projectId)
        this.identities.requireWorkspaceDeletions(
          projectId,
          request.body?.deleteWorkspaceIds,
        );
      if (url.startsWith('/workspaces/')) {
        const name = request.params?.name;
        this.identities.requireWorkspacePath(
          typeof name === 'string' ? `/workspaces/${name}` : undefined,
        );
      }
    }
    if (request.method !== 'GET') {
      const resource = url.match(
        /^\/projects\/[^/]+\/resources\/([^/]+)(?:\/|$)/,
      )?.[1];
      const serverExecution =
        (url.startsWith('/threads') && url !== '/threads/turn-counts') ||
        /\/automations(?:\/|$)|\/automation-runs(?:\/|$)/.test(url) ||
        request.body?.type === 'automation_board' ||
        (resource && this.identities.isAutomationResource(resource));
      if (serverExecution) this.identities.requireAdministrator(identity);
    }
    if (
      request.method !== 'GET' &&
      /^\/(projects|workspaces|threads)(\/|$)/.test(url)
    ) {
      for (const key of [
        'path',
        'workspacePath',
        'cwd',
        'oldPath',
        'newPath',
      ]) {
        if (request.body?.[key] !== undefined)
          this.identities.requireWorkspacePath(
            request.body[key],
            url.startsWith('/projects'),
          );
      }
    }
    if (/^\/(files|onlyoffice)(\/|$)/.test(url)) {
      for (const source of [request.query, request.body]) {
        for (const key of [
          'path',
          'root',
          'sourcePath',
          'destinationPath',
          'cwd',
        ]) {
          if (source?.[key] !== undefined)
            this.identities.requireWorkspacePath(source[key]);
        }
      }
    }
    return true;
  }
}
