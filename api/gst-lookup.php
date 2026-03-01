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

$gstin = trim($_GET["gstin"] ?? "");

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

// ── Primary: Official GST Portal API (services.gst.gov.in) ─────
$result = null;

try {
    $govUrl = "https://services.gst.gov.in/services/api/search/taxpayerByGstin/" . urlencode($gstin);
    $ch = curl_init($govUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => [
            "Accept: application/json",
            "Content-Type: application/json",
        ],
        CURLOPT_USERAGENT      => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $d = json_decode($response, true);
        if (!empty($d) && !empty($d["gstin"])) {
            // Build full address from addr sub-fields
            $addr = $d["pradr"]["addr"] ?? [];
            $addrParts = array_filter([
                $addr["bno"] ?? "",   // building number
                $addr["bnm"] ?? "",   // building name
                $addr["flno"] ?? "",  // floor number
                $addr["st"] ?? "",    // street
                $addr["loc"] ?? "",   // locality
            ]);
            $fullAddress = !empty($d["pradr"]["adr"])
                ? $d["pradr"]["adr"]
                : implode(", ", $addrParts);

            $result = [
                "trade_name"    => $d["tradeNam"] ?? "",
                "legal_name"    => $d["lgnm"] ?? "",
                "address"       => $fullAddress,
                "state"         => $addr["stcd"] ?? $stateName,
                "pincode"       => $addr["pncd"] ?? "",
                "city"          => $addr["dst"] ?? $addr["loc"] ?? "",
                "business_type" => $d["ctb"] ?? "",
                "status"        => $d["sts"] ?? "",
                "nature"        => $d["pradr"]["ntr"] ?? "",
            ];
        }
    }
} catch (Throwable $e) {
    // Silently fall through to fallback
}

// ── Secondary: Masters India public API (fallback) ─────────────
if (!$result) {
    try {
        $altUrl = "https://commonapi.mastersindia.co/commonapis/searchgstin?gstin=" . urlencode($gstin);
        $ch = curl_init($altUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => [
                "Accept: application/json",
                "Content-Type: application/json",
            ],
            CURLOPT_USERAGENT      => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && $response) {
            $data = json_decode($response, true);
            $d = $data["data"] ?? $data ?? null;
            if (!empty($d) && (!empty($d["tradeNam"]) || !empty($d["lgnm"]) || !empty($d["tradeName"]) || !empty($d["legalName"]))) {
                $result = [
                    "trade_name"    => $d["tradeNam"] ?? $d["tradeName"] ?? "",
                    "legal_name"    => $d["lgnm"] ?? $d["legalName"] ?? "",
                    "address"       => $d["pradr"]["adr"] ?? $d["address"] ?? "",
                    "state"         => $d["pradr"]["addr"]["stcd"] ?? $stateName,
                    "pincode"       => $d["pradr"]["addr"]["pncd"] ?? "",
                    "city"          => $d["pradr"]["addr"]["dst"] ?? "",
                    "business_type" => $d["ctb"] ?? $d["constitutionOfBusiness"] ?? "",
                ];
            }
        }
    } catch (Throwable $e) {
        // Silently fall through to fallback
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
