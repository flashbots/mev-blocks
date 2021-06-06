#!/bin/bash

set -euxo pipefail

curl -s 'localhost:31080/v1/blocks?before=12000000&limit=1' | jq
curl -s 'localhost:31080/v1/blocks?before=12000000&limit=2' | jq
curl -s 'localhost:31080/v1/blocks?block_number=12006597' | jq
curl -s 'localhost:31080/v1/blocks?miner=0xc8f595e2084db484f8a80109101d58625223b7c9&limit=1' | jq
curl -s 'localhost:31080/v1/blocks?from=0xf888ac7a3f709d3da4fabbb04412c479b94fec94' | jq
curl -s -o /dev/null 'localhost:31080/v1/blocks?limit=1'
curl -s -o /dev/null 'localhost:31080/v1/blocks?before=12000000'
curl -s -o /dev/null 'localhost:31080/v1/blocks'

curl -s 'localhost:31080/v1/transactions?before=12000000&limit=1' | jq
curl -s 'localhost:31080/v1/transactions?before=12000000&limit=2' | jq
curl -s -o /dev/null 'localhost:31080/v1/transactions?limit=1'
curl -s -o /dev/null 'localhost:31080/v1/transactions?before=12000000'
curl -s -o /dev/null 'localhost:31080/v1/transactions'
