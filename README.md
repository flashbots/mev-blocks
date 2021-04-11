# mev-blocks

## Run locally

```
yarn install
yarn gen-docs
yarn run start
```

## Build docker container

```
docker build -t mev-blocks .
```

## Run docker container

```
docker rm -f mev-blocks; docker run -d --network=host -e 'POSTGRES_DSN=postgres://mev_blocks@localhost:5432/mev' --init --name mev-blocks --restart=always mev-blocks
```
