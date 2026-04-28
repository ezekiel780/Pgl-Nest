import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1777329444926 implements MigrationInterface {
    name = 'Init1777329444926'

    public async up(queryRunner: QueryRunner): Promise<void> {

        // EXTENSIONS
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "postgis"`);

        // TRANSACTIONS TABLE
        await queryRunner.query(`
            CREATE TABLE "transactions" (
                "transactionId" character varying(64) NOT NULL,
                "userId" character varying(64) NOT NULL,
                "amount" numeric(15,2) NOT NULL,
                "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
                "merchant" character varying(255) NOT NULL,
                "location" character varying(255) NOT NULL,
                "latitude" double precision,
                "longitude" double precision,
                "geoPoint" geography(Point,4326),
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_transactions" PRIMARY KEY ("transactionId")
            )
        `);

        // INDEXES (NO DUPLICATES)
        await queryRunner.query(`CREATE INDEX "IDX_transactions_userId" ON "transactions" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_transactions_timestamp" ON "transactions" ("timestamp")`);
        await queryRunner.query(`CREATE INDEX "IDX_transactions_user_timestamp" ON "transactions" ("userId", "timestamp")`);

        // FLAGGED TRANSACTIONS ENUM
        await queryRunner.query(`
            CREATE TYPE "public"."flagged_transactions_reason_enum"
            AS ENUM ('HIGH_VELOCITY', 'DAILY_LIMIT_EXCEEDED', 'GEO_VELOCITY')
        `);

        // FLAGGED TRANSACTIONS TABLE
        await queryRunner.query(`
            CREATE TABLE "flagged_transactions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "transactionId" character varying(64) NOT NULL,
                "userId" character varying(64) NOT NULL,
                "amount" numeric(15,2) NOT NULL,
                "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
                "merchant" character varying(255) NOT NULL,
                "location" character varying(255) NOT NULL,
                "latitude" double precision,
                "longitude" double precision,
                "reason" "public"."flagged_transactions_reason_enum" NOT NULL,
                "metadata" jsonb NOT NULL DEFAULT '{}',
                "riskScore" double precision NOT NULL DEFAULT 1,
                "flaggedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_flagged_transactions" PRIMARY KEY ("id")
            )
        `);

        // FLAGGED INDEXES (NO DUPLICATES)
        await queryRunner.query(`CREATE INDEX "IDX_flagged_transactionId" ON "flagged_transactions" ("transactionId")`);
        await queryRunner.query(`CREATE INDEX "IDX_flagged_userId" ON "flagged_transactions" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_flagged_reason" ON "flagged_transactions" ("reason")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {

        // DROP FLAGGED TABLE
        await queryRunner.query(`DROP TABLE "flagged_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."flagged_transactions_reason_enum"`);

        // DROP TRANSACTIONS TABLE
        await queryRunner.query(`DROP TABLE "transactions"`);

        // (indexes auto-drop with tables, no need to manually drop unless strict DB policy)
    }
}
