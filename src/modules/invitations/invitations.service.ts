import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invitation } from '../../entities/invitation.entity';
import { EventGuest } from '../../entities/event-guest.entity';
import { Raffle } from '../../entities/raffle.entity';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

type GuestPayload = {
  id?: string;
  name?: string;
  status?: string;
  gender?: string;
  food?: string;
  companions?: number;
  table?: string;
  phone?: string;
  email?: string | null;
  inviteCode?: string;
  note?: string | null;
  side?: string;
};

type PublicRsvpPayload = {
  guestToken?: string | null;
  name?: string;
  email?: string;
  phone?: string;
};

@Injectable()
export class InvitationsService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'invitations');

  constructor(
    @InjectRepository(Invitation)
    private readonly repo: Repository<Invitation>,

    @InjectRepository(EventGuest)
    private readonly guestRepo: Repository<EventGuest>,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,
  ) {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private async assertWorkspaceAccess(workspaceId: string, userId: string, role: string): Promise<void> {
    if (!workspaceId) {
      throw new NotFoundException('Workspace inválido');
    }

    if (!['master', 'creator', 'organizer', 'guest'].includes(String(role || ''))) {
      throw new ForbiddenException('No tenés permisos para acceder a este evento.');
    }

    const where =
      role === 'master'
        ? { id: workspaceId }
        : role === 'guest'
          ? { id: workspaceId, finalUser: { id: userId } }
          : { id: workspaceId, creator: { id: userId } };

    const raffle = await this.raffleRepo.findOne({
      where: where as any,
      relations: ['creator', 'finalUser'],
    });

    if (!raffle) {
      throw new ForbiddenException('No tenés acceso a este evento.');
    }
  }

  private normalizeGuestStatus(raw: unknown): string {
    const value = String(raw || '').trim().toLowerCase();
    if (['confirmado', 'confirmed', 'si', 'sí', 'yes'].includes(value)) return 'confirmed';
    if (['presente', 'present'].includes(value)) return 'present';
    if (['ausente', 'absent', 'no'].includes(value)) return 'absent';
    return 'pending';
  }

  private normalizeGuestGender(raw: unknown): string {
    const value = String(raw || '').trim().toLowerCase();
    if (['mujer', 'female', 'femenino', 'f'].includes(value)) return 'female';
    if (['hombre', 'male', 'masculino', 'm'].includes(value)) return 'male';
    return 'other';
  }

  async listByWorkspace(workspaceId: string, userId: string, role: string): Promise<Invitation[]> {
    await this.assertWorkspaceAccess(workspaceId, userId, role);

    return this.repo.find({
      where: { workspaceId },
      order: { updatedAt: 'DESC' },
    });
  }

  async getById(id: string, userId: string, role: string): Promise<Invitation> {
    const inv = await this.repo.findOne({ where: { id } });
    if (!inv) throw new NotFoundException('Invitacion no encontrada');

    await this.assertWorkspaceAccess(String(inv.workspaceId || ''), userId, role);

    return inv;
  }

  async getPublic(slug: string): Promise<Invitation | null> {
    return this.repo.findOne({ where: { publicSlug: slug, published: true } });
  }

  private slugify(value: string): string {
    const base = String(value || 'invitacion')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return base || 'invitacion';
  }

  private createInviteCode(source: string): string {
    return `${this.slugify(source || 'invitado') || 'invitado'}-${randomUUID().slice(0, 6)}`;
  }

  private normalizeGuestPayload(payload: GuestPayload, index: number, workspaceId: string): EventGuest {
    const name = String(payload?.name || `Invitado ${index + 1}`).trim() || `Invitado ${index + 1}`;
    const email = String(payload?.email || '').trim().toLowerCase() || null;

    return this.guestRepo.create({
      id: String(payload?.id || `guest-${randomUUID()}`).trim(),
      workspaceId,
      name,
      status: this.normalizeGuestStatus(payload?.status),
      gender: this.normalizeGuestGender(payload?.gender),
      food: String(payload?.food || 'Sin restriccion').trim() || 'Sin restriccion',
      companions: Math.max(0, Math.min(8, Number(payload?.companions ?? 0) || 0)),
      table: String(payload?.table || 'Sin mesa').trim() || 'Sin mesa',
      phone: String(payload?.phone || '-').trim() || '-',
      email,
      inviteCode: String(payload?.inviteCode || this.createInviteCode(email || name)).trim() || this.createInviteCode(name),
      note: String(payload?.note || '').trim() || null,
      side: payload?.side === 'right' ? 'right' : 'left',
    });
  }

  private serializeGuest(guest: EventGuest) {
    return {
      id: guest.id,
      workspaceId: guest.workspaceId,
      name: guest.name,
      status: this.normalizeGuestStatus(guest.status),
      gender: this.normalizeGuestGender(guest.gender),
      food: guest.food,
      companions: Number(guest.companions || 0),
      table: guest.table,
      phone: guest.phone,
      email: guest.email || undefined,
      inviteCode: guest.inviteCode,
      note: guest.note || undefined,
      side: guest.side === 'right' ? 'right' : 'left',
    };
  }

  private async createUniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = attempt === 0 ? randomUUID().slice(0, 6) : randomUUID().slice(0, 8);
      const slug = `${base}-${suffix}`;
      const exists = await this.repo.exist({ where: { publicSlug: slug } });
      if (!exists) return slug;
    }
    return `inv-${randomUUID().slice(0, 12)}`;
  }

  async create(workspaceId: string, userId: string, role: string, design: Record<string, any>): Promise<Invitation> {
    await this.assertWorkspaceAccess(workspaceId, userId, role);

    const name = design?.name || 'Nueva invitacion';
    const slug = await this.createUniqueSlug(name);
    const inv = this.repo.create({
      workspaceId,
      creatorId: userId,
      design,
      name,
      publicSlug: slug,
      published: false,
      publishedAt: null,
    });
    return this.repo.save(inv);
  }

  async update(id: string, userId: string, role: string, design: Record<string, any>): Promise<Invitation> {
    const inv = await this.getById(id, userId, role);
    
    inv.design = design;
    if (design?.name) inv.name = design.name;
    
    return this.repo.save(inv);
  }

  async delete(id: string, userId: string, role: string): Promise<void> {
    const inv = await this.getById(id, userId, role);
    await this.repo.remove(inv);
  }

  async uploadImage(workspaceId: string, userId: string, file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname) || '.png';
    const filename = `${workspaceId}-${randomUUID().slice(0, 8)}${ext}`;
    const filePath = path.join(this.uploadDir, filename);

    fs.writeFileSync(filePath, file.buffer);

    // Return a relative URL that the frontend can use
    return `/uploads/invitations/${filename}`;
  }

  async publish(id: string, userId: string, role: string, published: boolean): Promise<Invitation> {
    const inv = await this.getById(id, userId, role);

    inv.published = published;
    if (published && !inv.publicSlug) {
      inv.publicSlug = await this.createUniqueSlug(inv.name);
    }
    inv.publishedAt = published ? new Date() : null;
    return this.repo.save(inv);
  }

  async listGuestsByWorkspace(workspaceId: string, userId: string, role: string) {
    await this.assertWorkspaceAccess(workspaceId, userId, role);

    const guests = await this.guestRepo.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });

    return guests.map((guest) => this.serializeGuest(guest));
  }

  async replaceGuestsByWorkspace(workspaceId: string, userId: string, role: string, guests: GuestPayload[]) {
    await this.assertWorkspaceAccess(workspaceId, userId, role);

    const normalizedGuests = Array.isArray(guests)
      ? guests.map((guest, index) => this.normalizeGuestPayload(guest, index, workspaceId))
      : [];

    await this.guestRepo.manager.transaction(async (manager) => {
      await manager.delete(EventGuest, { workspaceId });
      if (normalizedGuests.length) {
        await manager.save(EventGuest, normalizedGuests);
      }
    });

    return normalizedGuests.map((guest) => this.serializeGuest(guest));
  }

  async confirmPublicRsvp(slug: string, payload: PublicRsvpPayload) {
    const invitation = await this.getPublic(slug);
    if (!invitation || !invitation.workspaceId) {
      throw new NotFoundException('Invitacion no encontrada');
    }

    const workspaceId = String(invitation.workspaceId);
    const normalizedEmail = String(payload?.email || '').trim().toLowerCase();
    const normalizedName = String(payload?.name || '').trim();
    const normalizedPhone = String(payload?.phone || '').trim();
    const guestToken = String(payload?.guestToken || '').trim();

    if (!normalizedEmail && !guestToken) {
      throw new NotFoundException('Necesitamos email o token del invitado para confirmar la asistencia.');
    }

    const guests = await this.guestRepo.find({ where: { workspaceId } });
    const guest = guests.find((item) => {
      if (guestToken && (item.id === guestToken || item.inviteCode === guestToken)) return true;
      return normalizedEmail && String(item.email || '').trim().toLowerCase() === normalizedEmail;
    });

    if (!guest) {
      throw new NotFoundException('No encontramos un invitado con esos datos dentro de este evento.');
    }

    guest.name = normalizedName || guest.name;
    guest.email = normalizedEmail || guest.email;
    guest.phone = normalizedPhone || guest.phone;
    guest.status = 'confirmed';
    guest.inviteCode = guest.inviteCode || guestToken || this.createInviteCode(guest.email || guest.name);

    const savedGuest = await this.guestRepo.save(guest);
    return this.serializeGuest(savedGuest);
  }
}
