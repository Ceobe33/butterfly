/**
 * Butterfly
 * ramdom cover
 */

'use strict'

hexo.extend.filter.register('before_post_render', function (data) {
  const { config } = this
  if (config.post_asset_folder) {
    const imgTestReg = /\.(png|jpe?g|gif|svg|webp)(\?.*)?$/
    const topImg = data.top_img
    const cover = data.cover

    // 单个 front-matter 写错不该让整个构建 FATAL，这里只警告并跳过
    if (topImg && typeof topImg !== 'string') {
      hexo.log.warn(`[random_cover] ${data.source} 的 top_img 不是字符串，已跳过：${JSON.stringify(topImg)}`)
    } else if (topImg && topImg.indexOf('/') === -1 && imgTestReg.test(topImg)) {
      data.top_img = data.path + topImg
    }

    if (cover && typeof cover !== 'string') {
      hexo.log.warn(`[random_cover] ${data.source} 的 cover 不是字符串，已跳过：${JSON.stringify(cover)}`)
    } else if (cover && cover.indexOf('/') === -1) {
      data.cover = data.path + cover
    }
  }

  if (data.cover === false) {
    data.randomcover = randomCover()
    return data
  }

  data.cover = data.cover || randomCover()
  return data
})

function randomCover () {
  const theme = hexo.theme.config
  let cover
  let num

  if (theme.cover && theme.cover.default_cover) {
    if (!Array.isArray(theme.cover.default_cover)) {
      cover = theme.cover.default_cover
      return cover
    } else {
      num = Math.floor(Math.random() * theme.cover.default_cover.length)
      cover = theme.cover.default_cover[num]
      return cover
    }
  } else {
    cover = theme.default_top_img || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    return cover
  }
}
