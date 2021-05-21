const Router = require('express-promise-router')
const router = new Router()

module.exports = router

router.get('/', async (req, res) => {
  res.send({
    maintenance: false,
    message: 'Wallet node is under maintenance. Services may not be available.',
    url: 'https://status.rraayy.com',
  })
})