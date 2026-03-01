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

// Try fetching from public GST API
$apiUrl = "https://sheet.best/api/sheets/1599c0e3-3b7c-4c05-940a-082adea327d6/GSTIN/" . urlencode($gstin);
$result = null;

try {
    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => ["Accept: application/json"],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        if (is_array($data) && count($data) > 0) {
            $result = $data[0];
        }
    }
} catch (Throwable $e) {
    // Silently fall through to fallback
}

// If external API didn't return results, try a second public source
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
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && $response) {
            $data = json_decode($response, true);
            if (!empty($data["data"])) {
                $d = $data["data"];
                $result = [
                    "trade_name" => $d["tradeNam"] ?? $d["tradeName"] ?? "",
                    "legal_name" => $d["lgnm"] ?? $d["legalName"] ?? "",
                    "address"    => $d["pradr"]["adr"] ?? $d["address"] ?? "",
                    "state"      => $d["pradr"]["addr"]["stcd"] ?? $stateName,
                    "pincode"    => $d["pradr"]["addr"]["pncd"] ?? "",
                    "city"       => $d["pradr"]["addr"]["dst"] ?? "",
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
