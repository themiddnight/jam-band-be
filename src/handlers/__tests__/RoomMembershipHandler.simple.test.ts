import { RoomMembershipHandler } from '../RoomMembershipHandler';

describe('RoomMembershipHandler', () => {
  it('should create instance', () => {
    const mockRoomService = {} as any;
    const mockIo = {} as any;
    const mockNamespaceManager = {} as any;
    const mockRoomSessionManager = {} as any;

    const handler = new RoomMembershipHandler(
      mockRoomService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );

    expect(handler).toBeDefined();
  });
});