const stake = require('./stake')
const rewards = require('./rewards')

module.exports = app => {
  app.use('/stake', stake)
  app.use('/rewards', rewards)
}