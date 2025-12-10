import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ProcessMonitor } from '../monitor.js';
import pm2 from 'pm2';

jest.mock('pm2');

describe('ProcessMonitor', () => {
  let monitor: ProcessMonitor;

  beforeEach(() => {
    monitor = new ProcessMonitor();
    jest.clearAllMocks();
    
    // Mock PM2 methods
    const mockConnect = jest.fn((callback: any) => {
      setTimeout(() => callback(null), 0);
    });
    const mockLaunchBus = jest.fn((callback: any) => {
      const mockBus = {
        on: jest.fn(),
      };
      setTimeout(() => callback(null, mockBus), 0);
    });
    const mockList = jest.fn((callback: any) => {
      callback(null, []);
    });
    const mockDisconnect = jest.fn();

    (pm2 as any).connect = mockConnect;
    (pm2 as any).launchBus = mockLaunchBus;
    (pm2 as any).list = mockList;
    (pm2 as any).disconnect = mockDisconnect;
    (pm2 as any).describe = jest.fn((callback: any) => {
      callback(null, []);
    });
  });

  afterEach(async () => {
    await monitor.stop();
  });

  it('should start and connect to PM2', async () => {
    await monitor.start();
    
    expect((pm2 as any).connect).toHaveBeenCalled();
  });

  it('should not start if already running', async () => {
    await monitor.start();
    const initialCalls = (pm2 as any).connect.mock.calls.length;
    
    await monitor.start(); // Try to start again
    
    // Should not call connect again
    expect((pm2 as any).connect).toHaveBeenCalledTimes(initialCalls);
  });

  it('should get process list', async () => {
    const mockProcesses = [
      {
        pm_id: 1,
        name: 'test-agent',
        pm2_env: { pm_cwd: '/path/to/test', status: 'online', pm_uptime: Date.now() },
        monit: { memory: 1000000, cpu: 5 },
      },
    ];

    (pm2 as any).list = jest.fn((callback: any) => {
      callback(null, mockProcesses);
    });

    const processes = await monitor.getProcessList();

    expect(processes).toHaveLength(1);
    expect(processes[0].name).toBe('test-agent');
    expect(processes[0].status).toBe('online');
  });

  it('should stop gracefully', async () => {
    await monitor.start();
    await monitor.stop();
    
    expect((pm2 as any).disconnect).toHaveBeenCalled();
  });
});
