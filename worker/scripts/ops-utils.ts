import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WRANGLER_MAX_BUFFER = 25 * 1024 * 1024;

export const D1_DATABASE = 'csgogamble';

export function loadCloudflareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!existsSync('.dev.vars')) return env;

  const lines = readFileSync('.dev.vars', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    env[key] = env[key] ?? value;
  }

  env.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID ?? env.CF_ACCOUNT_ID;
  return env;
}

const cloudflareEnv = loadCloudflareEnv();

export async function wrangler(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: cloudflareEnv,
    maxBuffer: WRANGLER_MAX_BUFFER,
  });
  return stdout;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function parseD1Rows<T>(output: string, mapper: (row: Record<string, unknown>) => T): T[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || !isRecord(parsed[0]) || !Array.isArray(parsed[0].results)) return [];
  return parsed[0].results.filter(isRecord).map(mapper);
}

export async function queryD1<T>(sql: string, mapper: (row: Record<string, unknown>) => T): Promise<T[]> {
  const output = await wrangler(['d1', 'execute', D1_DATABASE, '--remote', '--json', '--command', sql]);
  return parseD1Rows(output, mapper);
}

export async function executeD1(sql: string): Promise<void> {
  await wrangler(['d1', 'execute', D1_DATABASE, '--remote', '--command', sql]);
}
