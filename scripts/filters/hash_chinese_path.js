// 只判断当前 path component 是否包含中文
const CHINESE = /[^\/]*[\u3400-\u9fff\uF900-\uFAFF][^\/|^\.]*/

// scripts/hash-post-permalink.js

const crypto = require('crypto')

function hash(text) {
  return crypto
    .createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, 12)
}

function hashPermalink(permalink) {
  return permalink
    .split('/')
    .map(segment => {
      if (!CHINESE.test(segment)) {
        CHINESE.lastIndex = 0
        return segment
      }

      CHINESE.lastIndex = 0

      return segment.replace(CHINESE, char => {
        return hash(char)
      })
    })
    .join('/')
}

hexo.extend.filter.register('post_permalink', function (data) {
  const oldPath = data
  const newPath = hashPermalink(data)

  // if (oldPath !== newPath) {
  //   console.log('[hash-permalink]')
  //   console.log(`  ${oldPath}`)
  //   console.log(`  -> ${newPath}`)
  // }

  return newPath
})
