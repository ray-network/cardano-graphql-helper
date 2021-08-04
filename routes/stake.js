const Router = require('express-promise-router')
const db = require('../db')
const router = new Router()
const { range } = require('lodash')
const moment = require('moment')

module.exports = router

router.get('/state/:stakeKey', async (req, res) => {
  const { stakeKey } = req.params

  // current epoch
  const currentEpochQuery = await db.query(`SELECT no FROM epoch ORDER BY no desc limit 1`)
  const currentEpoch = currentEpochQuery.rows.length > 0 ? parseInt(currentEpochQuery.rows[0].no, 10) : 0

  // accountDbId
  const { rows: accountDbResult } = await db.query(
    'SELECT id as "accountDbId" from stake_address WHERE view=$1',
    [stakeKey]
  )
  const accountDbId = accountDbResult.length > 0 ? accountDbResult[0].accountDbId : '-1'

  // rewards
  const rewardsAmountQuery = await db.query(`
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

  const rewardsAmount = rewardsAmountQuery.rows.length > 0 ? parseInt(rewardsAmountQuery.rows[0].remainingRewards, 10) : 0

  // rewards history
  const rewardsHistoryQuery = await db.query(`
  SELECT
    r.epoch_no::INTEGER as "epochNo",
    r.amount::INTEGER, ph.view as "poolId", 'REGULAR' as "rewardType",
    e.start_time as "timeStart", e.end_time as "timeEnd"
    FROM reward r
      LEFT JOIN pool_hash ph ON r.pool_id=ph.id
      LEFT JOIN epoch e ON r.epoch_no=e.no
      WHERE r.addr_id=$1
      ORDER BY r.epoch_no::INTEGER DESC`,
    [accountDbId]
  )
  const rewardsHistory = rewardsHistoryQuery.rows

  // current pool
  const currentPoolQuery = await db.query(
    `SELECT
      ph.view as "poolId"
      FROM delegation AS d
        LEFT JOIN tx ON d.tx_id=tx.id
        LEFT JOIN pool_retire pr on pr.hash_id=d.pool_hash_id
        LEFT JOIN pool_hash ph on ph.id=d.pool_hash_id
        WHERE d.addr_id=$1
        ORDER BY tx.block_id DESC
        LIMIT 1`,
    [accountDbId]
  )
  const currentPool = currentPoolQuery.rows[0] || {}

  // staking key
  const newestStakingKeyBlockForDb = (dbTable) => `
    SELECT
      tx.block_id as "blockId"
      FROM tx
        LEFT JOIN ${dbTable} ON tx.id=${dbTable}.tx_id
        WHERE ${dbTable}.addr_id=$1
        ORDER BY tx.block_id DESC
        LIMIT 1
  `
  const registrationBlockResult = await db.query({
    text: newestStakingKeyBlockForDb('stake_registration'),
    values: [accountDbId],
  })
  const deregistrationBlockResult = await db.query({
    text: newestStakingKeyBlockForDb('stake_deregistration'),
    values: [accountDbId],
  })
  const latestRegistrationBlock = registrationBlockResult.rows.length
    ? parseInt(registrationBlockResult.rows[0].blockId, 10) : -1
  const latestDeregistrationBlock = deregistrationBlockResult.rows.length
    ? parseInt(deregistrationBlockResult.rows[0].blockId, 10) : -1
  const hasStakingKey = latestRegistrationBlock > latestDeregistrationBlock

  // next rewards
  const getEmptyRewardsArray = (currentEpoch) =>
    range(currentEpoch - 1, currentEpoch + 1)
      .map(epoch => ({ epoch }))

  const rawEpochDelegations = await db.query(`
    SELECT
      DISTINCT ON (block.epoch_no) block.epoch_no as "epochNo",
      ph.view as "poolId"
      FROM delegation d
        LEFT JOIN tx ON tx.id=d.tx_id
        LEFT JOIN block ON tx.block_id=block.id
        LEFT JOIN pool_hash ph on ph.id=d.pool_hash_id
        WHERE d.addr_id=$1
        ORDER BY block.epoch_no DESC, block.slot_no DESC
        LIMIT 4`,
    [accountDbId]
  )
  const epochDelegations = rawEpochDelegations.rows

  const getRewardObject = (epoch, poolId) => {
    const firstDelegationEpochWithRewards = 209
    const diff = epoch - firstDelegationEpochWithRewards - 2
    return {
      epochNo: epoch,
      rewardDate: moment.utc('2020-08-23 21:44:00').add(diff * 5, 'days').format(),
      poolId,
    }
  }

  const getNextRewards = async () => {
    if (!epochDelegations.length) {
      return getEmptyRewardsArray(currentEpoch)
    }
    let i = epochDelegations.length - 1
    const currentlyRewardedEpoch = currentEpoch - 2
    while (i > 0 && epochDelegations[i - 1].epochNo <= currentlyRewardedEpoch) { i -= 1 }
    const nextReward = epochDelegations[i]
    epochDelegations[i].epochNo = Math.max(currentlyRewardedEpoch, nextReward.epochNo)
    epochDelegations.length = i + 1
    const epochRewards = await Promise.all(epochDelegations
      .reverse()
      .map(async delegation => {
        return getRewardObject(delegation.epochNo, delegation.poolId)
      }))

    let j = 0
    const paddedEpochRewards = range(currentlyRewardedEpoch, currentlyRewardedEpoch + 4)
      .map(epoch => {
        if (j < epochRewards.length && epochRewards[j].epochNo === epoch) {
          return epochRewards[j++]
        }
        if (j === 0) { return { epochNo: epoch } }
        return getRewardObject(epoch, epochRewards[j - 1].poolId)
      })
    return paddedEpochRewards
  }

  const nextRewardsHistory = accountDbId
    ? await getNextRewards()
    : getEmptyRewardsArray(currentEpoch)

  res.send({
    rewardsAmount,
    rewardsHistory,
    currentPool,
    hasStakingKey,
    currentEpoch,
    nextRewardsHistory,
  })
})