import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RafflesService } from './raffles.service';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { FinalizeDrawDto } from './dto/finalize-draw.dto';
import { CreateDoorStaffDto } from './dto/create-door-staff.dto';

type AuthRequest = Request & {
  user: {
    id: string;
    email: string;
    role: 'master' | 'creator' | 'organizer' | 'guest' | 'seller' | 'door';
    firstName?: string;
    lastName?: string;
    fullName?: string;
  };
};

@Controller('api/raffles')
export class RafflesController {
  constructor(private readonly rafflesService: RafflesService) {}

  @Get('config/fees')
  getFeeConfig() {
    return this.rafflesService.getFeeConfig();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: AuthRequest, @Body() body: CreateRaffleDto) {
    return this.rafflesService.createRaffle(req.user.id, req.user.role, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/finalize-draw')
  finalizeDraw(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: FinalizeDrawDto,
  ) {
    return this.rafflesService.finalizeDraw(id, req.user.id, req.user.role, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-raffles')
  getMyRaffles(@Req() req: AuthRequest) {
    return this.rafflesService.getMyRaffles(req.user.id, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/dashboard')
  getCreatorDashboard(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.rafflesService.getCreatorDashboard(id, req.user.id, req.user.role);
  }

  // ========= NUEVO =========
  @UseGuards(JwtAuthGuard)
  @Post(':id/door-staff')
  createDoorStaff(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: CreateDoorStaffDto,
  ) {
    return this.rafflesService.createDoorStaff(id, req.user.id, req.user.role, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/door-staff')
  getDoorStaff(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.rafflesService.getDoorStaff(id, req.user.id, req.user.role);
  }
  // =========================

  @Get('share/:id')
  async getSharePage(
    @Param('id') id: string,
    @Query('vendedor') sellerId: string | undefined,
    @Res() res: Response,
  ) {
    const html = await this.rafflesService.getShareHtml(id, sellerId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  @Get('share/:id/image')
  async getShareImage(@Param('id') id: string, @Res() res: Response) {
    const result = await this.rafflesService.getShareImage(id);

    if (result.kind === 'redirect') {
      return res.redirect(result.url);
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(result.buffer);
  }

  @Get(':id')
  getPublic(@Param('id') id: string) {
    return this.rafflesService.getPublicRaffle(id);
  }
}
