# Fraud Detection System

Real-time, high-volume transaction fraud detection built with **NestJS**, **Apache Kafka**, **Redis**, and **PostgreSQL(Supabase) + PostGIS**.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       INGESTION SOURCES                              │
│  JSON file (stream)  ·  Batch API (10k txns)  ·  Single txn REST    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  IngestionService   │  stream-json parser
                    │  500/batch INSERT   │  ON CONFLICT DO NOTHING
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ KafkaProducerService│  keyed by userId
                    │  publishBatch()     │  same user = same partition
                    └──────────┬──────────┘
                               │
     ┌─────────────────────────▼──────────────────────────┐
     │                   KAFKA CLUSTER                     │
     │                                                     │
     │  ZooKeeper :2181  ──►  Kafka broker :9092          │
     │                         topic: transactions          │
     │                         4 partitions                │
     │                                                     │
     │  Schema Registry :8081 ··►  broker (schemas)        │
     │  Control Center  :9021 ··►  broker (monitoring)     │
     └─────────────────────────┬──────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │ KafkaConsumerService│  groupId: fraud-detection-group
                    │  4 partitions       │  ordered per userId
                    │  concurrent         │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────────────────────┐
                    │           FraudService               │
                    │   Rule 1: HIGH_VELOCITY              │
                    │   Redis ZSET  vel:{userId}           │
                    │   >5 txns in 60s — O(log n)          │
                    │                                      │
                    │   Rule 2: DAILY_LIMIT                │
                    │   Redis HINCRBYFLOAT                 │
                    │   >$10,000 per user per day          │
                    │                                      │
                    │   Rule 3: GEO_VELOCITY               │
                    │   Redis HASH  geo:{userId}           │
                    │   location change within 2 min       │
                    │                                      │
                    │   All 3 run in Promise.all()         │
                    └──────────┬────────────────┬─────────┘
                               │                │
               ┌───────────────▼───┐    ┌───────▼──────────────┐
               │   Redis :6379     │    │ PostgreSQL + PostGIS  │
               │  vel:{userId}     │    │      :5432            │
               │  daily:{u}:{d}   │    │  transactions         │
               │  geo:{userId}     │    │  flagged_transactions │
               └───────────────────┘    └──────────────────────┘
```

---

## Fraud Rules

| Rule | Trigger | Redis Key | Method |
|------|---------|-----------|--------|
| `HIGH_VELOCITY` | >5 txns same user in 60s | `vel:{userId}` | Sorted set sliding window |
| `DAILY_LIMIT_EXCEEDED` | >$10,000 same user in one day | `daily:{userId}:{date}` | `HINCRBYFLOAT` — atomic |
| `GEO_VELOCITY` | Location changes >1km in <2 min | `geo:{userId}` | geolib Haversine + Redis hash TTL |

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
metadata         JSONB        -- velocityCount, dailyTotal, distanceKm, etc.
"riskScore"      FLOAT        -- 0.0 to 1.0
"flaggedAt"      TIMESTAMPTZ
```

### Redis Key Patterns
```
vel:{userId}            ZSET   score=unix_ms  member=txnId:ms  TTL=5min
daily:{userId}:{date}   HASH   field=total    value=float      TTL=2days
geo:{userId}            HASH   lat, lng, ts                    TTL=5min
```

---

## Project Structure

```
fraud-detection/
├── src/
│   ├── main.ts                        Entry point + Swagger
│   ├── app.module.ts                  Root module
│   ├── common/redis/
│   │   ├── redis.module.ts
│   │   └── redis.service.ts           slidingWindowCount, getDailyTotal, geo
│   ├── kafka/
│   │   ├── kafka.module.ts
│   │   ├── kafka-producer.service.ts  publishTransaction, publishBatch
│   │   └── kafka-consumer.service.ts  Consumes 'transactions', calls FraudService
│   ├── transactions/
│   │   ├── entities/transaction.entity.ts
│   │   ├── transactions.service.ts
│   │   ├── transactions.controller.ts
│   │   └── transactions.module.ts
│   ├── fraud/
│   │   ├── entities/flagged-transaction.entity.ts
│   │   ├── fraud.service.ts           Core detection — 3 rules
│   │   ├── fraud.controller.ts        /check /analyse /all /heatmap /stats
│   │   ├── fraud.service.spec.ts      Jest unit tests
│   │   └── fraud.module.ts
│   └── ingestion/
│       ├── ingestion.service.ts       Streaming file + batch processor
│       ├── ingestion.controller.ts    /batch /file /generate-sample
│       └── ingestion.module.ts
├── docker-compose.yml
├── Dockerfile
├── init.sql
├── .env.example
└── package.json
```

---

## Quick Start

### Option A — Everything in Docker

```bash
git clone <your-repo>
cd fraud-detection
cp .env.example .env
docker-compose up --build
```

### Option B — Infrastructure in Docker, API locally

```bash
# Start all support services
docker-compose up postgres redis zookeeper kafka schema-registry kafka-control-center -d

# Wait ~30 seconds for Kafka to initialize, then:
npm install
npm run start:dev
```

### Service URLs

| Service | URL |
|---------|-----|
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| Kafka Control Center | http://localhost:9021 |
| Schema Registry | http://localhost:8081 |

---

## API Reference

### `GET /api/v1/fraud/check?userId=user_001`
All flagged transactions for a user, paginated.

**Query params:** `userId` (required), `page` (default 1), `limit` (default 50, max 200)

**Response:**
```json
{
  "data": [{
    "id": "uuid",
    "transactionId": "txn_00000042",
    "userId": "user_001",
    "amount": "2500.00",
    "reason": "HIGH_VELOCITY",
    "metadata": { "velocityCount": 8 },
    "riskScore": 0.85,
    "flaggedAt": "2024-01-15T10:30:01Z"
  }],
  "total": 1,
  "page": 1,
  "totalPages": 1,
  "riskSummary": { "reasons": [{ "reason": "HIGH_VELOCITY", "count": "1" }] }
}
```

---

### `POST /api/v1/fraud/analyse`
Real-time single transaction fraud check.

**Request:**
```json
{
  "transactionId": "txn_99",
  "userId": "user_001",
  "amount": 500.00,
  "timestamp": "2024-01-15T10:30:00Z",
  "merchant": "Amazon",
  "location": "40.7128,-74.0060"
}
```

**Response:**
```json
{
  "isFraud": true,
  "reasons": ["HIGH_VELOCITY", "GEO_VELOCITY"],
  "riskScore": 0.95,
  "metadata": {
    "velocityCount": 7,
    "distanceKm": "3982.41",
    "timeDiffSeconds": "58.2",
    "prevLocation": "34.0522,-118.2437"
  }
}
```

---

### `GET /api/v1/fraud/all?reason=HIGH_VELOCITY&page=1&limit=100`
All flagged transactions across all users. Optional `reason` filter.

### `GET /api/v1/fraud/heatmap`
Geo-aggregated fraud points for map visualization.
```json
[{ "userId": "user_001", "lat": 40.7128, "lng": -74.006, "count": 5 }]
```

### `GET /api/v1/fraud/stats`
System-wide statistics — totals by reason, top offending users.

### `POST /api/v1/ingestion/batch`
Ingest up to 10,000 transactions. Body: `{ "transactions": [...] }`

### `POST /api/v1/ingestion/file?path=transactions.json`
Stream-process a JSON file from `./data/`. No memory limit.

### `POST /api/v1/ingestion/generate-sample?count=10000&filename=sample.json`
Generate test data with random users, merchants, and locations.

### `GET /api/v1/transactions?userId=user_001&limit=100`
Raw transaction history for a user.

---

## Testing

```bash
# Unit tests
npm test

# Coverage report
npm run test:cov

# Quick curl test flow
curl -X POST "http://localhost:3000/api/v1/ingestion/generate-sample?count=5000"
curl -X POST "http://localhost:3000/api/v1/ingestion/file?path=sample.json"
curl "http://localhost:3000/api/v1/fraud/stats"
curl "http://localhost:3000/api/v1/fraud/check?userId=user_0001"
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `fraud_user` | DB user |
| `DB_PASSWORD` | `fraud_pass` | DB password |
| `DB_NAME` | `fraud_db` | Database |
| `DB_SYNCHRONIZE` | `true` | Auto-migrate (disable in prod) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated brokers |
| `FRAUD_MAX_TXN_PER_MINUTE` | `5` | Velocity threshold |
| `FRAUD_MAX_DAILY_AMOUNT` | `10000` | Daily limit ($) |
| `FRAUD_LOCATION_WINDOW_MINUTES` | `2` | Geo-velocity window |

---

## Performance Notes

- `stream-json` reads files node-by-node — 10M rows never loads into memory
- Bulk INSERT 500/batch with `orIgnore()` — safe to re-ingest same file
- All 3 fraud rules run in `Promise.all()` — never sequential
- Redis sorted set ops are O(log n)
- `HINCRBYFLOAT` is atomic — no race conditions under concurrent load
- Kafka consumer group processes 4 partitions concurrently; userId key guarantees ordering per user
- PostgreSQL pool capped at 20 connections

---

## Kafka Control Center Usage

After startup, open http://localhost:9021 to:
- Browse the `transactions` topic and see messages in real time
- Monitor consumer group `fraud-detection-group` lag
- Check partition assignment and offsets
- View throughput and latency metrics