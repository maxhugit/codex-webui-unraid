import { EventEmitter } from 'node:events';

/** Disconnect live sockets when privileges or account activity change. */
export const identityEvents = new EventEmitter();
