import {
  Controller,
  ForbiddenException,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Header,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InvitationsService } from './invitations.service';

type AuthRequest = Request & {
  user: { id: string; role: string };
};

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  private serialize(inv: any) {
    const publicUrl = inv.published && inv.publicSlug ? `/i/${inv.publicSlug}` : null;
    const design = inv.design
      ? {
          ...inv.design,
          metadata: {
            ...(inv.design?.metadata || {}),
            workspaceId: inv.workspaceId || inv.design?.metadata?.workspaceId,
          },
        }
      : inv.design;

    return {
      id: inv.id,
      name: inv.name,
      workspaceId: inv.workspaceId,
      published: inv.published,
      status: inv.published ? 'published' : 'draft',
      publicSlug: inv.publicSlug,
      publicUrl,
      publishedAt: inv.publishedAt,
      updatedAt: inv.updatedAt,
      design,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('workspace/:workspaceId')
  async listByWorkspace(@Req() req: AuthRequest, @Param('workspaceId') workspaceId: string) {
    const list = await this.service.listByWorkspace(workspaceId, req.user.id, req.user.role);
    return list.map((inv) => this.serialize(inv));
  }

  @UseGuards(JwtAuthGuard)
  @Get('workspace/:workspaceId/guests')
  async listGuests(@Req() req: AuthRequest, @Param('workspaceId') workspaceId: string) {
    const guests = await this.service.listGuestsByWorkspace(workspaceId, req.user.id, req.user.role);
    return { guests };
  }

  @UseGuards(JwtAuthGuard)
  @Put('workspace/:workspaceId/guests')
  async replaceGuests(
    @Req() req: AuthRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { guests: Array<Record<string, any>> },
  ) {
    const guests = await this.service.replaceGuestsByWorkspace(
      workspaceId,
      req.user.id,
      req.user.role,
      Array.isArray(body?.guests) ? body.guests : [],
    );
    return { guests };
  }

  @UseGuards(JwtAuthGuard)
  @Post('workspace/:workspaceId/guests/:guestId/review')
  async reviewGuest(
    @Req() req: AuthRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('guestId') guestId: string,
    @Body() body: { reviewStatus?: string; rejectionReason?: string | null },
  ) {
    const guest = await this.service.reviewGuest(workspaceId, guestId, req.user.id, req.user.role, body || {});
    return { success: true, guest };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':workspaceId')
  async createDesign(
    @Req() req: AuthRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { design: Record<string, any> },
  ) {
    const inv = await this.service.create(workspaceId, req.user.id, req.user.role, body.design);
    return { success: true, ...this.serialize(inv) };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getDesign(@Req() req: AuthRequest, @Param('id') id: string) {
    const inv = await this.service.getById(id, req.user.id, req.user.role);
    return this.serialize(inv);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updateDesign(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { design: Record<string, any> },
  ) {
    const inv = await this.service.update(id, req.user.id, req.user.role, body.design);
    return { success: true, ...this.serialize(inv) };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteDesign(@Req() req: AuthRequest, @Param('id') id: string) {
    await this.service.delete(id, req.user.id, req.user.role);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':workspaceId/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadImage(
    @Req() req: AuthRequest,
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const url = await this.service.uploadImage(workspaceId, req.user.id, req.user.role, file);
    return { url };
  }

  @Get('assets/:id')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getAsset(@Param('id') id: string): Promise<StreamableFile> {
    const asset = await this.service.getAsset(id);
    return new StreamableFile(asset.data, {
      type: asset.mimeType,
      disposition: `inline; filename="${asset.originalName.replace(/["\\]/g, '')}"`,
      length: asset.size,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/publish')
  async publish(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { published: boolean },
  ) {
    const inv = await this.service.publish(id, req.user.id, req.user.role, body.published);
    return { success: true, ...this.serialize(inv) };
  }

  @Get('public/:slug')
  async getPublic(@Param('slug') slug: string) {
    const inv = await this.service.getPublic(slug);
    return inv ? this.serialize(inv) : { design: null };
  }

  @Post('public/:slug/rsvp')
  async confirmPublicRsvp(
    @Param('slug') slug: string,
    @Body() body: { guestToken?: string; name?: string; email?: string; phone?: string },
  ) {
    const guest = await this.service.confirmPublicRsvp(slug, body || {});
    return { success: true, guest };
  }
}
