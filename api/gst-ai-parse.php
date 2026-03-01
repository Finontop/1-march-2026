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

if (!file_exists(__DIR__ . "/config.php"))
    respond(["success" => false, "error" => "config.php missing"]);
try { require __DIR__ . "/config.php"; }
catch (Throwable $e) { respond(["success" => false, "error" => $e->getMessage()]); }

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);
if (!$data) respond(["success" => false, "error" => "Invalid JSON"]);

$sellerId = (int)($data["seller_id"] ?? 0);
$gstRaw   = $data["gst_raw"] ?? [];

if (empty($gstRaw) || empty($gstRaw["gstin"])) {
    respond(["success" => false, "error" => "No GST data provided"]);
}

// ── Build Groq prompt ──────────────────────────────────────────
$gstJson = json_encode($gstRaw, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

$categoryOptions = "Electronics, Clothing & Apparel, Food & Restaurant, Furniture, Hardware & Tools, Medical & Pharmacy, Real Estate, Education, Salon & Beauty, Automobile, Grocery, IT Services, Printing & Packaging, Textile & Fabric, Agriculture, Chemical & Plastics, Construction, Other";
$businessTypeOptions = "Manufacturer, Wholesaler / Distributor, Retailer, Dealer, Exporter, Service Provider, Trader, Franchise";
$turnoverOptions = "Below ₹10 Lakh, ₹10L – ₹50L, ₹50L – ₹1 Crore, ₹1Cr – ₹5Cr, ₹5Cr – ₹25Cr, Above ₹25 Crore";
$employeesOptions = "1–5 (Micro), 6–20 (Small), 21–50, 51–200 (Medium), 200+ (Large)";
$deliveryOptions = "Local only (within city), Within 50 km, Within state, Pan India, International / Export";

$prompt = <<<PROMPT
You are an Indian business data expert. Given raw GST portal data for a business, extract and intelligently map the data into our onboarding form fields.

Raw GST Data:
$gstJson

Map this data into the following JSON structure. Use ONLY the exact allowed values for dropdown fields. If you cannot determine a value, use empty string "".

Required JSON output:
{
  "business_name": "<trade name from GST, NOT the proprietor/legal name>",
  "business_type": "<one of: $businessTypeOptions>",
  "category": "<one of: $categoryOptions>",
  "products_offered": "<comma-separated list of products/services this business likely deals in, inferred from the nature of business, trade name, and business type. Be specific with Indian business context. Example: 'cotton fabric, polyester cloth, readymade garments'>",
  "business_desc": "<a short 1-2 line description of what this business does, based on available info>",
  "address": "<full business address>",
  "city": "<city/district name only>",
  "state": "<full state name>",
  "pincode": "<6-digit pincode if available>",
  "gst_number": "<the GSTIN>",
  "annual_turnover": "<one of: $turnoverOptions, or empty>",
  "employees": "<one of: $employeesOptions, or empty>",
  "delivery_radius": "<one of: $deliveryOptions, or empty>",
  "certifications": "<any certifications like GST registered, etc.>"
}

Rules:
- business_name must be the TRADE NAME, not the legal/proprietor name
- For products_offered, infer specific products from "nature of business" field (like "Supplier of Services" or "Wholesale Trader" etc.) combined with trade name context. Be specific to Indian market.
- For category, pick the BEST matching category from the allowed list
- For business_type, pick the BEST matching type based on constitution (ctb) and nature fields
- For city, extract just the city/district name, not the full address
- Return ONLY valid JSON, no markdown, no explanation
PROMPT;

// ── Call Groq API ──────────────────────────────────────────────
$groqKey = defined("GROQ_KEY") ? GROQ_KEY : "";
if (!$groqKey) {
    respond(["success" => false, "error" => "GROQ_KEY not configured"]);
}

$ch = curl_init("https://api.groq.com/openai/v1/chat/completions");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HTTPHEADER     => [
        "Authorization: Bearer $groqKey",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "model"       => "llama-3.3-70b-versatile",
        "temperature" => 0.1,
        "max_tokens"  => 800,
        "messages"    => [
            [
                "role"    => "system",
                "content" => "Return only valid JSON. No markdown. No explanation. No code fences."
            ],
            [
                "role"    => "user",
                "content" => $prompt
            ],
        ],
    ]),
]);

$response = curl_exec($ch);
$curlErr  = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($curlErr) {
    respond(["success" => false, "error" => "Groq request failed: $curlErr"]);
}
if ($httpCode !== 200) {
    respond(["success" => false, "error" => "Groq HTTP $httpCode", "raw" => substr($response, 0, 300)]);
}

$groqResp = json_decode($response, true);
$content  = $groqResp["choices"][0]["message"]["content"] ?? "";

if (!$content) {
    respond(["success" => false, "error" => "Empty Groq response"]);
}

// Clean markdown fences if any
$content = trim($content);
$content = preg_replace('/^```(?:json)?\s*/i', '', $content);
$content = preg_replace('/\s*```$/i', '', $content);

$parsed = json_decode($content, true);
if (!$parsed || !is_array($parsed)) {
    respond(["success" => false, "error" => "Could not parse AI response", "raw_content" => substr($content, 0, 500)]);
}

// ── Save to SQL if seller_id provided ──────────────────────────
if ($sellerId > 0) {
    try {
        $pdo = db();

        // Verify seller exists
        $chk = $pdo->prepare("SELECT id FROM sellers WHERE id = ?");
        $chk->execute([$sellerId]);
        if ($chk->fetch()) {
            // Update sellers table
            $stmt = $pdo->prepare("UPDATE sellers SET
                name     = COALESCE(NULLIF(?, ''), name),
                category = COALESCE(NULLIF(?, ''), category),
                city     = COALESCE(NULLIF(?, ''), city),
                state    = COALESCE(NULLIF(?, ''), state)
                WHERE id = ?");
            $stmt->execute([
                trim($parsed["business_name"] ?? ""),
                trim($parsed["category"]      ?? ""),
                trim($parsed["city"]          ?? ""),
                trim($parsed["state"]         ?? ""),
                $sellerId
            ]);

            // Upsert seller_details
            $exists = $pdo->prepare("SELECT id FROM seller_details WHERE seller_id = ?");
            $exists->execute([$sellerId]);

            $detailFields = [
                trim($parsed["gst_number"]       ?? ""),
                trim($parsed["business_type"]    ?? ""),
                "",  // year_established — not in GST data
                trim($parsed["employees"]        ?? ""),
                trim($parsed["annual_turnover"]  ?? ""),
                trim($parsed["products_offered"] ?? ""),
                trim($parsed["business_desc"]    ?? ""),
                trim($parsed["address"]          ?? ""),
                trim($parsed["pincode"]          ?? ""),
                trim($parsed["certifications"]   ?? ""),
                "",  // facebook_url
                "",  // instagram_url
                "",  // whatsapp
                "",  // working_hours
                trim($parsed["delivery_radius"]  ?? ""),
            ];

            if ($exists->fetch()) {
                $stmt = $pdo->prepare("UPDATE seller_details SET
                    gst_number       = COALESCE(NULLIF(?, ''), gst_number),
                    business_type    = COALESCE(NULLIF(?, ''), business_type),
                    year_established = COALESCE(NULLIF(?, ''), year_established),
                    employees        = COALESCE(NULLIF(?, ''), employees),
                    annual_turnover  = COALESCE(NULLIF(?, ''), annual_turnover),
                    products_offered = COALESCE(NULLIF(?, ''), products_offered),
                    business_desc    = COALESCE(NULLIF(?, ''), business_desc),
                    address          = COALESCE(NULLIF(?, ''), address),
                    pincode          = COALESCE(NULLIF(?, ''), pincode),
                    certifications   = COALESCE(NULLIF(?, ''), certifications),
                    facebook_url     = COALESCE(NULLIF(?, ''), facebook_url),
                    instagram_url    = COALESCE(NULLIF(?, ''), instagram_url),
                    whatsapp         = COALESCE(NULLIF(?, ''), whatsapp),
                    working_hours    = COALESCE(NULLIF(?, ''), working_hours),
                    delivery_radius  = COALESCE(NULLIF(?, ''), delivery_radius),
                    updated_at       = NOW()
                    WHERE seller_id  = ?");
                $stmt->execute(array_merge($detailFields, [$sellerId]));
            } else {
                $stmt = $pdo->prepare("INSERT INTO seller_details
                    (seller_id, gst_number, business_type, year_established,
                     employees, annual_turnover, products_offered, business_desc,
                     address, pincode, certifications, facebook_url, instagram_url,
                     whatsapp, working_hours, delivery_radius)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->execute(array_merge([$sellerId], $detailFields));
            }

            $parsed["saved_to_db"] = true;
        }
    } catch (Throwable $e) {
        $parsed["db_error"] = $e->getMessage();
    }
}

respond([
    "success" => true,
    "parsed"  => $parsed,
]);
?>
