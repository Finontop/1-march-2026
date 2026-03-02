<?php
ob_start();
ini_set("display_errors", 0);
error_reporting(0);

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    ob_end_clean(); echo json_encode(["success" => true]); exit;
}

function respond($d) { ob_end_clean(); echo json_encode($d); exit; }

// Accept POST with JSON body (stateless cookie transfer)
$input = json_decode(file_get_contents("php://input"), true);

$gstin        = trim($input["gstin"]        ?? $_GET["gstin"]   ?? "");
$captcha      = trim($input["captcha"]      ?? $_GET["captcha"] ?? "");
$token        = trim($input["token"]        ?? $_GET["token"]   ?? "");
$sessionData  = trim($input["session_data"] ?? "");

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
    // Restore cookie jar from session_data sent by the frontend (stateless approach)
    $cookieJar = '';
    if ($sessionData !== '') {
        $cookieContent = @base64_decode($sessionData, true);
        if ($cookieContent !== false && strlen($cookieContent) > 0) {
            $safeToken = ($token !== '' && preg_match('/^[a-f0-9]{32}$/', $token)) ? $token : bin2hex(random_bytes(16));
            $cookieJar = sys_get_temp_dir() . '/gst_captcha_' . $safeToken . '.txt';
            @file_put_contents($cookieJar, $cookieContent);
        }
    }

    // Fallback: try token-based temp file (in case it still exists)
    if (!$cookieJar && $token !== '' && preg_match('/^[a-f0-9]{32}$/', $token)) {
        $tokenJar = sys_get_temp_dir() . '/gst_captcha_' . $token . '.txt';
        if (file_exists($tokenJar)) {
            $cookieJar = $tokenJar;
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
                @unlink($cookieJar);
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
                    @unlink($cookieJar);
                    respond(["success" => false, "error" => $d["message"] ?? "Captcha incorrect or GSTIN not found"]);
                } elseif (!empty($d["error"])) {
                    @unlink($cookieJar);
                    respond(["success" => false, "error" => $d["error"]]);
                }
            } elseif ($httpCode >= 400) {
                @unlink($cookieJar);
                respond(["success" => false, "error" => "GST portal returned HTTP $httpCode"]);
            }
        } catch (Throwable $e) {
            // Fall through to state-only fallback
        }
        // Clean up cookie jar
        @unlink($cookieJar);
    } else {
        // No cookie data available — captcha session expired
        respond(["success" => false, "error" => "Captcha session expired. Please refresh the captcha and try again."]);
    }
}

// Return whatever we have
if ($result) {
    respond([
        "success"       => true,
        "gstin"         => $gstin,
        "trade_name"    => $result["trade_name"]    ?? $result["TradeName"]    ?? "",
        "legal_name"    => $result["legal_name"]    ?? $result["LegalName"]    ?? "",
        "address"       => $result["address"]       ?? $result["Address"]      ?? "",
        "city"          => $result["city"]           ?? $result["City"]         ?? "",
        "state"         => $result["state"]          ?? $result["State"]        ?? $stateName,
        "pincode"       => $result["pincode"]        ?? $result["Pincode"]      ?? "",
        "business_type" => $result["business_type"]  ?? $result["BusinessType"] ?? "",
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
