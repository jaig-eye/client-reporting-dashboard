<?php
/**
 * Plugin Name: LaunchLocal — Site Settings
 * Description: A single `site_settings` record holding company facts (NAP, hours, services,
 *              proof), surfaced across the site via Kadence dynamic fields (mb_meta|<key>).
 *              Drop in wp-content/mu-plugins/. Seed the single record with the WP-CLI snippet
 *              at the bottom (run once via `wp eval-file`).
 *
 * Convention: a page references a fact with a Kadence dynamic-field span, e.g.
 *   <span data-field="post|post_custom_field" data-para="mb_meta|phone"
 *         class="kb-inline-dynamic">(000) 000-0000</span>
 * bound to THIS settings post (set the block's Dynamic source to the settings post ID).
 */

if (!defined('ABSPATH')) exit;

// ── 1. Register the CPT (non-public, single record we edit in wp-admin) ──────────
add_action('init', function () {
    register_post_type('site_settings', [
        'label'        => 'Site Settings',
        'public'       => false,
        'show_ui'      => true,
        'show_in_menu' => true,
        'show_in_rest' => true,               // so we can upsert via REST/WP-CLI
        'menu_icon'    => 'dashicons-store',
        'supports'     => ['title', 'custom-fields'],
        'capability_type' => 'page',
        'menu_position'   => 3,
    ]);
});

// ── 2. MetaBox field group (the company facts) ──────────────────────────────────
add_filter('rwmb_meta_boxes', function ($meta_boxes) {
    $meta_boxes[] = [
        'title'      => 'Company Info',
        'id'         => 'company_info',
        'post_types' => ['site_settings'],
        'context'    => 'normal',
        'fields'     => [
            ['id' => 'company_name', 'name' => 'Company Name', 'type' => 'text'],
            ['id' => 'tagline',      'name' => 'Tagline',      'type' => 'text'],
            ['id' => 'phone',        'name' => 'Phone',        'type' => 'tel'],
            ['id' => 'email',        'name' => 'Email',        'type' => 'email'],
            ['id' => 'address_line', 'name' => 'Street',       'type' => 'text'],
            ['id' => 'city',         'name' => 'City',         'type' => 'text'],
            ['id' => 'state',        'name' => 'State',        'type' => 'text'],
            ['id' => 'zip',          'name' => 'ZIP',          'type' => 'text'],
            ['id' => 'service_area', 'name' => 'Service Area', 'type' => 'text'],
            ['id' => 'hours',        'name' => 'Hours',        'type' => 'textarea'],
            ['id' => 'license_no',   'name' => 'License #',    'type' => 'text'],
            ['id' => 'years_in_business', 'name' => 'Years in Business', 'type' => 'number'],
            ['id' => 'rating',       'name' => 'Rating',       'type' => 'text'],
            ['id' => 'review_count', 'name' => 'Review Count', 'type' => 'number'],
            ['id' => 'primary_color','name' => 'Brand Color',  'type' => 'color'],
            ['id' => 'logo',         'name' => 'Logo',         'type' => 'single_image'],
            ['id' => 'facebook',     'name' => 'Facebook URL', 'type' => 'url'],
            ['id' => 'instagram',    'name' => 'Instagram URL','type' => 'url'],
            ['id' => 'google',       'name' => 'Google Profile URL', 'type' => 'url'],
            ['id' => 'yelp',         'name' => 'Yelp URL',     'type' => 'url'],
        ],
    ];
    return $meta_boxes;
});

/*
─────────────────────────────────────────────────────────────────────────────────
SEED (run once):  wp eval-file site-settings-cpt.php   OR paste into `wp eval`:

$existing = get_posts(['post_type' => 'site_settings', 'numberposts' => 1, 'fields' => 'ids']);
$id = $existing ? $existing[0]
    : wp_insert_post(['post_type' => 'site_settings', 'post_status' => 'publish', 'post_title' => 'Site Settings']);
$fields = [
    'company_name' => 'Acme Plumbing', 'phone' => '(602) 555-0142', 'email' => 'info@acme.com',
    'city' => 'Phoenix', 'state' => 'AZ', 'service_area' => 'Greater Phoenix, AZ',
    'hours' => "Mon–Fri 8–6, Sat 9–2", 'license_no' => 'ROC #123456',
    'years_in_business' => 12, 'rating' => '4.9', 'review_count' => 214,
];
foreach ($fields as $k => $v) update_post_meta($id, $k, $v);
echo "site_settings id: $id\n";
─────────────────────────────────────────────────────────────────────────────────
*/
