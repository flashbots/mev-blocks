#!/usr/bin/env python3
import requests
import argparse


def main():
    parser = argparse.ArgumentParser(
        description='Fetch a block and process the miner profit')
    parser.add_argument('block_number', type=int, help='block number to query')

    args = parser.parse_args()
    url = f'https://blocks.flashbots.net/v1/blocks?block_number={args.block_number}'
    print('Fetching:', url)

    resp = requests.get(url)

    block = resp.json()['blocks'][0]

    coinbase_transfers = 0
    for tx in block['transactions']:
        coinbase_transfers += tx['coinbase_transfer']

    print(
        f'block_number={block["block_number"]}, miner_reward={block["miner_reward"]}, miner_coinbase_transfers={coinbase_transfers}'
    )


if __name__ == "__main__":
    main()
