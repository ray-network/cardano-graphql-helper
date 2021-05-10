const Router = require('express-promise-router')
const db = require('../db')
const router = new Router()

module.exports = router

router.get('/ray/:stakeKey', async (req, res) => {
  const { stakeKey } = req.params

  // accountDbId
  const { rows: accountDbResult } = await db.query(
    'SELECT id as "accountDbId" from stake_address WHERE view=$1',
    [stakeKey]
  )
  const accountDbId = accountDbResult.length > 0 ? accountDbResult[0].accountDbId : '-1'

  const currentEpochQuery = await db.query('SELECT no FROM epoch ORDER BY no desc limit 1')
  const currentEpoch = currentEpochQuery.rows.length > 0 ? parseInt(currentEpochQuery.rows[0].no, 10) : 0

  const rewardsHistoryQuery = await db.query(`
  SELECT
    es.epoch_no::INTEGER as "forDelegationInEpoch", block.epoch_no as "epochNo",
    block.time, es.amount::INTEGER, ph.view as "poolId", 'REGULAR' as "rewardType"
    FROM epoch_stake es
      LEFT JOIN block ON es.block_id=block.id
      LEFT JOIN pool_hash ph ON es.pool_id=ph.id
      WHERE es.addr_id=$1 AND ph.view=$2 AND es.epoch_no NOT IN ($3-1, $3)
      ORDER BY block.slot_no DESC`,
    [accountDbId, 'pool1rjxdqghfjw5rv6lxg8qhedkechvfgnsqhl8rrzwck9g45n43yql', currentEpoch]
  )
  const rewardsHistory = rewardsHistoryQuery.rows.map(item => {
    return {
      ...item,
      epochNo: item.epochNo + 2,
      amount: parseInt(item.amount / 1000000 / 50)
    }
  })

  const total = rewardsHistory.reduce((n, { amount }) => n + amount, 0)

  res.send({
    stakeKey,
    total,
    rewardsHistory,
  })
})