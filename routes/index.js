const stake = require('./stake')
const ispo = require('./ispo')
const status = require('./status')

module.exports = app => {
  app.use('/stake', stake)
  app.use('/ispo', ispo)
  app.use('/status', status)
}