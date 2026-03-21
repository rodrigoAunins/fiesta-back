import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SellersService } from './sellers.service';
import { AssignSellerDto } from './dto/assign-seller.dto';
import { UserRole } from '../../common/enums/user-role.enum';

@UseGuards(AuthGuard('jwt'))
@Controller('api/sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post('assign/:raffleId')
  assignSeller(
    @Req() req,
    @Param('raffleId') raffleId: string,
    @Body() body: AssignSellerDto,
  ) {
    if (req.user.role !== UserRole.CREATOR) {
      throw new UnauthorizedException('Solo creadores');
    }

    return this.sellersService.assignSellerToRaffle(req.user.id, raffleId, body);
  }

  @Get('list/:raffleId')
  getSellers(@Req() req, @Param('raffleId') raffleId: string) {
    if (req.user.role !== UserRole.CREATOR) {
      throw new UnauthorizedException('Solo creadores');
    }

    return this.sellersService.getSellersForRaffle(req.user.id, raffleId);
  }

  @Get('dashboard/:raffleId')
  getDashboard(@Req() req, @Param('raffleId') raffleId: string) {
    if (req.user.role !== UserRole.SELLER) {
      throw new UnauthorizedException('Solo vendedores');
    }

    return this.sellersService.getSellerDashboard(req.user.id, raffleId);
  }
}