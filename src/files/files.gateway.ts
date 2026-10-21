/** Authenticated Socket.IO lease boundary for app-server filesystem watches. */
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy, UseFilters, UseGuards } from '@nestjs/common';
import { IdentityService } from '../auth/identity.service';
import { Server, Socket } from 'socket.io';
import { FilesExceptionFilter } from './files-ws-errors';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { PlatformAccessGuard } from '../auth/platform-access.guard';
import {
  FileWatchCoordinatorService,
  type FileWatchChange,
} from './file-watch-coordinator.service';

interface WatchPathMessage {
  path?: string;
  leaseId?: string;
}

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
@UseGuards(ApiKeyGuard, PlatformAccessGuard)
@UseFilters(FilesExceptionFilter)
export class FilesGateway implements OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly watches: FileWatchCoordinatorService,
    private readonly identities: IdentityService,
  ) {}

  afterInit(): void {
    this.unsubscribe = this.watches.subscribe((change) => {
      void this.emitChange(change);
    });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.watches.releaseSocket(client.id);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Acquires one visible filesystem path for the authenticated socket. */
  @SubscribeMessage('fs.watch.acquire')
  async handleAcquire(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: WatchPathMessage,
  ) {
    if (typeof body?.path !== 'string' || typeof body.leaseId !== 'string')
      return { ok: false, error: 'path and leaseId are required' };
    if (!client.connected) return { ok: false, error: 'Socket disconnected' };
    return this.watches.acquire(client.id, body.path, body.leaseId);
  }

  /** Releases one visible filesystem path for the authenticated socket. */
  @SubscribeMessage('fs.watch.release')
  async handleRelease(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: WatchPathMessage,
  ) {
    if (typeof body?.leaseId !== 'string') return { ok: true };
    return this.watches.release(client.id, body.leaseId);
  }

  /** Sends changes only to sockets that hold the corresponding lease. */
  private async emitChange(change: FileWatchChange): Promise<void> {
    const payload = {
      watchPath: change.watchPath,
      refresh: change.refresh,
      changedPaths: change.changedPaths,
    };
    for (const socketId of change.socketIds) {
      try {
        const sockets = await this.server.in(socketId).fetchSockets();
        for (const socket of sockets) {
          const identity = this.identities.resolve(socket.handshake.headers);
          this.identities.requireActive(identity);
          if (identity.role !== 'administrator')
            this.identities.requireWorkspacePath(
              change.watchPath,
              false,
              identity,
            );
          socket.emit('fs.changed', payload);
        }
      } catch {
        /* Revocation or a disappearing socket must not deliver content. */
      }
    }
  }
}
