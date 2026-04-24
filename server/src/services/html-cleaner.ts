import * as cheerio from 'cheerio';

// Stripped entirely, including text children.
const DROP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'meta',
  'link',
  'iframe',
  'object',
  'embed',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
  // common ad containers
  '[class*="ad-" i]',
  '[class*="advert" i]',
  '[id*="ad-" i]',
  '[class*="banner" i]',
  '[class*="promo" i]',
  '[class*="sponsored" i]',
  '[role="banner"]',
  '[role="navigation"]',
  '[aria-hidden="true"]',
];

// Regex that looks for instruction-shaped text that often appears in
// prompt-injection payloads. We replace matches with a placeholder
// rather than dropping the whole node so surrounding context survives.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /\b(system|assistant|developer)\s*:/gi,
  /you\s+are\s+(now\s+)?an?\s+(ai|assistant|language\s+model)/gi,
  /\bprompt\s*injection\b/gi,
];

export type CleanOptions = {
  /** Maximum characters to retain (default 120k ~= 30k tokens). */
  maxChars?: number;
};

export function cleanHtml(html: string, opts: CleanOptions = {}): string {
  const maxChars = opts.maxChars ?? 120_000;
  const $ = cheerio.load(html);

  // Remove comments recursively.
  $('*')
    .contents()
    .filter((_, el) => el.type === 'comment')
    .remove();

  for (const selector of DROP_SELECTORS) {
    $(selector).remove();
  }

  // Inline hidden style elements.
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      $(el).remove();
    }
  });

  // Strip data-* attributes and noisy tracking attrs on every element.
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const name of Object.keys(el.attribs)) {
      if (name.startsWith('data-') || name.startsWith('on')) {
        $(el).removeAttr(name);
      }
    }
  });

  // Prefer <main> / <article> if present.
  let workingHtml: string;
  const main = $('main, article').first();
  if (main.length > 0) {
    workingHtml = $.html(main);
  } else {
    workingHtml = $('body').length ? $.html($('body')) : $.html();
  }

  // Strip instruction-like text.
  for (const pattern of INJECTION_PATTERNS) {
    workingHtml = workingHtml.replace(pattern, '[redacted]');
  }

  // Collapse excessive whitespace without destroying structure.
  workingHtml = workingHtml
    .replace(/>\s+</g, '><')
    .replace(/\s{3,}/g, '\n')
    .trim();

  if (workingHtml.length > maxChars) {
    workingHtml = workingHtml.slice(0, maxChars) + '\n<!-- truncated -->';
  }
  return workingHtml;
}

/**
 * Return a rough visible-text length so callers can decide whether a
 * Cheerio pass produced enough content or we need to fall back to Playwright.
 */
export function visibleTextLength(html: string): number {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  return $('body').text().trim().replace(/\s+/g, ' ').length;
}
