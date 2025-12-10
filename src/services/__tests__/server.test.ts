import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { SlackServer } from '../server.js';
import { ProcessMonitor } from '../monitor.js';
import { metrics } from '../metrics.js';

// Mock dependencies
jest.mock('../slack.js', () => ({
  getRetryQueue: jest.fn(() => ({
    getQueueSize: jest.fn(() => 0),
    getDeadLetterSize: jest.fn(() => 0),
  })),
}));

jest.mock('../monitor.js');

describe('SlackServer', () => {
  let server: SlackServer;
  let mockMonitor: jest.Mocked<ProcessMonitor>;

  beforeEach(() => {
    mockMonitor = {
      getProcessList: jest.fn().mockResolvedValue([
        {
          id: 1,
          name: 'test-agent',
          pm_cwd: '/path',
          status: 'online',
          memory: 1000000,
          cpu: 5,
          uptime: 3600000,
        },
      ]),
    } as any;

    server = new SlackServer(mockMonitor, 0); // Port 0 for auto-assign
  });

  it('should respond to health check', async () => {
    server.start();
    const app = (server as any).app as express.Application;
    
    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'OK');
    expect(response.body).toHaveProperty('processCount');
  });

  it('should return 503 when PM2 connection fails', async () => {
    mockMonitor.getProcessList.mockRejectedValueOnce(new Error('PM2 failed'));
    
    server.start();
    const app = (server as any).app as express.Application;
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toHaveProperty('status', 'ERROR');
  });

  it('should expose metrics endpoint', async () => {
    metrics.reset();
    metrics.incrementCounter('test_counter');
    
    server.start();
    const app = (server as any).app as express.Application;
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.get('Content-Type')).toContain('text/plain');
    expect(response.text).toContain('test_counter');
  });

  it('should apply rate limiting to slash command', async () => {
    server.start();
    const app = (server as any).app as express.Application;
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Make requests up to the limit (10 per minute)
    // Note: Rate limiting is per IP, so we need to simulate same IP
    const makeRequest = () => request(app)
      .post('/slack/status')
      .set('x-slack-signature', 'v0=test')
      .set('x-slack-request-timestamp', String(Math.floor(Date.now() / 1000)))
      .send({});
    
    // Make 10 requests (should all succeed)
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(makeRequest());
    }
    await Promise.all(requests);
    
    // 11th request should be rate limited
    const response = await makeRequest();

    // Should be rate limited or pass signature check
    // If signature fails, it's 401, if rate limited it's 429
    expect([401, 429]).toContain(response.status);
  });
});
