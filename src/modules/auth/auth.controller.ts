import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordWithRecoveryDto } from './dto/reset-password-with-recovery.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

type JwtRequest = Request & {
  user: {
    id: string;
    email: string;
    role: 'master' | 'creator' | 'organizer' | 'guest' | 'seller' | 'door';
    firstName?: string;
    lastName?: string;
    fullName?: string;
  };
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('password/reset-with-recovery')
  resetWithRecoveryCode(@Body() body: ResetPasswordWithRecoveryDto) {
    return this.authService.resetPasswordWithRecoveryCode(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('recovery-code/rotate')
  rotateRecoveryCode(@Req() req: JwtRequest) {
    return this.authService.rotateRecoveryCode(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: JwtRequest) {
    return this.authService.me(req.user.id);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() _req: Request) {
    return;
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: Request & { user?: any }, @Res() res: Response) {
    const result = await this.authService.googleLogin(req.user);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    res.redirect(
      `${frontendUrl}/auth/success?token=${encodeURIComponent(result.access_token)}`,
    );
  }
}
