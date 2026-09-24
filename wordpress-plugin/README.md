# WordPress site plugins

Small PHP files that get installed on **client** WordPress sites, not on this app.

## `rank-math-rest-meta.php`

Makes Rank Math's SEO fields writable over the REST API.

### The problem it solves

Rank Math stores its SEO title, meta description, focus keyword and canonical URL as ordinary post
meta, but it never registers those keys with `show_in_rest`. WordPress only accepts a `meta` key
that has been registered — anything else is **discarded without comment**, and the request still
answers `200` with a complete post object.

So a push looks entirely successful and sets nothing. We measured this on a live client post: the
push returned 200, the post appeared correctly, and the SEO title was never stored.

Rank Math's own REST namespace (`rankmath/v1`) is read-only — `getHead` returns already-rendered
tags. There is no official endpoint for writing these fields, so registering the meta on the site
is the supported route.

### Installing

Copy the file to `wp-content/mu-plugins/` on the client site, creating the folder if it does not
exist. Must-use plugins load automatically and cannot be deactivated by accident, which is what
you want for something the publishing pipeline depends on.

It also works as a normal plugin in `wp-content/plugins/` if you would rather activate it
explicitly.

No configuration. Nothing runs on the front end, and it adds no queries to a page load.

### Verifying it worked

Push any post from the dashboard. If the fields still don't stick, the dashboard records an
activity-log entry — action `seo_meta_not_stored` — naming each field that was dropped. No entry
means every field was stored.

### Security

Registration does not widen access. Writes still pass the REST post controller's own permission
check, and the `auth_callback` adds a second gate requiring `edit_post` on that specific post. An
application password with no editing rights gains nothing from this plugin.

### Custom post types

Posts, pages, and WooCommerce products are covered automatically. For a custom type, add to the
filter from another plugin or the theme's `functions.php`:

```php
add_filter( 'crd_rank_math_rest_post_types', function ( $types ) {
    $types[] = 'case_study';
    return $types;
} );
```
