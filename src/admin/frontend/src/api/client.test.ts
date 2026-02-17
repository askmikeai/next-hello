import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getStats,
  getContacts,
  getQueues,
  getHealth,
  getMessages,
  getActivities,
  getSwarmStates,
  getAgentStats,
  sendVoice,
  sendVideo,
} from './client';
import {
  mockStats,
  mockContacts,
  mockQueues,
  mockHealth,
  mockMessages,
  mockActivities,
  mockSwarmStates,
  mockAgentStats,
} from '../test/mocks';

describe('API Client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getStats', () => {
    it('should fetch stats successfully', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStats),
      } as Response);

      const result = await getStats();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/stats');
      expect(result).toEqual(mockStats);
    });

    it('should throw on HTTP error', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(getStats()).rejects.toThrow('HTTP 500: Internal Server Error');
    });
  });

  describe('getContacts', () => {
    it('should fetch contacts with default limit', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockContacts),
      } as Response);

      const result = await getContacts();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/contacts?limit=15');
      expect(result).toEqual(mockContacts);
    });

    it('should fetch contacts with custom limit', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockContacts),
      } as Response);

      await getContacts(25);

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/contacts?limit=25');
    });
  });

  describe('getQueues', () => {
    it('should fetch queue stats', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQueues),
      } as Response);

      const result = await getQueues();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/queues');
      expect(result).toEqual(mockQueues);
    });
  });

  describe('getHealth', () => {
    it('should fetch health status', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      } as Response);

      const result = await getHealth();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/health');
      expect(result).toEqual(mockHealth);
    });
  });

  describe('getMessages', () => {
    it('should fetch messages with default limit', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      } as Response);

      const result = await getMessages();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/messages?limit=50');
      expect(result).toEqual(mockMessages);
    });

    it('should fetch messages filtered by phone', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      } as Response);

      await getMessages(50, '+1555123456');

      expect(global.fetch).toHaveBeenCalledWith(
        '/admin/api/messages?limit=50&phone=%2B1555123456'
      );
    });
  });

  describe('getActivities', () => {
    it('should fetch activities with default limit', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      } as Response);

      const result = await getActivities();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/activities?limit=20');
      expect(result).toEqual(mockActivities);
    });

    it('should fetch activities filtered by agent type', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      } as Response);

      await getActivities(20, 'orchestrator');

      expect(global.fetch).toHaveBeenCalledWith(
        '/admin/api/activities?limit=20&agentType=orchestrator'
      );
    });
  });

  describe('getSwarmStates', () => {
    it('should fetch swarm states', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSwarmStates),
      } as Response);

      const result = await getSwarmStates();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/swarm/states');
      expect(result).toEqual(mockSwarmStates);
    });
  });

  describe('getAgentStats', () => {
    it('should fetch agent stats', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgentStats),
      } as Response);

      const result = await getAgentStats();

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/swarm/agents');
      expect(result).toEqual(mockAgentStats);
    });
  });

  describe('sendVoice', () => {
    it('should send voice request', async () => {
      const mockResponse = { success: true, jobId: 'job-123' };
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await sendVoice('contact-1');

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/send-voice/contact-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: undefined,
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('sendVideo', () => {
    it('should send video request', async () => {
      const mockResponse = { success: true, jobId: 'job-456' };
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await sendVideo('contact-1');

      expect(global.fetch).toHaveBeenCalledWith('/admin/api/send-video/contact-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: undefined,
      });
      expect(result).toEqual(mockResponse);
    });
  });
});
