'use strict';

const path = require('path');

const RAW_DIR = '_posts';

function isRawHtmlPost(data) {
  const source = data.source || '';
  const ext = path.extname(source).toLowerCase();

  return (
    ext === '.html' &&
    source.includes(`source${path.sep}${RAW_DIR}${path.sep}`)
  );
}

/**
 * HTML 原样渲染器
 *
 * .html -> .html
 * 不经过 Markdown 转换。
 */
hexo.extend.renderer.register(
  'html',
  'html',
  function (data) {
    return data.text;
  },
  true
);

/**
 * 禁用主题布局。
 *
 * Markdown:
 *   layout: post
 *
 * HTML:
 *   layout: false
 */
hexo.extend.filter.register('before_post_render', function (data) {
  if (!isRawHtmlPost(data)) {
    return data;
  }

  data.layout = false;
  data.disableNunjucks = true;

  return data;
});
