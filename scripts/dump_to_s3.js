const postgres = require('postgres')
const fspromises = require('fs/promises')
const fs = require('fs')

const util = require('util')
const exec = util.promisify(require('child_process').exec)

const MAX_BLOCK_NUMBER = 2 ** 63 - 1
const LIMIT = 10000

const FILENAME = '/tmp/blocks.json'
const FILENAME_XZ = '/tmp/blocks.json.xz'
const S3_FILENAME = 's3://blocks-api/latest_blocks.json'
const S3_FILENAME_XZ = 's3://blocks-api/latest_blocks.json.xz'

async function fetchBlocks(sql, before, limit = LIMIT) {
  return await sql`
        select
            b.block_number,
            sum(t.coinbase_diff)::text as miner_reward,
            min(b.miner) as miner,
            sum(t.eth_sent_to_coinbase)::text as coinbase_transfers,
            sum(t.gas_used) as gas_used,
            floor(sum(t.coinbase_diff)/sum(t.gas_used))::text as gas_price,
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
              'total_miner_reward', t.coinbase_diff::text
            ) ORDER BY t.bundle_index, t.tx_index) as transactions
        from
            mined_bundles b
              join mined_bundle_txs t ON b.block_number = t.block_number AND b.bundle_index = t.bundle_index
        where
            b.block_number < ${before}
        group by
            b.block_number
        order by
            b.block_number desc
        limit
          ${limit}`
}

async function main() {
  const file = await fspromises.open(FILENAME, 'w')

  const sql = postgres(process.env.POSTGRES_DSN)

  let before = MAX_BLOCK_NUMBER

  let count = 0
  file.write('[')

  let first = true
  while (true) {
    const blocks = await fetchBlocks(sql, before)

    if (!blocks || blocks.length === 0) {
      break
    }
    before = blocks[blocks.length - 1].block_number
    let blocksJSON = JSON.stringify(blocks)
    blocksJSON = blocksJSON.slice(1, blocksJSON.length - 1)
    if (!first) {
      blocksJSON = ',' + blocksJSON
    } else {
      first = false
    }
    await file.write(blocksJSON)

    count += LIMIT
    console.log('written', count)
  }
  await file.write(']')
  await file.close()

  const { stdout, stderr } = await exec(`aws s3 cp --acl public-read ${FILENAME} ${S3_FILENAME}`)
  console.log('aws s3 cp: ', stdout, stderr)
  const { stdoutxz, stderrxz } = await exec(`xz  ${FILENAME}`)
  console.log('xz compress: ', stdoutxz, stderrxz)
  const { stdoutxzs3, stderrxzs3 } = await exec(`aws s3 cp --acl public-read ${FILENAME_XZ} ${S3_FILENAME_XZ}`)
  console.log('aws s3 cp xz: ', stdoutxzs3, stderrxzs3)
}

main()
  .catch((err) => {
    console.error('error in main', err)
    process.exit(1)
  })
  .finally(() => {
    try {
      fs.truncateSync(FILENAME_XZ, 0)
    } catch {}
    try {
      fs.truncateSync(FILENAME, 0)
    } catch {}
    process.exit(0)
  })
