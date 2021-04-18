const account = require('./account')

module.exports = app => {
  app.use('/account', account)
}