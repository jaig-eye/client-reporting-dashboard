/**
 * Google Ads MCC Script — Campaign + Ad Group + Ad Metrics Sync
 * ─────────────────────────────────────────────────────────────
 * Runs at the MCC (Manager Account) level and pushes daily performance
 * data (campaign-level AND ad-level) for ALL sub-accounts to your dashboard.
 *
 * HOW TO INSTALL
 * ──────────────
 * 1. In your Google Ads MCC: Tools & Settings → Scripts → + New Script
 * 2. Paste this entire file, then update CONFIG below.
 * 3. Authorise the script (first run only — grants UrlFetch permission).
 * 4. Schedule: Daily at 07:00 in your timezone (after Google finishes
 *    processing the previous day's data, usually by 06:00).
 *
 * FIRST RUN (BACKFILL)
 * ────────────────────
 * Set IS_BACKFILL = true and BACKFILL_DAYS to how far back you want
 * to pull (max 730 days / 2 years). Run once manually, then set
 * IS_BACKFILL back to false and save for the scheduled daily runs.
 *
 * NOTE: The script pushes data for ALL accounts under the MCC on each run.
 * Accounts that are not yet mapped to a client in the admin panel are
 * registered but their metrics are discarded until they are mapped.
 *
 * AD-LEVEL DATA
 * ─────────────
 * The script also queries ad_group_ad to push ad-group and individual-ad
 * metrics. This enables the campaign drill-down view in the dashboard.
 * Set SYNC_AD_LEVEL = false to disable this if you only need campaign totals.
 */

var CONFIG = {
  // ── Required ───────────────────────────────────────────────────────────────
  INGEST_URL:    'https://YOUR_APP_URL/api/ingest/google',
  INGEST_SECRET: 'YOUR_INGEST_SECRET',   // must match INGEST_SECRET in Vercel env vars

  // ── Sync window ───────────────────────────────────────────────────────────
  // Incremental mode: re-sync the last N days on every scheduled run.
  // 3 days catches late-arriving conversions and attribution updates.
  INCREMENTAL_DAYS: 3,

  // ── Backfill (first run only) ──────────────────────────────────────────────
  IS_BACKFILL:   false,   // set true for the initial historical pull, then back to false
  BACKFILL_DAYS: 730,     // how many days of history to pull on first run (max ~730)

  // ── Account filter ─────────────────────────────────────────────────────────
  // Leave empty [] to sync all MCC sub-accounts, or list specific customer IDs:
  // e.g. ['1234567890', '0987654321']
  ACCOUNT_ALLOWLIST: [],

  // ── Ad-level sync ─────────────────────────────────────────────────────────
  // Pushes ad group + individual ad metrics to enable campaign drill-down.
  // Disable only if you hit script memory limits on very large accounts.
  SYNC_AD_LEVEL: true,

  // ── Batch size ────────────────────────────────────────────────────────────
  // Rows per POST request. Keep under 500 to stay well within UrlFetch limits.
  BATCH_SIZE: 300,
};

// ─────────────────────────────────────────────────────────────────────────────

function main() {
  var days = CONFIG.IS_BACKFILL ? CONFIG.BACKFILL_DAYS : CONFIG.INCREMENTAL_DAYS;
  var dates = buildDateRange(days);

  Logger.log('Sync mode: ' + (CONFIG.IS_BACKFILL ? 'BACKFILL' : 'INCREMENTAL') +
             ' | Date range: ' + dates.start + ' → ' + dates.end +
             ' | Ad-level: ' + (CONFIG.SYNC_AD_LEVEL ? 'yes' : 'no'));

  var accountIterator = MccApp.accounts()
    .withLimit(500)
    .get();

  var synced = 0;
  var errors = 0;

  while (accountIterator.hasNext()) {
    var account = accountIterator.next();
    var customerId = account.getCustomerId(); // format: "123-456-7890"
    var customerIdClean = customerId.replace(/-/g, '');

    // Apply allowlist filter if set
    if (CONFIG.ACCOUNT_ALLOWLIST.length > 0 &&
        CONFIG.ACCOUNT_ALLOWLIST.indexOf(customerIdClean) === -1 &&
        CONFIG.ACCOUNT_ALLOWLIST.indexOf(customerId) === -1) {
      continue;
    }

    MccApp.select(account);

    try {
      var rows   = fetchCampaignMetrics(dates.start, dates.end);
      if (rows.length === 0) {
        Logger.log('[' + customerId + '] No campaign data — skipping');
        continue;
      }

      var adRows = CONFIG.SYNC_AD_LEVEL ? fetchAdMetrics(dates.start, dates.end) : [];

      pushData(customerIdClean, rows, adRows);
      synced++;
      Logger.log('[' + customerId + '] Pushed ' + rows.length + ' campaign rows, ' +
                 adRows.length + ' ad rows');
    } catch (e) {
      errors++;
      Logger.log('[' + customerId + '] ERROR: ' + e.message);
    }
  }

  Logger.log('Done. Accounts synced: ' + synced + ' | Errors: ' + errors);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

/**
 * Query all ENABLED + PAUSED campaigns in the currently-selected account.
 */
function fetchCampaignMetrics(dateStart, dateEnd) {
  var query = [
    'SELECT',
    '  campaign.id,',
    '  campaign.name,',
    '  campaign.status,',
    '  campaign.advertising_channel_type,',
    '  segments.date,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.conversions,',
    '  metrics.conversions_value',
    'FROM campaign',
    'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\')',
    '  AND metrics.impressions > 0',
    '  AND segments.date BETWEEN \'' + dateStart + '\' AND \'' + dateEnd + '\'',
    'ORDER BY segments.date DESC, campaign.id ASC',
  ].join(' ');

  var rows = [];

  try {
    var result = AdsApp.search(query);
    while (result.hasNext()) {
      var row = result.next();
      var costMicros   = row.metrics.costMicros || 0;
      var impressions  = parseInt(row.metrics.impressions) || 0;
      var clicks       = parseInt(row.metrics.clicks) || 0;
      var conversions  = parseFloat(row.metrics.conversions) || 0;
      var convValue    = parseFloat(row.metrics.conversionsValue) || 0;
      var spend        = costMicros / 1000000;

      if (spend === 0 && impressions === 0) continue;

      rows.push({
        campaign_id:      String(row.campaign.id),
        campaign_name:    row.campaign.name,
        campaign_status:  row.campaign.status,
        campaign_type:    row.campaign.advertisingChannelType || null,
        date:             row.segments.date,
        spend:            round(spend, 2),
        impressions:      impressions,
        clicks:           clicks,
        conversions:      conversions,
        conversion_value: round(convValue, 2),
      });
    }
  } catch (e) {
    Logger.log('Campaign query error: ' + e.message);
  }

  return rows;
}

/**
 * Query ad-level metrics (ad group → ad) for the currently-selected account.
 * Groups by ad_group_ad so each ad gets one row per day.
 */
function fetchAdMetrics(dateStart, dateEnd) {
  var query = [
    'SELECT',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  ad_group_ad.ad.id,',
    '  ad_group_ad.ad.name,',
    '  ad_group_ad.ad.type,',
    '  ad_group_ad.status,',
    '  segments.date,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.conversions,',
    '  metrics.conversions_value',
    'FROM ad_group_ad',
    'WHERE ad_group_ad.status != \'REMOVED\'',
    '  AND metrics.impressions > 0',
    '  AND segments.date BETWEEN \'' + dateStart + '\' AND \'' + dateEnd + '\'',
    'ORDER BY segments.date DESC',
  ].join(' ');

  var rows = [];

  try {
    var result = AdsApp.search(query);
    while (result.hasNext()) {
      var row = result.next();
      var costMicros  = row.metrics.costMicros || 0;
      var impressions = parseInt(row.metrics.impressions) || 0;
      var clicks      = parseInt(row.metrics.clicks) || 0;
      var conversions = parseFloat(row.metrics.conversions) || 0;
      var convValue   = parseFloat(row.metrics.conversionsValue) || 0;
      var spend       = costMicros / 1000000;

      if (spend === 0 && impressions === 0) continue;

      rows.push({
        campaign_id:      String(row.campaign.id),
        campaign_name:    row.campaign.name,
        ad_group_id:      String(row.adGroup.id),
        ad_group_name:    row.adGroup.name,
        ad_id:            String(row.adGroupAd.ad.id),
        ad_name:          row.adGroupAd.ad.name || '',
        ad_type:          row.adGroupAd.ad.type || '',
        ad_status:        row.adGroupAd.status || '',
        date:             row.segments.date,
        spend:            round(spend, 2),
        impressions:      impressions,
        clicks:           clicks,
        conversions:      conversions,
        conversion_value: round(convValue, 2),
      });
    }
  } catch (e) {
    // Ad-level query is best-effort — log but don't fail the whole account
    Logger.log('Ad query error (non-fatal): ' + e.message);
  }

  return rows;
}

// ── HTTP push ─────────────────────────────────────────────────────────────────

function pushData(accountId, campaignRows, adRows) {
  // Build the full payload including both campaign and ad rows
  var fullPayload = {
    account_id: accountId,
    rows:       campaignRows,
  };
  if (adRows && adRows.length > 0) {
    fullPayload.ad_rows = adRows;
  }

  // Split into batches based on campaign rows (ad rows go in the first batch)
  for (var i = 0; i < campaignRows.length; i += CONFIG.BATCH_SIZE) {
    var batchPayload = {
      account_id: accountId,
      rows: campaignRows.slice(i, i + CONFIG.BATCH_SIZE),
    };

    // Include all ad_rows with the first campaign batch only
    if (i === 0 && adRows && adRows.length > 0) {
      // Send ad rows in their own separate batches
      for (var j = 0; j < adRows.length; j += CONFIG.BATCH_SIZE) {
        var adBatch = {
          account_id: accountId,
          rows: [],  // no campaign rows in ad-only batches
          ad_rows: adRows.slice(j, j + CONFIG.BATCH_SIZE),
        };
        // Only include campaign rows in the first batch
        if (j === 0) {
          adBatch.rows = batchPayload.rows;
        }
        postBatch(adBatch);
        if (j + CONFIG.BATCH_SIZE < adRows.length) {
          Utilities.sleep(200);
        }
      }
    } else if (i > 0) {
      // Subsequent campaign batches (no ad rows)
      postBatch(batchPayload);
    }

    if (i + CONFIG.BATCH_SIZE < campaignRows.length) {
      Utilities.sleep(200);
    }
  }

  // Handle case where there are no campaign rows but there are ad rows
  if (campaignRows.length === 0 && adRows && adRows.length > 0) {
    for (var k = 0; k < adRows.length; k += CONFIG.BATCH_SIZE) {
      postBatch({
        account_id: accountId,
        rows: [],
        ad_rows: adRows.slice(k, k + CONFIG.BATCH_SIZE),
      });
      if (k + CONFIG.BATCH_SIZE < adRows.length) Utilities.sleep(200);
    }
  }
}

function postBatch(payload) {
  var options = {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(payload),
    headers: {
      'x-ingest-secret': CONFIG.INGEST_SECRET,
    },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(CONFIG.INGEST_URL, options);
  var code = response.getResponseCode();

  if (code !== 200) {
    throw new Error(
      'Ingest HTTP ' + code + ': ' + response.getContentText().substring(0, 200)
    );
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function buildDateRange(days) {
  var end = new Date();
  end.setDate(end.getDate() - 1); // yesterday

  var start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  return {
    start: formatDate(start),
    end:   formatDate(end),
  };
}

function formatDate(date) {
  return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function round(value, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
