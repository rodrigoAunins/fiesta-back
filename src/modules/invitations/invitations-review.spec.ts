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
});
