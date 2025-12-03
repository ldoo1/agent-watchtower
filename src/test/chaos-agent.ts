/**
 * Chaos Agent - Intentionally crashes to test the Watchtower
 * Run this with PM2 to verify the monitoring pipeline
 */

console.log('[CHAOS] Starting chaos agent...');
console.log('[CHAOS] This agent will crash in 5 seconds...');

// Simulate some sensitive logs to test redaction
// NOTE: These are fake credentials for testing purposes
console.log('[CHAOS] Connecting to DB with password: super_secret_password_123');
console.log('[CHAOS] API Key: sk-proj-12345678901234567890123456789012');

setTimeout(() => {
  console.log('[CHAOS] About to crash...');
  console.log('[CHAOS] Simulating error scenario...');
  
  // Intentionally cause an error
  const obj: any = null;
  console.log(obj.propertyThatDoesNotExist);
  
}, 5000);
