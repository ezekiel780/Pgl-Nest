# Fraud Detection System

Real-time, high-volume transaction fraud detection built with **NestJS**, **BullMQ**, **WebSocket**, **Apache Kafka**, **Redis**, and **PostgreSQL (Supabase) + PostGIS**.

**Live API →** https://pgl-nest.onrender.com  
**Swagger UI →** https://pgl-nest.onrender.com/docs  
**Frontend →** https://distributed-system.netlify.app

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           INGESTION SOURCES                                  │
│   JSON file (stream)  ·  POST /batch (10k txns)  ·  POST /analyse (REST)    │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │   IngestionService  │
                        │   stream-json       │  No full-file memory load
                        │   500/batch INSERT  │  ON CONFLICT DO NOTHING
                        └──────────┬──────────┘
                                   │
               ┌───────────────────┴───────────────────┐
               │                                       │
    ┌──────────▼──────────┐               ┌────────────▼────────────┐
    │  QueueProducerService│               │  KafkaProducerService   │
    │  BullMQ              │               │  (local dev only)       │
    │  transactions queue  │               │  keyed by userId        │
    └──────────┬──────────┘               └────────────┬────────────┘
               │                                       │
    ┌──────────▼──────────┐          ┌─────────────────▼──────────────────┐
    │  QueueConsumerService│          │         KAFKA CLUSTER              │
    │  BullMQ Worker       │          │                                    │
    │  Processes jobs      │          │  ZooKeeper :2181                   │
    │  async + retries     │          │  Kafka broker :9092                │
    └──────────┬──────────┘          │  topic: transactions               │
               │                     │  4 partitions · keyed by userId    │
               │                     │                                    │
               │                     │  Schema Registry :8081             │
               │                     │  Control Center  :9021             │
               │                     └────────────────────┬───────────────┘
               │                                          │
               └──────────────────────┬───────────────────┘
                                      │
                           ┌──────────▼──────────────────────────┐
                           │           FraudService               │
                           │                                      │
                           │  ┌─────────────────────────────┐    │
                           │  │  Rule 1: HIGH_VELOCITY       │    │
                           │  │  Redis ZSET vel:{userId}     │    │
                           │  │  >5 txns in 60s — O(log n)  │    │
                           │  ├─────────────────────────────┤    │
                           │  │  Rule 2: DAILY_LIMIT         │    │
                           │  │  Redis HINCRBYFLOAT          │    │
                           │  │  >$10,000 per user per day   │    │
                           │  ├─────────────────────────────┤    │
                           │  │  Rule 3: GEO_VELOCITY        │    │
                           │  │  Redis HASH geo:{userId}     │    │
                           │  │  >1km change in <2 min       │    │
                           │  │  Haversine formula (geolib)  │    │
                           │  └─────────────────────────────┘    │
                           │       All 3 run in Promise.all()     │
                           └──────┬──────────────┬───────────────┘
                                  │              │
                  ┌───────────────▼───┐    ┌─────▼────────────────┐
                  │   Redis :6379     │    │ PostgreSQL + PostGIS  │
                  │  vel:{userId}     │    │ (Supabase) :5432      │
                  │  daily:{u}:{date} │    │  transactions         │
                  │  geo:{userId}     │    │  flagged_transactions │
                  └───────────────────┘    └──────────────────────┘
                                  │
                  ┌───────────────▼──────────────────────────────┐
                  │         FraudGateway (WebSocket)             │
                  │         @WebSocketGateway                    │
                  │                                              │
                  │  emitFraudAlert() → broadcasts to all        │
                  │  connected frontend clients instantly        │
                  │                                              │
                  │  Event: fraud.detected                       │
                  │  Payload: transactionId, userId, reasons,    │
                  │           riskScore, metadata, timestamp     │
                  └───────────────┬──────────────────────────────┘
                                  │  Socket.io
                                  ▼
                  ┌───────────────────────────────────────────────┐
                  │         React Frontend (Netlify)              │
                  │                                               │
                  │  Dashboard  — live stats + reason bars        │
                  │  Live Feed  — real-time WebSocket alerts      │
                  │  Fraud Checker — query by userId              │
                  │  Live Analyser — single txn check             │
                  │  Heatmap    — Leaflet + CartoDB dark tiles    │
                  │  Ingest     — generate + batch ingest         │
                  └───────────────────────────────────────────────┘
```

---

## Real-time Flow — WebSocket + BullMQ

```
Transaction arrives (REST or Kafka or BullMQ)
        │
        ▼
FraudService.analyseTransaction()
        │
        ├── isFraud = true?
        │       │
        │       ├── persist() → Supabase flagged_transactions
        │       │
        │       └── FraudGateway.emitFraudAlert()
        │               │
        │               └── Socket.io broadcasts to ALL
        │                   connected frontend clients
        │                   instantly — no polling
        │
        └── isFraud = false → no action
```

---

## Fraud Rules

| Rule | Trigger | Redis Key | Method | Risk Score |
|------|---------|-----------|--------|------------|
| `HIGH_VELOCITY` | >5 txns same user in 60s | `vel:{userId}` | Sorted set sliding window — O(log n) | 0.85 |
| `DAILY_LIMIT_EXCEEDED` | >$10,000 same user in one day | `daily:{userId}:{date}` | `HINCRBYFLOAT` — atomic | 0.75 |
| `GEO_VELOCITY` | Location changes >1km in <2 min | `geo:{userId}` | geolib Haversine + Redis hash TTL | 0.95 |

---

## Algorithms

| Algorithm | Rule | Data Structure | Complexity |
|-----------|------|----------------|------------|
| Sliding Window | HIGH_VELOCITY | Redis ZSET | O(log n) |
| Atomic Counter | DAILY_LIMIT | Redis HINCRBYFLOAT | O(1) |
| Haversine Formula | GEO_VELOCITY | geolib + Redis Hash | O(1) |
| Bulk Insert | Ingestion | PostgreSQL batch | O(n) |
| Stream Processing | File ingestion | stream-json | O(1) memory |
| Parallel Execution | All rules | Promise.all() | — |
| Composite Indexing | DB queries | userId + timestamp | O(log n) |

---

## Database Schema

### `transactions`
```sql
"transactionId"  VARCHAR(64)  PRIMARY KEY
"userId"         VARCHAR(64)  INDEX
amount           DECIMAL(15,2)
timestamp        TIMESTAMPTZ  INDEX
merchant         VARCHAR(255)
location         VARCHAR(255)
latitude         FLOAT
longitude        FLOAT
"geoPoint"       GEOGRAPHY(Point, 4326)   -- PostGIS spatial column
"createdAt"      TIMESTAMPTZ

-- Indexes
idx_transactions_userId
idx_transactions_timestamp
idx_transactions_userId_timestamp  -- composite for time-series
```

### `flagged_transactions`
```sql
id               UUID         PRIMARY KEY (auto)
"transactionId"  VARCHAR(64)  INDEX
"userId"         VARCHAR(64)  INDEX
amount           DECIMAL(15,2)
timestamp        TIMESTAMPTZ
merchant         VARCHAR(255)
location         VARCHAR(255)
latitude         FLOAT
longitude        FLOAT
reason           ENUM('HIGH_VELOCITY', 'DAILY_LIMIT_EXCEEDED', 'GEO_VELOCITY')  INDEX
metadata         JSONB        -- velocityCount, dailyTotal, distanceKm, timeDiff
"riskScore"      FLOAT        -- 0.0 to 1.0
"flaggedAt"      TIMESTAMPTZ
```

### Redis Key Patterns
```
vel:{userId}            ZSET   score=unix_ms  member=txnId:ms   TTL 5min
daily:{userId}:{date}   HASH   field=total    value=float       TTL 2days
geo:{userId}            HASH   lat, lng, ts                     TTL 5min
```

---

## Project Structure

```
fraud-detection/
├── src/
│   ├── main.ts                              Entry point + Swagger + WebSocket
│   ├── app.module.ts                        Root module
│   │
│   ├── common/redis/
│   │   ├── redis.module.ts
│   │   └── redis.service.ts                 slidingWindowCount · getDailyTotal · geo
│   │
│   ├── gateway/
│   │   ├── fraud.gateway.ts                 @WebSocketGateway — emitFraudAlert()
│   │   └── gateway.module.ts
│   │
│   ├── queue/
│   │   ├── queue.module.ts                  BullMQ queue setup
│   │   ├── queue.constants.ts               TRANSACTIONS_QUEUE token
│   │   ├── queue-producer.service.ts        addJob() — enqueues transactions
│   │   └── queue-consumer.service.ts        Worker — processes jobs → FraudService
│   │
│   ├── kafka/                               Only loaded when KAFKA_ENABLED=true
│   │   ├── kafka.module.ts
│   │   ├── kafka-producer.service.ts        publishTransaction() · publishBatch()
│   │   └── kafka-consumer.service.ts        Subscribes to 'transactions' topic
│   │
│   ├── transactions/
│   │   ├── entities/transaction.entity.ts   PostGIS geography + composite indexes
│   │   ├── transactions.service.ts
│   │   ├── transactions.controller.ts
│   │   └── transactions.module.ts
│   │
│   ├── fraud/
│   │   ├── entities/flagged-transaction.entity.ts  reason ENUM · metadata JSONB
│   │   ├── fraud.service.ts                 3 rules in Promise.all() + WebSocket emit
│   │   ├── fraud.controller.ts              /check /analyse /all /heatmap /stats
│   │   ├── fraud.service.spec.ts            Jest unit tests — all 3 rules
│   │   └── fraud.module.ts
│   │
│   └── ingestion/
│       ├── ingestion.service.ts             stream-json · 500/batch · orIgnore
│       ├── ingestion.controller.ts          /batch /file /generate-sample
│       └── ingestion.module.ts
│
├── data/                                    Local file ingestion directory
├── docker-compose.yml                       Postgres · Redis · Kafka · ZooKeeper
├── Dockerfile                               Multi-stage production build
├── init.sql                                 CREATE EXTENSION postgis
├── .env.example
└── package.json
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API Framework | NestJS (TypeScript) | REST API, DI, modules, Swagger |
| Queue | BullMQ | Async job processing with retries |
| Real-time | Socket.io + @nestjs/websockets | Live fraud alerts to frontend |
| Cache / Windows | Redis | Sliding windows, daily totals, geo state |
| Message Broker | Apache Kafka (local only) | Real-time streaming ingestion demo |
| ORM | TypeORM | Schema sync, query builder, indexes |
| Database | PostgreSQL + PostGIS (Supabase) | Transactions, flagged records, spatial |
| Validation | class-validator | Request body validation |
| Distance | geolib | Haversine great-circle distance |
| File streaming | stream-json | Large file ingestion without memory load |
| Docs | Swagger / OpenAPI | Auto-generated at /docs |
| Deployment | Render (API + Redis) + Supabase (DB) | Cloud hosting |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API port |
| `DB_TYPE` | `postgres` | Database type |
| `DATABASE_URL` | — | Full Postgres connection string |
| `DB_SYNCHRONIZE` | `false` | Auto-migrate (false in prod) |
| `DB_SSL_ENABLED` | `true` | SSL for Supabase |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` | Allow Supabase cert |
| `DB_POOL_MAX` | `10` | Connection pool size |
| `DB_LOGGING` | `false` | Query logging |
| `REDIS_URL` | — | Redis connection URL (Render) |
| `REDIS_HOST` | `localhost` | Redis host (local) |
| `REDIS_PORT` | `6379` | Redis port (local) |
| `KAFKA_ENABLED` | `false` | Toggle Kafka on/off |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker list |
| `API_PREFIX` | `api` | Global route prefix |
| `SWAGGER_PATH` | `docs` | Swagger UI path |
| `APP_HOST` | `0.0.0.0` | App host |
| `FRONTEND_URL` | — | CORS allowed origins (comma-separated) |
| `INGESTION_DATA_DIR` | `./data` | Directory for ingestion files |
| `FRAUD_MAX_TXN_PER_MINUTE` | `5` | Velocity rule threshold |
| `FRAUD_MAX_DAILY_AMOUNT` | `10000` | Daily limit in USD |
| `FRAUD_LOCATION_WINDOW_MINUTES` | `2` | Geo-velocity time window |

---

## Quick Start

### Local development (without Kafka)

```bash
git clone <your-repo>
cd fraud-detection
cp .env.example .env
mkdir data

# Start Redis and Postgres
docker-compose up postgres redis -d

# Install and run
npm install
npm run start:dev
```

### Local development (with Kafka)

```bash
# Start all infrastructure
docker-compose up -d

# Wait ~30 seconds for Kafka, then:
npm run start:dev
```

### Service URLs

| Service | URL |
|---------|-----|
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| WebSocket | ws://localhost:3000 |
| Kafka Control Center | http://localhost:9021 |
| Schema Registry | http://localhost:8081 |

---

## API Reference

### `GET /api/fraud/check?userId=user_001`
All flagged transactions for a user, paginated with risk summary.

### `POST /api/fraud/analyse`
Real-time single transaction fraud check — runs all 3 rules in parallel.

**Request:**
```json
{
  "transactionId": "txn_001",
  "userId": "user_001",
  "amount": 500.00,
  "timestamp": "2024-01-15T10:30:00Z",
  "merchant": "Amazon",
  "location": "6.5244,3.3792",
  "latitude": 6.5244,
  "longitude": 3.3792
}
```

**Response — flagged:**
```json
{
  "isFraud": true,
  "reasons": ["HIGH_VELOCITY", "GEO_VELOCITY"],
  "riskScore": 0.95,
  "metadata": {
    "velocityCount": 7,
    "distanceKm": "8542.31",
    "timeDiffSeconds": "58.2",
    "prevLocation": "6.5244,3.3792"
  }
}
```

### `GET /api/fraud/all?reason=HIGH_VELOCITY&page=1&limit=100`
All flagged transactions, filterable by reason.

### `GET /api/fraud/heatmap`
Geo-aggregated fraud points for Leaflet heatmap.

### `GET /api/fraud/stats`
System-wide statistics — total, by reason, top users.

### `POST /api/ingestion/generate-sample?count=5000&filename=sample.json`
Generate random test transactions to `./data/`.

### `POST /api/ingestion/file?path=sample.json`
Stream-process a JSON file — no memory limit.

### `POST /api/ingestion/batch`
Ingest up to 10,000 transactions directly.

---

## WebSocket Events

Connect to the WebSocket server at `ws://localhost:3000` (local) or `wss://pgl-nest.onrender.com` (production).

### Event: `fraud.detected`
Emitted to all connected clients whenever a transaction is flagged.

```json
{
  "transactionId": "txn_vel_001",
  "userId": "user_vel_test",
  "amount": 100,
  "merchant": "Shell",
  "location": "6.5244,3.3792",
  "reasons": ["HIGH_VELOCITY"],
  "riskScore": 0.85,
  "metadata": { "velocityCount": 8 },
  "timestamp": "2024-01-15T10:30:01.123Z"
}
```

### Frontend connection (socket.js)
```js
const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000'
const socket = io(SOCKET_URL)

socket.on('fraud.detected', (alert) => {
  // show toast, update live feed
})
```

---

## BullMQ Queue

Transactions are enqueued via `QueueProducerService` and processed asynchronously by `QueueConsumerService`:

```
addJob(transaction) → BullMQ queue → Worker → FraudService.analyseTransaction()
                                                      │
                                               if fraud → WebSocket emit
                                                      │
                                               persist to Supabase
```

Benefits over direct processing:
- Automatic retries on failure
- Job concurrency control
- Queue monitoring via Bull Board
- Decoupled ingestion from fraud detection

---

## Testing

```bash
# Unit tests
npm test

# Coverage
npm run test:cov
```

Tests cover all 3 fraud rules, edge cases (boundary values, outside window, simultaneous flags), and `parseLocation` utility. Redis and TypeORM are fully mocked.

---

## Kafka — Local Demo Only

Kafka is included for real-time streaming ingestion demonstration. Disabled on Render via `KAFKA_ENABLED=false`.

```bash
# Start with Kafka locally
docker-compose up -d

# Open Control Center
open http://localhost:9021

# Watch messages flow through topic in real time
# Topics → transactions → Messages
# Consumer groups → fraud-detection-group → lag per partition
```

In production, a managed service like **Confluent Cloud** or **AWS MSK** would replace the local cluster.

---

## Performance Notes

- `stream-json` reads files node-by-node — 10M rows never loads into memory
- Bulk INSERT 500/batch with `orIgnore()` — safe to re-ingest
- All 3 fraud rules run in `Promise.all()` — never sequential
- Redis ZSET ops are O(log n) — fast even at millions of events
- `HINCRBYFLOAT` is atomic — no race conditions under concurrent load
- BullMQ handles retries — no lost jobs on transient failures
- WebSocket broadcasts are non-blocking — fraud detection is not delayed
- Kafka (local) processes 4 partitions concurrently with userId ordering
- PostgreSQL pool capped at 10 connections (Supabase free tier)
- PostGIS `GEOGRAPHY(Point, 4326)` enables future spatial range queries

---

## Submission Links

| Item | Link |
|------|------|
| Frontend (Netlify) | https://distributed-system.netlify.app |
| Backend API (Render) | https://pgl-nest.onrender.com |
| Swagger UI | https://pgl-nest.onrender.com/docs |
| Backend GitHub | https://github.com/ezekiel780/Pgl-Nest |
| Frontend GitHub | https://github.com/ezekiel780/detection-frontend |
