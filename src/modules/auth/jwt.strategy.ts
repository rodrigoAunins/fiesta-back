import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../../entities/user.entity';
import { isSuperAdminEmail } from './auth.utils';

type JwtPayload = {
  sub: string;
  email: string;
  role: User['role'];
  firstName?: string;
  lastName?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') || 'dev_secret_change_me',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token inválido: falta sub');
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Token inválido: usuario no encontrado');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Tu usuario está desactivado');
    }

    const role = isSuperAdminEmail(
      user.email,
      this.configService.get<string>('SUPERADMIN_EMAILS'),
    )
      ? 'master'
      : user.role;

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      role,
      isActive: user.isActive,
    };
  }
}
