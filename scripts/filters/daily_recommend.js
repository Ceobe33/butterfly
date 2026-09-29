'use strict';

const fs = require('fs');
const path = require('path');

// ===== 可调整参数 =====
// 前端下拉框最大可选的推荐篇数,预取时就按这个数量抽取,
// 前端 JS 再根据用户实际选择的数量隐藏多余部分。
// 配置来自 butterfly 主题配置(站点根 _config.butterfly.yml 覆盖主题 _config.yml)
const dailyConf = (hexo.theme.config && hexo.theme.config.daily_recommend) || {};
const MAX_COUNT = dailyConf.max_count || 9;
const DEFAULT_COUNT = dailyConf.default_count || 3;

// 数据持久化到 source/_data 下,hexo clean 不会清掉这个目录
const DATA_DIR = path.join(hexo.source_dir, '_data');
const DATA_FILE = path.join(DATA_DIR, 'daily-recommend.json');

// 固定时区,避免本地/CI 服务器时区不一致导致"今天"判断出错
process.env.TZ = 'Asia/Shanghai';

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ history: [], lastDate: '', today: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // 文件损坏时重置,避免直接构建失败
    const fresh = { history: [], lastDate: '', today: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 用本地时间字段拼日期字符串,而不是 toISOString()(始终返回 UTC 时间,
// 会导致北京时间 00:00-07:59 这段时间"今天"判断还停留在昨天)
function getToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getSlug(post) {
  return post.slug || post.source.replace(/\.md$/, '');
}

// 文章 front-matter 写 recommend: false 则不参与每日推荐,不写默认参与
function isEligible(post) {
  return post.recommend !== false;
}

function getDailyRecommend(posts) {
  const data = ensureDataFile();
  const today = getToday();

  const eligiblePosts = posts.filter(isEligible);
  const allSlugs = eligiblePosts.map(getSlug);

  if (data.lastDate !== today) {
    // 优先从"这一轮还没抽到过"的文章里选,保证抽完一轮前不重复
    let pool = allSlugs.filter(slug => !data.history.includes(slug));

    // 需求2:剩余未展示的文章数不够填满当天展示上限,直接清空历史、当新一轮重新抽
    if (pool.length < MAX_COUNT) {
      data.history = [];
      pool = [...allSlugs];
    }

    const picked = shuffle(pool).slice(0, Math.min(MAX_COUNT, pool.length));

    // 需求1:只有真正凑够展示上限时才计入历史,
    // 避免文章总数本身不足 MAX_COUNT 时历史列表被提前写满、失去轮换意义
    if (picked.length >= MAX_COUNT) {
      data.history.push(...picked);
    }
    console.log('[daily-recommend] pool.length:', pool.length, ' all slugs:', allSlugs.length, ' posts:', posts.length);

    data.lastDate = today;
    data.today = picked;
    saveData(data);
  }

  return data.today || [];
}

// 生成前预取一次,保证同一次 generate 过程里所有页面拿到的数据一致,
// 且不会因为多次调用助手函数而被重复抽取。
hexo.extend.filter.register('after_generate', function (locals) {
  const posts = hexo.locals.get('posts').toArray();
  // console.log('[daily-recommend] eligible posts:', posts.filter(isEligible).length, 'MAX_COUNT:', MAX_COUNT);
  getDailyRecommend(posts);
});

// 模板里用 daily_recommend() 拿到今天预取好的全部文章对象(最多 MAX_COUNT 篇),
// 具体展示几篇由页面前端 JS 按用户选择隐藏多余部分,不需要在这里再传 count。
hexo.extend.helper.register('daily_recommend', function () {
  const posts = hexo.locals.get('posts').toArray();
  const eligiblePosts = posts.filter(isEligible);
  const todaySlugs = getDailyRecommend(posts);

  return todaySlugs
    .map(slug => eligiblePosts.find(p => getSlug(p) === slug))
    .filter(Boolean);
});
