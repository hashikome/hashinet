-- CreateEnum
CREATE TYPE "membership_scope" AS ENUM ('platform', 'business');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('admin', 'manager', 'operator', 'owner', 'business_manager', 'venue_manager', 'venue_operator');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "sign_in_method" AS ENUM ('email_code', 'authenticator', 'passkey', 'recovery_code');

-- CreateEnum
CREATE TYPE "business_status" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "audit_category" AS ENUM ('change', 'read', 'auth');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('success', 'no_change', 'failed', 'denied');

-- CreateEnum
CREATE TYPE "venue_status" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateEnum
CREATE TYPE "router_status" AS ENUM ('online', 'offline', 'provisioning', 'error');

-- CreateEnum
CREATE TYPE "voucher_status" AS ENUM ('unused', 'pending_activation', 'active', 'expired', 'used', 'revoked');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('active', 'blocked');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('connected', 'disconnected', 'expired', 'terminated');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('cash', 'mobile_money', 'card', 'manual');

-- CreateEnum
CREATE TYPE "sms_status" AS ENUM ('sending', 'sent', 'delivered', 'failed', 'unconfirmed');

-- CreateEnum
CREATE TYPE "theme_preference" AS ENUM ('light', 'dark', 'system');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "two_factor_enabled" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,
    "active_membership_id" UUID,
    "signed_in_with" "sign_in_method",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failed_verification_count" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(120),
    "public_key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" VARCHAR(32) NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "aaguid" VARCHAR(36),
    "created_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_in_code_budgets" (
    "user_id" UUID NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "codes_sent" INTEGER NOT NULL,

    CONSTRAINT "sign_in_code_budgets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(160) NOT NULL,
    "region" VARCHAR(40) NOT NULL,
    "area" VARCHAR(160) NOT NULL,
    "status" "business_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "scope" "membership_scope" NOT NULL,
    "business_id" UUID,
    "role" "membership_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_venues" (
    "membership_id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,

    CONSTRAINT "membership_venues_pkey" PRIMARY KEY ("membership_id","venue_id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" VARCHAR(255) NOT NULL,
    "scope" "membership_scope" NOT NULL,
    "business_id" UUID,
    "role" "membership_role" NOT NULL,
    "venue_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "token_digest" VARCHAR(64) NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "theme" "theme_preference" NOT NULL DEFAULT 'system',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "platform_default_packages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(180) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "device_limit" INTEGER NOT NULL DEFAULT 1,
    "price_tsh" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_default_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "business_id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "allowed_sites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "region" VARCHAR(40) NOT NULL,
    "area" VARCHAR(160) NOT NULL,
    "status" "venue_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "model" VARCHAR(160),
    "identity" VARCHAR(160),
    "ip_address" VARCHAR(45) NOT NULL,
    "hotspot_gateway_ip" VARCHAR(45),
    "mac_address" VARCHAR(32),
    "api_username" VARCHAR(120),
    "api_password_encrypted" TEXT,
    "enable_hotspot" BOOLEAN NOT NULL DEFAULT true,
    "hotspot_name" VARCHAR(160),
    "hotspot_interface" VARCHAR(80),
    "ssid" VARCHAR(32),
    "network_range" VARCHAR(64),
    "provisioning_command" TEXT,
    "provisioned_at" TIMESTAMPTZ(3),
    "tunnel_address" VARCHAR(45),
    "tunnel_public_key" VARCHAR(64),
    "tunnel_private_key_encrypted" TEXT,
    "ros_version" VARCHAR(32),
    "architecture" VARCHAR(32),
    "capabilities" JSONB,
    "last_provision_report" JSONB,
    "setup_started_at" TIMESTAMPTZ(3),
    "setup_phase" VARCHAR(20),
    "last_setup" JSONB,
    "last_setup_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "uptime_seconds" INTEGER NOT NULL DEFAULT 0,
    "connected_devices" INTEGER NOT NULL DEFAULT 0,
    "status" "router_status" NOT NULL DEFAULT 'offline',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "business_id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "download_speed_mbps" INTEGER NOT NULL,
    "upload_speed_mbps" INTEGER,
    "data_limit_gb" INTEGER,
    "device_limit" INTEGER NOT NULL DEFAULT 1,
    "price_tsh" DECIMAL(12,2) NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "throttled_download_mbps" INTEGER,
    "throttled_upload_mbps" INTEGER,
    "peak_start_hour" INTEGER,
    "peak_end_hour" INTEGER,
    "throttle_after_gb" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_packages" (
    "venue_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_packages_pkey" PRIMARY KEY ("venue_id","package_id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "mac_address" VARCHAR(32) NOT NULL,
    "last_ip_address" VARCHAR(45),
    "device_name" VARCHAR(160),
    "device_type" VARCHAR(40),
    "status" "device_status" NOT NULL DEFAULT 'active',
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "package_id" UUID,
    "venue_id" UUID,
    "created_by_id" UUID,
    "quantity" INTEGER NOT NULL,
    "prefix" VARCHAR(24) NOT NULL DEFAULT 'WIFI',
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voucher_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "batch_id" UUID,
    "package_id" UUID,
    "venue_id" UUID,
    "redeemed_by_device_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "status" "voucher_status" NOT NULL DEFAULT 'unused',
    "data_limit_gb" INTEGER,
    "data_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "duration_minutes" INTEGER,
    "price_tsh" DECIMAL(12,2) NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_devices" (
    "voucher_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_devices_pkey" PRIMARY KEY ("voucher_id","device_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "device_id" UUID,
    "voucher_id" UUID,
    "package_id" UUID,
    "venue_id" UUID,
    "provider" "payment_provider" NOT NULL DEFAULT 'manual',
    "provider_reference" VARCHAR(160),
    "phone" VARCHAR(32),
    "amount_tsh" DECIMAL(12,2) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(3),
    "router_provisioned_at" TIMESTAMPTZ(3),
    "provision_error" TEXT,
    "session_secret_hash" VARCHAR(64),
    "idempotency_key" VARCHAR(30),
    "customer_id" UUID,
    "router_id" UUID,
    "mac_address" VARCHAR(32),
    "ip_address" VARCHAR(45),
    "destination" TEXT,
    "recorded_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "signed_in_at" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "phone" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("provider","event_id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID NOT NULL,
    "status" "sms_status" NOT NULL DEFAULT 'sending',
    "job_id" VARCHAR(120),
    "message_id" VARCHAR(120),
    "failure_reason" VARCHAR(255),
    "confirm_by" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "device_id" UUID,
    "voucher_id" UUID,
    "package_id" UUID,
    "venue_id" UUID,
    "router_id" UUID,
    "mac_address" VARCHAR(32) NOT NULL,
    "ip_address" VARCHAR(45),
    "device_name" VARCHAR(160),
    "device_type" VARCHAR(40),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "download_bytes" BIGINT NOT NULL DEFAULT 0,
    "upload_speed_mbps" DECIMAL(8,2),
    "download_speed_mbps" DECIMAL(8,2),
    "signal_strength_dbm" INTEGER,
    "termination_reason" VARCHAR(120),
    "is_throttled" BOOLEAN NOT NULL DEFAULT false,
    "status" "session_status" NOT NULL DEFAULT 'connected',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wifi_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_usage_samples" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "sampled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "download_bytes" BIGINT NOT NULL DEFAULT 0,
    "upload_speed_mbps" DECIMAL(8,2),
    "download_speed_mbps" DECIMAL(8,2),
    "signal_strength_dbm" INTEGER,

    CONSTRAINT "session_usage_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "brand_name" VARCHAR(160) NOT NULL,
    "headline" VARCHAR(180) NOT NULL,
    "message" TEXT NOT NULL,
    "primary_color" VARCHAR(16) NOT NULL,
    "accent_color" VARCHAR(16) NOT NULL,
    "background_color" VARCHAR(16) NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 18,
    "voucher_label" VARCHAR(100) NOT NULL,
    "voucher_prefix" VARCHAR(24) NOT NULL DEFAULT 'WIFI',
    "voucher_help" TEXT NOT NULL,
    "ticket_title" VARCHAR(160) NOT NULL,
    "ticket_footer" VARCHAR(255) NOT NULL,
    "require_terms" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_brands" (
    "venue_id" UUID NOT NULL,
    "brand_name" VARCHAR(160) NOT NULL,
    "headline" VARCHAR(180) NOT NULL,
    "message" TEXT NOT NULL,
    "primary_color" VARCHAR(16) NOT NULL,
    "accent_color" VARCHAR(16) NOT NULL,
    "background_color" VARCHAR(16) NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 18,
    "voucher_label" VARCHAR(100) NOT NULL,
    "voucher_prefix" VARCHAR(12) NOT NULL,
    "voucher_help" TEXT NOT NULL,
    "ticket_title" VARCHAR(160) NOT NULL,
    "ticket_footer" VARCHAR(255) NOT NULL,
    "require_terms" BOOLEAN NOT NULL DEFAULT true,
    "logo_key" VARCHAR(120),
    "background_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venue_brands_pkey" PRIMARY KEY ("venue_id")
);

-- CreateTable
CREATE TABLE "daily_usage_stats" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID,
    "package_id" UUID,
    "stat_date" DATE NOT NULL,
    "sessions_count" INTEGER NOT NULL DEFAULT 0,
    "active_users_count" INTEGER NOT NULL DEFAULT 0,
    "upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "download_bytes" BIGINT NOT NULL DEFAULT 0,
    "revenue_tsh" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_usage_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_membership_id" UUID,
    "actor_user_id" UUID,
    "business_id" UUID,
    "venue_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "category" "audit_category" NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(80),
    "outcome" "audit_outcome" NOT NULL,
    "change" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "two_factors_user_id_key" ON "two_factors"("user_id");

-- CreateIndex
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- CreateIndex
CREATE INDEX "passkeys_credential_id_idx" ON "passkeys"("credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE INDEX "memberships_business_id_idx" ON "memberships"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_scope_business_id_key" ON "memberships"("user_id", "scope", "business_id");

-- CreateIndex
CREATE INDEX "membership_venues_venue_id_idx" ON "membership_venues"("venue_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_digest_key" ON "invitations"("token_digest");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_business_id_idx" ON "invitations"("business_id");

-- CreateIndex
CREATE INDEX "venues_business_id_idx" ON "venues"("business_id");

-- CreateIndex
CREATE INDEX "venues_status_idx" ON "venues"("status");

-- CreateIndex
CREATE UNIQUE INDEX "routers_mac_address_key" ON "routers"("mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "routers_tunnel_address_key" ON "routers"("tunnel_address");

-- CreateIndex
CREATE UNIQUE INDEX "routers_tunnel_public_key_key" ON "routers"("tunnel_public_key");

-- CreateIndex
CREATE INDEX "routers_venue_id_idx" ON "routers"("venue_id");

-- CreateIndex
CREATE INDEX "routers_status_idx" ON "routers"("status");

-- CreateIndex
CREATE INDEX "routers_ip_address_idx" ON "routers"("ip_address");

-- CreateIndex
CREATE INDEX "packages_business_id_idx" ON "packages"("business_id");

-- CreateIndex
CREATE INDEX "packages_is_active_idx" ON "packages"("is_active");

-- CreateIndex
CREATE INDEX "packages_price_tsh_idx" ON "packages"("price_tsh");

-- CreateIndex
CREATE INDEX "venue_packages_package_id_idx" ON "venue_packages"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_mac_address_key" ON "devices"("mac_address");

-- CreateIndex
CREATE INDEX "devices_status_idx" ON "devices"("status");

-- CreateIndex
CREATE INDEX "voucher_batches_package_id_idx" ON "voucher_batches"("package_id");

-- CreateIndex
CREATE INDEX "voucher_batches_venue_id_idx" ON "voucher_batches"("venue_id");

-- CreateIndex
CREATE INDEX "voucher_batches_created_by_id_idx" ON "voucher_batches"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");

-- CreateIndex
CREATE INDEX "vouchers_status_idx" ON "vouchers"("status");

-- CreateIndex
CREATE INDEX "vouchers_package_id_idx" ON "vouchers"("package_id");

-- CreateIndex
CREATE INDEX "vouchers_venue_id_idx" ON "vouchers"("venue_id");

-- CreateIndex
CREATE INDEX "vouchers_redeemed_by_device_id_idx" ON "vouchers"("redeemed_by_device_id");

-- CreateIndex
CREATE INDEX "voucher_devices_device_id_idx" ON "voucher_devices"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_device_id_idx" ON "payments"("device_id");

-- CreateIndex
CREATE INDEX "payments_voucher_id_idx" ON "payments"("voucher_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_provider_reference_idx" ON "payments"("provider_reference");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_payment_id_key" ON "sms_messages"("payment_id");

-- CreateIndex
CREATE INDEX "sms_messages_job_id_idx" ON "sms_messages"("job_id");

-- CreateIndex
CREATE INDEX "sms_messages_message_id_idx" ON "sms_messages"("message_id");

-- CreateIndex
CREATE INDEX "sms_messages_status_idx" ON "sms_messages"("status");

-- CreateIndex
CREATE INDEX "wifi_sessions_device_id_idx" ON "wifi_sessions"("device_id");

-- CreateIndex
CREATE INDEX "wifi_sessions_voucher_id_idx" ON "wifi_sessions"("voucher_id");

-- CreateIndex
CREATE INDEX "wifi_sessions_router_id_idx" ON "wifi_sessions"("router_id");

-- CreateIndex
CREATE INDEX "wifi_sessions_status_idx" ON "wifi_sessions"("status");

-- CreateIndex
CREATE INDEX "wifi_sessions_started_at_idx" ON "wifi_sessions"("started_at");

-- CreateIndex
CREATE INDEX "wifi_sessions_mac_address_idx" ON "wifi_sessions"("mac_address");

-- CreateIndex
CREATE INDEX "session_usage_samples_session_id_idx" ON "session_usage_samples"("session_id");

-- CreateIndex
CREATE INDEX "session_usage_samples_sampled_at_idx" ON "session_usage_samples"("sampled_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_settings_singleton_key" ON "portal_settings"("singleton");

-- CreateIndex
CREATE INDEX "daily_usage_stats_venue_id_idx" ON "daily_usage_stats"("venue_id");

-- CreateIndex
CREATE INDEX "daily_usage_stats_package_id_idx" ON "daily_usage_stats"("package_id");

-- CreateIndex
CREATE INDEX "daily_usage_stats_stat_date_idx" ON "daily_usage_stats"("stat_date");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_venue_id_created_at_idx" ON "audit_logs"("venue_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_membership_id_fkey" FOREIGN KEY ("active_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_code_budgets" ADD CONSTRAINT "sign_in_code_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_venues" ADD CONSTRAINT "membership_venues_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_venues" ADD CONSTRAINT "membership_venues_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routers" ADD CONSTRAINT "routers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_packages" ADD CONSTRAINT "venue_packages_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_packages" ADD CONSTRAINT "venue_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "voucher_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_redeemed_by_device_id_fkey" FOREIGN KEY ("redeemed_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_devices" ADD CONSTRAINT "voucher_devices_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_devices" ADD CONSTRAINT "voucher_devices_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_usage_samples" ADD CONSTRAINT "session_usage_samples_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "wifi_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_brands" ADD CONSTRAINT "venue_brands_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_stats" ADD CONSTRAINT "daily_usage_stats_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_stats" ADD CONSTRAINT "daily_usage_stats_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Rules Prisma cannot express ────────────────────────────────────────────

-- At most one membership per person per scope: the platform's has no business, so nulls must
-- collide (ADR-0011, 7).
DROP INDEX "memberships_user_id_scope_business_id_key";
CREATE UNIQUE INDEX "memberships_user_id_scope_business_id_key" ON "memberships"("user_id", "scope", "business_id") NULLS NOT DISTINCT;

-- A role belongs to its own scope, and only a business membership names a business.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scope_role" CHECK (
  ("scope" = 'platform' AND "business_id" IS NULL AND "role" IN ('admin', 'manager', 'operator'))
  OR ("scope" = 'business' AND "business_id" IS NOT NULL AND "role" IN ('owner', 'business_manager', 'venue_manager', 'venue_operator'))
);
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_scope_role" CHECK (
  ("scope" = 'platform' AND "business_id" IS NULL AND "role" IN ('admin', 'manager', 'operator'))
  OR ("scope" = 'business' AND "role" IN ('owner', 'business_manager', 'venue_manager', 'venue_operator')
      AND ("business_id" IS NOT NULL OR "role" = 'owner'))
);
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_venue_roles" CHECK (
  ("role" IN ('venue_manager', 'venue_operator')) = (cardinality("venue_ids") > 0)
);

-- Emails are lower-case; voucher codes and prefixes upper-case: RouterOS compares hotspot
-- usernames case-sensitively, so input is normalised before lookup.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower" CHECK ("email" = lower("email"));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_lower" CHECK ("email" = lower("email"));
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_code_upper" CHECK ("code" = upper("code"));
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_prefix_upper" CHECK ("prefix" = upper("prefix"));
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_voucher_prefix_upper" CHECK ("voucher_prefix" = upper("voucher_prefix"));
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_singleton" CHECK ("singleton");

-- Packages: positive time, speed, devices and price; peak hours within the day.
ALTER TABLE "packages" ADD CONSTRAINT "packages_positive" CHECK ("duration_minutes" > 0 AND "download_speed_mbps" > 0 AND "device_limit" > 0 AND "price_tsh" >= 0);
ALTER TABLE "packages" ADD CONSTRAINT "packages_peak_hours_range" CHECK (("peak_start_hour" IS NULL OR "peak_start_hour" BETWEEN 0 AND 23) AND ("peak_end_hour" IS NULL OR "peak_end_hour" BETWEEN 0 AND 23));
ALTER TABLE "platform_default_packages" ADD CONSTRAINT "platform_default_packages_positive" CHECK ("duration_minutes" > 0 AND "device_limit" > 0 AND "price_tsh" >= 0);
