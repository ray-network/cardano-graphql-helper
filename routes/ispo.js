const Router = require('express-promise-router')
const { range } = require('lodash')
const db = require('../db')
const router = new Router()

module.exports = router

/*
const pools = [
  'pool15sfcpy4tps5073gmra0e6tm2dgtrn004yr437qmeh44sgjlg2ex',
  'pool1d03p2xfdcq09efx0hgy4jkr0tqdgvklues5cg3ud45t9wndafmm',
  'pool1tzmx7k40sm8kheam3pr2d4yexrp3jmv8l50suj6crnvn6dc2429',
]

const startEpoch = 100
const cutoffEpoch = 130
const cutoffEpochEarly = 132
const endEpoch = 500
*/

const pools = [
  'pool1rjxdqghfjw5rv6lxg8qhedkechvfgnsqhl8rrzwck9g45n43yql',
  'pool1ntfxj2jgvhzen8e86ed679ctukar3vj538ywyyq8ryld66jj4sx',
  'pool1yt868wrp9s2x5pehe96del9m3nwasme62yw02vww3kg6zwzspcz',
]

const startEpoch = 235
const cutoffEpoch = 275
const cutoffEpochEarly = 277
const endEpoch = 500

const totalRewards = 100000000
const earlyBonus = 1538200
const maxStart = 888888
const decreaseRatio = 0.00444
const startRate = 50000000
const epochsRange = range(startEpoch, endEpoch + 1)

const calculateAmountWithDescrease = (amount, epoch, rewardsPerEpochs, currentEpoch) => {
  const diff = epoch - cutoffEpoch
  const coeff = diff >= 0 ? diff : 0
  const maxRewardsCalc = parseInt(maxStart - maxStart * decreaseRatio * coeff, 10)
  const maxRewards = maxRewardsCalc > 0 ? maxRewardsCalc : 0

  const fromEpochs = rewardsPerEpochs.filter(item => parseInt(item.epochNo) === epoch)
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
  const arr = data.filter(item => parseInt(item.epochNo, 10) === epoch)
  return arr.length > 0 ? arr[0] : {}
}

/*
 * SEARCH STAKE KEY BY KEY OR ADDRESS
 */

router.get('/search/:search', async (req, res) => {
  const { search } = req.params

  if (search.startsWith('addr1')) {
    const { rows: stakeAddressDbResult } = await db.query(
      `
        SELECT
          tx_out.stake_address_id as "id", stake_address.view as "key"
          FROM tx_out
            LEFT JOIN stake_address ON tx_out.stake_address_id=stake_address.id
            WHERE address=$1 limit 1
      `,
      [search]
    )
    res.send({
      id: stakeAddressDbResult.length > 0 ? stakeAddressDbResult[0].id : false,
      key: stakeAddressDbResult.length > 0 ? stakeAddressDbResult[0].key : false,
    })
  }

  if (!search.startsWith('addr1')) {
    const { rows: accountDbResult } = await db.query(
      'SELECT id as "accountDbId", view as "key" from stake_address WHERE view=$1',
      [search]
    )
    res.send({
      id: accountDbResult.length > 0 ? accountDbResult[0].accountDbId : false,
      key: accountDbResult.length > 0 ? accountDbResult[0].key : false,
    })
  }
})

/*
 * GLOBAL ISPO STATE
 */

router.get('/state', async (req, res) => {

  const currentEpochQuery = await db.query('SELECT no FROM epoch ORDER BY no desc limit 1')
  const currentEpoch = currentEpochQuery.rows.length > 0 ? parseInt(currentEpochQuery.rows[0].no, 10) : 0

  const { rows: rewardsHistoryForEpochs } = await db.query(`
    SELECT
      es.epoch_no::BIGINT as "epochNo",
      es.amount::BIGINT, ph.view as "poolId", 'ISPO' as "rewardType",
      e.start_time as "timeStart", e.end_time as "timeEnd"
      FROM epoch_stake es
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        LEFT JOIN epoch e ON es.epoch_no=e.no
        WHERE ph.view = ANY ($1)
        ORDER BY es.epoch_no DESC
    `,
    [pools]
  )

  const rewardsPerEpochs = Object.values(rewardsHistoryForEpochs.reduce((acc, { epochNo, timeStart, timeEnd, amount }) => {
    acc[epochNo] = {
      epochNo,
      timeStart,
      timeEnd,
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
  })

  let maxLimit = 0
  const distributed = epochsRange
    .map(epoch => {
      const distr = getEpochData(rewardsPerEpochs, epoch)
      const rewards = calculateAmountWithDescrease(distr.amount, epoch, rewardsPerEpochs, currentEpoch)
      maxLimit = maxLimit + (rewards[0] || 0)
      const exceed = maxLimit > totalRewards

      return {
        epoch,
        timeStart: distr.timeStart,
        timeEnd: distr.timeEnd,
        total: !exceed ? distr.amount || 0 : 0,
        xray: !exceed ? rewards[0] || 0 : 0,
        rate: !exceed ? rewards[1] || 0 : 0,
        maxRewards: !exceed ? decreaseGraph[epoch] : 0,
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

/*
 * RATE IN THE LAST EPOCH
 */

router.get('/rate', async (req, res) => {

  const currentEpochQuery = await db.query('SELECT no FROM epoch ORDER BY no desc limit 1')
  const currentEpoch = currentEpochQuery.rows.length > 0 ? parseInt(currentEpochQuery.rows[0].no, 10) : 0

  const { rows: rewardsHistoryForEpochs } = await db.query(`
    SELECT
      es.epoch_no::BIGINT as "epochNo",
      es.amount::BIGINT, ph.view as "poolId", 'ISPO' as "rewardType",
      e.start_time as "timeStart", e.end_time as "timeEnd"
      FROM epoch_stake es
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        LEFT JOIN epoch e ON es.epoch_no=e.no
        WHERE ph.view = ANY ($1) AND e.no = $2
        ORDER BY es.epoch_no DESC
    `,
    [pools, currentEpoch]
  )

  const rewardsPerEpochs = Object.values(rewardsHistoryForEpochs.reduce((acc, { epochNo, timeStart, timeEnd, amount }) => {
    acc[epochNo] = {
      epochNo,
      timeStart,
      timeEnd,
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
  })

  let maxLimit = 0
  const distributed = epochsRange
    .map(epoch => {
      const distr = getEpochData(rewardsPerEpochs, epoch)
      const rewards = calculateAmountWithDescrease(distr.amount, epoch, rewardsPerEpochs, currentEpoch)
      maxLimit = maxLimit + (rewards[0] || 0)
      const exceed = maxLimit > totalRewards

      return {
        epoch,
        timeStart: distr.timeStart,
        timeEnd: distr.timeEnd,
        total: !exceed ? distr.amount || 0 : 0,
        xray: !exceed ? rewards[0] || 0 : 0,
        rate: !exceed ? rewards[1] || 0 : 0,
        maxRewards: !exceed ? decreaseGraph[epoch] : 0,
      }
    })

  res.send({
    currentEpoch,
    rate: distributed.filter((epoch) => epoch.epoch === currentEpoch)[0].rate || 0,
  })
})

/*
 * REWARDS STATE BY KEY OR ADDRESS
 */

router.get('/key/:search', async (req, res) => {
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
      es.epoch_no::BIGINT as "epochNo",
      es.amount::BIGINT, ph.view as "poolId", 'ISPO' as "rewardType",
      e.start_time as "timeStart", e.end_time as "timeEnd"
      FROM epoch_stake es
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        LEFT JOIN epoch e ON es.epoch_no=e.no
        WHERE ph.view = ANY ($1) AND es.addr_id=$2
        ORDER BY es.epoch_no::BIGINT DESC`,
    [pools, accountDbId]
  )

  const { rows: rewardsHistoryForEpochs } = await db.query(`
    SELECT
      es.epoch_no::BIGINT as "epochNo",
      es.amount::BIGINT, ph.view as "poolId", 'ISPO' as "rewardType",
      e.start_time as "timeStart", e.end_time as "timeEnd"
      FROM epoch_stake es
        LEFT JOIN pool_hash ph ON es.pool_id=ph.id
        LEFT JOIN epoch e ON es.epoch_no=e.no
        WHERE ph.view = ANY ($1)
        ORDER BY es.epoch_no::BIGINT DESC
    `,
    [pools]
  )

  const rewardsPerEpochs = Object.values(rewardsHistoryForEpochs.reduce((acc, { epochNo, timeStart, timeEnd, amount }) => {
    acc[epochNo] = {
      epochNo,
      timeStart,
      timeEnd,
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
        timeStart: distr.timeStart,
        timeEnd: distr.timeEnd,
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
    const epoch = parseInt(item.epochNo, 10)
    const tokens = calculateAmountWithDescrease(parseInt(item.amount, 10), epoch, rewardsPerEpochs, currentEpoch)
    const isAvailable = xrayDistributed[epoch].xrayTotal < totalRewards

    return {
      ...item,
      amount: isAvailable ? tokens[0] || 0 : 0,
      perXray: isAvailable ? tokens[1] || 0 : 0,
      snapshot: isAvailable ? parseInt(item.amount, 10) : 0,
    }
  })

  const totalAccruedToDelegators = distributed.reduce((n, { xray }) => n + xray, 0)
  const total = rewardsHistory.reduce((n, { amount }) => n + amount, 0)

  const totalAccruedInEarly = distributed
    .filter(distr => distr.epoch <= cutoffEpochEarly)
    .reduce((n, { xray }) => n + xray, 0)
  const totalInEarly = rewardsHistory
    .filter(distr => parseInt(distr.epochNo, 10) <= cutoffEpochEarly)
    .reduce((n, { amount }) => n + amount, 0)

  const totalEarlyBonus = Math.ceil(totalInEarly / totalAccruedInEarly * earlyBonus / 100)
  const totalEarlyShare = (totalInEarly / totalAccruedInEarly).toFixed(4)

  res.send({
    found: !(parseInt(accountDbId) < 0),
    isAddress,
    search,
    total,
    totalEarlyBonus,
    totalEarlyShare,
    rewardsHistory,
    currentEpoch,
    totalAccruedToDelegators,
  })
})