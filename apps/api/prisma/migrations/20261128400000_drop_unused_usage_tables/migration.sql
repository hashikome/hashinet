-- Two tables nothing wrote or read: daily usage stats and per-session usage samples. Analytics
-- reads the sessions themselves (owner, 28 November 2026).

-- DropForeignKey
ALTER TABLE "daily_usage_stats" DROP CONSTRAINT "daily_usage_stats_package_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_usage_stats" DROP CONSTRAINT "daily_usage_stats_venue_id_fkey";

-- DropForeignKey
ALTER TABLE "session_usage_samples" DROP CONSTRAINT "session_usage_samples_session_id_fkey";

-- DropTable
DROP TABLE "daily_usage_stats";

-- DropTable
DROP TABLE "session_usage_samples";

