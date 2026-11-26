-- CreateTable
CREATE TABLE "invoice_runs" (
    "period" DATE NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_runs_pkey" PRIMARY KEY ("period")
);
