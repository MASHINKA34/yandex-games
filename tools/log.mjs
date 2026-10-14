import winston from 'winston';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_VALUE = 2048;
const MAX_CAUSE_DEPTH = 5;

const pad = (n, width = 2) => String(n).padStart(width, '0');

function clock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

const ERROR_OWN_KEYS = new Set(['name', 'message', 'stack', 'cause', 'code', 'errors']);

function extraErrorFields(error) {
  const extra = {};
  for (const key of Object.keys(error)) if (!ERROR_OWN_KEYS.has(key)) extra[key] = error[key];
  return extra;
}

function serializeError(error, depth = 0) {
  const out = { name: error.name, message: error.message };
  if (error.code !== undefined) out.code = error.code;
  Object.assign(out, extraErrorFields(error));
  if (Array.isArray(error.errors)) {
    out.errors = depth < MAX_CAUSE_DEPTH ? error.errors.map((item) => (item instanceof Error ? serializeError(item, depth + 1) : item)) : '[too deep]';
  }
  if (error.stack) out.stack = error.stack;
  if (error.cause !== undefined) {
    if (depth >= MAX_CAUSE_DEPTH) out.cause = '[cause chain too deep]';
    else out.cause = error.cause instanceof Error ? serializeError(error.cause, depth + 1) : error.cause;
  }
  return out;
}

function jsonReplacer() {
  const ancestors = [];
  return function replace(_key, raw) {
    if (typeof raw === 'bigint') return `${raw}n`;
    if (typeof raw !== 'object' || raw === null) return raw;
    let value = raw;
    if (raw instanceof Error) value = serializeError(raw);
    else if (raw instanceof Map) value = Object.fromEntries(raw);
    else if (raw instanceof Set) value = Array.from(raw);
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].holder !== this) ancestors.pop();
    if (ancestors.some((entry) => entry.raw === raw)) return '[Circular]';
    ancestors.push({ raw, holder: value });
    return value;
  };
}

function truncate(text) {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}...(${text.length} chars total)` : text;
}

function formatValue(value) {
  if (typeof value === 'string') return truncate(/[\s"=]/.test(value) || value === '' ? JSON.stringify(value) : value);
  if (value === undefined) return 'undefined';
  try {
    return truncate(JSON.stringify(value, jsonReplacer()) ?? String(value));
  } catch (error) {
    return `[unserializable ${Object.prototype.toString.call(value)}: ${error.message}]`;
  }
}

function formatError(error, depth = 0) {
  const extra = extraErrorFields(error);
  const extraText = Object.keys(extra).length > 0 ? ` ${formatValue(extra)}` : '';
  const head = `${error.name}: ${error.message}${error.code !== undefined ? ` code=${error.code}` : ''}${extraText}`;
  const stack = error.stack ? `\n    ${error.stack.split('\n').slice(1).map((line) => line.trim()).join('\n    ')}` : '';
  const nested = (label, value) =>
    `\n    ${label}: ${value instanceof Error && depth < MAX_CAUSE_DEPTH ? formatError(value, depth + 1) : formatValue(value)}`;
  const errors = Array.isArray(error.errors) ? error.errors.map((item, i) => nested(`errors[${i}]`, item)).join('') : '';
  const cause = error.cause !== undefined ? nested('cause', error.cause) : '';
  return head + stack + errors + cause;
}

const lineFormat = winston.format.printf((info) => {
  const ctx = info.ctx ?? {};
  const errors = [];
  const pairs = [];
  for (const [key, value] of Object.entries(ctx)) {
    if (value instanceof Error) {
      pairs.push(`${key}=${value.name}`);
      errors.push(`  ${key}: ${formatError(value)}`);
    } else {
      pairs.push(`${key}=${formatValue(value)}`);
    }
  }
  const tail = pairs.length ? ` ${pairs.join(' ')}` : '';
  const errorBlock = errors.length ? `\n${errors.join('\n')}` : '';
  return `${clock()} ${info.level.toUpperCase().padEnd(5)} [${info.module}] ${info.message}${tail}${errorBlock}`;
});

const envLevel = process.env.LOG_LEVEL?.toLowerCase();

const base = winston.createLogger({
  levels: LEVELS,
  level: envLevel && envLevel in LEVELS ? envLevel : 'info',
  format: lineFormat,
  transports: [new winston.transports.Console({ stderrLevels: ['error', 'warn'] })],
});

export function createLogger(module) {
  const write = (level) => (message, ctx) => base.log(level, message, { module, ctx });
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (sub) => createLogger(`${module}:${sub}`),
  };
}

export function since(startedAt) {
  return Math.round(performance.now() - startedAt);
}

export function installProcessHandlers(log) {
  const fail = (message, ctx) => {
    log.error(message, ctx);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 200);
  };
  process.on('uncaughtException', (error) => fail('uncaught exception, exiting', { error }));
  process.on('unhandledRejection', (reason) => fail('unhandled promise rejection, exiting', { reason }));
}
