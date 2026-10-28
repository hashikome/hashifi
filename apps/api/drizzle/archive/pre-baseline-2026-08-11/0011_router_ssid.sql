-- The network name customers see, so provisioning can assert it on every run.
--
-- Until now the SSID was set once by hand (or once by the generated bootstrap script) and
-- nothing re-asserted it: a radio someone disabled or renamed stayed broken through a fully
-- green provision, because no step looked at the radio at all.
--
-- Nullable on purpose. With no SSID stored, the radio steps still enable the interface but
-- leave the name alone — so existing routers keep whatever SSID they are already broadcasting
-- and nobody is forced to fill this in.
ALTER TABLE routers ADD COLUMN ssid VARCHAR(32) NULL AFTER hotspot_interface;
