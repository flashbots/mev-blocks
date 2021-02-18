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
app.get('/v1/transactions', async (req, res) => {
  const transactions = await sql`select transaction_hash, block_number from mined_bundles order by block_number desc limit 100`
  res.json({ transactions })
})

/**
 * @api {get} /v1/blocks Get blocks
 * @apiVersion 1.0.0
 * @apiGroup Flashbots
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
  const rows = await sql`select transaction_hash, block_number, miner_reward, gas_used, gas_price from mined_bundles order by block_number desc limit 100`
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
})

app.use(express.static('apidoc'))

app.listen(PORT, () => {
  console.log(`mev-etherscan listening at ${PORT}`)
})
