const stake = require('./stake')
// const pools = require('./pools')

module.exports = app => {
  app.use('/account', stake)
  // app.use('/pools', pools)
}