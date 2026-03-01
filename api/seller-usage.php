<?php
ob_start();
ini_set("display_errors", 0);
error_reporting(0);

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    ob_end_clean(); echo json_encode(["success" => true]); exit;
}

function respond($d) { ob_end_clean(); echo json_encode($d); exit; }

if (!file_exists(__DIR__ . "/config.php"))
    respond(["success" => false, "error" => "config.php missing"]);
try { require __DIR__ . "/config.php"; }
catch (Throwable $e) { respond(["success" => false, "error" => $e->getMessage()]); }

// Accept seller_id from GET param or POST JSON body
$sid = 0;
if (!empty($_GET["seller_id"])) {
    $sid = (int)$_GET["seller_id"];
} else {
    $raw  = file_get_contents("php://input");
    $data = json_decode($raw, true);
    $sid  = (int)($data["seller_id"] ?? 0);
}

if (!$sid) respond(["success" => false, "error" => "seller_id required"]);

try {
    // Ensure table exists
    try { db()->exec("CREATE TABLE IF NOT EXISTS seller_usage (
        id INT AUTO_INCREMENT PRIMARY KEY, seller_id INT NOT NULL,
        feature VARCHAR(50) NOT NULL DEFAULT 'analyze',
        used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_usage (seller_id, feature, used_at)
    ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4"); } catch (Throwable $_) {}

    $rows = db()->prepare("
        SELECT feature,
               SUM(CASE WHEN YEAR(used_at)=YEAR(NOW()) AND MONTH(used_at)=MONTH(NOW()) THEN 1 ELSE 0 END) AS this_month,
               COUNT(*) AS total
        FROM seller_usage
        WHERE seller_id=?
        GROUP BY feature
    ");
    $rows->execute([$sid]);
    $usage = $rows->fetchAll();

    $tierRow = db()->prepare("SELECT COALESCE(subscription_tier,'free') AS tier FROM sellers WHERE id=?");
    $tierRow->execute([$sid]);
    $tierData = $tierRow->fetch();

    if (!$tierData) respond(["success" => false, "error" => "Seller not found"]);

    $limits = defined('TIER_LIMITS') ? TIER_LIMITS : ["free" => 2, "basic" => 10, "pro" => 30, "enterprise" => -1];

    respond([
        "success"   => true,
        "seller_id" => $sid,
        "tier"      => $tierData["tier"] ?? "free",
        "limits"    => $limits,
        "usage"     => $usage,
    ]);
} catch (Throwable $e) {
    respond(["success" => false, "error" => "DB error: " . $e->getMessage()]);
}
?>
