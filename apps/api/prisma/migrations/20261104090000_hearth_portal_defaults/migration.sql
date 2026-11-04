-- The portal's default brand moves to Hearth. A default someone has changed is left alone.
UPDATE "portal_settings"
SET "primary_color" = '#F59E2A', "accent_color" = '#0D1B2A', "background_color" = '#0D1B2A'
WHERE "primary_color" = '#0F766E' AND "accent_color" = '#134E4A' AND "background_color" = '#134E4A';
