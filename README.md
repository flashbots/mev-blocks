# mev-etherscan

## Run locally

```
yarn install
yarn gen-docs
yarn run start
```

## Build docker container

```
docker build -t mev-etherscan .
```

## Run docker container

```
docker rm -f mev-etherscan; docker run -d --network=host -e 'POSTGRES_DSN=postgres://mev_etherscan@localhost:5432/mev' --init --name mev-etherscan --restart=always mev-etherscan
```
