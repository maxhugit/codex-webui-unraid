import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { accessContext } from './access-context';
import { IdentityService } from './identity.service';
import type { IdentityRequest } from './platform-access.guard';

@Injectable()
export class AccessContextInterceptor implements NestInterceptor {
  constructor(private readonly identities: IdentityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const identity = context
      .switchToHttp()
      .getRequest<IdentityRequest>().platformIdentity;
    if (!identity) return next.handle();
    return new Observable((subscriber) =>
      accessContext.run({ identity, identities: this.identities }, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
