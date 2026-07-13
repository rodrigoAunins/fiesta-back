import { ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService event final-user assignments', () => {
  function createService() {
    const configService = { get: jest.fn().mockReturnValue('') };
    const userRepo = { findOne: jest.fn() };
    const raffleRepo = { findOne: jest.fn(), save: jest.fn(async (value) => value) };
    const unusedRepo = {};
    const service = new AdminService(
      configService as any,
      userRepo as any,
      raffleRepo as any,
      unusedRepo as any,
      unusedRepo as any,
      unusedRepo as any,
      unusedRepo as any,
      unusedRepo as any,
      unusedRepo as any,
    );
    return { service, userRepo, raffleRepo };
  }

  const baseEvent = () => ({
    id: 'event-1',
    title: 'Fiesta',
    status: 'active',
    drawDate: new Date('2026-12-01T20:00:00Z'),
    createdAt: new Date('2026-07-13T12:00:00Z'),
    totalNumbers: 100,
    creator: { id: 'organizer-1', firstName: 'Org', lastName: 'Uno', email: 'org@example.com' },
    createdBy: { id: 'organizer-1' },
    finalUser: null,
    finalUserId: null,
  });

  it('associates a final user as master', async () => {
    const { service, userRepo, raffleRepo } = createService();
    const event = baseEvent();
    const finalUser = { id: 'user-1', role: 'guest', firstName: 'Monica', lastName: 'Cliente', email: 'monica@example.com' };
    raffleRepo.findOne.mockResolvedValue(event);
    userRepo.findOne.mockResolvedValue(finalUser);

    const result = await service.assignFinalUser({ id: 'master-1', role: 'master' }, event.id, finalUser.id);

    expect(event.finalUserId).toBe(finalUser.id);
    expect(event.finalUser).toBe(finalUser);
    expect(result.finalUserId).toBe(finalUser.id);
  });

  it('removes the final-user association without deleting the event', async () => {
    const { service, raffleRepo } = createService();
    const event = { ...baseEvent(), finalUserId: 'user-1', finalUser: { id: 'user-1' } };
    raffleRepo.findOne.mockResolvedValue(event);

    const result = await service.assignFinalUser({ id: 'master-1', role: 'master' }, event.id, null);

    expect(event.finalUserId).toBeNull();
    expect(event.finalUser).toBeNull();
    expect(result.id).toBe(event.id);
  });

  it('blocks an organizer from changing an unrelated event', async () => {
    const { service, raffleRepo } = createService();
    raffleRepo.findOne.mockResolvedValue(baseEvent());

    await expect(service.assignFinalUser(
      { id: 'organizer-2', role: 'organizer', email: 'other@example.com' },
      'event-1',
      null,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
