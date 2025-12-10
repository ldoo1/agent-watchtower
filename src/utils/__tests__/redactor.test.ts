import { describe, it, expect } from '@jest/globals';
import { redactSecrets, redactObject } from '../redactor.js';

describe('redactSecrets', () => {
  it('should redact OpenAI API keys', () => {
    const input = 'My key is sk-proj-12345678901234567890123456789012';
    const output = redactSecrets(input);
    expect(output).not.toContain('sk-proj-12345678901234567890123456789012');
    expect(output).toContain('[REDACTED_CREDENTIAL]');
  });

  it('should redact JWT tokens', () => {
    const input = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const output = redactSecrets(input);
    expect(output).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(output).toContain('[REDACTED_CREDENTIAL]');
  });

  it('should redact Slack tokens', () => {
    const input = 'Token: xoxb-dummy-token-for-testing-only-12345678901234567890';
    const output = redactSecrets(input);
    expect(output).not.toContain('xoxb-');
    expect(output).toContain('[REDACTED_CREDENTIAL]');
  });

  it('should redact database connection strings', () => {
    const input = 'postgres://user:password@localhost:5432/db';
    const output = redactSecrets(input);
    expect(output).not.toContain('password');
    expect(output).toContain('[REDACTED_CREDENTIAL]');
  });

  it('should not redact normal text', () => {
    const input = 'This is a normal log message with no secrets';
    const output = redactSecrets(input);
    expect(output).toBe(input);
  });
});

describe('redactObject', () => {
  it('should redact sensitive fields in objects', () => {
    const input = {
      name: 'test',
      password: 'secret123',
      apiKey: 'key12345',
    };

    const output = redactObject(input) as typeof input;
    expect(output.password).toBe('[REDACTED_CREDENTIAL]');
    expect(output.apiKey).toBe('[REDACTED_CREDENTIAL]');
    expect(output.name).toBe('test');
  });

  it('should handle nested objects', () => {
    const input = {
      config: {
        secret: 'value',
        public: 'data',
      },
    };

    const output = redactObject(input) as typeof input;
    expect(output.config.secret).toBe('[REDACTED_CREDENTIAL]');
    expect(output.config.public).toBe('data');
  });
});

