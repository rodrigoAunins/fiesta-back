import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { User } from '../../entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordWithRecoveryDto } from './dto/reset-password-with-recovery.dto';
import {
  compareSecret,
  ensureStrongPassword,
  generateRecoveryCode,
  normalizeEmail,
  normalizeName,
  sanitizeUser,
  hashSecret,
} from './auth.utils';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  private async buildAccessToken(user: User) {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }

  async register(data: RegisterDto) {
    const email = normalizeEmail(data.email);
    const firstName = normalizeName(data.firstName);
    const lastName = normalizeName(data.lastName);

    const exists = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (exists) {
      throw new BadRequestException(
        'Ya existe una cuenta con ese correo electrónico',
      );
    }

    if (!ensureStrongPassword(data.password)) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número',
      );
    }

    const passwordHash = await hashSecret(data.password);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await hashSecret(recoveryCode);

    const userToCreate: Partial<User> = {
      firstName,
      lastName,
      email,
      passwordHash,
      googleId: null,
      recoveryCodeHash,
      recoveryCodeGeneratedAt: new Date(),
      role: 'creator' as User['role'],
      isActive: true,
      mp_access_token: null,
      mp_refresh_token: null,
      mp_user_id: null,
    };

    const user = this.userRepo.create(userToCreate);
    const saved = await this.userRepo.save(user);

    const access_token = await this.buildAccessToken(saved);

    return {
      message: 'Cuenta creada correctamente',
      access_token,
      user: sanitizeUser(saved),
      recoveryCode,
    };
  }

  async login(data: LoginDto) {
    const email = normalizeEmail(data.email);

    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect(['user.passwordHash'])
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Tu usuario está desactivado');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Esta cuenta está vinculada a Google. Usá la opción "Continuar con Google".',
      );
    }

    const validPassword = await compareSecret(data.password, user.passwordHash);

    if (!validPassword) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const access_token = await this.buildAccessToken(user);

    return {
      message: 'Sesión iniciada correctamente',
      access_token,
      user: sanitizeUser(user),
    };
  }

  async googleLogin(googleUser: any) {
    if (!googleUser) {
      throw new BadRequestException('No se recibió información de Google');
    }

    const email = normalizeEmail(
      googleUser.email ||
        googleUser.emails?.[0]?.value ||
        '',
    );

    if (!email) {
      throw new BadRequestException(
        'Google no devolvió un correo electrónico válido',
      );
    }

    let user = await this.userRepo.findOne({
      where: { email },
    });

    if (!user) {
      const firstName = normalizeName(
        googleUser.firstName ||
          googleUser.given_name ||
          googleUser.givenName ||
          'Usuario',
      );

      const lastName = normalizeName(
        googleUser.lastName ||
          googleUser.family_name ||
          googleUser.familyName ||
          '',
      );

      const userToCreate: Partial<User> = {
        email,
        firstName,
        lastName,
        googleId: String(googleUser.googleId || googleUser.sub || '').trim() || null,
        passwordHash: null,
        recoveryCodeHash: null,
        recoveryCodeGeneratedAt: null,
        role: 'creator' as User['role'],
        isActive: true,
        mp_access_token: null,
        mp_refresh_token: null,
        mp_user_id: null,
      };

      user = this.userRepo.create(userToCreate);
      user = await this.userRepo.save(user);
    } else {
      if (user.isActive === false) {
        throw new UnauthorizedException('Tu usuario está desactivado');
      }

      const incomingGoogleId =
        String(googleUser.googleId || googleUser.sub || '').trim() || null;

      let changed = false;

      if (!user.googleId && incomingGoogleId) {
        user.googleId = incomingGoogleId;
        changed = true;
      }

      if ((!user.firstName || !user.firstName.trim()) && googleUser.firstName) {
        user.firstName = normalizeName(googleUser.firstName);
        changed = true;
      }

      if ((!user.lastName || !user.lastName.trim()) && googleUser.lastName) {
        user.lastName = normalizeName(googleUser.lastName);
        changed = true;
      }

      if (changed) {
        user = await this.userRepo.save(user);
      }
    }

    const access_token = await this.buildAccessToken(user);

    return {
      access_token,
      user: sanitizeUser(user),
    };
  }

  async me(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Tu usuario está desactivado');
    }

    return sanitizeUser(user);
  }

  async resetPasswordWithRecoveryCode(data: ResetPasswordWithRecoveryDto) {
    const email = normalizeEmail(data.email);

    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect(['user.recoveryCodeHash', 'user.passwordHash'])
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (!user || !user.recoveryCodeHash) {
      throw new BadRequestException(
        'No se pudo validar el código de recuperación. Si usás Google, ingresá directamente con Google.',
      );
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Tu usuario está desactivado');
    }

    const validRecovery = await compareSecret(
      data.recoveryCode.trim().toUpperCase(),
      user.recoveryCodeHash,
    );

    if (!validRecovery) {
      throw new BadRequestException('Código de recuperación inválido');
    }

    if (!ensureStrongPassword(data.newPassword)) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 8 caracteres, una mayúscula y un número',
      );
    }

    user.passwordHash = await hashSecret(data.newPassword);

    const newRecoveryCode = generateRecoveryCode();
    user.recoveryCodeHash = await hashSecret(newRecoveryCode);
    user.recoveryCodeGeneratedAt = new Date();

    await this.userRepo.save(user);

    return {
      message: 'La contraseña fue actualizada correctamente',
      newRecoveryCode,
    };
  }

  async rotateRecoveryCode(userId: string) {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.recoveryCodeHash')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Tu usuario está desactivado');
    }

    const recoveryCode = generateRecoveryCode();
    user.recoveryCodeHash = await hashSecret(recoveryCode);
    user.recoveryCodeGeneratedAt = new Date();

    await this.userRepo.save(user);

    return {
      message: 'Se generó un nuevo código de recuperación',
      recoveryCode,
    };
  }
}