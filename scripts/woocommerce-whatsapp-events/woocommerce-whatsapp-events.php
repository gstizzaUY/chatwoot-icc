<?php
/*
Plugin Name: WooCommerce WhatsApp Events
Description: Envía pedidos pagados a un backend para notificaciones WhatsApp.
Version: 1.0.0
Author: Guillermo Stizza
*/

if (!defined('ABSPATH')) {
    exit;
}

define('WWE_PATH', plugin_dir_path(__FILE__));

require_once WWE_PATH . 'includes/class-whatsapp-events.php';

new WhatsAppEvents();