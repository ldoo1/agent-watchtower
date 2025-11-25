import fs from 'fs';
import path from 'path';
import { ProcessInfo } from '../types.js';
import { log } from './logger.js';

/**
 * Auto-discovers Git repository information from a process's working directory
 */
export async function discoverRepo(processInfo: ProcessInfo): Promise<{ repo?: string; branch?: string }> {
  const cwd = processInfo.pm_cwd;
  
  if (!cwd || !fs.existsSync(cwd)) {
    log(`Process ${processInfo.name} has invalid cwd: ${cwd}`, 'warn');
    return {};
  }
  
  // Try package.json first
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.repository) {
        const repo = typeof packageJson.repository === 'string' 
          ? packageJson.repository 
          : packageJson.repository.url;
        
        if (repo) {
          // Normalize GitHub URLs
          const normalized = normalizeRepoUrl(repo);
          log(`Found repo in package.json for ${processInfo.name}: ${normalized}`);
          return { repo: normalized };
        }
      }
    } catch (err) {
      log(`Failed to parse package.json for ${processInfo.name}: ${err}`, 'warn');
    }
  }
  
  // Fallback to .git/config
  const gitConfigPath = path.join(cwd, '.git', 'config');
  if (fs.existsSync(gitConfigPath)) {
    try {
      const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
      const remoteMatch = gitConfig.match(/\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+)/i);
      
      if (remoteMatch && remoteMatch[1]) {
        const repoUrl = remoteMatch[1].trim();
        const normalized = normalizeRepoUrl(repoUrl);
        log(`Found repo in .git/config for ${processInfo.name}: ${normalized}`);
        
        // Try to get current branch
        const branch = await getCurrentBranch(cwd);
        
        return { repo: normalized, branch };
      }
    } catch (err) {
      log(`Failed to parse .git/config for ${processInfo.name}: ${err}`, 'warn');
    }
  }
  
  log(`Could not discover repo for ${processInfo.name}`, 'warn');
  return {};
}

function normalizeRepoUrl(url: string): string {
  // Remove .git suffix
  let normalized = url.replace(/\.git$/, '');
  
  // Convert SSH to HTTPS format
  // git@github.com:owner/repo -> owner/repo
  normalized = normalized.replace(/git@[^:]+:(.+)/, '$1');
  
  // Extract owner/repo from HTTPS URLs
  // https://github.com/owner/repo -> owner/repo
  const httpsMatch = normalized.match(/github\.com[/:]([^/]+\/[^/]+)/);
  if (httpsMatch) {
    return httpsMatch[1];
  }
  
  // If already in owner/repo format, return as-is
  if (/^[^/]+\/[^/]+$/.test(normalized)) {
    return normalized;
  }
  
  return normalized;
}

async function getCurrentBranch(cwd: string): Promise<string | undefined> {
  try {
    const headPath = path.join(cwd, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const head = fs.readFileSync(headPath, 'utf-8').trim();
      const branchMatch = head.match(/refs\/heads\/(.+)/);
      if (branchMatch) {
        return branchMatch[1];
      }
    }
  } catch (err) {
    // Ignore errors
  }
  return undefined;
}
