import { InvitationsService } from './invitations.service';

describe('InvitationsService guest review', () => {
  function createService(guest: Record<string, unknown>) {
    const invitationRepo = {};
    const guestRepo = {
      findOne: jest.fn().mockResolvedValue(guest),
      save: jest.fn(async (value) => value),
    };
    const assetRepo = {};
    const raffleRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    return {
      service: new InvitationsService(
        invitationRepo as any,
        guestRepo as any,
        assetRepo as any,
        raffleRepo as any,
      ),
      guestRepo,
    };
  }

  it('confirms a pending guest when the manual review is approved', async () => {
    const guest = {
      id: 'guest-1',
      workspaceId: 'workspace-1',
      name: 'Jose Luis Molina',
      status: 'pending',
      reviewStatus: 'pending_review',
      registrationSource: 'public',
      companions: 0,
      companionsData: [],
      phone: '3855107706',
      table: 'Sin mesa',
    };
    const { service, guestRepo } = createService(guest);

    const result = await service.reviewGuest(
      'workspace-1',
      'guest-1',
      'manager-1',
      'master',
      { reviewStatus: 'approved' },
    );

    expect(guest.reviewStatus).toBe('approved');
    expect(guest.status).toBe('confirmed');
    expect(result.status).toBe('confirmed');
    expect(guestRepo.save).toHaveBeenCalledWith(guest);
  });

  it('does not let a delayed list autosave undo an approved public guest', async () => {
    const reviewedAt = new Date('2026-07-16T14:06:47.472Z');
    const createdAt = new Date('2026-07-10T12:00:00.000Z');
    const existingGuest = {
      id: 'guest-1',
      workspaceId: 'workspace-1',
      name: 'Jose Luis Molina',
      status: 'confirmed',
      registrationSource: 'public',
      reviewStatus: 'approved',
      reviewedAt,
      reviewedByUserId: '4a57be23-a9ce-4416-b5a2-be71f2268726',
      rejectionReason: null,
      createdAt,
    };
    const manager = {
      find: jest.fn().mockResolvedValue([existingGuest]),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (_entity, values) => values),
    };
    const guestRepo = {
      create: jest.fn((value) => value),
      manager: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
    };
    const raffleRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const service = new InvitationsService(
      {} as any,
      guestRepo as any,
      {} as any,
      raffleRepo as any,
    );

    const result = await service.replaceGuestsByWorkspace(
      'workspace-1',
      'manager-1',
      'master',
      [
        {
          id: 'guest-1',
          name: 'Jose Luis Molina',
          status: 'pending',
          registrationSource: 'public',
          reviewStatus: 'approved',
          phone: '3855107706',
        },
      ],
    );

    expect(manager.save).toHaveBeenCalled();
    const savedGuest = manager.save.mock.calls[0][1][0];
    expect(savedGuest.status).toBe('confirmed');
    expect(savedGuest.reviewStatus).toBe('approved');
    expect(savedGuest.reviewedAt).toBe(reviewedAt);
    expect(savedGuest.reviewedByUserId).toBe(existingGuest.reviewedByUserId);
    expect(savedGuest.createdAt).toBe(createdAt);
    expect(result[0]).toMatchObject({
      status: 'confirmed',
      reviewStatus: 'approved',
      reviewedAt,
      reviewedByUserId: existingGuest.reviewedByUserId,
    });
  });
});
