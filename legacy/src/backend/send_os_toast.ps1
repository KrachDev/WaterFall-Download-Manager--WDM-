param(
    [ValidateSet("progress", "complete", "error", "clear")]
    [string]$action = "complete",
    [string]$title = "Download Complete",
    [string]$fileName = "DownloadedFile.zip",
    [string]$fileSize = "75.4 MB",
    [string]$savePath = "",
    [string]$errorMessage = "Download encountered an error.",
    [string]$speed = "0 KB/s",
    [double]$progress = 1.0,
    [string]$appId = "Waterfall.DownloadSuite"
)

try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)

    if ($action -eq "clear") {
        try { [Windows.UI.Notifications.ToastNotificationManager]::History.Remove("waterfall_progress_tag", "waterfall_group", $appId) } catch {}
        try { [Windows.UI.Notifications.ToastNotificationManager]::History.Remove("hydra_progress_tag", "hydra_group", $appId) } catch {}
        exit 0
    }

    if ($action -eq "progress") {
        $pct = [Math]::Min(100, [Math]::Max(0, [Math]::Round($progress * 100)))
        $pctStr = "$pct%"
        $valStr = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.00}", [Math]::Min(1.0, [Math]::Max(0.0, $progress)))

        $xmlText = @"
<toast scenario="reminder">
    <visual>
        <binding template="ToastGeneric">
            <text>$fileName</text>
            <text>$pctStr • $speed</text>
            <progress title="Waterfall Downloading" value="$valStr" valueStringOverride="$pctStr" status="Downloading ($speed)..."/>
        </binding>
    </visual>
</toast>
"@
        $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xmlDoc.LoadXml($xmlText)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)
        $toast.Tag = "waterfall_progress_tag"
        $toast.Group = "waterfall_group"
        $toast.SuppressPopup = $false

        $notifier.Show($toast)
        Write-Output "PROGRESS_TOAST_OK"
        exit 0
    }

    if ($action -eq "complete") {
        # Remove progress toast first
        try {
            [Windows.UI.Notifications.ToastNotificationManager]::History.Remove("waterfall_progress_tag", "waterfall_group", $appId)
            [Windows.UI.Notifications.ToastNotificationManager]::History.Remove("hydra_progress_tag", "hydra_group", $appId)
        } catch {}

        $escapedFile = [System.Security.SecurityElement]::Escape($fileName)
        $targetPath = if ($savePath) { $savePath } else { [System.IO.Path]::Combine([Environment]::GetFolderPath("UserProfile"), "Downloads") }

        $actionsXml = ""
        try {
            if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
                $fileUri = [System.Uri]::new($targetPath).AbsoluteUri
                $escapedFileUri = [System.Security.SecurityElement]::Escape($fileUri)
                $parentFolder = Split-Path $targetPath -Parent
                $folderUri = if ($parentFolder) { [System.Uri]::new($parentFolder).AbsoluteUri } else { "" }
                $escapedFolderUri = if ($folderUri) { [System.Security.SecurityElement]::Escape($folderUri) } else { "" }

                $actionsXml = @"
    <actions>
        <action content="Open File" arguments="$escapedFileUri" activationType="protocol"/>
        <action content="Open Folder" arguments="$escapedFolderUri" activationType="protocol"/>
    </actions>
"@
            } else {
                $folderUri = [System.Uri]::new($targetPath).AbsoluteUri
                $escapedFolderUri = [System.Security.SecurityElement]::Escape($folderUri)
                $actionsXml = @"
    <actions>
        <action content="Open Folder" arguments="$escapedFolderUri" activationType="protocol"/>
    </actions>
"@
            }
        } catch {}

        $xmlText = @"
<toast duration="long">
    <visual>
        <binding template="ToastGeneric">
            <text>✓ Download Complete — Waterfall</text>
            <text>$escapedFile ($fileSize)</text>
            <text>Click Open File or Open Folder below</text>
        </binding>
    </visual>
$actionsXml
</toast>
"@
        $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xmlDoc.LoadXml($xmlText)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)
        $toast.Tag = "waterfall_complete_$([Guid]::NewGuid().ToString('N'))"
        $toast.Group = "waterfall_group"

        $notifier.Show($toast)
        Write-Output "COMPLETE_TOAST_OK"
        exit 0
    }

    if ($action -eq "error") {
        # Remove progress toast first
        try {
            [Windows.UI.Notifications.ToastNotificationManager]::History.Remove("waterfall_progress_tag", "waterfall_group", $appId)
            [Windows.UI.Notifications.ToastNotificationManager]::History.Remove("hydra_progress_tag", "hydra_group", $appId)
        } catch {}

        $escapedFile = [System.Security.SecurityElement]::Escape($fileName)
        $escapedError = [System.Security.SecurityElement]::Escape($errorMessage)

        $xmlText = @"
<toast duration="long">
    <visual>
        <binding template="ToastGeneric">
            <text>✕ Download Failed — Waterfall</text>
            <text>$escapedFile</text>
            <text>$escapedError</text>
        </binding>
    </visual>
    <actions>
        <action content="Open Waterfall" arguments="http://localhost:4567" activationType="protocol"/>
    </actions>
</toast>
"@
        $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xmlDoc.LoadXml($xmlText)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)
        $toast.Tag = "waterfall_error_$([Guid]::NewGuid().ToString('N'))"
        $toast.Group = "waterfall_group"

        $notifier.Show($toast)
        Write-Output "ERROR_TOAST_OK"
        exit 0
    }
} catch {
    Write-Output "TOAST_ERR: $($_.Exception.Message)"
}
