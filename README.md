```
Deprecated
```

### cardano-graphql-helper

Some cardano-graphql queries are slow or incorrect, this proxy API complements the functionality.

Works together with the `cardano-db-sync-extended` default configuration.
 
### run

1. copy `.env.example` to `.env`
2. replace network name in `docker-compose.yml`, to find yours use `docker network ls`
3. run `docker-compose up -d`
