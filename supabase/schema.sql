-- BizBoost Supabase/Postgres Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS sellers (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  category          VARCHAR(255) NOT NULL,
  city              VARCHAR(255) NOT NULL,
  state             VARCHAR(255) NOT NULL,
  website           VARCHAR(500) DEFAULT NULL,
  contact           VARCHAR(50)  NOT NULL,
  email             VARCHAR(255) NOT NULL UNIQUE,
  password          VARCHAR(255) NOT NULL,
  is_featured       BOOLEAN      NOT NULL DEFAULT false,
  is_verified       BOOLEAN      NOT NULL DEFAULT false,
  featured_order    INT          NOT NULL DEFAULT 0,
  subscription_tier VARCHAR(20)  NOT NULL DEFAULT 'free',
  created_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buyers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  requirement TEXT,
  city        VARCHAR(255) NOT NULL,
  state       VARCHAR(255) NOT NULL,
  budget_min  REAL         DEFAULT 0,
  budget_max  REAL         DEFAULT 0,
  contact     VARCHAR(50)  NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_details (
  id               SERIAL PRIMARY KEY,
  seller_id        INT          NOT NULL UNIQUE,
  gst_number       VARCHAR(20)  DEFAULT NULL,
  business_type    VARCHAR(100) DEFAULT NULL,
  year_established VARCHAR(10)  DEFAULT NULL,
  employees        VARCHAR(50)  DEFAULT NULL,
  annual_turnover  VARCHAR(100) DEFAULT NULL,
  products_offered TEXT,
  business_desc    TEXT,
  address          TEXT,
  pincode          VARCHAR(10)  DEFAULT NULL,
  certifications   VARCHAR(255) DEFAULT NULL,
  facebook_url     VARCHAR(255) DEFAULT NULL,
  instagram_url    VARCHAR(255) DEFAULT NULL,
  whatsapp         VARCHAR(20)  DEFAULT NULL,
  working_hours    VARCHAR(100) DEFAULT NULL,
  delivery_radius  VARCHAR(100) DEFAULT NULL,
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_usage (
  id        SERIAL PRIMARY KEY,
  seller_id INT         NOT NULL,
  feature   VARCHAR(50) NOT NULL DEFAULT 'analyze',
  used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage ON seller_usage (seller_id, feature, used_at);

CREATE TABLE IF NOT EXISTS leads (
  id                 SERIAL PRIMARY KEY,
  buyer_id           INT          NOT NULL,
  buyer_name         VARCHAR(255),
  buyer_phone        VARCHAR(50),
  product            VARCHAR(255) NOT NULL,
  city               VARCHAR(255) NOT NULL,
  state              VARCHAR(255),
  quantity           VARCHAR(100),
  unit               VARCHAR(50),
  budget_min         REAL         DEFAULT 0,
  budget_max         REAL         DEFAULT 0,
  status             VARCHAR(50)  DEFAULT 'active',
  assigned_seller_id INT          DEFAULT NULL,
  assigned_at        TIMESTAMPTZ  DEFAULT NULL,
  created_at         TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connections (
  id           SERIAL PRIMARY KEY,
  buyer_id     INT         NOT NULL,
  seller_id    INT         NOT NULL,
  message      TEXT,
  status       VARCHAR(50) DEFAULT 'pending',
  initiated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_reports (
  id           SERIAL PRIMARY KEY,
  seller_id    INT  NOT NULL,
  report_json  TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor_data (
  id             SERIAL PRIMARY KEY,
  seller_id      INT          NOT NULL,
  competitor_url VARCHAR(500),
  meta_title     TEXT,
  meta_desc      TEXT,
  keywords       TEXT,
  h1_tags        TEXT,
  scraped_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_listings (
  id            SERIAL PRIMARY KEY,
  platform      VARCHAR(50)  NOT NULL,
  category      VARCHAR(255),
  city          VARCHAR(255),
  business_name VARCHAR(255),
  contact       VARCHAR(100),
  url           VARCHAR(500),
  cached_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor_intel (
  id           SERIAL PRIMARY KEY,
  seller_id    INT  NOT NULL,
  intel_json   TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ci ON competitor_intel (seller_id, generated_at);
