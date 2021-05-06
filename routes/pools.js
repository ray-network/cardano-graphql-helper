const Router = require('express-promise-router')
const db = require('../db')
const router = new Router()

module.exports = router

router.post('/info/', async (req, res) => {
  const { poolsIds, currentEpoch } = req.body

  const poolsQuery = await db.query(`
    SELECT 
      sp."poolHash", sp.pledge, sp.margin, sp."fixedCost", sp.url, sp."poolId", sp.amount FROM
        (SELECT 
          DISTINCT ON (ph.hash_raw) RIGHT(ph.hash_raw::text, -2) as "poolHash",
            ph.view as "poolId", p.pledge, p.margin,
            p.fixed_cost as "fixedCost", pmd.url, ph.id as pool_hash_id,
            es.amount
          FROM pool_update AS p
            LEFT JOIN pool_meta_data AS pmd ON p.meta_id=pmd.id
            LEFT JOIN pool_hash AS ph ON p.hash_id=ph.id
            LEFT JOIN epoch_stake AS es ON (p.hash_id=es.pool_id and ${currentEpoch}=es.epoch_no)
            WHERE ph.view='pool1d03p2xfdcq09efx0hgy4jkr0tqdgvklues5cg3ud45t9wndafmm'
            ORDER BY ph.hash_raw, p.registered_tx_id DESC
        ) sp
  `)

  const pools = poolsQuery.rows
  console.log(pools)

  res.send({
    pools,
  })
})