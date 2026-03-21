import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, _context: ExecutionContext) {
    if (err || !user) {
      console.error('JWT AUTH ERROR =>', {
        err: err?.message || err || null,
        info:
          info?.message ||
          info?.name ||
          info ||
          'No se recibió usuario validado en el guard',
      });

      throw err ||
        new UnauthorizedException(
          info?.message || 'Token inválido o vencido',
        );
    }

    return user;
  }
}