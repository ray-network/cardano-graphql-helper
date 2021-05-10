const stake = require('./stake')
const rewards = require('./rewards')

module.exports = app => {
  app.use('/account', stake)
  app.use('/rewards', rewards)
}