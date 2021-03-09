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
 * @apiSuccess {String}   transactions.tx_index index of tx inside of bundle
 * @apiSuccess {Number}   transactions.block_number   block number
 * @apiSuccess {String}   transactions.eoa_address address of the externally owned account that created this transaction
 * @apiSuccess {String}   transactions.to_address to address
 * @apiSuccess {String}   transactions.gas_used gas used in this transaction
 * @apiSuccess {String}   transactions.gas_price gas price of this transaction
 * @apiSuccess {String}   transactions.coinbase_transfer ETH directly transferred to the coinbase, not counting gas
 * @apiSuccess {String}   transactions.total_miner_reward ETH transferred to the coinbase, including gas and direct transfers
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
{
  "transactions": [
    {
      "transaction_hash": "0x52258130e92d9a527e1751aa011a340641c7b0ff61c7df1c35b6eddc8a0cfadd",
      "tx_index": 0,
      "block_number": 11999806,
      "eoa_address": "0x421125ca608A35458B2C99DA39CD55B70bA202a4",
      "to_address": "0xa57Bd00134B2850B2a1c55860c9e9ea100fDd6CF",
      "gas_used": 79188,
      "gas_price": 0,
      "coinbase_transfer": 10340046243502720,
      "total_miner_reward": 10340046243502720
    },
    {
      "transaction_hash": "0x965aa095d75f03ba91851ce3b8f1b51fee09ae0de837e42652412b6ace18691f",
      "tx_index": 0,
      "block_number": 11999435,
      "eoa_address": "0x1F00ACFEdC298253487D91758bcfe9D7a6Ba2c83",
      "to_address": "0xb10E56Edb7698C960f1562c7edcC15612900c4A5",
      "gas_used": 103577,
      "gas_price": 0,
      "coinbase_transfer": 0,
      "total_miner_reward": 0
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

    let beforeInt
    if (before) {
      beforeInt = parseInt(before)
      if (isNaN(beforeInt)) {
        res.status(400)
        res.json({ error: `invalid before param provided, expected a number but got: ${before}` })
        return
      }
    }
    const transactions = await sql`
      select
          transaction_hash,
          tx_index,
          block_number,
          eoa_address,
          to_address,
          gas_used,
          gas_price,
          coinbase_transfer,
          total_miner_reward
      from
          mined_bundle_txs
      where
          (${beforeInt || null}::int is null or block_number < ${beforeInt})
      order by
          block_number desc
      limit
          ${limit}`

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
 * @apiParam (Query string) {Number}   [block_number]  Returns just a single block equal to the given block_number
 * @apiParam (Query string) {Number}   [before=latest]  Filter blocks to before this block number (exclusive, does not include this block number)
 * @apiParam (Query string) {Number{1-10000}}   [limit=100]  Number of blocks that are returned
 *
 * @apiSuccess {Object[]} blocks       List of blocks.
 * @apiSuccess {Number}   blocks.block_number   Block number
 * @apiSuccess {Number}   blocks.miner_reward   The total reward paid to the miner. This includes gas fees
 * @apiSuccess {Number}   blocks.gas_used   Total gas used by the bundle
 * @apiSuccess {Number}   blocks.gas_price   The adjusted gas price of the bundle. This is not an actual gas price, but it is what's used by mev-geth to sort bundles. Found by doing: miner_reward/gas_used
 * @apiSuccess {Object[]} blocks.transactions List of transactions
 * @apiSuccess {String}   blocks.transactions.transaction_hash transaction hash
 * @apiSuccess {String}   blocks.transactions.tx_index index of tx inside of bundle
 * @apiSuccess {Number}   blocks.transactions.block_number   block number
 * @apiSuccess {String}   blocks.transactions.eoa_address address of the externally owned account that created this transaction
 * @apiSuccess {String}   blocks.transactions.to_address to address
 * @apiSuccess {String}   blocks.transactions.gas_used gas used in this transaction
 * @apiSuccess {String}   blocks.transactions.gas_price gas price of this transaction
 * @apiSuccess {String}   blocks.transactions.coinbase_transfer ETH directly transferred to the coinbase, not counting gas
 * @apiSuccess {String}   blocks.transactions.total_miner_reward ETH transferred to the coinbase, including gas and direct transfers
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
{
  "blocks": [
    {
      "block_number": 12006597,
      "miner_reward": 89103402731082940,
      "gas_used": 374858,
      "gas_price": 237699082668,
      "transactions": [
        {
          "transaction_hash": "0x3c302a865edd01047e5454a28feb4bb91b5e4d880b53ba2b91aec359ebe031a5",
          "tx_index": 0,
          "block_number": 12006597,
          "eoa_address": "0xf888ac7A3f709d3DA4fabBB04412c479b94FEC94",
          "to_address": "0x111111125434b319222CdBf8C261674aDB56F3ae",
          "gas_used": 292129,
          "gas_price": 129000000000,
          "coinbase_transfer": 0,
          "total_miner_reward": 37684641000000000
        },
        {
          "transaction_hash": "0xb0686a581fde130f5e0621c6aedb2f7b4c33fbc95f89cda0e01833843a4f6b29",
          "tx_index": 1,
          "block_number": 12006597,
          "eoa_address": "0xD1c1E70325E89bf7d6440Fe9D10802186B21672d",
          "to_address": "0xa57Bd00134B2850B2a1c55860c9e9ea100fDd6CF",
          "gas_used": 82729,
          "gas_price": 0,
          "coinbase_transfer": 51418761731082940,
          "total_miner_reward": 51418761731082940
        }
      ]
    }
  ]
}
 */
app.get('/v1/blocks/:block_number?', async (req, res) => {
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

    let beforeInt
    if (before) {
      beforeInt = parseInt(before)
      if (isNaN(beforeInt)) {
        res.status(400)
        res.json({ error: `invalid before param provided, expected a number but got: ${before}` })
        return
      }
    }

    let blockNumInt
    if (req.query.block_number) {
      blockNumInt = parseInt(req.query.block_number)
      if (isNaN(blockNumInt)) {
        res.status(400)
        res.json({ error: `invalid before param provided, expected a number but got: ${req.query.block_number}` })
        return
      }
    }
    const blocks = await sql`
        select
            b.block_number,
            b.miner_reward,
            b.gas_used,
            b.gas_price,
            array_agg(row_to_json(t)) as transactions
        from
            mined_bundles b
              join mined_bundle_txs t ON b.block_number = t.block_number
        where
            (${beforeInt || null}::int is null or b.block_number < ${beforeInt}) and
            (${blockNumInt || null}::int is null or b.block_number = ${blockNumInt})
        group by
            b.block_number
        order by
            b.block_number desc
        limit
          ${limit}`

    // const blocks = _.map(rows, ({ transaction_hash, block_number, miner_reward, gas_used, gas_price }) => {
    //   return {
    //     transactions: _.map(transaction_hash.split(','), (tx) => {
    //       return { transaction_hash: tx }
    //     }),
    //     block_number,
    //     miner_reward,
    //     gas_used,
    //     gas_price
    //   }
    // })

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
