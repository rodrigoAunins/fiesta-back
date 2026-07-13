import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invitation } from '../../entities/invitation.entity';
import { InvitationAsset } from '../../entities/invitation-asset.entity';
import { EventGuest } from '../../entities/event-guest.entity';
import { Raffle } from '../../entities/raffle.entity';
import { randomUUID } from 'crypto';

type GuestPayload = {
  id?: string;
  name?: string;
  status?: string;
  gender?: string;
  food?: string;
  age?: number | null;
  ageGroup?: string;
  companions?: number;
  companionsData?: CompanionPayload[];
  table?: string;
  tableId?: string | null;
  seatIndex?: number | null;
  phone?: string;
  email?: string | null;
  inviteCode?: string;
  note?: string | null;
  side?: string;
  registrationSource?: string;
  reviewStatus?: string;
  rejectionReason?: string | null;
};

type CompanionPayload = {
  id?: string;
  name?: string;
  status?: string;
  gender?: string;
  food?: string;
  age?: number | null;
  ageGroup?: string;
  tableId?: string | null;
  seatIndex?: number | null;
  email?: string | null;
  phone?: string | null;
};

type PublicRsvpPayload = {
  guestToken?: string | null;
  name?: string;
  email?: string;
  phone?: string;
  gender?: string;
  food?: string;
  age?: number | null;
  ageGroup?: string;
  confirmCompanions?: boolean;
  companionsData?: CompanionPayload[];
};

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation)
    private readonly repo: Repository<Invitation>,

    @InjectRepository(EventGuest)
    private readonly guestRepo: Repository<EventGuest>,

    @InjectRepository(InvitationAsset)
    private readonly assetRepo: Repository<InvitationAsset>,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,
  ) {}

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

  private isDraftWorkspace(workspaceId: string): boolean {
    return String(workspaceId || '').startsWith('draft-');
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

  private normalizeAge(raw: unknown): number | null {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 130) return null;
    return Math.round(value);
  }

  private normalizeAgeGroup(raw: unknown): string {
    const value = String(raw || '').trim().toLowerCase();
    if (['child', 'niño', 'nino', 'menor', 'menor de edad'].includes(value)) return 'child';
    if (['senior', 'mayor', 'adulto mayor', 'tercera edad'].includes(value)) return 'senior';
    return 'adult';
  }

  private normalizeReviewStatus(raw: unknown): string {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'pending_review' || value === 'pending-review' || value === 'revision' || value === 'revisión') return 'pending_review';
    if (value === 'rejected' || value === 'rechazado') return 'rejected';
    return 'approved';
  }

  private normalizeRegistrationSource(raw: unknown): string {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'public' || value === 'import') return value;
    return 'manual';
  }

  private normalizeSeatIndex(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 500) return null;
    return value;
  }

  private normalizeCompanionPayload(payload: CompanionPayload, index: number) {
    const name = String(payload?.name || `Acompañante ${index + 1}`).trim() || `Acompañante ${index + 1}`;
    const email = String(payload?.email || '').trim().toLowerCase() || undefined;
    const phone = String(payload?.phone || '').trim() || undefined;

    return {
      id: String(payload?.id || `comp-${randomUUID()}`).trim(),
      name,
      status: this.normalizeGuestStatus(payload?.status),
      gender: this.normalizeGuestGender(payload?.gender),
      food: String(payload?.food || 'Sin restriccion').trim() || 'Sin restriccion',
      age: this.normalizeAge(payload?.age),
      ageGroup: this.normalizeAgeGroup(payload?.ageGroup),
      tableId: String(payload?.tableId || '').trim() || null,
      seatIndex: this.normalizeSeatIndex(payload?.seatIndex),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    };
  }

  private normalizeCompanionsData(payload: GuestPayload | PublicRsvpPayload) {
    const companionsData = Array.isArray(payload?.companionsData)
      ? payload.companionsData
          .filter((item) => String(item?.name || '').trim())
          .map((item, index) => this.normalizeCompanionPayload(item, index))
      : [];

    if (companionsData.length) return companionsData.slice(0, 20);

    const count = Math.max(0, Math.min(20, Number((payload as GuestPayload)?.companions ?? 0) || 0));
    return Array.from({ length: count }, (_, index) => this.normalizeCompanionPayload({ name: `Acompañante ${index + 1}` }, index));
  }

  async listByWorkspace(workspaceId: string, userId: string, role: string): Promise<Invitation[]> {
    if (this.isDraftWorkspace(workspaceId)) {
      return [];
    }

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
    const companionsData = this.normalizeCompanionsData(payload);

    return this.guestRepo.create({
      id: String(payload?.id || `guest-${randomUUID()}`).trim(),
      workspaceId,
      name,
      status: this.normalizeGuestStatus(payload?.status),
      gender: this.normalizeGuestGender(payload?.gender),
      food: String(payload?.food || 'Sin restriccion').trim() || 'Sin restriccion',
      age: this.normalizeAge(payload?.age),
      ageGroup: this.normalizeAgeGroup(payload?.ageGroup),
      companions: companionsData.length,
      companionsData,
      table: String(payload?.table || 'Sin mesa').trim() || 'Sin mesa',
      tableId: String(payload?.tableId || '').trim() || null,
      seatIndex: this.normalizeSeatIndex(payload?.seatIndex),
      phone: String(payload?.phone || '-').trim() || '-',
      email,
      inviteCode: String(payload?.inviteCode || this.createInviteCode(email || name)).trim() || this.createInviteCode(name),
      note: String(payload?.note || '').trim() || null,
      side: payload?.side === 'right' ? 'right' : 'left',
      registrationSource: this.normalizeRegistrationSource(payload?.registrationSource),
      reviewStatus: this.normalizeReviewStatus(payload?.reviewStatus),
      rejectionReason: String(payload?.rejectionReason || '').trim() || null,
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
      age: guest.age ?? null,
      ageGroup: this.normalizeAgeGroup(guest.ageGroup),
      companions: Array.isArray(guest.companionsData) && guest.companionsData.length ? guest.companionsData.length : Number(guest.companions || 0),
      companionsData: Array.isArray(guest.companionsData)
        ? guest.companionsData.map((item, index) => this.normalizeCompanionPayload(item, index))
        : [],
      table: guest.table,
      tableId: guest.tableId || undefined,
      seatIndex: this.normalizeSeatIndex(guest.seatIndex),
      phone: guest.phone,
      email: guest.email || undefined,
      inviteCode: guest.inviteCode,
      note: guest.note || undefined,
      side: guest.side === 'right' ? 'right' : 'left',
      registrationSource: this.normalizeRegistrationSource(guest.registrationSource),
      reviewStatus: this.normalizeReviewStatus(guest.reviewStatus),
      reviewedAt: guest.reviewedAt || null,
      reviewedByUserId: guest.reviewedByUserId || null,
      rejectionReason: guest.rejectionReason || undefined,
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
    if (this.isDraftWorkspace(workspaceId)) {
      throw new ForbiddenException('Primero tenes que crear el evento para guardar invitaciones.');
    }

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

  async uploadImage(
    workspaceId: string,
    userId: string,
    role: string,
    file?: Express.Multer.File,
  ): Promise<string> {
    await this.assertWorkspaceAccess(workspaceId, userId, role);

    if (!file?.buffer?.length || !String(file.mimetype || '').startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen valida.');
    }

    const asset = this.assetRepo.create({
      workspaceId,
      creatorId: userId,
      originalName: String(file.originalname || 'imagen').slice(0, 255),
      mimeType: String(file.mimetype).slice(0, 100),
      size: file.buffer.length,
      data: file.buffer,
    });

    const saved = await this.assetRepo.save(asset);
    return `/api/invitations/assets/${saved.id}`;
  }

  async getAsset(id: string): Promise<InvitationAsset> {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Imagen no encontrada');
    return asset;
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
    if (this.isDraftWorkspace(workspaceId)) {
      return [];
    }

    await this.assertWorkspaceAccess(workspaceId, userId, role);

    const guests = await this.guestRepo.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });

    return guests.map((guest) => this.serializeGuest(guest));
  }

  async replaceGuestsByWorkspace(workspaceId: string, userId: string, role: string, guests: GuestPayload[]) {
    if (this.isDraftWorkspace(workspaceId)) {
      return Array.isArray(guests)
        ? guests.map((guest, index) => this.serializeGuest(this.normalizeGuestPayload(guest, index, workspaceId)))
        : [];
    }

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

  async reviewGuest(workspaceId: string, guestId: string, userId: string, role: string, payload: { reviewStatus?: string; rejectionReason?: string | null }) {
    await this.assertWorkspaceAccess(workspaceId, userId, role);

    const guest = await this.guestRepo.findOne({ where: { id: guestId, workspaceId } });
    if (!guest) {
      throw new NotFoundException('Invitado no encontrado');
    }

    const reviewStatus = this.normalizeReviewStatus(payload?.reviewStatus);
    if (!['approved', 'rejected'].includes(reviewStatus)) {
      throw new ForbiddenException('Estado de revision invalido');
    }

    guest.reviewStatus = reviewStatus;
    guest.reviewedAt = new Date();
    guest.reviewedByUserId = userId;
    guest.rejectionReason = reviewStatus === 'rejected' ? String(payload?.rejectionReason || '').trim() || null : null;
    if (reviewStatus === 'rejected') {
      guest.status = 'absent';
    }

    const saved = await this.guestRepo.save(guest);
    return this.serializeGuest(saved);
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
    let guest = guests.find((item) => {
      if (guestToken && (item.id === guestToken || item.inviteCode === guestToken)) return true;
      return normalizedEmail && String(item.email || '').trim().toLowerCase() === normalizedEmail;
    });

    if (!guest) {
      guest = this.normalizeGuestPayload(
        {
          name: normalizedName || 'Invitado sin nombre',
          email: normalizedEmail,
          phone: normalizedPhone || '-',
          gender: payload?.gender,
          food: payload?.food,
          age: payload?.age,
          ageGroup: payload?.ageGroup,
          companionsData: payload?.confirmCompanions ? payload?.companionsData : [],
          registrationSource: 'public',
          reviewStatus: 'pending_review',
          status: 'pending',
        },
        guests.length,
        workspaceId,
      );
    } else {
      guest.name = normalizedName || guest.name;
      guest.email = normalizedEmail || guest.email;
      guest.phone = normalizedPhone || guest.phone;
      guest.status = 'confirmed';
      guest.gender = this.normalizeGuestGender(payload?.gender || guest.gender);
      guest.food = String(payload?.food || guest.food || 'Sin restriccion').trim() || 'Sin restriccion';
      guest.age = this.normalizeAge(payload?.age ?? guest.age);
      guest.ageGroup = this.normalizeAgeGroup(payload?.ageGroup || guest.ageGroup);
      guest.reviewStatus = this.normalizeReviewStatus(guest.reviewStatus);
      guest.registrationSource = this.normalizeRegistrationSource(guest.registrationSource);
      if (payload?.confirmCompanions) {
        const companionsData = this.normalizeCompanionsData(payload);
        guest.companionsData = companionsData;
        guest.companions = companionsData.length;
      }
    }

    guest.inviteCode = guest.inviteCode || guestToken || this.createInviteCode(guest.email || guest.name);

    const savedGuest = await this.guestRepo.save(guest);
    return this.serializeGuest(savedGuest);
  }
}
