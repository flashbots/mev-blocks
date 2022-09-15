import Sentry from '@sentry/node'
import utils from 'web3-utils'
import _ from 'lodash'

function isMegabundleBlock(mergedBlock, megabundleBlock) {
  if (mergedBlock === undefined) return true
  if (megabundleBlock === undefined) return false
  return megabundleBlock.transactions.length > mergedBlock.transactions.length
}

export async function getPremergeTransactions(sql, req, res) {
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
          tx_hash as transaction_hash,
          tx_index,
          bundle_index,
          block_number,
          from_address as eao_address,
          to_address,
          gas_used,
          gas_price::text,
          
          eth_sent_to_coinbase::text as coinbase_transfer,
          eth_sent_to_coinbase::text as eth_sent_to_fee_recipient,
          
          coinbase_diff::text as total_miner_reward,
          coinbase_diff::text as fee_recipient_eth_diff
      from
          mined_bundle_txs
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
}

function inferMegabundleTransactionsByBlock(megaBundleBlock, mergedBlock) {
  if (megaBundleBlock === undefined) return mergedBlock
  if (mergedBlock === undefined || megaBundleBlock.transactions.length > mergedBlock.transactions.length) {
    return {
      ...megaBundleBlock,
      transactions: megaBundleBlock.transactions.map((tx) => {
        return {
          ...tx,
          is_megabundle: true
        }
      })
    }
  }

  // Even though we individually tag transactions as "is_megabundle", we still need to report on overall block metrics, so we need to select an overall block to return and parse transactions for.
  const baseBlock = isMegabundleBlock(mergedBlock, megaBundleBlock) ? megaBundleBlock : mergedBlock
  const megaBundleTransactions = megaBundleBlock.transactions
  const mergedTransactions = mergedBlock.transactions
  const megaBundleIdentifiedTransactions = _.map(baseBlock.transactions, (transaction, i) => {
    const megaBundleTx = megaBundleTransactions[i]
    const mergedTx = mergedTransactions[i]
    if ((megaBundleTx === undefined && mergedTx !== undefined) || megaBundleTx.transaction_hash !== mergedTx.transaction_hash) {
      return transaction
    }
    return {
      ...transaction,
      is_megabundle: true
    }
  })
  return {
    ...baseBlock,
    transactions: megaBundleIdentifiedTransactions
  }
}

export async function getPremergeBlocks(sql, req, res) {
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
      res.json({ error: `invalid limit param provided, must be less than 10000 and more than 0 but got: ${req.query.limit}` })
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

    let miner = req.query.miner
    if (miner) {
      miner = utils.toChecksumAddress(miner)
    }

    let from = req.query.from
    if (from) {
      from = utils.toChecksumAddress(from)
    }

    const mergedBundles = await sql`
        select
            b.block_number,
            sum(t.coinbase_diff)::text as miner_reward,
            sum(t.coinbase_diff)::text as fee_recipient_eth_diff,
            min(b.miner) as miner,
            sum(t.eth_sent_to_coinbase)::text as coinbase_transfers,
            sum(t.eth_sent_to_coinbase)::text as eth_sent_to_fee_recipient,
            sum(t.gas_used) as gas_used,
            floor(sum(t.coinbase_diff)/sum(t.gas_used))::text as gas_price,
            floor(sum(t.coinbase_diff)/sum(t.gas_used))::text as effective_priority_fee_gas_price,
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
                
              'coinbase_transfer', t.eth_sent_to_coinbase::text,
              'eth_sent_to_fee_recipient', t.eth_sent_to_coinbase::text,
                
              'total_miner_reward', t.coinbase_diff::text,
              'fee_recipient_eth_diff', t.coinbase_diff::text
                  
            ) ORDER BY t.bundle_index, t.tx_index) as transactions
        from
            mined_bundles b
              join mined_bundle_txs t ON b.block_number = t.block_number AND b.bundle_index = t.bundle_index
        where
            (${beforeInt || null}::int is null or b.block_number < ${beforeInt}::int) and
            (${blockNumInt || null}::int is null or b.block_number = ${blockNumInt}::int) and
            (${miner || null}::text is null or b.miner = ${miner}) and
            (${from || null}::text is null or b.block_number IN (SELECT block_number from mined_bundle_txs where from_address = ${from}))
        group by
            b.block_number
        order by
            b.block_number desc
        limit
          ${limit}`

    const megabundles = await sql`
        select
            mmb.block_number,
            sum(t.coinbase_diff)::text as miner_reward,
            sum(t.coinbase_diff)::text as fee_recipient_eth_diff,
            min(blocks.miner) as miner,
            sum(t.eth_sent_to_coinbase)::text as coinbase_transfers,
            sum(t.eth_sent_to_coinbase)::text as fee_recipient_eth_diff,
            sum(t.gas_used) as gas_used,
            floor(sum(t.coinbase_diff)/sum(t.gas_used))::text as gas_price,
            floor(sum(t.coinbase_diff)/sum(t.gas_used))::text as effective_priority_fee_gas_price,
            array_agg(json_build_object(
              'transaction_hash', t.tx_hash,
              'tx_index', t.tx_index,
              'bundle_index', t.bundle_index,
              'block_number', mmb.block_number,
              'eoa_address', t.from_address,
              'to_address', t.to_address,
              'gas_used', t.gas_used,
              'gas_price', t.gas_price::text,
              'coinbase_transfer', t.eth_sent_to_coinbase::text,
              'total_miner_reward', t.coinbase_diff::text
            ) ORDER BY t.bundle_index, t.tx_index) as transactions
        from
            mined_megabundle_bundles b
              join mined_megabundles mmb ON b.megabundle_id = mmb.megabundle_id
              join mined_megabundle_bundle_txs t ON t.megabundle_id = mmb.megabundle_id
              join blocks ON blocks.block_number = mmb.block_number
        where
            (${beforeInt || null}::bigint is null or mmb.block_number < ${beforeInt}::bigint) and
            (${blockNumInt || null}::bigint is null or mmb.block_number = ${blockNumInt}::bigint) and
            (${miner || null}::text is null or blocks.miner = ${miner}) and
            (${
              from || null
            }::text is null or mmb.block_number IN (SELECT mined_megabundles.block_number from mined_megabundle_bundle_txs JOIN mined_megabundles ON mined_megabundles.megabundle_id = mined_megabundle_bundle_txs.megabundle_id where from_address = ${from}))
        group by
            mmb.block_number
        order by
            mmb.block_number desc
        limit
          ${limit}`

    // Each result set is sparse, find all unique block numbers in both bundle types, rebuild array sequentially
    const blockNumbers = _.chain([...mergedBundles, ...megabundles])
      .map('block_number')
      .uniq()
      .sort()
      .takeRight(limit)
      .value()

    const mergedByBlockNumber = _.keyBy(mergedBundles, 'block_number')
    const megabundleByBlockNumber = _.keyBy(megabundles, 'block_number')
    const inferredBundleBlocks = _.map(blockNumbers, (blockNumber) => {
      const megaBundleBlock = megabundleByBlockNumber[blockNumber]
      const mergedBlock = mergedByBlockNumber[blockNumber]
      return inferMegabundleTransactionsByBlock(megaBundleBlock, mergedBlock)
    })
    const latestBlockNumber = await sql`select max(block_number) as block_number
                                        from blocks`

    res.json({ paris: 0, blocks: inferredBundleBlocks, latest_block_number: latestBlockNumber[0].block_number })
  } catch (error) {
    console.error('unhandled error in /transactions', error)
    Sentry.captureException(error)
    res.status(500)
    res.end('Internal Server Error')
  }
}
