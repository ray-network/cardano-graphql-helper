const Router = require('express-promise-router')
const { range } = require('lodash')
const db = require('../db')
const router = new Router()

module.exports = router

const pools = [
  'pool1rjxdqghfjw5rv6lxg8qhedkechvfgnsqhl8rrzwck9g45n43yql',
]

// const pools = [
//   'pool15sfcpy4tps5073gmra0e6tm2dgtrn004yr437qmeh44sgjlg2ex',
//   'pool1d03p2xfdcq09efx0hgy4jkr0tqdgvklues5cg3ud45t9wndafmm',
//   'pool1tzmx7k40sm8kheam3pr2d4yexrp3jmv8l50suj6crnvn6dc2429',
// ]

const startEpoch = 235
const cutoffEpoch = 275
const endEpoch = 500
const totalRewards = 100000000
const earlyBonus = 1538200
const maxStart = 444444
const decreaseRatio = 0.00444
const startRate = 50000000
const epochsRange = range(startEpoch, endEpoch + 1)

const calculateAmountWithDescrease = (amount, epoch, rewardsPerEpochs, currentEpoch) => {
  const diff = epoch - cutoffEpoch
  const coeff = diff >= 0 ? diff : 0
  const maxRewardsCalc = parseInt(maxStart - maxStart * decreaseRatio * coeff, 10)
  const maxRewards = maxRewardsCalc > 0 ? maxRewardsCalc : 0

  const fromEpochs = rewardsPerEpochs.filter(item => item.epochNo === epoch)
  const fromEpoch = fromEpochs.length > 0 ? fromEpochs[0] : {}
  const fromEpochAmount = fromEpoch.amount || 0

  let ratio = 1
  if (maxRewards > 0) {
    const newRate = fromEpochAmount / maxRewards
    if (newRate > startRate) {
      ratio = fromEpochAmount / maxRewards / startRate
    }
  }

  const rate = startRate * ratio
  const isAvailable = epoch < endEpoch && maxRewards > 0 && epoch <= currentEpoch
  const result = isAvailable
    ? [Math.floor(amount / rate), Math.round(rate)]
    : [0, 0]

  return result
}

const getEpochData = (data, epoch) => {
  const arr = data.filter(item => item.epochNo === epoch)
  return arr.length > 0 ? arr[0] : {}
}

router.get('/delegation/state', async (req, res) => {

  const currentEpochQuery = await db.query('SELECT no FROM epoch ORDER BY no desc limit 1')
  const currentEpoch = currentEpochQuery.rows.length > 0 ? parseInt(currentEpochQuery.rows[0].no, 10) : 0

  const { rows: rewardsHistoryForEpochs } = await db.query(`
    SELECT
      es.epoch_no::BIGINT as "forDelegationInEpoch", block.epoch_no as "epochNo",
      block.time, es.amount::BIGINT, ph.view as "poolId", 'REGULAR' as "rewardType"
      FROM epoch_stake es
        LEFT JOIN block ON es.block_id=block.id
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        WHERE ph.view = ANY ($1)
        ORDER BY block.slot_no DESC
    `,
    [pools]
  )

  const rewardsPerEpochs = Object.values(rewardsHistoryForEpochs.reduce((acc, { epochNo, amount }) => {
    acc[epochNo] = {
      epochNo,
      amount: (acc[epochNo] ? parseInt(acc[epochNo].amount) : 0) + parseInt(amount)
    }
    return acc
  }, {}))


  const decreaseGraph = {}
  epochsRange.forEach(epoch => {
    const diff = epoch - cutoffEpoch
    const coeff = diff >= 0 ? diff : 0
    const maxRewardsCalc = parseInt(maxStart - maxStart * decreaseRatio * coeff, 10)
    const maxRewards = maxRewardsCalc > 0 ? maxRewardsCalc : 0

    decreaseGraph[epoch] = maxRewards
    return {
      [epoch]: maxRewards,
    }
  })

  let maxLimit = 0
  const distributed = epochsRange
    .map(epoch => {
      const distr = getEpochData(rewardsPerEpochs, epoch)
      const rewards = calculateAmountWithDescrease(distr.amount, epoch, rewardsPerEpochs, currentEpoch)
      maxLimit = maxLimit + (rewards[0] || 0)
      const exceed = maxLimit > totalRewards

      return {
        epoch: epoch,
        total: !exceed ? distr.amount || 0 : 0,
        xray: !exceed ? rewards[0] || 0 : 0,
        rate: !exceed ? rewards[1] || 0 : 0,
        maxRewards: decreaseGraph[epoch]
      }
    })

  const totalAccrued = distributed.reduce((n, { xray }) => n + xray, 0)
  const totalUndelivered = totalRewards - totalAccrued

  res.send({
    currentEpoch,
    totalAccrued,
    totalUndelivered,
    distributed,
  })
})

router.get('/delegation/state/:search', async (req, res) => {
  const { search } = req.params

  // accountDbId
  let accountDbId = ''
  let isAddress = false
  if (search.startsWith('addr1')) {
    isAddress = true
    const { rows: stakeAddressDbResult } = await db.query(
      `SELECT stake_address_id FROM tx_out WHERE address=$1 limit 1`,
      [search]
    )
    accountDbId = stakeAddressDbResult.length > 0 ? stakeAddressDbResult[0].stake_address_id : '-1'
  } else {
    const { rows: accountDbResult } = await db.query(
      'SELECT id as "accountDbId" from stake_address WHERE view=$1',
      [search]
    )
    accountDbId = accountDbResult.length > 0 ? accountDbResult[0].accountDbId : '-1'
  }

  const currentEpochQuery = await db.query('SELECT no FROM epoch ORDER BY no desc limit 1')
  const currentEpoch = currentEpochQuery.rows.length > 0 ? parseInt(currentEpochQuery.rows[0].no, 10) : 0

  const { rows: rewardsHistoryForAccount } = await db.query(`
    SELECT
      es.epoch_no::BIGINT as "forDelegationInEpoch",
      block.time, block.id, es.amount::BIGINT, ph.view as "poolId", 'REGULAR' as "rewardType"
      FROM epoch_stake es
        LEFT JOIN block ON es.block_id=block.id
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        WHERE ph.view = ANY ($1) AND es.addr_id=$2
        ORDER BY block.slot_no DESC`,
    [pools, accountDbId]
  )

  const { rows: rewardsHistoryForEpochs } = await db.query(`
    SELECT
      es.epoch_no::BIGINT as "forDelegationInEpoch", block.epoch_no as "epochNo",
      block.time, es.amount::BIGINT, ph.view as "poolId", 'REGULAR' as "rewardType"
      FROM epoch_stake es
        LEFT JOIN block ON es.block_id=block.id
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        WHERE ph.view = ANY ($1)
        ORDER BY block.slot_no DESC
    `,
    [pools]
  )

  const rewardsPerEpochs = Object.values(rewardsHistoryForEpochs.reduce((acc, { epochNo, amount }) => {
    acc[epochNo] = {
      epochNo,
      amount: (acc[epochNo] ? parseInt(acc[epochNo].amount, 10) : 0) + parseInt(amount, 10)
    }
    return acc
  }, {}))


  const distributed = []
  let xrayTotal = 0
  epochsRange
    .forEach(epoch => {
      const distr = getEpochData(rewardsPerEpochs, epoch)
      const rewards = calculateAmountWithDescrease(distr.amount, epoch, rewardsPerEpochs, currentEpoch)
      xrayTotal = xrayTotal + rewards[0]

      distributed.push({
        epoch: epoch,
        total: distr.amount || 0,
        xray: rewards[0] || 0,
        rate: rewards[1] || 0,
        xrayTotal,
      })
    })

  const xrayDistributed = {}
  distributed.forEach(item => {
    xrayDistributed[item.epoch] = {
      xrayTotal: item.xrayTotal,
    }
  })

  const rewardsHistory = rewardsHistoryForAccount.map(item => {
    const epoch = parseInt(item.forDelegationInEpoch, 10)
    const tokens = calculateAmountWithDescrease(parseInt(item.amount, 10), epoch, rewardsPerEpochs, currentEpoch)
    const isAvailable = xrayDistributed[epoch].xrayTotal < totalRewards

    return {
      ...item,
      amount: isAvailable ? tokens[0] || 0 : 0,
      perXray: isAvailable ? tokens[1] || 0 : 0,
      snapshot: isAvailable ? parseInt(item.amount, 10) : 0,
    }
  })

  const totalAccrued = distributed.reduce((n, { xray }) => n + xray, 0)
  const total = rewardsHistory.reduce((n, { amount }) => n + amount, 0)
  const totalEarlyBonus = Math.floor(total / totalAccrued * earlyBonus)
  const totalEarlyShare = (total / totalAccrued).toFixed(4)

  res.send({
    found: !(parseInt(accountDbId) < 0),
    isAddress,
    search,
    total,
    totalEarlyBonus,
    totalEarlyShare,
    rewardsHistory,
    currentEpoch,
  })
})