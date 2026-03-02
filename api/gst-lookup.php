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

// Accept POST with JSON body
$input = json_decode(file_get_contents("php://input"), true);
if (!$input || !is_array($input)) $input = [];

$gstin = trim($input["gstin"] ?? "");

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

$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

$result = null;

// ── Primary: Pinelabs GST Search API (no captcha needed) ───────
try {
    $ch = curl_init("https://www.pinelabs.com/api/gst-number-search");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(["gstin" => $gstin]),
        CURLOPT_HTTPHEADER     => [
            "Content-Type: application/json",
            "Accept: application/json",
            "Referer: https://www.pinelabs.com/gst-number-search",
            "Origin: https://www.pinelabs.com",
        ],
        CURLOPT_USERAGENT      => $ua,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($ch);
    $curlErr  = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response !== false && !$curlErr && $httpCode === 200 && $response) {
        $d = json_decode($response, true);

        // Handle Pinelabs response format
        $gstData = $d["data"] ?? $d;

        if (!empty($gstData) && is_array($gstData)) {
            $tradeName = trim(
                $gstData["tradeName"] ?? $gstData["trade_name"] ?? $gstData["tradeNam"] ?? ""
            );
            $legalName = trim(
                $gstData["legalNameOfBusiness"] ?? $gstData["legal_name"] ?? $gstData["lgnm"] ?? ""
            );
            $address = trim(
                $gstData["principalPlaceAddress"] ?? $gstData["address"] ?? ""
            );
            // Try nested address object
            if ($address === '' && isset($gstData["pradr"])) {
                $addr = $gstData["pradr"]["addr"] ?? $gstData["pradr"] ?? [];
                $addrParts = array_filter([
                    $addr["bno"]  ?? "", $addr["bnm"]  ?? "",
                    $addr["flno"] ?? "", $addr["st"]   ?? "",
                    $addr["loc"]  ?? "",
                ]);
                $address = !empty($gstData["pradr"]["adr"])
                    ? $gstData["pradr"]["adr"]
                    : implode(", ", $addrParts);
            }

            $state = trim(
                $gstData["state"] ?? $gstData["stateJurisdiction"] ?? ""
            );
            if ($state === '' && isset($gstData["pradr"]["addr"]["stcd"])) {
                $state = $gstData["pradr"]["addr"]["stcd"];
            }
            if ($state === '') $state = $stateName;

            $city = trim($gstData["city"] ?? "");
            if ($city === '' && isset($gstData["pradr"]["addr"])) {
                $addr = $gstData["pradr"]["addr"];
                $city = trim($addr["dst"] ?? $addr["loc"] ?? $addr["city"] ?? "");
            }
            // Try extracting city from address object
            if ($city === '' && isset($gstData["address"]) && is_array($gstData["address"])) {
                $city = trim($gstData["address"]["city"] ?? $gstData["address"]["district"] ?? "");
            }

            $pincode = trim($gstData["pincode"] ?? "");
            if ($pincode === '' && isset($gstData["pradr"]["addr"]["pncd"])) {
                $pincode = $gstData["pradr"]["addr"]["pncd"];
            }
            if ($pincode === '' && isset($gstData["address"]) && is_array($gstData["address"])) {
                $pincode = trim($gstData["address"]["pincode"] ?? "");
            }

            $nature = $gstData["natureOfBusiness"] ?? $gstData["nature"] ?? $gstData["ntr"] ?? "";
            if (is_array($nature)) $nature = implode(", ", $nature);

            $businessType = trim(
                $gstData["constitutionOfBusiness"] ?? $gstData["business_type"] ?? $gstData["ctb"] ?? ""
            );

            $status = trim(
                $gstData["gstnStatus"] ?? $gstData["status"] ?? $gstData["sts"] ?? ""
            );

            if ($tradeName || $legalName || $address) {
                $result = [
                    "trade_name"    => $tradeName,
                    "legal_name"    => $legalName,
                    "address"       => $address,
                    "state"         => $state,
                    "pincode"       => $pincode,
                    "city"          => $city,
                    "business_type" => $businessType,
                    "status"        => $status,
                    "nature"        => $nature,
                ];
            }
        }
    }
} catch (Throwable $e) {
    // Fall through to fallback
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
