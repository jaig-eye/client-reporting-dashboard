-- 224: where a client's keyword research and rank checks are measured.
--
-- DataForSEO Labs — every keyword volume and competitor the research pipeline reads — is
-- country-level by design. For a service business that sells in one county, the national volume
-- for "christmas light installer" says nothing about its market, and the national competitors are
-- product brands it never meets. This column names the client's market as a Google geo target
-- (city, county or state), which the Google Ads volume and live SERP endpoints do accept:
--
--   { "code": 1014221, "name": "Los Angeles County,California,United States", "type": "County" }
--
-- Null keeps the previous behaviour: country-wide research. Nothing reads this until the code
-- from the same branch is deployed, and every read tolerates the column being absent.

alter table content_settings
  add column if not exists research_location jsonb;

comment on column content_settings.research_location is
  'Google geo target the research and live rank checks are measured in: { code, name, type }. Null = country-level (DataForSEO Labs default).';
