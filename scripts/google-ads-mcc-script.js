/**
 * Google Ads MCC Script — Campaign Metrics Sync
 * ─────────────────────────────────────────────
 * Runs at the MCC (Manager Account) level and pushes daily campaign
 * performance data for ALL sub-accounts to your reporting dashboard.
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
 * ACCOUNTS
 * ────────
 * By default the script syncs ALL sub-accounts under the MCC.
 * To restrict to specific accounts, add their customer IDs (digits only,
 * no dashes) to ACCOUNT_ALLOWLIST. Leave empty to sync all.
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

  // ── Batch size ────────────────────────────────────────────────────────────
  // Rows per POST request. Keep under 500 to stay well within UrlFetch limits.
  BATCH_SIZE: 300,
};

// ─────────────────────────────────────────────────────────────────────────────

function main() {
  var days = CONFIG.IS_BACKFILL ? CONFIG.BACKFILL_DAYS : CONFIG.INCREMENTAL_DAYS;
  var dates = buildDateRange(days);

  Logger.log('Sync mode: ' + (CONFIG.IS_BACKFILL ? 'BACKFILL' : 'INCREMENTAL') +
             ' | Date range: ' + dates.start + ' → ' + dates.end);

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
      var rows = fetchCampaignMetrics(dates.start, dates.end);
      if (rows.length === 0) {
        Logger.log('[' + customerId + '] No data for range — skipping');
        continue;
      }

      pushRows(customerIdClean, rows);
      synced++;
      Logger.log('[' + customerId + '] Pushed ' + rows.length + ' rows');
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
 * Uses GAQL (Google Ads Query Language) via AdsApp.search().
 */
function fetchCampaignMetrics(dateStart, dateEnd) {
  var query = [
    'SELECT',
    '  campaign.id,',
    '  campaign.name,',
    '  campaign.status,',
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
      var costMicros = row.metrics.costMicros || 0;
      var impressions = parseInt(row.metrics.impressions) || 0;
      var clicks = parseInt(row.metrics.clicks) || 0;
      var conversions = parseFloat(row.metrics.conversions) || 0;
      var conversionValue = parseFloat(row.metrics.conversionsValue) || 0;
      var spend = costMicros / 1000000;

      // Skip rows where nothing happened (no spend AND no impressions)
      if (spend === 0 && impressions === 0) continue;

      rows.push({
        campaign_id:      String(row.campaign.id),
        campaign_name:    row.campaign.name,
        date:             row.segments.date,   // already YYYY-MM-DD from GAQL
        spend:            round(spend, 2),
        impressions:      impressions,
        clicks:           clicks,
        conversions:      conversions,
        conversion_value: round(conversionValue, 2),
      });
    }
  } catch (e) {
    // If account has no campaigns yet the query may throw — log and return empty
    Logger.log('Query error: ' + e.message);
  }

  return rows;
}

// ── HTTP push ─────────────────────────────────────────────────────────────────

function pushRows(accountId, allRows) {
  for (var i = 0; i < allRows.length; i += CONFIG.BATCH_SIZE) {
    var batch = allRows.slice(i, i + CONFIG.BATCH_SIZE);
    var payload = JSON.stringify({
      account_id: accountId,
      rows: batch,
    });

    var options = {
      method:             'post',
      contentType:        'application/json',
      payload:            payload,
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

    // Brief pause between batches to be a good API citizen
    if (i + CONFIG.BATCH_SIZE < allRows.length) {
      Utilities.sleep(200);
    }
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns { start, end } as YYYY-MM-DD strings.
 * End date is always yesterday — today's data is incomplete until Google
 * finishes processing, typically by 06:00 in the account timezone.
 */
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
