import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should log to console', async () => {
    const { log } = await import('../logger.js');
    log('Test message');
    
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] Test message')
    );
  });

  it('should log with different levels', async () => {
    const { log } = await import('../logger.js');
    
    log('Info message', 'info');
    log('Warning message', 'warn');
    log('Error message', 'error');
    
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] Info message')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[WARN] Warning message')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR] Error message')
    );
  });

  it('should log errors with context', async () => {
    const { logError } = await import('../logger.js');
    const error = new Error('Test error');
    logError(error, 'Context');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR]')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Context')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Test error')
    );
  });

  it('should log errors without context', async () => {
    const { logError } = await import('../logger.js');
    const error = new Error('Test error');
    logError(error);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR]')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Test error')
    );
  });

  it('should handle non-Error objects', async () => {
    const { logError } = await import('../logger.js');
    logError('String error');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR]')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('String error')
    );
  });

  it('should include timestamp in log format', async () => {
    const { log } = await import('../logger.js');
    log('Test message');
    
    const call = (console.log as jest.Mock).mock.calls[0][0] as string;
    // Should contain ISO timestamp format
    expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
