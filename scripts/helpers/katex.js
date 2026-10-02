'use strict';

/**
 * katex is an optional dependency: it is only needed when KaTeX
 * rendering is actually turned on. Requiring it at load time made the
 * whole script fail ("Script load failed") on sites where katex is
 * disabled or not installed, so it is resolved lazily instead.
 */
let katex_module = null;
let katex_missing = false;

function get_katex() {
  if (katex_module) {
    return katex_module;
  }

  if (katex_missing) {
    return null;
  }

  try {
    katex_module = require('katex');
  } catch (err) {
    katex_missing = true;
    console.warn('[butterfly] theme.katex is enabled, but the "katex" package is not installed - math rendering is skipped. Run: npm install katex');
    return null;
  }

  return katex_module;
}

/**
 * ============================================================
 * Butterfly KaTeX configuration
 * ============================================================
 *
 * Read configuration from:
 *
 * themes/butterfly/_config.yml
 *
 * Not from Hexo root _config.yml.
 */

const config =
  (hexo.theme.config && hexo.theme.config.katex) || {};

const delimiters = config.delimiters || {};

const inline_dollar_config =
  config.inline_dollar || {};

const render_config =
  config.render || {};

const macros =
  render_config.macros || {};


/**
 * ============================================================
 * Helpers
 * ============================================================
 */

/**
 * Check whether a character is escaped.
 *
 * \$   -> true
 * \\$  -> false
 * \\\$ -> true
 */
function is_escaped(source, index) {
  let slash_count = 0;

  for (let i = index - 1; i >= 0; i--) {
    if (source[i] !== '\\') {
      break;
    }

    slash_count++;
  }

  return slash_count % 2 === 1;
}


/**
 * Find an unescaped closing delimiter.
 */
function find_closing_delimiter(
  source,
  start,
  delimiter
) {
  let position = start;

  while (position < source.length) {
    const index = source.indexOf(
      delimiter,
      position
    );

    if (index === -1) {
      return -1;
    }

    if (!is_escaped(source, index)) {
      return index;
    }

    position = index + delimiter.length;
  }

  return -1;
}


/**
 * Convert YAML "Infinity" to JavaScript Infinity.
 */
function parse_max_size(value) {
  if (value === 'Infinity') {
    return Infinity;
  }

  if (typeof value === 'number') {
    return value;
  }

  return undefined;
}


/**
 * ============================================================
 * KaTeX rendering
 * ============================================================
 */

function render_math(text, display_mode) {
  const katex = get_katex();

  if (!katex) {
    return text;
  }

  return katex.renderToString(
    text.trim(),
    {
      displayMode: display_mode,

      throwOnError:
        render_config.throw_on_error ?? false,

      errorColor:
        render_config.error_color ?? '#cc0000',

      strict:
        render_config.strict ?? false,

      trust:
        render_config.trust ?? false,

      output:
        render_config.output ?? 'htmlAndMathml',

      fleqn:
        render_config.fleqn ?? false,

      leqno:
        render_config.leqno ?? false,

      colorIsTextColor:
        render_config.color_is_text_color ?? false,

      maxSize:
        parse_max_size(
          render_config.max_size
        ),

      maxExpand:
        render_config.max_expand ?? 1000,

      globalGroup:
        render_config.global_group ?? false,

      minRuleThickness:
        render_config.min_rule_thickness ?? 0,

      macros,
    }
  );
}


/**
 * ============================================================
 * $$ ... $$
 * ============================================================
 */

function create_block_dollar_extension() {
  return {
    name: 'math_block_dollar',

    level: 'block',

    start(source) {
      return source.indexOf('$$');
    },

    tokenizer(source) {
      if (delimiters.block_dollar === false) {
        return;
      }

      const match = source.match(
        /^( {0,3})\$\$([\s\S]*?)\$\$(?:\n|$)/
      );

      if (!match) {
        return;
      }

      return {
        type: 'math_block_dollar',
        raw: match[0],
        text: match[2],
        tokens: [],
      };
    },

    renderer(token) {
      return render_math(
        token.text,
        true
      );
    },
  };
}


/**
 * ============================================================
 * \[ ... \]
 * ============================================================
 */

function create_block_bracket_extension() {
  return {
    name: 'math_block_bracket',

    level: 'block',

    start(source) {
      return source.indexOf('\\[');
    },

    tokenizer(source) {
      if (delimiters.block_bracket === false) {
        return;
      }

      const match = source.match(
        /^( {0,3})\\\[([\s\S]*?)\\\](?:\n|$)/
      );

      if (!match) {
        return;
      }

      return {
        type: 'math_block_bracket',
        raw: match[0],
        text: match[2],
        tokens: [],
      };
    },

    renderer(token) {
      return render_math(
        token.text,
        true
      );
    },
  };
}


/**
 * ============================================================
 * $ ... $
 * ============================================================
 */

function create_inline_dollar_extension() {
  return {
    name: 'math_inline_dollar',

    level: 'inline',

    start(source) {
      return source.indexOf('$');
    },

    tokenizer(source) {
      if (delimiters.inline_dollar === false) {
        return;
      }

      if (!source.startsWith('$')) {
        return;
      }

      /*
       * $$ belongs to block math.
       */
      if (source.startsWith('$$')) {
        return;
      }

      /*
       * Empty expression.
       */
      if (source[1] === '$') {
        return;
      }

      /*
       * Find the next unescaped $.
       */
      const closing_index =
        find_closing_delimiter(
          source,
          1,
          '$'
        );

      if (closing_index === -1) {
        return;
      }

      const content =
        source.slice(
          1,
          closing_index
        );

      if (!content.trim()) {
        return;
      }

      /*
       * Do not interpret "$100$" as math.
       */
      if (
        /^\s*\d+(?:[.,]\d+)?\s*$/.test(content)
      ) {
        return;
      }

      /*
       * Optional whitespace restriction.
       */
      if (
        !inline_dollar_config.allow_space &&
        (
          /^\s/.test(content) ||
          /\s$/.test(content)
        )
      ) {
        return;
      }

      return {
        type: 'math_inline_dollar',

        raw: source.slice(
          0,
          closing_index + 1
        ),

        text: content,
      };
    },

    renderer(token) {
      return render_math(
        token.text,
        false
      );
    },
  };
}


/**
 * ============================================================
 * \( ... \)
 * ============================================================
 */

function create_inline_parenthesis_extension() {
  return {
    name: 'math_inline_parenthesis',

    level: 'inline',

    start(source) {
      return source.indexOf('\\(');
    },

    tokenizer(source) {
      if (
        delimiters.inline_parenthesis === false
      ) {
        return;
      }

      if (!source.startsWith('\\(')) {
        return;
      }

      if (is_escaped(source, 0)) {
        return;
      }

      const closing_index =
        find_closing_delimiter(
          source,
          2,
          '\\)'
        );

      if (closing_index === -1) {
        return;
      }

      const content =
        source.slice(
          2,
          closing_index
        );

      if (!content.trim()) {
        return;
      }

      return {
        type: 'math_inline_parenthesis',

        raw: source.slice(
          0,
          closing_index + 2
        ),

        text: content,
      };
    },

    renderer(token) {
      return render_math(
        token.text,
        false
      );
    },
  };
}


/**
 * ============================================================
 * Register extensions
 * ============================================================
 */

hexo.extend.filter.register(
  'marked:extensions',

  function (extensions) {
    if (config.enable === false) {
      return;
    }

    if (!get_katex()) {
      return;
    }

    if (
      delimiters.block_dollar !== false
    ) {
      extensions.push(
        create_block_dollar_extension()
      );
    }

    if (
      delimiters.inline_dollar !== false
    ) {
      extensions.push(
        create_inline_dollar_extension()
      );
    }

    if (
      delimiters.block_bracket !== false
    ) {
      extensions.push(
        create_block_bracket_extension()
      );
    }

    if (
      delimiters.inline_parenthesis !== false
    ) {
      extensions.push(
        create_inline_parenthesis_extension()
      );
    }
  }
);
