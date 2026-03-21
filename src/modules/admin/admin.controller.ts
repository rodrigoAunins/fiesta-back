import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminOverviewQueryDto } from './dto/admin-overview-query.dto';
import { AdminService } from './admin.service';

@Controller('api/admin')
@UseGuards(AuthGuard('jwt'))
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  getOverview(@Req() req: any, @Query() query: AdminOverviewQueryDto) {
    return this.adminService.getOverview(req.user, query.range);
  }
}