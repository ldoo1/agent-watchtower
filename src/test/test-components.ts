import dotenv from 'dotenv';
import path from 'path';

// Load .env explicitly from the project root
console.log('CWD:', process.cwd());
const envPath = path.resolve(process.cwd(), '.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

async function runTests() {
  // Dynamic imports to ensure env is loaded first
  const { redactSecrets } = await import('../utils/redactor.js');
  const { sendErrorAlert } = await import('../services/slack.js');

  console.log('🧪 Starting Component Tests...\n');

  // 1. Test Redactor
  console.log('🔒 Testing Redactor...');
  // Dummy secrets for testing - NOT real credentials
  const secret = 'sk-proj-12345678901234567890123456789012';
  const input = `My API key is ${secret} and my password is "secret123"`;
  const output = redactSecrets(input);
  
  if (output.includes(secret) || output.includes('secret123')) {
    console.error('❌ Redactor FAILED: Secrets were leaked!');
    console.error('Output:', output);
    process.exit(1);
  } else {
    console.log('✅ Redactor PASSED: Secrets hidden.');
    console.log(`   Input: "${input}"`);
    console.log(`   Output: "${output}"\n`);
  }

  // 2. Test Slack Alert
  console.log('📣 Testing Slack Alert...');
  try {
    await sendErrorAlert({
      processId: 999,
      processName: 'test-agent',
      errorMessage: 'Test Error: Nothing is actually broken',
      stackTrace: 'Error: Test Error\n    at runTests (test-components.ts:25:5)',
      logContext: [
        '[INFO] Starting test...',
        `[INFO] Using sensitive key: ${secret}`, // Should be redacted in Slack
        '[ERROR] Simulation complete'
      ],
      repo: 'aidan/agent-watchtower',
      branch: 'test-branch',
      timestamp: new Date()
    });
    console.log('✅ Slack Alert PASSED: Check your channel for the notification.');
  } catch (error) {
    console.error('❌ Slack Alert FAILED:', error);
    process.exit(1);
  }
}

runTests();

