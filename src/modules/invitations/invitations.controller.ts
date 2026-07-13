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
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InvitationsService } from './invitations.service';
import { parseByteRange } from './invitation-asset.utils';

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

  @UseGuards(JwtAuthGuard)
  @Post(':id/assets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async uploadAsset(
    @Req() req: AuthRequest,
    @Param('id') invitationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const asset = await this.service.uploadAsset(invitationId, req.user.id, req.user.role, file);
    return { asset };
  }

  @Get('assets/:id')
  async getAsset(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.service.getAsset(id);
    const safeName = asset.originalName.replace(/["\\]/g, '');
    const range = asset.kind === 'audio'
      ? parseByteRange(req.headers.range, asset.size)
      : null;

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (asset.kind === 'audio') res.setHeader('Accept-Ranges', 'bytes');

    if (req.headers.range && asset.kind === 'audio' && !range) {
      res.status(416).setHeader('Content-Range', `bytes */${asset.size}`);
      res.end();
      return;
    }

    if (range) {
      const chunk = asset.data.subarray(range.start, range.end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
      res.setHeader('Content-Length', chunk.length);
      res.end(chunk);
      return;
    }

    res.setHeader('Content-Length', asset.size);
    res.end(asset.data);
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

  @Post('public/:slug/guest')
  async getPublicGuest(
    @Param('slug') slug: string,
    @Body() body: { guestToken?: string; email?: string; name?: string; phone?: string },
  ) {
    const guest = await this.service.getPublicGuest(slug, body || {});
    return { guest };
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
