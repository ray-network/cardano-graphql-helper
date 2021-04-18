const Router = require('express-promise-router')
const db = require('../db')
const router = new Router()

module.exports = router

router.get('/stake/:account', async (req, res) => {
  const { account } = req.params
  const { rows: accountDbResult } = await db.query(
    'SELECT id as "accountDbId" from stake_address WHERE hash_raw=$1',
    [`\\x${account}`]
  )
  const accountDbId = accountDbResult.length > 0 ? accountDbResult[0].accountDbId : '-1'
  const rewardResult = await db.query(`
      SELECT 
        (SELECT COALESCE(SUM(rewards.amount), 0) FROM 
          (
            SELECT amount FROM reward WHERE addr_id=$1
            UNION ALL
            SELECT amount FROM reserve WHERE addr_id=$1
            UNION ALL
            SELECT amount FROM treasury WHERE addr_id=$1
          ) rewards
        ) - (
          SELECT COALESCE(SUM(amount), 0) FROM withdrawal WHERE addr_id=$1
        )
      AS "remainingRewards"
    `,
    [accountDbId]
  )
  const rewards = rewardResult.rows.length > 0 ? `${parseInt(rewardResult.rows[0].remainingRewards, 10)}` : '0'

  res.send({
    rewards,
  })
})