const stake = require('./stake')

module.exports = app => {
  app.use('/account', stake)
}