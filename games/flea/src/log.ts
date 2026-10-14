export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, ctx?: LogContext): void;
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, ctx?: LogContext): void;
  child(module: string): Logger;
}

interface LevelConfig {
  level: LogLevel;
  source: 'url' | 'localStorage' | 'default';
  rejected?: { source: string; value: string };
  storageError?: unknown;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_VALUE = 2048;
const MAX_DEPTH = 5;
const ERROR_OWN_KEYS = new Set(['name', 'message', 'stack', 'cause', 'code', 'errors']);

const isLevel = (value: unknown): value is LogLevel => typeof value === 'string' && value in ORDER;
const defaultLevel = (): LogLevel => (import.meta.env.DEV ? 'info' : 'warn');

function readLevel(): LevelConfig {
  const fromUrl = new URLSearchParams(window.location.search).get('log');
  if (fromUrl !== null) {
    const normalized = fromUrl.trim().toLowerCase();
    if (isLevel(normalized)) return { level: normalized, source: 'url' };
    return { level: defaultLevel(), source: 'default', rejected: { source: '?log=', value: fromUrl } };
  }
  try {
    const fromStorage = window.localStorage.getItem('LOG_LEVEL');
    if (fromStorage !== null) {
      const normalized = fromStorage.trim().toLowerCase();
      if (isLevel(normalized)) return { level: normalized, source: 'localStorage' };
      return { level: defaultLevel(), source: 'default', rejected: { source: 'localStorage.LOG_LEVEL', value: fromStorage } };
    }
  } catch (storageError) {
    return { level: defaultLevel(), source: 'default', storageError };
  }
  return { level: defaultLevel(), source: 'default' };
}

const config = readLevel();

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function clock(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function serializeError(error: Error, depth = 0): Record<string, unknown> {
  const source = error as Error & Record<string, unknown>;
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  if (source.code !== undefined) out.code = source.code;
  for (const key of Object.keys(error)) if (!ERROR_OWN_KEYS.has(key)) out[key] = source[key];
  if (Array.isArray(source.errors)) {
    out.errors = depth < MAX_DEPTH ? source.errors.map((item: unknown) => (item instanceof Error ? serializeError(item, depth + 1) : item)) : '[too deep]';
  }
  if (error.stack) out.stack = error.stack;
  if (source.cause !== undefined) {
    if (depth >= MAX_DEPTH) out.cause = '[cause chain too deep]';
    else out.cause = source.cause instanceof Error ? serializeError(source.cause, depth + 1) : source.cause;
  }
  return out;
}

function jsonReplacer(): (this: unknown, key: string, raw: unknown) => unknown {
  const ancestors: Array<{ raw: object; holder: unknown }> = [];
  return function replace(this: unknown, _key: string, raw: unknown): unknown {
    if (typeof raw === 'bigint') return `${raw}n`;
    if (typeof raw !== 'object' || raw === null) return raw;
    let value: unknown = raw;
    if (raw instanceof Error) value = serializeError(raw);
    else if (raw instanceof Map) value = Object.fromEntries(raw);
    else if (raw instanceof Set) value = Array.from(raw);
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]?.holder !== this) ancestors.pop();
    if (ancestors.some((entry) => entry.raw === raw)) return '[Circular]';
    ancestors.push({ raw, holder: value });
    return value;
  };
}

function truncate(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}...(${text.length} chars total)` : text;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return truncate(/[\s"=]/.test(value) || value === '' ? JSON.stringify(value) : value);
  if (value === undefined) return 'undefined';
  try {
    return truncate(JSON.stringify(value, jsonReplacer()) ?? String(value));
  } catch (error) {
    return `[unserializable ${Object.prototype.toString.call(value)}: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function format(level: LogLevel, module: string, message: string, ctx?: LogContext): string {
  const pairs = ctx ? Object.entries(ctx).map(([key, value]) => `${key}=${formatValue(value)}`) : [];
  return `${clock()} ${level.toUpperCase().padEnd(5)} [${module}] ${message}${pairs.length ? ` ${pairs.join(' ')}` : ''}`;
}

const sinks: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.log(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export function createLogger(module: string): Logger {
  const write = (level: LogLevel) => (message: string, ctx?: LogContext) => {
    if (ORDER[level] < ORDER[config.level]) return;
    sinks[level](format(level, module, message, ctx));
  };
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (sub) => createLogger(`${module}:${sub}`),
  };
}

export function since(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function installGlobalHandlers(): void {
  const log = createLogger('global');
  if (config.rejected) {
    log.warn(`unknown log level in ${config.rejected.source}, using ${config.level}`, {
      value: config.rejected.value,
      allowed: Object.keys(ORDER).join(','),
    });
  }
  if (config.storageError) {
    log.warn('localStorage is not available, LOG_LEVEL from storage ignored', { error: config.storageError });
  }
  log.debug('log level resolved', { level: config.level, source: config.source });
  window.addEventListener('error', (event) => {
    log.error('uncaught error', {
      message: event.message,
      source: `${event.filename}:${event.lineno}:${event.colno}`,
      error: event.error,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled promise rejection', { reason: event.reason });
  });
}
