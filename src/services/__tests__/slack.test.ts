import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { sendErrorAlert, getRetryQueue } from '../slack.js';
import { ErrorContext } from '../../types.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Slack Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedAxios.post as jest.Mock).mockResolvedValue({ status: 200, data: 'ok' } as any);
  });

  it('should send error alert successfully', async () => {
    const context: ErrorContext = {
      processId: 1,
      processName: 'test-agent',
      errorMessage: 'Test error',
      stackTrace: 'Error: Test error\n    at test.js:1:1',
      logContext: ['Line 1', 'Line 2'],
      repo: 'owner/repo',
      branch: 'main',
      timestamp: new Date(),
    };

    await sendErrorAlert(context);

    expect(mockedAxios.post).toHaveBeenCalled();
    const call = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(call[1]).toMatchObject({
      text: expect.stringContaining('test-agent'),
    });
  });

  it('should queue alert for retry on failure', async () => {
    (mockedAxios.post as jest.Mock).mockRejectedValueOnce(new Error('Network error') as any);

    const context: ErrorContext = {
      processId: 1,
      processName: 'test-agent',
      errorMessage: 'Test error',
      stackTrace: 'Error: Test',
      logContext: [],
      timestamp: new Date(),
    };

    await sendErrorAlert(context);

    // Should have attempted to send
    expect(mockedAxios.post).toHaveBeenCalled();
    
    // Should be queued for retry
    const retryQueue = getRetryQueue();
    expect(retryQueue.getQueueSize()).toBeGreaterThan(0);
    
    // Cleanup
    retryQueue.stop();
  });

  it('should include repo and branch in message', async () => {
    const context: ErrorContext = {
      processId: 1,
      processName: 'test-agent',
      errorMessage: 'Test error',
      stackTrace: 'Error: Test',
      logContext: [],
      repo: 'owner/repo',
      branch: 'feature-branch',
      timestamp: new Date(),
    };

    await sendErrorAlert(context);

    const call = (mockedAxios.post as jest.Mock).mock.calls[0];
    const message = call[1] as any;
    const blocks = message.blocks;
    
    // Find the repo field block
    const repoBlock = blocks.find((b: any) => 
      b.fields?.some((f: any) => f.text?.includes('Repo:'))
    );
    
    expect(repoBlock).toBeDefined();
    expect(JSON.stringify(repoBlock)).toContain('owner/repo');
    expect(JSON.stringify(repoBlock)).toContain('feature-branch');
  });
});
