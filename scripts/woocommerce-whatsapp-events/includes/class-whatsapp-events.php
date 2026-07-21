<?php

if (!defined('ABSPATH')) {
    exit;
}

class WhatsAppEvents
{
    const OPTION_API_URL = 'wwe_api_url';
    const OPTION_API_KEY = 'wwe_api_key';

    public function __construct()
    {
        add_action(
            'woocommerce_payment_complete',
            [$this, 'sendPaidOrder']
        );

        add_action(
            'admin_menu',
            [$this, 'settingsPage']
        );

        add_action(
            'admin_init',
            [$this, 'registerSettings']
        );
    }

    public function registerSettings()
    {
        register_setting('wwe_settings', self::OPTION_API_URL);
        register_setting('wwe_settings', self::OPTION_API_KEY);
    }

    public function settingsPage()
    {
        add_options_page(
            'WhatsApp Events',
            'WhatsApp Events',
            'manage_options',
            'wwe-settings',
            [$this, 'renderSettings']
        );
    }

    public function renderSettings()
    {
        ?>
        <div class="wrap">
            <h1>WhatsApp Events</h1>

            <form method="post" action="options.php">

                <?php settings_fields('wwe_settings'); ?>

                <table class="form-table">

                    <tr>
                        <th>Backend URL</th>
                        <td>
                            <input
                                type="text"
                                name="wwe_api_url"
                                value="<?php echo esc_attr(get_option('wwe_api_url')); ?>"
                                size="80">
                        </td>
                    </tr>

                    <tr>
                        <th>API Key</th>
                        <td>
                            <input
                                type="text"
                                name="wwe_api_key"
                                value="<?php echo esc_attr(get_option('wwe_api_key')); ?>"
                                size="80">
                        </td>
                    </tr>

                </table>

                <?php submit_button(); ?>

            </form>
        </div>
        <?php
    }

    public function sendPaidOrder($order_id)
    {
        if (get_post_meta($order_id, '_wa_sent', true)) {
            return;
        }

        $order = wc_get_order($order_id);

        if (!$order) {
            return;
        }

        $items = [];

        foreach ($order->get_items() as $item) {

            $items[] = [
                'product_id' => $item->get_product_id(),
                'name' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'total' => $item->get_total()
            ];
        }

        $payload = [
            'event' => 'order_paid',

            'store' => [
                'name' => get_bloginfo('name'),
                'url' => home_url()
            ],

            'order' => [
                'id' => $order->get_id(),
                'number' => $order->get_order_number(),
                'status' => $order->get_status(),
                'currency' => $order->get_currency(),
                'total' => $order->get_total()
            ],

            'customer' => [
                'name' => trim(
                    $order->get_billing_first_name() .
                    ' ' .
                    $order->get_billing_last_name()
                ),
                'email' => $order->get_billing_email(),
                'phone' => preg_replace(
                    '/\D/',
                    '',
                    $order->get_billing_phone()
                )
            ],

            'items' => $items,

            'created_at' => current_time('mysql')
        ];

        $response = wp_remote_post(
            get_option(self::OPTION_API_URL),
            [
                'timeout' => 20,
                'headers' => [
                    'Content-Type' => 'application/json',
                    'Authorization' =>
                        'Bearer ' .
                        get_option(self::OPTION_API_KEY)
                ],
                'body' => wp_json_encode($payload)
            ]
        );

        if (!is_wp_error($response)) {

            update_post_meta(
                $order_id,
                '_wa_sent',
                1
            );
        }
    }
}