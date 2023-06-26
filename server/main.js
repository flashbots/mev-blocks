import express from 'express'
import Sentry from '@sentry/node'
import postgres from 'postgres'
import cors from 'cors'
import utils from 'web3-utils'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import _ from 'lodash'
import { getPremergeBlocks, getPremergeTransactions } from './premerge.js'

const MAX_QUERY_LIMIT = 100
const DEFAULT_QUERY_LIMIT = 10
const DB_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || '20')

if (process.env.SENTRY_DSN) {
  console.log('initializing sentry')
  Sentry.init({
    dsn: process.env.SENTRY_DSN
  })
}

const app = express()
app.set('trust proxy', true)

app.use(morgan('tiny'))
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60
  })
)
app.use(cors({ origin: ['http://localhost:3000', 'https://flashbots-explorer.marto.lol', 'https://test--flashbots-explorer.netlify.app'] }))
process.on('unhandledRejection', (err) => {
  Sentry.captureException(err)
  console.error(`unhandled rejection: ${err}`)
})

const PORT = parseInt(_.get(process.env, 'PORT', '31080'))
const MERGE_BLOCK_NUMBER = parseInt(process.env.MERGE_BLOCK_NUMBER || '1')
const BUNDLE_TX_LIMIT = parseInt(process.env.BUNDLE_TX_LIMIT || '75')
const sql = postgres(process.env.POSTGRES_DSN, { max: DB_POOL_SIZE })

/**
 * @api {get} /v1/transactions Get transactions
 * @apiVersion 1.0.0
 * @apiGroup Flashbots
 * @apiDescription Returns the 100 most recent flashbots transactions. Use the `before` query param to filter to transactions before a given block number.
 *
 * @apiParam (Query string) {Number}   [before=latest]  Filter transactions to before this block number (exclusive, does not include this block number)
 * @apiParam (Query string) {Number{1-100}}   [limit=10]  Number of transactions that are returned
 *
 * @apiSuccess {Number}   latest_block_number   The latest block number that has been processed
 * @apiSuccess {Object[]} transactions       List of transactions.
 * @apiSuccess {String}   transactions.transaction_hash transaction hash
 * @apiSuccess {Number}   transactions.tx_index index of tx inside of bundle
 * @apiSuccess {Number}   transactions.bundle_index index of bundle inside of the block
 * @apiSuccess {Number}   transactions.block_number   block number
 * @apiSuccess {String}   transactions.eoa_address address of the externally owned account that created this transaction
 * @apiSuccess {String}   transactions.to_address to address
 * @apiSuccess {Number}   transactions.gas_used gas used in this transaction
 * @apiSuccess {String}   transactions.gas_price gas price of this transaction
 * @apiSuccess {String}   transactions.eth_sent_to_fee_recipient ETH (in wei) directly transferred to the fee recipient, not counting gas
 * @apiSuccess {String}   transactions.fee_recipient_eth_diff ETH (in wei) transferred to the fee recipient, including gas and direct transfers
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
{
  "transactions": [
    {
      "transaction_hash": "0x52258130e92d9a527e1751aa011a340641c7b0ff61c7df1c35b6eddc8a0cfadd",
      "tx_index": 0,
      "bundle_index": 0,
      "block_number": 11999806,
      "eoa_address": "0x421125ca608A35458B2C99DA39CD55B70bA202a4",
      "to_address": "0xa57Bd00134B2850B2a1c55860c9e9ea100fDd6CF",
      "gas_used": 79188,
      "gas_price": "0",
      "eth_sent_to_fee_recipient": "10340046243502720",
      "fee_recipient_eth_diff": "10340046243502720"
    },
    {
      "transaction_hash": "0x965aa095d75f03ba91851ce3b8f1b51fee09ae0de837e42652412b6ace18691f",
      "tx_index": 0,
      "bundle_index": 0,
      "block_number": 11999435,
      "eoa_address": "0x1F00ACFEdC298253487D91758bcfe9D7a6Ba2c83",
      "to_address": "0xb10E56Edb7698C960f1562c7edcC15612900c4A5",
      "gas_used": 103577,
      "gas_price": "0",
      "eth_sent_to_fee_recipient": "0",
      "fee_recipient_eth_diff": "0"
    }
  ],
  "latest_block_number": 11999809
}
 */
app.get('/v1/transactions', async (req, res) => {
  try {
    let before = req.query.before
    if (before === 'latest') {
      before = ''
    }
    let limit = parseInt(req.query.limit)
    if (isNaN(limit)) {
      limit = DEFAULT_QUERY_LIMIT
    }
    if (limit < 0 || limit > MAX_QUERY_LIMIT) {
      res.status(400)
      res.json({ error: `invalid limit param provided, must be less than ${MAX_QUERY_LIMIT} and more than 0: ${req.query.limit}` })
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
    if (beforeInt < MERGE_BLOCK_NUMBER) {
      return getPremergeTransactions(sql, req, res)
    }
    const transactions = await sql`
      select
          tx_hash as transaction_hash,
          tx_index,
          bundle_index,
          block_number,
          from_address as eao_address,
          to_address,
          gas_used,
          gas_price::text,
          
          eth_sent_to_fee_recipient::text as coinbase_transfer,
          eth_sent_to_fee_recipient::text as eth_sent_to_fee_recipient,
          
          fee_recipient_eth_diff::text as total_miner_reward,
          fee_recipient_eth_diff::text as fee_recipient_eth_diff
      from
          included_built_block_bundle_txs
      where
          (${beforeInt || null}::int is null or block_number < ${beforeInt}::int)
      order by
          block_number desc
      limit
          ${limit}`

    const latestBlockNumber = await sql`select max(block_number) as block_number from blocks`

    res.json({ transactions, latest_block_number: latestBlockNumber[0].block_number })
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
 * @apiDescription Returns the 100 most recent flashbots blocks. This also contains a list of transactions that were part of the flashbots bundle. Use query parameters to filter this down to blocks you're interested in.
 *
 * @apiParam (Query string) {Number}   [block_number]  Returns just a single block equal to the given block_number
 * @apiParam (Query string) {String}   [fee_recipient]  Filter to a single miner address
 * @apiParam (Query string) {String}   [from]   Filter to get blocks including transactions sent by from
 * @apiParam (Query string) {Number}   [before=latest]  Filter blocks to before this block number (exclusive, does not include this block number)
 * @apiParam (Query string) {Number{1-100}}   [limit=10]  Number of blocks that are returned
 *
 * @apiSuccess {Number}   latest_block_number   The latest block number that has been processed
 * @apiSuccess {Object[]} blocks       List of blocks.
 * @apiSuccess {Number}   blocks.block_number   Block number
 * @apiSuccess {String}   blocks.fee_recipient   The Fee Recipient's address
 * @apiSuccess {String}   blocks.fee_recipient_eth_diff   The total ETH (in wei) reward paid to the fee recipient. This includes gas fees and direct eth transfers
 * @apiSuccess {String}   blocks.eth_sent_to_fee_recipient   The total ETH (in wei) transferred directly to the fee recipient, not counting gas
 * @apiSuccess {Number}   blocks.gas_used   Total gas used by the bundle
 * @apiSuccess {String}   blocks.gas_price   The adjusted gas price of the bundle. This is not a transactions's gas price, but what mev-geth uses to sort bundles. Found by doing: fee_recipient_eth_diff/gas_used. Like fee_recipient_eth_diff, base_fee is subtracted from the gas fees.
 * @apiSuccess {Object[]} blocks.transactions List of transactions
 * @apiSuccess {String}   blocks.transactions.transaction_hash transaction hash
 * @apiSuccess {Number}   blocks.transactions.tx_index index of tx inside of bundle
 * @apiSuccess {String}   blocks.transactions.bundle_type The bundle type, either "flashbots" or "mempool". Mempool indicates some non-relayed transactions were included between flashbots-relayed bundles.
 * @apiSuccess {Number}   blocks.transactions.bundle_index index of bundle inside of the block
 * @apiSuccess {Number}   blocks.transactions.block_number   block number
 * @apiSuccess {String}   blocks.transactions.eoa_address address of the externally owned account that created this transaction
 * @apiSuccess {String}   blocks.transactions.to_address to address
 * @apiSuccess {Number}   blocks.transactions.gas_used gas used in this transaction
 * @apiSuccess {String}   blocks.transactions.gas_price gas price of this transaction
 * @apiSuccess {String}   blocks.transactions.eth_sent_to_fee_recipient ETH (in wei) directly transferred to the fee recipient, not counting gas
 * @apiSuccess {String}   blocks.transactions.fee_recipient_eth_diff ETH (in wei) transferred to the fee recipient, including gas and direct transfers. The burned base_fee (EIP-1559) is not credited to the fee recipient, so the base_fee is not present in this value.
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
{
  "blocks": [
    {
      "block_number": 12006597,
      "fee_recipient_eth_diff": "89103402731082940",
      "fee_recipient": "0xd224ca0c819e8e97ba0136b3b95ceff503b79f53",
      "eth_sent_to_fee_recipient": "51418761731082940",
      "gas_used": 374858,
      "gas_price": "237699082668",
      "transactions": [
        {
          "transaction_hash": "0x3c302a865edd01047e5454a28feb4bb91b5e4d880b53ba2b91aec359ebe031a5",
          "bundle_type": "flashbots",
          "tx_index": 0,
          "bundle_index": 0,
          "block_number": 12006597,
          "eoa_address": "0xf888ac7A3f709d3DA4fabBB04412c479b94FEC94",
          "to_address": "0x111111125434b319222CdBf8C261674aDB56F3ae",
          "gas_used": 292129,
          "gas_price": "129000000000",
          "eth_sent_to_fee_recipient": "0",
          "fee_recipient_eth_diff": "37684641000000000"
        },
        {
          "transaction_hash": "0xb0686a581fde130f5e0621c6aedb2f7b4c33fbc95f89cda0e01833843a4f6b29",
          "bundle_type": "flashbots",
          "tx_index": 1,
          "bundle_index": 0,
          "block_number": 12006597,
          "eoa_address": "0xD1c1E70325E89bf7d6440Fe9D10802186B21672d",
          "to_address": "0xa57Bd00134B2850B2a1c55860c9e9ea100fDd6CF",
          "gas_used": 82729,
          "gas_price": "0",
          "eth_sent_to_fee_recipient": "51418761731082940",
          "fee_recipient_eth_diff": "51418761731082940"
        }
      ]
    }
  ],
  "latest_block_number": 12006599
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
      limit = DEFAULT_QUERY_LIMIT
    }
    if (limit < 0 || limit > MAX_QUERY_LIMIT) {
      res.status(400)
      res.json({ error: `invalid limit param provided, must be less than ${MAX_QUERY_LIMIT} and more than 0 but got: ${req.query.limit}` })
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
        res.json({ error: `invalid block_number param provided, expected a number but got: ${req.query.block_number}` })
        return
      }
    }

    if (blockNumInt < MERGE_BLOCK_NUMBER || beforeInt < MERGE_BLOCK_NUMBER) {
      return getPremergeBlocks(sql, req, res)
    }

    // allow both query by fee_recipient or miner
    let feeRecipient = req.query.fee_recipient || req.query.miner
    if (feeRecipient) {
      feeRecipient = utils.toChecksumAddress(feeRecipient)
    }

    let from = req.query.from
    if (from) {
      from = utils.toChecksumAddress(from)
    }

    const bundles = await sql`
        select
            b.block_number,
            sum(t.fee_recipient_eth_diff)::text as miner_reward,
            sum(t.fee_recipient_eth_diff)::text as fee_recipient_eth_diff,
            min(b.fee_recipient) as miner,
            min(b.fee_recipient) as fee_recipient,
            sum(t.eth_sent_to_fee_recipient)::text as coinbase_transfers,
            sum(t.eth_sent_to_fee_recipient)::text as eth_sent_to_fee_recipient,
            sum(t.gas_used) as gas_used,
            floor(sum(t.fee_recipient_eth_diff)/sum(t.gas_used))::text as gas_price,
            floor(sum(t.fee_recipient_eth_diff)/sum(t.gas_used))::text as effective_priority_fee,
            array_agg(json_build_object(
              'transaction_hash', t.tx_hash,
              'tx_index', t.tx_index,
              'bundle_type', t.bundle_type,
              'bundle_index', t.bundle_index,
              'block_number', t.block_number,
              'eoa_address', t.from_address,
              'to_address', t.to_address,
              'gas_used', t.gas_used,
              'gas_price', t.gas_price::text,
                
              'coinbase_transfer', t.eth_sent_to_fee_recipient::text,
              'eth_sent_to_fee_recipient', t.eth_sent_to_fee_recipient::text,
                
              'total_miner_reward', t.fee_recipient_eth_diff::text,
              'fee_recipient_eth_diff', t.fee_recipient_eth_diff::text
            ) ORDER BY t.bundle_index, t.tx_index) as transactions
        from
            included_built_block_bundles b
              join included_built_block_bundle_txs t ON b.block_number = t.block_number AND b.bundle_index = t.bundle_index
        where
            (${beforeInt || null}::int is null or b.block_number < ${beforeInt}::int) and
            (${blockNumInt || null}::int is null or b.block_number = ${blockNumInt}::int) and
            (${feeRecipient || null}::text is null or b.fee_recipient = ${feeRecipient}) and
            (${
              from || null
            }::text is null or b.block_number IN (SELECT block_number from included_built_block_bundle_txs where from_address = ${from}))
        group by
            b.block_number
        order by
            b.block_number desc
        limit
          ${limit}`

    // Each result set is sparse, find all unique block numbers in both bundle types, rebuild array sequentially

    // const bundlesByBlockNumber = _.keyBy(bundles, 'block_number')
    const latestBlockNumber = await sql`select max(block_number) as block_number
                                        from blocks`

    res.json({ paris: 1, blocks: bundles, latest_block_number: latestBlockNumber[0].block_number })
  } catch (error) {
    console.error('unhandled error in /blocks', error)
    Sentry.captureException(error)
    res.status(500)
    res.end('Internal Server Error')
  }
})

/**
 * @api {get} /v1/all_blocks Historical json dump of all blocks
 * @apiVersion 1.0.0
 * @apiGroup Flashbots
 * @apiDescription Returns all flashbots blocks, see /v1/blocks for api documentation. This endpoint is a redirect to an s3 bucket, so keep that in mind. For example, add `-L` to curl, e.g. `curl -L ...`. Do *not* fetch this endpoint from your browser, it is over 2GB and will either not work or crash your browser.
 * @apiParam (Query string) {Boolean}   [xz]  Return in xz format
 */
app.get('/v1/all_blocks', async (req, res) => {
  if (req.query && req.query.xz) {
    res.redirect('https://blocks-api.s3.us-east-2.amazonaws.com/latest_blocks.json.xz')
  } else {
    res.redirect('https://blocks-api.s3.us-east-2.amazonaws.com/latest_blocks.json')
  }
})

/**
 * @api {get} /v1/bundle/:hash Get bundle by hash
 * @apiVersion 1.0.0
 * @apiGroup Flashbots
 * @apiDescription Returns a bundle by hash.
 * @apiParam (Path parameter) {String}   hash  Bundle hash
 *
 * @apiSuccess {Object[]} transactions       List of transactions.
 * @apiSuccess {String}   transactions.transaction_hash transaction hash
 * @apiSuccess {Number}   transactions.tx_index index of tx inside of bundle
 * @apiSuccess {Number}   transactions.bundle_index index of bundle inside of the block
 * @apiSuccess {Number}   transactions.block_number   block number
 * @apiSuccess {String}   transactions.eoa_address address of the externally owned account that created this transaction
 * @apiSuccess {String}   transactions.to_address to address
 * @apiSuccess {Number}   transactions.gas_used gas used in this transaction
 * @apiSuccess {String}   transactions.gas_price gas price of this transaction
 * @apiSuccess {String}   transactions.eth_sent_to_fee_recipient ETH (in wei) directly transferred to the fee recipient, not counting gas
 * @apiSuccess {String}   transactions.fee_recipient_eth_diff ETH (in wei) transferred to the fee recipient, including gas and direct transfers
 * @apiSuccessExample {json} Success-Response:
 * HTTP/1.1 200 OK
 {
  "transactions": [
    {
        "transaction_hash": "0xd9cdf1483a85aa206625c66fea49059b96ffae1c086f76664cfa3f91a495d73a",
        "tx_index": 0,
        "bundle_index": 3,
        "block_number": 9091437,
        "eao_address": "0x8D460B72eaF3d63830E16C22d1Fc6908D0834Abe",
        "to_address": "0x8D460B72eaF3d63830E16C22d1Fc6908D0834Abe",
        "gas_used": 21000,
        "gas_price": "1000000000",
        "coinbase_transfer": "0",
        "eth_sent_to_fee_recipient": "0",
        "total_miner_reward": "21000000000000",
        "fee_recipient_eth_diff": "21000000000000"
    }
  ],
}
 */
app.get('/v1/bundle/:hash', async (req, res) => {
  try {
    let hash = req.params.hash
    if (hash.slice(0, 2) === '0x') {
      hash = hash.slice(2)
    }
    hash = Buffer.from(hash, 'hex')
    const transactions = await sql`
        select
            ibbbt.tx_hash as transaction_hash,
            ibbbt.tx_index,
            ibbbt.bundle_index,
            ibbbt.block_number,
            ibbbt.from_address as eao_address,
            ibbbt.to_address,
            ibbbt.gas_used,
            ibbbt.gas_price::text,

            ibbbt.eth_sent_to_fee_recipient::text as coinbase_transfer,
            ibbbt.eth_sent_to_fee_recipient::text as eth_sent_to_fee_recipient,

            ibbbt.fee_recipient_eth_diff::text as total_miner_reward,
            ibbbt.fee_recipient_eth_diff::text as fee_recipient_eth_diff
        from
            included_built_block_bundles ibbb
                join included_built_block_bundle_txs ibbbt on ibbbt.block_id = ibbb.block_id and ibbbt.bundle_index = ibbb.bundle_index
        where ibbb.sbundle_hash = ${hash}
        order by tx_index asc
        limit ${BUNDLE_TX_LIMIT}`
    if (transactions.length >= BUNDLE_TX_LIMIT) {
      console.error('bundle tx limit reached', hash)
    }
    res.json({ transactions })
  } catch (error) {
    console.error('unhandled error in /bundle/:hash', error)
    Sentry.captureException(error)
    res.status(500)
    res.end('Internal Server Error')
  }
})

app.use(express.static('apidoc'))

app.listen(PORT, () => {
  console.log(`mev-blocks listening at ${PORT}`)
})
