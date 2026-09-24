<?php
/**
 * Plugin Name: Rank Math REST Meta
 * Description: Makes Rank Math's SEO title, description, focus keyword and canonical URL writable over the WordPress REST API. Without this, WordPress accepts those fields and silently discards them.
 * Version:     1.0.0
 * Author:      Client Reporting Dashboard
 * License:     GPL-2.0-or-later
 *
 * WHY THIS EXISTS
 *
 * Rank Math stores its SEO fields as ordinary post meta, but it never registers those keys for
 * REST writes. WordPress only accepts a `meta` key that has been registered with
 * `show_in_rest => true`; anything else is dropped without comment — and the request still answers
 * 200 with a complete post object. A push therefore looks perfect and sets nothing.
 *
 * Rank Math's own REST namespace (rankmath/v1) is read-only — `getHead` returns rendered tags.
 * There is no official write endpoint, so registering the meta ourselves is the supported route.
 *
 * SECURITY
 *
 * Registration alone does not widen access. Every write still passes through the REST post
 * controller's own permission check, and `auth_callback` below adds a second gate: the caller must
 * be able to edit that specific post. An application password with no editing rights gains
 * nothing from this plugin.
 *
 * INSTALLING
 *
 * Drop this file in wp-content/mu-plugins/ (create the folder if it doesn't exist). Must-use
 * plugins load automatically and cannot be deactivated by accident, which is what you want for
 * something the publishing pipeline depends on. It also works as a normal plugin in
 * wp-content/plugins/ if you'd rather activate it explicitly.
 *
 * Nothing here runs on the front end, and it adds no queries to a page load.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Post types that get the SEO fields.
 *
 * Filterable so a site with a custom type — case studies, locations — can opt in without editing
 * this file:
 *
 *     add_filter( 'crd_rank_math_rest_post_types', function ( $types ) {
 *         $types[] = 'case_study';
 *         return $types;
 *     } );
 */
function crd_rank_math_rest_post_types() {
	$types = array( 'post', 'page' );

	// WooCommerce products carry the same Rank Math fields.
	if ( post_type_exists( 'product' ) ) {
		$types[] = 'product';
	}

	return (array) apply_filters( 'crd_rank_math_rest_post_types', $types );
}

/**
 * Can the current user write SEO meta on this post?
 *
 * Mirrors what the block editor requires: rights over that exact post, not a blanket capability.
 * WordPress passes the post id as $object_id for post meta.
 *
 * @param bool   $allowed   Whether the user can add/edit the meta. Unused; recomputed here.
 * @param string $meta_key  Meta key being written.
 * @param int    $object_id Post ID.
 * @return bool
 */
function crd_rank_math_rest_auth( $allowed, $meta_key, $object_id ) {
	if ( empty( $object_id ) ) {
		return false;
	}

	return current_user_can( 'edit_post', (int) $object_id );
}

/**
 * Sanitizers with an explicit arity.
 *
 * WordPress invokes a sanitize_callback with three arguments (value, meta key, object type). Passing
 * a core function directly therefore hands it the meta key as its second parameter — harmless for
 * sanitize_text_field, and for esc_url_raw only because esc_url happens to check is_array() on the
 * protocols it is given. These wrappers take the value and nothing else, so none of that matters.
 */
function crd_rank_math_sanitize_text( $value ) {
	return sanitize_text_field( $value );
}

function crd_rank_math_sanitize_url( $value ) {
	return esc_url_raw( $value );
}

/**
 * Register the four Rank Math fields for REST reads and writes.
 *
 * Runs on `init` rather than `rest_api_init` so the registration is also in place for the block
 * editor and for WP-CLI, not only for REST requests.
 */
function crd_rank_math_register_rest_meta() {
	$fields = array(
		'rank_math_title' => array(
			'description' => 'Rank Math SEO title',
			'sanitize'    => 'crd_rank_math_sanitize_text',
		),
		'rank_math_description' => array(
			'description' => 'Rank Math meta description',
			'sanitize'    => 'crd_rank_math_sanitize_text',
		),
		'rank_math_focus_keyword' => array(
			'description' => 'Rank Math focus keyword',
			'sanitize'    => 'crd_rank_math_sanitize_text',
		),
		'rank_math_canonical_url' => array(
			'description' => 'Rank Math canonical URL',
			'sanitize'    => 'crd_rank_math_sanitize_url',
		),
	);

	foreach ( crd_rank_math_rest_post_types() as $post_type ) {
		foreach ( $fields as $meta_key => $config ) {
			register_post_meta(
				$post_type,
				$meta_key,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => true,
					'description'       => $config['description'],
					'sanitize_callback' => $config['sanitize'],
					'auth_callback'     => 'crd_rank_math_rest_auth',
				)
			);
		}
	}
}
add_action( 'init', 'crd_rank_math_register_rest_meta' );
