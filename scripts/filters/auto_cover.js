'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  // Canvas
  width: 1200,
  height: 630,

  // Safe Zone
  // 左右各 1/8 为危险区
  safe_zone_ratio: 2 / 8,

  // 文字距离安全区的额外间距
  safe_zone_padding: -20,

  // Title
  title: {
    // 最大字符数
    max_chars: 11,
    // 字体大小
    font_size: 52,

    // 多行标题之间的行高
    line_height: 72,

    // 单行标题的 Y
    single_line_y: 175,

    // 双行标题的 Y
    multi_line_y: 145,

    // 字间距
    letter_spacing: 4,

    // 字体粗细
    font_weight: 500,

    // 文字颜色
    color: '#26332f',
  },


  // ----------------------------------------------------------
  // Subtitle
  // ----------------------------------------------------------

  subtitle: {

    text: 'RECORD · THINK · GROW',

    font_size: 17,

    letter_spacing: 7,

    color: '#69736d',
  },


  // ----------------------------------------------------------
  // Date
  // ----------------------------------------------------------

  date: {

    font_size: 15,

    letter_spacing: 3,

    color: '#6d716d',
  },


  // ----------------------------------------------------------
  // Landscape
  // ----------------------------------------------------------

  landscape: {

    // 山体随机偏移范围
    mountain_random_range: 120,

    // 远山透明度
    far_mountain_opacity: 0.55,

    // 近山透明度
    near_mountain_opacity: 0.52,

    // 水面透明度
    water_opacity: 0.38,

    // 山脊线透明度
    ridge_opacity: 0.35,
  },


  // ----------------------------------------------------------
  // Ink
  // ----------------------------------------------------------

  ink: {

    // 第一层晕染
    first: {
      cx: 650,
      cy: 440,
      rx: 520,
      ry: 120,
      opacity: 0.12,
    },

    // 第二层晕染
    second: {
      cx: 950,
      cy: 350,
      rx: 280,
      ry: 160,
      opacity: 0.08,
    },

    blur: 8,
  },


  // ----------------------------------------------------------
  // Moon
  // ----------------------------------------------------------

  moon: {

    x_min: 780,
    x_range: 300,

    y_min: 90,
    y_range: 180,

    radius: 48,

    opacity: 0.9,
  },


  // ----------------------------------------------------------
  // Water
  // ----------------------------------------------------------

  water: {

    y_min: 500,
    y_range: 70,
  },


  // ----------------------------------------------------------
  // Boat
  // ----------------------------------------------------------

  boat: {

    x_min: 600,
    x_range: 400,

    width: 90,

    opacity: 0.75,
  },


  // ----------------------------------------------------------
  // Visual Variation
  // ----------------------------------------------------------

  variation_count: 8,
};


// ============================================================
// Derived Config
// ============================================================

const SAFE_ZONE =
  CONFIG.width * CONFIG.safe_zone_ratio;

const TITLE_X =
  SAFE_ZONE + CONFIG.safe_zone_padding;


// ============================================================
// Utility
// ============================================================

function hash(text) {
  return crypto
    .createHash('md5')
    .update(text)
    .digest('hex')
    .slice(0, 12);
}


function escape_xml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}


// ============================================================
// Title
// ============================================================

function split_title(title) {

  const max_chars =
    CONFIG.title.max_chars;

  title = String(title).trim();

  if (title.length <= max_chars) {
    return [title];
  }

  const lines = [];

  let current = '';

  for (const char of title) {

    current += char;

    if (current.length >= max_chars) {
      lines.push(current);
      current = '';
    }
  }

  if (current) {
    lines.push(current);
  }


  // 最多两行
  if (lines.length > 2) {

    const first = lines[0];

    const rest =
      lines.slice(1).join('');

    return [
      first,

      rest.length > max_chars
      ? rest.slice(0, max_chars - 1) + '…'
      : rest,
    ];
  }

  return lines;
}


// ============================================================
// Date
// ============================================================

function format_date(date) {

  const date_object =
    new Date(date);

  if (Number.isNaN(date_object.getTime())) {
    return '';
  }

  const year =
    date_object.getFullYear();

  const month =
    String(date_object.getMonth() + 1)
    .padStart(2, '0');

  const day =
    String(date_object.getDate())
    .padStart(2, '0');

  return `${year}.${month}.${day}`;
}


// ============================================================
// Create SVG
// ============================================================

function create_cover_svg(post) {

  const lines =
    split_title(post.title || 'Untitled');

  const date =
    format_date(post.date);


  // ----------------------------------------------------------
  // Stable random seed
  // ----------------------------------------------------------

  const seed =
    parseInt(
      hash(`${post.title}|${post.date}`)
      .slice(0, 8),
      16
    );


  const variation =
    seed % CONFIG.variation_count;


  // ----------------------------------------------------------
  // Random Landscape
  // ----------------------------------------------------------

  const mountain_range =
    CONFIG.landscape
    .mountain_random_range;

  const mountain_offset =
    (seed % mountain_range)
    - mountain_range / 2;


  // ----------------------------------------------------------
  // Random Moon
  // ----------------------------------------------------------

  const moon_x =
    CONFIG.moon.x_min +
    (seed % CONFIG.moon.x_range);

  const moon_y =
    CONFIG.moon.y_min +
    (seed % CONFIG.moon.y_range);


  // ----------------------------------------------------------
  // Random Water
  // ----------------------------------------------------------

  const water_y =
    CONFIG.water.y_min +
    ((seed >> 16) %
      CONFIG.water.y_range);


  // ----------------------------------------------------------
  // Random Boat
  // ----------------------------------------------------------

  const boat_x =
    CONFIG.boat.x_min +
    ((seed >> 20) %
      CONFIG.boat.x_range);


  // ----------------------------------------------------------
  // Title Position
  // ----------------------------------------------------------

  const title_y =
    lines.length === 1
    ? CONFIG.title.single_line_y
    : CONFIG.title.multi_line_y;


  // ----------------------------------------------------------
  // Title SVG
  // ----------------------------------------------------------

  const title_svg =
    lines
    .map((line, index) => {

      return `
          <text
            x="${TITLE_X}"
            y="${
              title_y +
                index *
                CONFIG.title.line_height
            }"
            class="title"
          >${escape_xml(line)}</text>
        `;
    })
    .join('\n');


  // ==========================================================
  // SVG
  // ==========================================================

  return `<?xml version="1.0" encoding="UTF-8"?>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${CONFIG.width}"
  height="${CONFIG.height}"
  viewBox="0 0 ${CONFIG.width} ${CONFIG.height}"
>

  <defs>

    <!-- ================================================== -->
    <!-- Paper -->
    <!-- ================================================== -->

    <linearGradient
      id="paper"
      x1="0"
      y1="0"
      x2="0"
      y2="1"
    >
      <stop
        offset="0%"
        stop-color="#f7f4eb"
      />

      <stop
        offset="100%"
        stop-color="#ebe6d8"
      />
    </linearGradient>


    <!-- ================================================== -->
    <!-- Far Mountain -->
    <!-- ================================================== -->

    <linearGradient
      id="farMountain"
      x1="0"
      y1="0"
      x2="0"
      y2="1"
    >
      <stop
        offset="0%"
        stop-color="#aeb8b0"
      />

      <stop
        offset="100%"
        stop-color="#d8d8cc"
      />
    </linearGradient>


    <!-- ================================================== -->
    <!-- Near Mountain -->
    <!-- ================================================== -->

    <linearGradient
      id="nearMountain"
      x1="0"
      y1="0"
      x2="0"
      y2="1"
    >
      <stop
        offset="0%"
        stop-color="#69756f"
      />

      <stop
        offset="100%"
        stop-color="#9ba39b"
      />
    </linearGradient>


    <!-- ================================================== -->
    <!-- Ink Blur -->
    <!-- ================================================== -->

    <filter id="inkBlur">
      <feGaussianBlur
        stdDeviation="${CONFIG.ink.blur}"
      />
    </filter>


    <!-- ================================================== -->
    <!-- Moon -->
    <!-- ================================================== -->

    <radialGradient id="moon">

      <stop
        offset="0%"
        stop-color="#eee8d8"
      />

      <stop
        offset="100%"
        stop-color="#d8d0bd"
      />

    </radialGradient>


    <!-- ================================================== -->
    <!-- Typography -->
    <!-- ================================================== -->

    <style>

      .title {

        font-family:
          "Noto Serif CJK SC",
          "Source Han Serif SC",
          "Songti SC",
          "STSong",
          serif;

        font-size:
          ${CONFIG.title.font_size}px;

        font-weight:
          ${CONFIG.title.font_weight};

        letter-spacing:
          ${CONFIG.title.letter_spacing}px;

        fill:
          ${CONFIG.title.color};
      }


      .subtitle {

        font-family:
          "Noto Serif CJK SC",
          "Source Han Serif SC",
          "Songti SC",
          "STSong",
          serif;

        font-size:
          ${CONFIG.subtitle.font_size}px;

        letter-spacing:
          ${CONFIG.subtitle.letter_spacing}px;

        fill:
          ${CONFIG.subtitle.color};
      }


      .date {

        font-family:
          "Helvetica Neue",
          Arial,
          sans-serif;

        font-size:
          ${CONFIG.date.font_size}px;

        letter-spacing:
          ${CONFIG.date.letter_spacing}px;

        fill:
          ${CONFIG.date.color};
      }

    </style>

  </defs>


  <!-- ====================================================== -->
  <!-- Background -->
  <!-- ====================================================== -->

  <rect
    x="0"
    y="0"
    width="${CONFIG.width}"
    height="${CONFIG.height}"
    fill="url(#paper)"
  />


  <!-- ====================================================== -->
  <!-- Ink -->
  <!-- ====================================================== -->

  <ellipse
    cx="${CONFIG.ink.first.cx}"
    cy="${CONFIG.ink.first.cy}"
    rx="${CONFIG.ink.first.rx}"
    ry="${CONFIG.ink.first.ry}"
    fill="#89958c"
    opacity="${CONFIG.ink.first.opacity}"
    filter="url(#inkBlur)"
  />


  <ellipse
    cx="${CONFIG.ink.second.cx}"
    cy="${CONFIG.ink.second.cy}"
    rx="${CONFIG.ink.second.rx}"
    ry="${CONFIG.ink.second.ry}"
    fill="#738078"
    opacity="${CONFIG.ink.second.opacity}"
    filter="url(#inkBlur)"
  />


  <!-- ====================================================== -->
  <!-- Moon -->
  <!-- ====================================================== -->

  <circle
    cx="${moon_x}"
    cy="${moon_y}"
    r="${CONFIG.moon.radius}"
    fill="url(#moon)"
    opacity="${CONFIG.moon.opacity}"
  />


  <!-- ====================================================== -->
  <!-- Far Mountain -->
  <!-- ====================================================== -->

  <path
    d="
      M0 430

      C100 370
        150 385
        240 330

      C320 280
        380 345
        460 300

      C540 255
        590 315
        670 285

      C760 250
        820 325
        900 290

      C1010 245
        1080 310
        1200 270

      L1200 630
      L0 630
      Z
    "
    fill="url(#farMountain)"
    opacity="${CONFIG.landscape.far_mountain_opacity}"
  />


  <!-- ====================================================== -->
  <!-- Near Mountain -->
  <!-- ====================================================== -->

  <path
    d="
      M0 500

      C110 ${440 - mountain_offset}
        180 ${470 - mountain_offset}
        270 ${395 - mountain_offset}

      C350 ${330 - mountain_offset}
        430 ${455 - mountain_offset}
        520 ${390 - mountain_offset}

      C610 ${320 - mountain_offset}
        690 ${450 - mountain_offset}
        780 ${375 - mountain_offset}

      C870 ${310 - mountain_offset}
        980 ${430 - mountain_offset}
        1080 ${350 - mountain_offset}

      C1130 ${320 - mountain_offset}
        1170 ${350 - mountain_offset}
        1200 ${330 - mountain_offset}

      L1200 630
      L0 630
      Z
    "
    fill="url(#nearMountain)"
    opacity="${CONFIG.landscape.near_mountain_opacity}"
  />


  <!-- ====================================================== -->
  <!-- Mountain Ridge -->
  <!-- ====================================================== -->

  <path
    d="
      M0 510

      C140 445
        205 480
        300 410

      C400 335
        450 475
        560 405

      C650 350
        710 460
        820 390

      C930 320
        1000 440
        1110 370

      C1150 345
        1180 355
        1200 345
    "
    fill="none"
    stroke="#59645e"
    stroke-width="3"
    opacity="${CONFIG.landscape.ridge_opacity}"
  />


  <!-- ====================================================== -->
  <!-- Water -->
  <!-- ====================================================== -->

  <path
    d="
      M0 ${water_y + 35}

      C160 ${water_y + 15}
        270 ${water_y + 50}
        420 ${water_y + 30}

      C600 ${water_y + 5}
        720 ${water_y + 55}
        880 ${water_y + 25}

      C1030 ${water_y}
        1110 ${water_y + 35}
        1200 ${water_y + 15}

      L1200 630
      L0 630
      Z
    "
    fill="#c4cbc4"
    opacity="${CONFIG.landscape.water_opacity}"
  />


  <!-- ====================================================== -->
  <!-- Water Lines -->
  <!-- ====================================================== -->

  <path
    d="
      M120 565

      C300 550
        430 575
        600 558

      C760 542
        900 570
        1080 550
    "
    fill="none"
    stroke="#77827b"
    stroke-width="2"
    opacity="0.28"
  />


  <path
    d="
      M230 595

      C400 580
        560 605
        720 588

      C850 575
        960 595
        1100 580
    "
    fill="none"
    stroke="#77827b"
    stroke-width="1.5"
    opacity="0.20"
  />


  <!-- ====================================================== -->
  <!-- Title -->
  <!-- ====================================================== -->

  ${title_svg}


  <!-- Title separator -->

  <rect
    x="${TITLE_X}"
    y="${
      title_y +
        lines.length *
        CONFIG.title.line_height +
        10
    }"
    width="42"
    height="2"
    fill="#52615a"
    opacity="0.7"
  />


  <!-- ====================================================== -->
  <!-- Subtitle -->
  <!-- ====================================================== -->

  <text
    x="${TITLE_X}"
    y="${
      title_y +
        lines.length *
        CONFIG.title.line_height +
        55
    }"
    class="subtitle"
  >${CONFIG.subtitle.text}</text>


  <!-- ====================================================== -->
  <!-- Date -->
  <!-- ====================================================== -->

  <text
    x="${TITLE_X}"
    y="${
      title_y +
        lines.length *
        CONFIG.title.line_height
    }"
    class="date"
  >${date}</text>


  <!-- ====================================================== -->
  <!-- Boat -->
  <!-- ====================================================== -->

  <path
    d="
      M${boat_x} 500

      Q${boat_x + 45} 492
        ${boat_x + CONFIG.boat.width} 500

      Q${boat_x + 45} 515
        ${boat_x} 500

      Z
    "
    fill="#4d5752"
    opacity="${CONFIG.boat.opacity}"
  />


  <line
    x1="${boat_x + 45}"
    y1="500"
    x2="${boat_x + 45}"
    y2="455"
    stroke="#4d5752"
    stroke-width="2"
    opacity="0.65"
  />


  <path
    d="
      M${boat_x + 45} 457
      L${boat_x + 45} 490
      L${boat_x + 75} 475
      Z
    "
    fill="#66716b"
    opacity="0.5"
  />

</svg>
`;
}


// ============================================================
// Hexo Filter
// =====================================================
const TAG = 'auto_cover'
let hasResource = false
// 检查封面图片文件是否真实存在
function coverFileExists(coverPath) {
  if (coverPath?.trim().length == 0) return false;
  const absPath = path.join(hexo.source_dir, coverPath.replace(/^\//, ''));
  return fs.existsSync(absPath);
}
// 检查文章是否有 Asset Folder（source/_posts/文章名/）
function assetFolderExists(post) {
  // Hexo 开启 post_asset_folder: true 时会自动生成
  if (post.asset_dir) {
    return fs.existsSync(post.asset_dir + path.basename(post.cover));
  }
  // 备用：手动推算
  const dir = path.join(hexo.source_dir, '_posts', post.slug);
  return fs.existsSync(dir + path.basename(post.cover));
}
function write_cover_to_post(post, cover_path) {
  // const post_path = path.resolve(post.source);
  const post_path = post.full_source;

  if (!fs.existsSync(post_path)) {
    return;
  }

  let content = fs.readFileSync(post_path, 'utf8');
  // 提取 Front-matter 区域（--- 之间的内容）
  const fmMatch = content.match(/^---\s*([\s\S]*?)\s*---/);
  const fm = fmMatch[0];
  let fa = fmMatch[1];

      if (!hasResource) {
        fa = fa.replace(/\n.*cover:.*/m, '')
      } else {
        return;
      }
  // 找到 YAML front matter
  if (content.startsWith('---')) {
      const newFm = fa + `\ncover: ${cover_path}`;
      content = content.replace(fm, `---\n${newFm}\n---`);
      fs.writeFileSync(post_path, content, 'utf8');

      post.cover = cover_path;
      hexo.log.info(
        `[${TAG}] wrote cover to: ${path.relative(hexo.base_dir, post_path)}`
      );
  }
}
/**
 * 删除某个 source 文件对应的路由。
 *
 * Hexo 7 的 _generate() 在 load() 阶段就会触发 after_generate，
 * 此时静态资源路由（source/img/auto_cover/*.svg）已经注册、但还没有写入 public。
 * 如果这里直接把源文件删掉，后面写文件时 createReadStream 就会 ENOENT 导致构建崩溃。
 * 所以务必先移除路由，再删除文件。
 */
function removeRouteFor(routePath) {
  if (!hexo.route || typeof hexo.route.remove !== 'function') {
    return;
  }

  const target = routePath.replace(/^\/+/, '').replace(/\\/g, '/');

  hexo.route.list().forEach((item) => {
    const normalized = String(item).replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalized === target || normalized.endsWith('/' + target)) {
      hexo.route.remove(item);
    }
  });
}

/**
 * 清理没有被任何 post.cover 引用的自动生成 SVG
 */
function cleanup_unused_covers() {
  const cover_dir = path.join( hexo.source_dir, 'img', TAG);
  if (!fs.existsSync(cover_dir)) {
    return;
  }

  // 收集所有 post.cover 引用
  const used_covers = new Set();

  const posts = hexo.locals.get('posts');

  if (posts) {
    posts.forEach((post) => {
      if ( typeof post.cover === 'string' &&
        post.cover.startsWith(`img/${TAG}/`)) {
        const filename = path.basename(post.cover);
        used_covers.add(filename);
  } }); }

  // 清理没有引用的 SVG
  const files = fs.readdirSync(cover_dir);

  for (const filename of files) {
    if (!filename.endsWith('.svg')) {
      continue;
    }

    if (!used_covers.has(filename)) {
      const filepath = path.join(cover_dir, filename);

      // 先摘掉路由，避免出现 ENOENT（详见 removeRouteFor 注释）
      removeRouteFor(path.posix.join('img', TAG, filename));

      fs.unlinkSync(filepath);
      hexo.log.info(
        `[${TAG}] removed unused: ${filename}`
      );
    }
  }
}

/**
 * Hexo 所有文章处理完成后清理孤儿 cover
 */
hexo.extend.filter.register( 'after_generate', function () {
    cleanup_unused_covers();
});

hexo.extend.filter.register( 'after_post_render',
  function (post) {
    // 只处理 source/_posts/ 下的文章
    const post_dir = path.resolve(hexo.source_dir, '_posts');
    const post_path = path.resolve(post.full_source);

    if (
      post_path !== post_dir &&
      !post_path.startsWith(post_dir + path.sep)
    ) {
      return post;
    }

    hasResource = coverFileExists(post.cover);
    const hasAssetFolder = assetFolderExists(post);
    /*
     * 有 cover 资源
     * 不做任何处理。
     */
    if (hasResource || hasAssetFolder) {
      return post;
    }

    /*
     * 明确写：
     *
     * cover: false
     *
     * 表示用户不想要封面。
     */
    if (post.cover === false) {
      return post;
    }

    const source_dir = hexo.source_dir;
    const cover_dir = path.join( source_dir, 'img', TAG);

    fs.mkdirSync( cover_dir, { recursive: true });

    /*
     * 使用标题 + 日期作为 hash。
     * 这样：
     * hexo generate
     * hexo generate
     * hexo generate
     * 都不会不断产生新的文件。
     */
    const id = hash( `${post.title}|${post.date}`);
    const filename = `${id}.svg`;
    const filepath = path.join( cover_dir, filename);

    const svg = create_cover_svg(post);

    fs.writeFileSync( filepath, svg, 'utf8');

    hexo.log.info( `[${TAG}] generated: ${filename}`);

    /*
     * 告诉 Butterfly 使用这个封面。
     */
    const cover_path = path.join('img', TAG, filename);
    write_cover_to_post(post, cover_path);

    return post;
  }
);
