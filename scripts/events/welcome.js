function safeRequire(modulePath) {
  try {
    return require(modulePath).default();
  } catch (error) {
    return require(modulePath)();
  }
}
const logger = safeRequire('hexo-log')

hexo.on('ready', () => {
  const { version } = require('../../package.json')
  logger.info(`
  ===================================================================
                                                                     
      #####  #    # ##### ##### ###### #####  ###### #      #   #    
      #    # #    #   #     #   #      #    # #      #       # #     
      #####  #    #   #     #   #####  #    # #####  #        #     
      #    # #    #   #     #   #      #####  #      #        #      
      #    # #    #   #     #   #      #   #  #      #        #    
      #####   ####    #     #   ###### #    # #      ######   #  

                            ${version}
  ===================================================================`)
})
