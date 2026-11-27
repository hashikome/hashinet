-- The captive portal as a template copied down (ADR-0009): the platform's starts a new business's,
-- a business's starts each new venue's, and a venue keeps its own. Two colours (the page and its
-- button) and the wording the portal shows; the platform keeps a list of themes, one the default.
-- Every business and venue gets a copy of what its guests see today, so no portal changes. The
-- brand name, accent colour, radius, voucher label, ticket wording and background image were read
-- by nothing the portal shows, and go.

CREATE TYPE "portal_start" AS ENUM ('voucher', 'buy');

-- Themes.
CREATE TABLE "portal_themes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(60) NOT NULL,
    "page_color" VARCHAR(7) NOT NULL,
    "button_color" VARCHAR(7) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_themes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portal_themes_colors_check" CHECK ("page_color" ~ '^#[0-9A-F]{6}$' AND "button_color" ~ '^#[0-9A-F]{6}$')
);
CREATE UNIQUE INDEX "portal_themes_name_key" ON "portal_themes"("name");
-- One default at most.
CREATE UNIQUE INDEX "portal_themes_one_default" ON "portal_themes"("is_default") WHERE "is_default";
INSERT INTO "portal_themes" ("name", "page_color", "button_color", "is_default") VALUES
    ('Midnight and ember', '#0D1B2A', '#F59E2A', true),
    ('White', '#FFFFFF', '#0D1B2A', false);

-- What every portal shows today when it has nothing of its own: the platform's row, else HashiNet's.
CREATE TEMPORARY TABLE "portal_now" AS
SELECT
    upper(left("background_color", 7)) AS "page_color",
    upper(left("primary_color", 7)) AS "button_color",
    left("headline", 120) AS "welcome",
    left("message", 240) AS "voucher_text",
    left("where_to_buy", 240) AS "where_to_buy",
    "contact_phone",
    "require_terms"
FROM "portal_settings"
UNION ALL
SELECT '#0D1B2A', '#F59E2A', 'Welcome to fast WiFi', 'Enter your voucher code to get online.', '', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM "portal_settings");

-- A business's template, from what its venues without their own show today.
CREATE TABLE "business_portals" (
    "business_id" UUID NOT NULL,
    "page_color" VARCHAR(7) NOT NULL,
    "button_color" VARCHAR(7) NOT NULL,
    "opens_on" "portal_start" NOT NULL DEFAULT 'voucher',
    "show_logo" BOOLEAN NOT NULL DEFAULT true,
    "welcome" VARCHAR(120) NOT NULL,
    "voucher_text" VARCHAR(240) NOT NULL,
    "buy_text" VARCHAR(240) NOT NULL,
    "where_to_buy" VARCHAR(240) NOT NULL,
    "contact_phone" VARCHAR(20),
    "require_terms" BOOLEAN NOT NULL DEFAULT true,
    "terms" VARCHAR(2000) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "business_portals_pkey" PRIMARY KEY ("business_id"),
    CONSTRAINT "business_portals_colors_check" CHECK ("page_color" ~ '^#[0-9A-F]{6}$' AND "button_color" ~ '^#[0-9A-F]{6}$')
);
ALTER TABLE "business_portals" ADD CONSTRAINT "business_portals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "business_portals" ("business_id", "page_color", "button_color", "welcome", "voucher_text", "buy_text", "where_to_buy", "contact_phone", "require_terms", "terms", "updated_at")
SELECT b."id", p."page_color", p."button_color", p."welcome", p."voucher_text",
    'Choose your time and pay with mobile money. You''re online in a moment.',
    p."where_to_buy", p."contact_phone", p."require_terms",
    'Use this WiFi for lawful purposes only. Don''t share your voucher code. Time runs from when you first join and doesn''t pause. We may limit speeds at busy times. Vouchers aren''t refundable once used.',
    CURRENT_TIMESTAMP
FROM "businesses" b CROSS JOIN "portal_now" p;

-- A venue's own: the branding it had, reshaped.
ALTER TABLE "venue_brands" RENAME TO "venue_portals";
ALTER TABLE "venue_portals" RENAME CONSTRAINT "venue_brands_pkey" TO "venue_portals_pkey";
ALTER TABLE "venue_portals" RENAME CONSTRAINT "venue_brands_venue_id_fkey" TO "venue_portals_venue_id_fkey";
ALTER TABLE "venue_portals" RENAME COLUMN "background_color" TO "page_color";
ALTER TABLE "venue_portals" RENAME COLUMN "primary_color" TO "button_color";
ALTER TABLE "venue_portals" RENAME COLUMN "headline" TO "welcome";
ALTER TABLE "venue_portals" RENAME COLUMN "message" TO "voucher_text";
ALTER TABLE "venue_portals"
    ALTER COLUMN "page_color" TYPE VARCHAR(7) USING upper(left("page_color", 7)),
    ALTER COLUMN "button_color" TYPE VARCHAR(7) USING upper(left("button_color", 7)),
    ALTER COLUMN "welcome" TYPE VARCHAR(120) USING left("welcome", 120),
    ALTER COLUMN "voucher_text" TYPE VARCHAR(240) USING left("voucher_text", 240),
    ALTER COLUMN "where_to_buy" TYPE VARCHAR(240) USING left("where_to_buy", 240),
    ADD COLUMN "opens_on" "portal_start" NOT NULL DEFAULT 'voucher',
    ADD COLUMN "show_logo" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "buy_text" VARCHAR(240) NOT NULL DEFAULT 'Choose your time and pay with mobile money. You''re online in a moment.',
    ADD COLUMN "terms" VARCHAR(2000) NOT NULL DEFAULT 'Use this WiFi for lawful purposes only. Don''t share your voucher code. Time runs from when you first join and doesn''t pause. We may limit speeds at busy times. Vouchers aren''t refundable once used.',
    DROP COLUMN "brand_name",
    DROP COLUMN "accent_color",
    DROP COLUMN "radius",
    DROP COLUMN "voucher_label",
    DROP COLUMN "ticket_title",
    DROP COLUMN "ticket_footer",
    DROP COLUMN "background_key",
    DROP COLUMN "created_at";
ALTER TABLE "venue_portals" ALTER COLUMN "buy_text" DROP DEFAULT, ALTER COLUMN "terms" DROP DEFAULT;
ALTER TABLE "venue_portals" ADD CONSTRAINT "venue_portals_colors_check" CHECK ("page_color" ~ '^#[0-9A-F]{6}$' AND "button_color" ~ '^#[0-9A-F]{6}$');

-- Every venue without one gets its business's, which is what it shows today.
INSERT INTO "venue_portals" ("venue_id", "page_color", "button_color", "opens_on", "show_logo", "welcome", "voucher_text", "buy_text", "where_to_buy", "contact_phone", "require_terms", "terms", "updated_at")
SELECT v."id", b."page_color", b."button_color", b."opens_on", b."show_logo", b."welcome", b."voucher_text", b."buy_text", b."where_to_buy", b."contact_phone", b."require_terms", b."terms", CURRENT_TIMESTAMP
FROM "venues" v JOIN "business_portals" b ON b."business_id" = v."business_id"
WHERE NOT EXISTS (SELECT 1 FROM "venue_portals" o WHERE o."venue_id" = v."id");

-- The platform's: the wording a new business starts with; its colours are the default theme's.
ALTER TABLE "portal_settings" RENAME COLUMN "headline" TO "welcome";
ALTER TABLE "portal_settings" RENAME COLUMN "message" TO "voucher_text";
ALTER TABLE "portal_settings"
    ALTER COLUMN "welcome" TYPE VARCHAR(120) USING left("welcome", 120),
    ALTER COLUMN "voucher_text" TYPE VARCHAR(240) USING left("voucher_text", 240),
    ALTER COLUMN "where_to_buy" TYPE VARCHAR(240) USING left("where_to_buy", 240),
    ADD COLUMN "opens_on" "portal_start" NOT NULL DEFAULT 'voucher',
    ADD COLUMN "show_logo" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "buy_text" VARCHAR(240) NOT NULL DEFAULT 'Choose your time and pay with mobile money. You''re online in a moment.',
    ADD COLUMN "terms" VARCHAR(2000) NOT NULL DEFAULT 'Use this WiFi for lawful purposes only. Don''t share your voucher code. Time runs from when you first join and doesn''t pause. We may limit speeds at busy times. Vouchers aren''t refundable once used.',
    DROP COLUMN "brand_name",
    DROP COLUMN "primary_color",
    DROP COLUMN "accent_color",
    DROP COLUMN "background_color",
    DROP COLUMN "radius",
    DROP COLUMN "voucher_label",
    DROP COLUMN "ticket_title",
    DROP COLUMN "ticket_footer",
    DROP COLUMN "is_active";
ALTER TABLE "portal_settings" ALTER COLUMN "buy_text" DROP DEFAULT, ALTER COLUMN "terms" DROP DEFAULT;

DROP TABLE "portal_now";
