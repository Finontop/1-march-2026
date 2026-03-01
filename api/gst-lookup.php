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

$gstin   = trim($_GET["gstin"]   ?? "");
$captcha = trim($_GET["captcha"] ?? "");
$token   = trim($_GET["token"]   ?? "");

// Validate GSTIN format: 15-char alphanumeric
if (!$gstin || !preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/', $gstin)) {
    respond(["success" => false, "error" => "Invalid GSTIN format"]);
}

// GST state code map
$gstStates = [
    '01' => 'Jammu & Kashmir', '02' => 'Himachal Pradesh', '03' => 'Punjab',
    '04' => 'Chandigarh', '05' => 'Uttarakhand', '06' => 'Haryana',
    '07' => 'Delhi', '08' => 'Rajasthan', '09' => 'Uttar Pradesh',
    '10' => 'Bihar', '11' => 'Sikkim', '12' => 'Arunachal Pradesh',
    '13' => 'Nagaland', '14' => 'Manipur', '15' => 'Mizoram',
    '16' => 'Tripura', '17' => 'Meghalaya', '18' => 'Assam',
    '19' => 'West Bengal', '20' => 'Jharkhand', '21' => 'Odisha',
    '22' => 'Chhattisgarh', '23' => 'Madhya Pradesh', '24' => 'Gujarat',
    '25' => 'Daman & Diu', '26' => 'Dadra & Nagar Haveli', '27' => 'Maharashtra',
    '28' => 'Andhra Pradesh', '29' => 'Karnataka', '30' => 'Goa',
    '31' => 'Lakshadweep', '32' => 'Kerala', '33' => 'Tamil Nadu',
    '34' => 'Puducherry', '35' => 'Andaman & Nicobar',
    '36' => 'Telangana', '37' => 'Andhra Pradesh', '38' => 'Ladakh'
];

$stateCode = substr($gstin, 0, 2);
$stateName = $gstStates[$stateCode] ?? '';

$result = null;

// ── Primary: Official GST Portal API with captcha session ──────
if ($captcha !== '') {
    // Try token-based cookie jar first, fall back to session
    $cookieJar = '';
    if ($token !== '' && preg_match('/^[a-f0-9]{32}$/', $token)) {
        $tokenJar = sys_get_temp_dir() . '/gst_captcha_' . $token . '.txt';
        if (file_exists($tokenJar)) {
            $cookieJar = $tokenJar;
        }
    }
    if (!$cookieJar) {
        $cookieJar = $_SESSION['gst_cookie_jar'] ?? '';
    }

    // If temp file cookie jar is gone, try restoring from session backup
    if ($cookieJar && !file_exists($cookieJar)) {
        $backupData  = $_SESSION['gst_cookies_data']  ?? '';
        $backupToken = $_SESSION['gst_cookies_token']  ?? '';
        if ($backupData && $backupToken === $token) {
            @file_put_contents($cookieJar, $backupData);
        }
    }

    if ($cookieJar && file_exists($cookieJar)) {
        try {
            $postData = json_encode(["gstin" => $gstin, "captcha" => $captcha]);
            $ch = curl_init("https://services.gst.gov.in/services/api/search/taxpayerDetails");
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 15,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $postData,
                CURLOPT_HTTPHEADER     => [
                    "Content-Type: application/json",
                    "Accept: application/json",
                    "Referer: https://services.gst.gov.in/services/searchtp",
                ],
                CURLOPT_USERAGENT      => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_COOKIEJAR      => $cookieJar,
                CURLOPT_COOKIEFILE     => $cookieJar,
            ]);
            $response = curl_exec($ch);
            $curlErr   = curl_error($ch);
            $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($response === false || $curlErr) {
                // Clean up and report the curl error
                @unlink($cookieJar);
                unset($_SESSION['gst_cookie_jar'], $_SESSION['gst_cookies_data'], $_SESSION['gst_cookies_token']);
                respond(["success" => false, "error" => "GST portal request failed: " . ($curlErr ?: "connection error")]);
            }

            if ($httpCode === 200 && $response) {
                $d = json_decode($response, true);
                if (!empty($d) && !empty($d["gstin"])) {
                    $addr = $d["pradr"]["addr"] ?? [];
                    $addrParts = array_filter([
                        $addr["bno"]  ?? "",
                        $addr["bnm"]  ?? "",
                        $addr["flno"] ?? "",
                        $addr["st"]   ?? "",
                        $addr["loc"]  ?? "",
                    ]);
                    $fullAddress = !empty($d["pradr"]["adr"])
                        ? $d["pradr"]["adr"]
                        : implode(", ", $addrParts);

                    $tradeName = trim($d["tradeNam"] ?? "");
                    $legalName = trim($d["lgnm"]     ?? "");
                    $city      = trim($addr["dst"]   ?? "");
                    if ($city === '') $city = trim($addr["loc"] ?? "");
                    if ($city === '') $city = trim($addr["city"] ?? "");

                    $result = [
                        "trade_name"    => $tradeName,
                        "legal_name"    => $legalName,
                        "address"       => $fullAddress,
                        "state"         => $addr["stcd"]  ?? $stateName,
                        "pincode"       => $addr["pncd"]  ?? "",
                        "city"          => $city,
                        "business_type" => $d["ctb"]      ?? "",
                        "status"        => $d["sts"]      ?? "",
                        "nature"        => $d["ntr"]      ?? $d["pradr"]["ntr"] ?? "",
                    ];
                } elseif (!empty($d["errorCode"]) || !empty($d["message"])) {
                    // Wrong captcha or GSTIN not found — clean up and return error for UI retry
                    @unlink($cookieJar);
                    unset($_SESSION['gst_cookie_jar'], $_SESSION['gst_cookies_data'], $_SESSION['gst_cookies_token']);
                    respond(["success" => false, "error" => $d["message"] ?? "Captcha incorrect or GSTIN not found"]);
                } elseif (!empty($d["error"])) {
                    @unlink($cookieJar);
                    unset($_SESSION['gst_cookie_jar'], $_SESSION['gst_cookies_data'], $_SESSION['gst_cookies_token']);
                    respond(["success" => false, "error" => $d["error"]]);
                }
            } elseif ($httpCode >= 400) {
                @unlink($cookieJar);
                unset($_SESSION['gst_cookie_jar'], $_SESSION['gst_cookies_data'], $_SESSION['gst_cookies_token']);
                respond(["success" => false, "error" => "GST portal returned HTTP $httpCode"]);
            }
        } catch (Throwable $e) {
            // Fall through to state-only fallback
        }
        // Clean up cookie jar
        @unlink($cookieJar);
        unset($_SESSION['gst_cookie_jar'], $_SESSION['gst_cookies_data'], $_SESSION['gst_cookies_token']);
    } else {
        // Cookie jar file was missing — captcha session expired
        respond(["success" => false, "error" => "Captcha session expired. Please refresh the captcha and try again."]);
    }
}

// Return whatever we have
if ($result) {
    respond([
        "success"       => true,
        "gstin"         => $gstin,
        "trade_name"    => $result["trade_name"]    ?? "",
        "legal_name"    => $result["legal_name"]    ?? "",
        "address"       => $result["address"]       ?? "",
        "city"          => $result["city"]           ?? "",
        "state"         => $result["state"]          ?? $stateName,
        "pincode"       => $result["pincode"]        ?? "",
        "business_type" => $result["business_type"]  ?? "",
        "status"        => $result["status"]         ?? "",
        "nature"        => $result["nature"]         ?? "",
    ]);
}

// Fallback: return state from GST code at minimum
respond([
    "success"    => true,
    "gstin"      => $gstin,
    "trade_name" => "",
    "legal_name" => "",
    "address"    => "",
    "city"       => "",
    "state"      => $stateName,
    "pincode"    => "",
    "business_type" => "",
    "fallback"   => true,
]);
?>
