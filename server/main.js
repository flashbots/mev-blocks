const express = require('express')
const Sentry = require('@sentry/node')
const postgres = require('postgres')
const _ = require('lodash')

if (process.env.SENTRY_DSN) {
  console.log('initializing sentry')
  Sentry.init({
    dsn: process.env.SENTRY_DSN
  })
}

const app = express()
app.set('trust proxy', true)

process.on('unhandledRejection', (err) => {
  Sentry.captureException(err)
  console.error(`unhandled rejection: ${err}`)
})

const PORT = parseInt(_.get(process.env, 'PORT', '31080'))

const sql = postgres(process.env.POSTGRES_DSN)

/**
 * @api {get} /v1/transactions Get transactions
 * @apiVersion 1.0.0
 * @apiGroup Flashbots
 * @apiDescription Returns the 100 most recent flashbots transactions. Use the `before` query param to filter to transactions before a given block number.
 *
 * @apiParam (Query string) {Number}   [before=latest]  Filter transactions to before this block number (exclusive, does not include this block number)
 * @apiParam (Query string) {Number{1-10000}}   [limit=100]  Number of transactions that are returned
 *
 * @apiSuccess {Object[]} transactions       List of transactions.
 * @apiSuccess {String}   transactions.transaction_hash transaction hash
 * @apiSuccess {Number}   transactions.block_number   block number
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
{
  transactions: [
    {
      transaction_hash: '0x944efcddcc36cbbb846695548ccc60af96c1c9e30d3680d996f7f3e0e6c02a0b',
      block_number: 11877225
    },
    {
      transaction_hash: '0x88fea43fc740b505a2afadec4aab93ecf5f30939818e4b6e2321a051627e96fc',
      block_number: 11877181
    }
  ]
}
 */
app.get('/v1/transactions', async (req, res, next) => {
  try {
    let before = req.query.before
    if (before === 'latest') {
      before = ''
    }
    let limit = parseInt(req.query.limit)
    if (isNaN(limit)) {
      limit = 100
    }
    if (limit < 0 || limit > 10000) {
      res.status(400)
      res.json({ error: `invalid limit param provided, must be less than 10000 and more than 0: ${req.query.limit}` })
      return
    }

    let transactions
    if (before) {
      const beforeInt = parseInt(before)
      if (isNaN(beforeInt)) {
        res.status(400)
        res.json({ error: `invalid before param provided, expected a number but got: ${before}` })
        return
      }
      transactions = await sql`select transaction_hash, block_number from mined_bundles where block_number < ${beforeInt} order by block_number desc limit ${limit}`
    } else {
      transactions = await sql`select transaction_hash, block_number from mined_bundles order by block_number desc limit ${limit}`
    }

    res.json({ transactions })
  } catch (error) {
    console.error('unhandled error in /transactions', error)
    Sentry.captureException(error)
    res.status(500)
    res.end('Internal Server Error')
  }
})

/**
 * @api {get} /v1/blocks Get blocks
 * @apiVersion 1.0.0
 * @apiGroup Flashbots
 * @apiDescription Returns the 100 most recent flashbots blocks. This also contains a list of transactions that were part of the flashbots bundle. Use the `before` query param to filter to blocks before a given block number.
 *
 * @apiParam (Query string) {Number}   [before=latest]  Filter blocks to before this block number (exclusive, does not include this block number)
 * @apiParam (Query string) {Number{1-10000}}   [limit=100]  Number of blocks that are returned
 *
 * @apiSuccess {Object[]} blocks       List of blocks.
 * @apiSuccess {Number}   blocks.block_number   block_number
 * @apiSuccess {Number}   blocks.miner_reward   miner_reward
 * @apiSuccess {Number}   blocks.gas_used   gas_used
 * @apiSuccess {Number}   blocks.gas_price   gas_price
 * @apiSuccess {Object[]} blocks.transactions List of transactions
 * @apiSuccess {String}   blocks.transactions.transaction_hash transaction hash
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
{
  blocks: [
    {
      transactions: [
        {
          transaction_hash: '0x944efcddcc36cbbb846695548ccc60af96c1c9e30d3680d996f7f3e0e6c02a0b'
        }
      ],
      block_number: 11877225,
      miner_reward: 64855128449839820,
      gas_used: 149287,
      gas_price: 434432525603
    },
    ...
  ]
}
 */
app.get('/v1/blocks', async (req, res) => {
  /* eslint-disable camelcase */
  try {
    let before = req.query.before
    if (before === 'latest') {
      before = ''
    }
    let limit = parseInt(req.query.limit)
    if (isNaN(limit)) {
      limit = 100
    }
    if (limit < 0 || limit > 10000) {
      res.status(400)
      res.json({ error: `invalid limit param provided, must be less than 10000 and more than 0: ${req.query.limit}` })
      return
    }

    let rows
    if (before) {
      const beforeInt = parseInt(before)
      if (isNaN(beforeInt)) {
        res.status(400)
        res.json({ error: `invalid before param provided, expected a number but got: ${before}` })
        return
      }
      rows = await sql`select transaction_hash, block_number, miner_reward, gas_used, gas_price from mined_bundles where block_number < ${beforeInt} order by block_number desc limit ${limit}`
    } else {
      rows = await sql`select transaction_hash, block_number, miner_reward, gas_used, gas_price from mined_bundles order by block_number desc limit ${limit}`
    }

    const blocks = _.map(rows, ({ transaction_hash, block_number, miner_reward, gas_used, gas_price }) => {
      return {
        transactions: _.map(transaction_hash.split(','), (tx) => {
          return { transaction_hash: tx }
        }),
        block_number,
        miner_reward,
        gas_used,
        gas_price
      }
    })

    res.json({ blocks })
  } catch (error) {
    console.error('unhandled error in /transactions', error)
    Sentry.captureException(error)
    res.status(500)
    res.end('Internal Server Error')
  }
})

app.use(express.static('apidoc'))

app.listen(PORT, () => {
  console.log(`mev-etherscan listening at ${PORT}`)
})
