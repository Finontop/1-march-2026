<?php
ob_start();
ini_set("display_errors", 0);
error_reporting(0);

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    ob_end_clean(); echo json_encode(["success" => true]); exit;
}

function respond($d) { ob_end_clean(); echo json_encode($d); exit; }

session_start();

// Generate a unique token for this captcha request
$token = bin2hex(random_bytes(16));

// Create a unique cookie jar file keyed by token
$cookieJar = sys_get_temp_dir() . '/gst_captcha_' . $token . '.txt';

$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Step 1: Hit the search page to initialise cookies on the GST portal
$ch = curl_init("https://services.gst.gov.in/services/searchtp");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_USERAGENT      => $ua,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_COOKIEJAR      => $cookieJar,
    CURLOPT_COOKIEFILE     => $cookieJar,
]);
curl_exec($ch);
$initCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($initCode < 200 || $initCode >= 400) {
    respond(["success" => false, "error" => "Could not reach GST portal"]);
}

// Step 2: Fetch the captcha image using the same cookie jar
$ch = curl_init("https://services.gst.gov.in/services/captcha");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_USERAGENT      => $ua,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_COOKIEJAR      => $cookieJar,
    CURLOPT_COOKIEFILE     => $cookieJar,
    CURLOPT_HTTPHEADER     => [
        "Referer: https://services.gst.gov.in/services/searchtp",
        "Accept: image/png,image/*,*/*",
    ],
]);
$captchaRaw = curl_exec($ch);
$captchaCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($captchaCode !== 200 || !$captchaRaw) {
    respond(["success" => false, "error" => "Could not fetch captcha"]);
}

// Store the cookie jar path in the session for the lookup step (fallback)
$_SESSION['gst_cookie_jar'] = $cookieJar;

respond([
    "success" => true,
    "captcha" => "data:image/png;base64," . base64_encode($captchaRaw),
    "token"   => $token,
]);
?>
