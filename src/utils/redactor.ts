/**
 * Redacts sensitive credentials from log messages before sending to Slack
 */

const PATTERNS = [
  // OpenAI API keys
  /sk-proj-[a-zA-Z0-9]{32,}/g,
  /sk-[a-zA-Z0-9]{32,}/g,
  
  // JWT tokens / Supabase keys
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  
  // Slack tokens
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
  
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  
  // Generic API keys (common patterns)
  /api[_-]?key["\s:=]+([a-zA-Z0-9_-]{20,})/gi,
  /token["\s:=]+([a-zA-Z0-9_-]{20,})/gi,
  /password["\s:=]+([^\s"']{8,})/gi,
  /password\s+is\s+["']?([^\s"']{8,})["']?/gi,
  /secret["\s:=]+([a-zA-Z0-9_-]{20,})/gi,
  
  // Database connection strings
  /postgres:\/\/[^:\s]+:[^@\s]+@/g,
  /mongodb:\/\/[^:\s]+:[^@\s]+@/g,
  /mysql:\/\/[^:\s]+:[^@\s]+@/g,
];

export function redactSecrets(text: string): string {
  let sanitized = text;
  
  for (const pattern of PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_CREDENTIAL]');
  }
  
  return sanitized;
}

export function redactObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return redactSecrets(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || 
          lowerKey.includes('secret') || 
          lowerKey.includes('token') || 
          lowerKey.includes('key') ||
          lowerKey.includes('credential')) {
        sanitized[key] = '[REDACTED_CREDENTIAL]';
      } else {
        sanitized[key] = redactObject(value);
      }
    }
    return sanitized;
  }
  
  return obj;
}
