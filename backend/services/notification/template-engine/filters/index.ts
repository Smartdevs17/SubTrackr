export interface FilterContext {
  locale?: string;
  now?: Date;
}

export type FilterFn = (value: unknown, args: string[], context?: FilterContext) => string;

const DATE_PRESETS: Record<string, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric', year: 'numeric' },
  long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  iso: { year: 'numeric', month: '2-digit', day: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit' },
  datetime: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  relative: {},
};

export const builtinFilters: Record<string, FilterFn> = {
  uppercase: (value: unknown): string => String(value ?? '').toUpperCase(),

  lowercase: (value: unknown): string => String(value ?? '').toLowerCase(),

  date: (value: unknown, args: string[], context?: FilterContext): string => {
    const preset = args[0] || 'short';
    const locale = args[1] || context?.locale || 'en-US';
    const input = value instanceof Date ? value : new Date(String(value ?? ''));

    if (isNaN(input.getTime())) {
      return String(value ?? '');
    }

    if (preset === 'relative') {
      const now = context?.now || new Date();
      const diffMs = now.getTime() - input.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);
      const diffMonth = Math.floor(diffDay / 30);

      if (diffSec < 60) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;
      if (diffDay < 30) return `${diffDay}d ago`;
      if (diffMonth < 12) return `${diffMonth}mo ago`;
      return input.toLocaleDateString(locale, DATE_PRESETS['short']);
    }

    const options = DATE_PRESETS[preset] || DATE_PRESETS['short'];
    return input.toLocaleDateString(locale, options);
  },

  currency: (value: unknown, args: string[], context?: FilterContext): string => {
    const currencyCode = args[0] || 'USD';
    const locale = args[1] || context?.locale || 'en-US';
    const num = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));

    if (isNaN(num)) return String(value ?? '');

    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(num);
    } catch {
      return `${currencyCode} ${num.toFixed(2)}`;
    }
  },

  pluralize: (value: unknown, args: string[]): string => {
    const count = typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10);
    if (isNaN(count)) return String(value ?? '');
    const [singular, plural] = args.length >= 2 ? args : [args[0] || '', `${args[0] || ''}s`];
    return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
  },

  default: (value: unknown, args: string[]): string => {
    const str = String(value ?? '');
    return str.trim() ? str : (args[0] || '');
  },

  length: (value: unknown): string => {
    if (Array.isArray(value)) return String(value.length);
    return String(String(value ?? '').length);
  },

  trim: (value: unknown): string => String(value ?? '').trim(),

  truncate: (value: unknown, args: string[]): string => {
    const maxLen = parseInt(args[0] || '80', 10);
    const str = String(value ?? '');
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + (args[1] || '...');
  },
};

export function resolveFilter(name: string): FilterFn | undefined {
  return builtinFilters[name.toLowerCase()];
}
