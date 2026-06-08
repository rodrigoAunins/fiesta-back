import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminOverviewQueryDto } from './dto/admin-overview-query.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { AdminService } from './admin.service';

@Controller('api/admin')
@UseGuards(AuthGuard('jwt'))
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  getOverview(@Req() req: any, @Query() query: AdminOverviewQueryDto) {
    return this.adminService.getOverview(req.user, query.range);
  }

  @Get('users')
  getUsers(@Req() req: any) {
    return this.adminService.getUsers(req.user);
  }

  @Post('users')
  createUser(@Req() req: any, @Body() body: CreateAdminUserDto) {
    return this.adminService.createUser(req.user, body);
  }

  @Get('catalog')
  getCatalog(@Req() req: any) {
    return this.adminService.getGlobalCatalog(req.user);
  }

  @Post('catalog')
  createCatalogItem(@Req() req: any, @Body() body: any) {
    return this.adminService.createGlobalCatalogItem(req.user, body);
  }

  @Put('catalog/:id')
  updateCatalogItem(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateGlobalCatalogItem(req.user, id, body);
  }

  @Delete('catalog/:id')
  deleteCatalogItem(@Req() req: any, @Param('id') id: string) {
    return this.adminService.deleteGlobalCatalogItem(req.user, id);
  }
}
