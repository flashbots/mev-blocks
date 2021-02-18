#!/bin/bash

set -euxo pipefail

curl -s 'localhost:31080/v1/blocks?before=11778936&limit=1' | jq
curl -s 'localhost:31080/v1/blocks?before=11778936&limit=2' | jq
curl -s -o /dev/null 'localhost:31080/v1/blocks?limit=1'
curl -s -o /dev/null 'localhost:31080/v1/blocks?before=11778936'
curl -s -o /dev/null 'localhost:31080/v1/blocks'

curl -s 'localhost:31080/v1/transactions?before=11778936&limit=1' | jq
curl -s 'localhost:31080/v1/transactions?before=11778936&limit=2' | jq
curl -s -o /dev/null 'localhost:31080/v1/transactions?limit=1'
curl -s -o /dev/null 'localhost:31080/v1/transactions?before=11778936'
curl -s -o /dev/null 'localhost:31080/v1/transactions'
